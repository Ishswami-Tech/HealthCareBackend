import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe, Logger, LogLevel, INestApplication, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from '@core/filters/http-exception.filter';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCompress from '@fastify/compress';
import fastifyMultipart from '@fastify/multipart';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { swaggerConfig, swaggerCustomOptions } from './config/swagger.config';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel as AppLogLevel } from '@core/types';
import developmentConfig from './config/environment/development.config';
import productionConfig from './config/environment/production.config';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@infrastructure/database';
import { LoggingInterceptor } from '@infrastructure/logging/logging.interceptor';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cluster from 'cluster';
import * as os from 'os';
import {
  AuthenticatedRequest,
  RateLimitContext,
  SerializedRequest,
  SocketConnection,
  WorkerProcess,
  FastifyLoggerConfig,
} from '@core/types';
import type { RedisClient } from '@core/types/common.types';

// Store original console methods
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  debug: console.debug,
  info: console.info,
};

// Declare Redis client variables at module level
let pubClient: RedisClient | null = null;
let subClient: RedisClient | null = null;

// Store adapter reference for graceful shutdown
// Type will be inferred from assignment
let customWebSocketAdapter: IoAdapter | null = null;

// Function to redirect only HTTP logs to the logging service
// but keep important service logs visible in the console
function setupConsoleRedirect(loggingService: LoggingService) {
  if (!loggingService) return;

  // We'll keep all console logs as they are,
  // but only filter FastifyAdapter logs for HTTP requests
}

// Add environment type
const validEnvironments = ['development', 'production'] as const;
type Environment = (typeof validEnvironments)[number];

/**
 * Configure production middleware for high performance and security
 */
async function configureProductionMiddleware(
  app: NestFastifyApplication,
  configService: ConfigService,
  logger: Logger
): Promise<void> {
  logger.log(' Configuring production middleware...');

  // Compression middleware
  // Note: Type assertion required due to Fastify plugin type incompatibilities
  // with NestJS FastifyAdapter. This is a known limitation of third-party types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fastifyCompress as unknown as any, {
    global: true,
    threshold: 1024,
    encodings: ['gzip', 'deflate', 'br'],
    brotliOptions: {
      quality: 4,
      windowBits: 22,
      mode: 'text',
    },
    gzipOptions: {
      level: 6,
      windowBits: 15,
      memLevel: 8,
    },
  });

  // Rate limiting middleware
  // Note: Type assertion required due to Fastify plugin type incompatibilities
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fastifyRateLimit as any, {
    max: parseInt(process.env['RATE_LIMIT_MAX'] || '1000', 10),
    timeWindow: process.env['RATE_LIMIT_WINDOW'] || '1 minute',
    redis: configService.get('REDIS_URL')
      ? {
          host: configService.get('REDIS_HOST'),
          port: configService.get('REDIS_PORT'),
          password: configService.get('REDIS_PASSWORD'),
        }
      : undefined,
    keyGenerator: (request: Partial<AuthenticatedRequest>) => {
      return `${request.ip}:${request.headers?.['user-agent'] || 'unknown'}`;
    },
    errorResponseBuilder: (request: Partial<AuthenticatedRequest>, context: RateLimitContext) => {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${Math.round(context.ttl / 1000)} seconds.`,
        retryAfter: Math.round(context.ttl / 1000),
      };
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  // Multipart form data handling
  // Note: Type assertion required due to Fastify plugin type incompatibilities
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fastifyMultipart as any, {
    limits: {
      fieldNameSize: 100,
      fieldSize: 1000000, // 1MB
      fields: 10,
      fileSize: 50 * 1024 * 1024, // 50MB
      files: 5,
      headerPairs: 2000,
    },
    attachFieldsToBody: true,
  });

  // Enable API versioning
  app.enableVersioning({
    type: VersioningType.HEADER,
    header: 'X-API-Version',
    defaultVersion: '1',
  });

  // Enable shutdown hooks for graceful shutdown
  app.enableShutdownHooks();

  // Set global prefix
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'metrics', 'docs', { path: 'docs/(.*)', method: 'GET' as any }],
  });

  logger.log(' Production middleware configured');
}

/**
 * Production clustering setup for high concurrency
 */
function setupProductionClustering(): boolean {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const enableClustering = process.env['ENABLE_CLUSTERING'] === 'true';

  if (!isProduction || !enableClustering) {
    return false;
  }

  const numCPUs = os.cpus().length;
  const workerCount = Math.max(1, numCPUs - 1);

  if (cluster.isPrimary) {
    console.log(` Primary process ${process.pid} starting with ${workerCount} workers`);

    // Fork workers
    for (let i = 0; i < workerCount; i++) {
      const worker = cluster.fork();
      console.log(` Worker ${worker.process.pid} started`);
    }

    // Handle worker deaths and respawn
    cluster.on('exit', (worker: WorkerProcess, code: number | null, signal: string | null) => {
      const pid = worker.process.pid;

      if (signal) {
        console.log(` Worker ${pid} killed by signal: ${signal}`);
      } else if (code !== 0 && code !== null) {
        console.error(` Worker ${pid} exited with error code: ${code}`);
      } else {
        console.log(` Worker ${pid} exited successfully`);
      }

      // Respawn worker if not in shutdown mode
      if (!worker.exitedAfterDisconnect) {
        console.log(' Respawning worker...');
        const newWorker = cluster.fork();
        console.log(` New worker ${newWorker.process.pid} started`);
      }
    });

    // Graceful shutdown for cluster
    const shutdownCluster = async (signal: string) => {
      console.log(`${signal} received, shutting down cluster gracefully...`);

      const workers = Object.values(cluster.workers || {});

      // Disconnect all workers
      for (const worker of workers) {
        if (worker && !worker.isDead()) {
          worker.disconnect();
        }
      }

      // Wait for workers to finish
      const shutdownTimeout = setTimeout(() => {
        console.error(' Force killing workers after timeout');
        workers.forEach(worker => {
          if (worker && !worker.isDead()) {
            worker.kill('SIGKILL');
          }
        });
        process.exit(1);
      }, 30000);

      // Wait for all workers to exit
      const exitPromises = workers.map(worker => {
        if (!worker || worker.isDead()) return Promise.resolve();
        return new Promise<void>(resolve => {
          worker.on('disconnect', resolve);
          worker.on('exit', resolve);
        });
      });

      await Promise.all(exitPromises);
      clearTimeout(shutdownTimeout);
      console.log(' All workers shutdown successfully');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdownCluster('SIGTERM'));
    process.on('SIGINT', () => shutdownCluster('SIGINT'));

    return true; // This is the master process
  } else {
    // Worker process
    process.title = `healthcare-worker-${cluster.worker?.id}`;
    process.env['WORKER_ID'] = cluster.worker?.id?.toString() || '0';
    console.log(` Worker ${process.pid} (ID: ${cluster.worker?.id}) initialized`);
    return false; // Continue with normal bootstrap
  }
}

async function bootstrap() {
  // Setup clustering for production
  if (setupProductionClustering()) {
    return; // This is the master process, workers will handle requests
  }

  // Detect horizontal scaling mode (Docker containers)
  const isHorizontalScaling = process.env['CLUSTER_MODE'] === 'horizontal';
  const instanceId = process.env['INSTANCE_ID'] || process.env['WORKER_ID'] || '1';
  const workerId = process.env['WORKER_ID'] || cluster.worker?.id || instanceId;

  const logger = new Logger(`Bootstrap-${instanceId}`);
  let app: (NestFastifyApplication & INestApplication) | undefined;
  let loggingService: LoggingService | undefined;

  try {
    logger.log(
      ` Starting Healthcare API bootstrap (Instance: ${instanceId}, Worker: ${workerId})...`
    );

    if (isHorizontalScaling) {
      logger.log(` Horizontal scaling mode detected - Instance ${instanceId}`);
      process.title = `healthcare-api-${instanceId}`;
    }

    const environment = process.env['NODE_ENV'] as Environment;
    if (!validEnvironments.includes(environment)) {
      throw new Error(
        `Invalid NODE_ENV: ${environment}. Must be one of: ${validEnvironments.join(', ')}`
      );
    }

    const envConfig = environment === 'production' ? productionConfig() : developmentConfig();

    // Configure Fastify logger based on environment
    const loggerConfig: FastifyLoggerConfig = {
      level: process.env['NODE_ENV'] === 'production' ? 'warn' : 'info',
      serializers: {
        req: (req: Partial<AuthenticatedRequest>): SerializedRequest => {
          // Skip detailed logging for health check and common endpoints
          if (
            req.url === '/health' ||
            req.url === '/api-health' ||
            req.url?.includes('socket.io') ||
            req.url?.includes('/logs/')
          ) {
            return {
              method: req.method || 'GET',
              url: req.url || '',
              skip: true,
            };
          }
          return {
            method: req.method || 'GET',
            url: req.url || '',
            headers: req.headers as Record<string, unknown>,
          };
        },
        res: (res: { statusCode?: number }) => ({
          statusCode: res.statusCode || 200,
        }),
        err: (err: unknown) => ({
          type: 'ERROR',
          message: (err as any).message,
          stack: (err as any).stack || 'No stack trace',
        }),
      },
    };

    // Add pretty printing only in development
    if (process.env['NODE_ENV'] !== 'production') {
      loggerConfig['transport'] = {
        target: 'pino-pretty',
        options: {
          translateTime: false,
          ignore: 'pid,hostname',
          messageFormat: '{msg}',
          colorize: true,
        },
      };
    }

    // Production optimized Fastify adapter with horizontal scaling support
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({
        // Note: loggerConfig type assertion needed due to FastifyAdapter logger type expectations
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        logger: loggerConfig as any,
        disableRequestLogging: true,
        requestIdLogLabel: 'requestId',
        requestIdHeader: 'x-request-id',
        trustProxy: envConfig.security.trustProxy === 1,

        // Production performance optimizations
        bodyLimit: environment === 'production' ? 50 * 1024 * 1024 : 10 * 1024 * 1024, // 50MB in prod
        keepAliveTimeout: environment === 'production' ? 65000 : 5000,
        maxParamLength: 500,
        connectionTimeout: environment === 'production' ? 60000 : 30000,
        requestTimeout: environment === 'production' ? 30000 : 10000,

        // Horizontal scaling optimizations
        ...(isHorizontalScaling && {
          serverFactory: (handler: unknown, opts: Record<string, unknown>) => {
            // Enhanced server configuration for load balanced instances
            const server = require('fastify')({
              ...(opts || {}),
              ignoreTrailingSlash: true,
              caseSensitive: false,
              // Optimize for high concurrency across instances
              pluginTimeout: 30000,
              requestIdHeader: `x-request-id-${instanceId}`,
            });
            return server;
          },
        }),

        // HTTP/2 support for production
        ...(environment === 'production' && process.env['ENABLE_HTTP2'] === 'true'
          ? ({ http2: true } as { http2: true })
          : {}),
      }),
      {
        logger:
          process.env['NODE_ENV'] === 'production'
            ? ['error', 'warn']
            : (['error', 'warn', 'log'] as LogLevel[]),
        bufferLogs: true,
        cors: false, // Will be configured separately
      }
    );

    // Initialize core services
    const configService = app.get(ConfigService);
    loggingService = app.get(LoggingService);
    logger.log('Core services initialized');
    const eventEmitter = new EventEmitter2();

    // Set up console redirection to the logging service
    if (loggingService) {
      setupConsoleRedirect(loggingService);
    }

    // Configure production middleware
    if (environment === 'production') {
      await configureProductionMiddleware(app, configService, logger);
    }

    // Apply global interceptor for logging
    if (loggingService) {
      app.useGlobalInterceptors(new LoggingInterceptor(loggingService));
    }

    // Apply global pipes and filters with error logging
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        exceptionFactory: errors => {
          const formattedErrors = errors.map(_error => ({
            field: _error.property,
            constraints: _error.constraints,
          }));

          if (loggingService) {
            loggingService.log(
              LogType.ERROR,
              AppLogLevel.ERROR,
              'Validation failed',
              'ValidationPipe',
              { errors: formattedErrors }
            );
          }

          return {
            type: 'VALIDATION_ERROR',
            message: 'Validation failed',
            stack: new Error().stack,
            errors: formattedErrors,
          };
        },
      })
    );
    if (loggingService) {
      app.useGlobalFilters(new HttpExceptionFilter(loggingService));
    }
    logger.log('Global pipes and filters configured');

    // Log application startup
    if (loggingService) {
      await loggingService.log(
        LogType.SYSTEM,
        AppLogLevel.INFO,
        'Application bootstrap started',
        'Bootstrap',
        { timestamp: new Date() }
      );
    }

    // Set up WebSocket adapter with Redis
    try {
      const { createAdapter } = await import('@socket.io/redis-adapter');
      const { createClient } = await import('redis');

      // Redis client configuration with improved error handling
      const redisConfig = {
        url: `redis://${configService.get('REDIS_HOST', '127.0.0.1').trim()}:${configService.get('REDIS_PORT', '6379').trim()}`,
        password: configService.get('REDIS_PASSWORD'),
        retryStrategy: (times: number) => {
          const maxRetries = 5;
          if (times > maxRetries) {
            logger.error(`Redis connection failed after ${maxRetries} retries`);
            return null; // Stop retrying
          }
          const maxDelay = 3000;
          const delay = Math.min(times * 100, maxDelay);
          logger.log(`Redis reconnection attempt ${times}, delay: ${delay}ms`);
          return delay;
        },
      };

      try {
        // Type assertion needed due to Redis client type incompatibility
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pubClient = createClient(redisConfig) as any as RedisClient;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        subClient = (pubClient as any).duplicate() as RedisClient;

        // Enhanced Redis connection event handling
        const handleRedisError = async (client: string, err: Error) => {
          try {
            await loggingService?.log(
              LogType.ERROR,
              AppLogLevel.ERROR,
              `Redis ${client} Client Error: ${err.message}`,
              'Redis',
              { client, _error: err.message, stack: err.stack }
            );
          } catch (logError) {
            // If logging service fails, use original console
            originalConsole.error(`Redis ${client} Client Error:`, err);
          }
        };

        const handleRedisConnect = async (client: string) => {
          try {
            await loggingService?.log(
              LogType.SYSTEM,
              AppLogLevel.INFO,
              `Redis ${client} Client Connected`,
              'Redis',
              { client }
            );
          } catch (logError) {
            originalConsole.log(`Redis ${client} Client Connected`);
          }
        };

        // Set up event handlers
        if (pubClient) {
          pubClient.on('error', (err: unknown) => handleRedisError('Pub', err as Error));
          pubClient.on('connect', () => handleRedisConnect('Pub'));
        }
        if (subClient) {
          subClient.on('error', (err: unknown) => handleRedisError('Sub', err as Error));
          subClient.on('connect', () => handleRedisConnect('Sub'));
        }

        // Connect with timeout
        const connectWithTimeout = async (client: RedisClient, name: string) => {
          return Promise.race([
            client.connect(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`${name} client connection timeout`)), 10000)
            ),
          ]);
        };

        if (pubClient && subClient) {
          await Promise.all([
            connectWithTimeout(pubClient, 'Pub'),
            connectWithTimeout(subClient, 'Sub'),
          ]);
        }

        class CustomIoAdapter extends IoAdapter {
          private adapterConstructor: ReturnType<typeof createAdapter>;

          constructor(app: INestApplication) {
            super(app);
            if (!pubClient || !subClient) {
              throw new Error('Redis clients must be initialized before creating adapter');
            }
            this.adapterConstructor = createAdapter(pubClient, subClient);
          }

          createIOServer(port: number, options?: Record<string, unknown>) {
            const server = super.createIOServer(port, {
              ...(options || {}),
              cors: {
                origin:
                  process.env['NODE_ENV'] === 'production'
                    ? process.env['CORS_ORIGIN']?.split(',') || ['https://ishswami.in']
                    : '*',
                methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
                credentials: true,
                allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
              },
              path: '/socket.io',
              serveClient: true,
              transports: ['websocket', 'polling'],
              allowEIO3: true,
              pingTimeout: 60000,
              pingInterval: 25000,
              connectTimeout: 45000,
              maxHttpBufferSize: 1e6,
              allowUpgrades: true,
              cookie: false,
            });

            server.adapter(this.adapterConstructor);

            // Health check endpoint
            server.of('/health').on('connection', (socket: SocketConnection) => {
              socket.emit('health', {
                status: 'healthy',
                timestamp: new Date(),
                environment: process.env['NODE_ENV'],
              });
            });

            // Test namespace with improved error handling
            server.of('/test').on('connection', (socket: SocketConnection) => {
              logger.log('Client connected to test namespace');

              let heartbeat: NodeJS.Timeout;

              // Send a welcome message and start heartbeat
              const startHeartbeat = () => {
                socket.emit('welcome', {
                  message: 'Connected to WebSocket server',
                  timestamp: new Date().toISOString(),
                  environment: process.env['NODE_ENV'],
                });

                heartbeat = setInterval(() => {
                  socket.emit('heartbeat', {
                    timestamp: new Date().toISOString(),
                  });
                }, 30000); // 30 second heartbeat
              };

              startHeartbeat();

              // Handle disconnection
              socket.on('disconnect', () => {
                clearInterval(heartbeat);
                logger.log('Client disconnected from test namespace');
              });

              // Echo messages with error handling
              socket.on('message', (data: unknown) => {
                try {
                  socket.emit('echo', {
                    original: data,
                    timestamp: new Date().toISOString(),
                    processed: true,
                  });
                } catch (_error) {
                  logger.error('Error processing socket message:', _error);
                  socket.emit('_error', {
                    message: 'Failed to process message',
                    timestamp: new Date().toISOString(),
                  });
                }
              });

              // Handle errors
              socket.on('error', (_error: unknown) => {
                logger.error('Socket _error:', _error);
                clearInterval(heartbeat);
              });
            });

            return server;
          }
        }

        customWebSocketAdapter = new CustomIoAdapter(app);
        app.useWebSocketAdapter(customWebSocketAdapter);

        logger.log('WebSocket adapter configured successfully');

        await loggingService?.log(
          LogType.SYSTEM,
          AppLogLevel.INFO,
          'WebSocket adapter configured successfully',
          'WebSocket'
        );
      } catch (redisError) {
        logger.warn('Failed to initialize Redis adapter:', redisError);
        await loggingService?.log(
          LogType.ERROR,
          AppLogLevel.WARN,
          'Continuing without Redis adapter',
          'WebSocket'
        );
      }
    } catch (_error) {
      await loggingService?.log(
        LogType.ERROR,
        AppLogLevel.ERROR,
        `WebSocket adapter initialization failed: ${_error instanceof Error ? _error.message : 'Unknown _error'}`,
        'WebSocket',
        {
          _error: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      // Don't throw, continue without WebSocket
      logger.warn('Continuing without WebSocket support');
    }

    // Enable CORS with specific configuration
    app.enableCors({
      origin:
        process.env['NODE_ENV'] === 'production'
          ? [
              'https://ishswami.in',
              'https://www.ishswami.in',
              /\.ishswami\.in$/,
              'http://localhost:3000', // Allow local development frontend
              'https://accounts.google.com',
              'https://oauth2.googleapis.com',
              'https://www.googleapis.com',
            ]
          : [
              'http://localhost:3000',
              'http://localhost:8088',
              'http://localhost:5050',
              'http://localhost:8082',
              'https://accounts.google.com',
              'https://oauth2.googleapis.com',
              'https://www.googleapis.com',
            ],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Session-ID',
        'X-Clinic-ID',
        'Origin',
        'Accept',
        'X-Requested-With',
        'Access-Control-Request-Method',
        'Access-Control-Request-Headers',
        'X-Client-Data',
        'Sec-Fetch-Site',
        'Sec-Fetch-Mode',
        'Sec-Fetch-Dest',
      ],
      exposedHeaders: ['Set-Cookie', 'Authorization'],
      maxAge: 86400, // 24 hours
    });

    // Add preflight handler for all routes
    const fastifyInstance = app.getHttpAdapter().getInstance();
    fastifyInstance.addHook('onRequest', (request, reply, done) => {
      // Handle preflight requests
      if (request.method === 'OPTIONS') {
        const origin = request.headers.origin;
        if (origin) {
          const allowedOrigins =
            process.env['NODE_ENV'] === 'production'
              ? ['https://ishswami.in', 'https://www.ishswami.in', 'http://localhost:3000'] // Allow local development frontend
              : [
                  'http://localhost:3000',
                  'http://localhost:8088',
                  'http://localhost:5050',
                  'http://localhost:8082',
                ];

          if (allowedOrigins.includes(origin) || /\.ishswami\.in$/.test(origin)) {
            reply.header('Access-Control-Allow-Origin', origin);
            reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
            reply.header(
              'Access-Control-Allow-Headers',
              'Content-Type, Authorization, X-Session-ID, X-Clinic-ID, Origin, Accept, X-Requested-With, Access-Control-Request-Method, Access-Control-Request-Headers, X-Client-Data, Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest'
            );
            reply.header('Access-Control-Allow-Credentials', 'true');
            reply.header('Access-Control-Max-Age', '86400');
            reply.send();
            return;
          }
        }
      }
      done();
    });

    // Add bot scan detection hook to reduce log noise
    fastifyInstance.addHook('onRequest', (request, reply, done) => {
      const path = request.url;
      const userAgent = request.headers['user-agent'] || '';

      // Check if this is likely a bot scan
      const isBotScan =
        path.includes('admin') ||
        path.includes('wp-') ||
        path.includes('php') ||
        path.includes('cgi-bin') ||
        path.includes('config') ||
        userAgent.toLowerCase().includes('bot') ||
        userAgent.toLowerCase().includes('crawler') ||
        userAgent.toLowerCase().includes('spider');

      if (isBotScan) {
        // For bot scans, return 404 immediately without further processing
        reply.status(404).send({ _error: 'Not Found' });
        return;
      }

      done();
    });

    // Configure Fastify security headers
    // Note: Type assertion required due to Fastify plugin type incompatibilities
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await app.register(fastifyHelmet as any, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            "'unsafe-eval'",
            'https://accounts.google.com',
            'https://apis.google.com',
            'https://www.googleapis.com',
          ],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
          connectSrc: [
            "'self'",
            'http://localhost:3000',
            'https://ishswami.in',
            'https://www.ishswami.in',
            'https://api.ishswami.in',
            'wss://api.ishswami.in',
            'https://accounts.google.com',
            'https://oauth2.googleapis.com',
            'https://www.googleapis.com',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          frameSrc: ["'self'", 'https://accounts.google.com'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'", 'https://accounts.google.com', 'http://localhost:3000'],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    });

    // Configure Swagger with environment variables
    const port = configService.get('PORT') || configService.get('VIRTUAL_PORT') || 8088;
    const virtualHost = configService.get('VIRTUAL_HOST') || 'localhost';
    const apiUrl = configService.get('API_URL');
    const swaggerUrl = configService.get('SWAGGER_URL') || '/docs';
    const bullBoardUrl = configService.get('BULL_BOARD_URL') || '/queue-dashboard';
    const socketUrl = configService.get('SOCKET_URL') || '/socket.io';
    const redisCommanderUrl = configService.get('REDIS_COMMANDER_URL');
    const prismaStudioUrl = configService.get('PRISMA_STUDIO_URL');
    const loggerUrl = configService.get('LOGGER_URL') || '/logger';

    const document = SwaggerModule.createDocument(app, swaggerConfig);

    // Add environment-specific Swagger setup
    if (process.env['NODE_ENV'] === 'production') {
      // In production, add CORS and security headers for Swagger UI
      // Note: Type assertion required due to Fastify plugin type incompatibilities
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await fastifyInstance.register(fastifyHelmet as unknown as any, {
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'https:', 'data:'],
          },
        },
      });
    }

    SwaggerModule.setup(swaggerUrl.replace('/', ''), app, document, {
      ...swaggerCustomOptions,
      swaggerOptions: {
        ...swaggerCustomOptions.swaggerOptions,
        // Set the default server based on environment
        urls: [
          {
            url: `${apiUrl}${swaggerUrl}/swagger.json`,
            name: process.env['NODE_ENV'] === 'production' ? 'Production' : 'Development',
          },
        ],
      },
    });

    logger.log(`Swagger API documentation configured for ${process.env['NODE_ENV']} environment`);

    // Start the server with improved error handling
    try {
      const port = envConfig.app.port;
      const host = envConfig.app.host;
      const bindAddress = envConfig.app.bindAddress;

      await app.listen(port, bindAddress);

      logger.log(`Application is running in ${envConfig.app.environment} mode:`);
      logger.log(`- Local: http://${host}:${port}`);
      logger.log(`- Base URL: ${envConfig.app.baseUrl}`);
      logger.log(
        `- Swagger Docs: ${envConfig.app.environment === 'production' ? envConfig.app.apiUrl : envConfig.app.baseUrl}${envConfig.urls.swagger}`
      );
      logger.log(`- Health Check: ${envConfig.app.baseUrl}/health`);

      if (envConfig.app.environment === 'development') {
        const devConfig = envConfig;
        logger.log('Development services:');
        logger.log(`- Redis Commander: ${devConfig.urls.redisCommander}`);
        logger.log(`- Prisma Studio: ${devConfig.urls.prismaStudio}`);
        logger.log(`- PgAdmin: ${devConfig.urls.pgAdmin}`);
      }

      // Graceful shutdown handlers
      const signals = ['SIGTERM', 'SIGINT'];

      signals.forEach(signal => {
        process.on(signal, async () => {
          logger.log(`Received ${signal}, starting graceful shutdown...`);

          const shutdownTimeout = setTimeout(() => {
            logger.error('Shutdown timed out, forcing exit');
            process.exit(1);
          }, 10000);

          try {
            // Close WebSocket connections gracefully
            if (customWebSocketAdapter && app) {
              logger.log('Closing WebSocket connections...');
              try {
                const httpServer = app.getHttpServer();
                if (httpServer && typeof httpServer.close === 'function') {
                  await new Promise<void>(resolve => {
                    const timeout = setTimeout(() => {
                      logger.warn('WebSocket server close timeout, continuing...');
                      resolve();
                    }, 3000);

                    httpServer.close(err => {
                      clearTimeout(timeout);
                      if (err) {
                        logger.warn('Error closing WebSocket server:', err);
                      } else {
                        logger.log('WebSocket server closed successfully');
                      }
                      resolve();
                    });
                  });
                }
                customWebSocketAdapter = null;
              } catch (wsError) {
                logger.warn('Error during WebSocket cleanup:', wsError);
              }
            }

            // Close database connections
            try {
              if (app) {
                const databaseService = await app.resolve(DatabaseService);
                if (databaseService) {
                  logger.log('Closing database connections...');
                  await databaseService.disconnect();
                }
              }
            } catch (databaseError) {
              logger.warn('Error closing database connections:', databaseError);
            }

            // Close Redis connections
            if (pubClient) {
              logger.log('Closing Redis pub connection...');
              await pubClient.quit();
            }
            if (subClient) {
              logger.log('Closing Redis sub connection...');
              await subClient.quit();
            }

            // Close the app
            if (app) {
              await app.close();
            }

            clearTimeout(shutdownTimeout);
            logger.log('Application shut down successfully');
            process.exit(0);
          } catch (_error) {
            clearTimeout(shutdownTimeout);
            logger.error('Error during shutdown:', _error);
            process.exit(1);
          }
        });
      });
    } catch (listenError) {
      await loggingService?.log(
        LogType.ERROR,
        AppLogLevel.ERROR,
        `Failed to start server: ${listenError instanceof Error ? listenError.message : 'Unknown error'}`,
        'Bootstrap',
        { _error: listenError instanceof Error ? listenError.stack : '' }
      );
      throw new Error(
        `Server startup failed: ${listenError instanceof Error ? listenError.message : 'Unknown error'}`
      );
    }

    // Enhanced error handling for uncaught exceptions
    process.on('uncaughtException', async _error => {
      try {
        await loggingService?.log(
          LogType.ERROR,
          AppLogLevel.ERROR,
          `Uncaught Exception: ${_error.message}`,
          'Process',
          { _error: _error.stack }
        );
      } catch (logError) {
        console.error('Failed to log uncaught exception:', logError);
        console.error('Original _error:', _error);
      }
      process.exit(1);
    });

    // Enhanced error handling for unhandled rejections
    process.on('unhandledRejection', async (reason, promise) => {
      try {
        await loggingService?.log(
          LogType.ERROR,
          AppLogLevel.ERROR,
          'Unhandled Rejection',
          'Process',
          {
            reason: reason instanceof Error ? reason.stack : reason,
            promise: promise,
          }
        );
      } catch (logError) {
        console.error('Failed to log unhandled rejection:', logError);
        console.error('Original rejection:', reason);
      }
    });
  } catch (_error) {
    if (loggingService) {
      try {
        await loggingService.log(
          LogType.ERROR,
          AppLogLevel.ERROR,
          `Failed to start application: ${_error instanceof Error ? _error.message : 'Unknown _error'}`,
          'Bootstrap',
          {
            _error: _error instanceof Error ? _error.message : 'Unknown _error',
            stack: _error instanceof Error ? _error.stack : 'No stack trace available',
            details: _error,
          }
        );
      } catch (logError) {
        console.error('CRITICAL: Failed to log through LoggingService:', logError);
      }
    } else {
      console.error('CRITICAL: Failed to start application:', _error);
    }

    try {
      if (app) {
        await app.close();
      }
    } catch (closeError) {
      console.error('CRITICAL: Failed to close application:', closeError);
    }

    process.exit(1);
  }
}

bootstrap().catch(_error => {
  console.error('CRITICAL: Fatal error during bootstrap:', _error);
  process.exit(1);
});
