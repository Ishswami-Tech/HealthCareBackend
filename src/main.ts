/* eslint-disable no-console */
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule } from '@nestjs/swagger';
import fastify from 'fastify';
import {
  ValidationPipe,
  Logger,
  LogLevel,
  INestApplication,
  VersioningType,
  RequestMethod,
} from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from '@core/filters/http-exception.filter';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCompress from '@fastify/compress';
import fastifyMultipart from '@fastify/multipart';
import { swaggerConfig, swaggerCustomOptions } from './config/swagger.config';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel as AppLogLevel } from '@core/types';
import developmentConfig from './config/environment/development.config';
import productionConfig from './config/environment/production.config';
import { ConfigService } from '@config';
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

// Type helpers for Fastify plugin compatibility with NestJS FastifyAdapter
// These handle type incompatibilities between third-party Fastify plugins and NestJS types
type FastifyPlugin = Parameters<NestFastifyApplication['register']>[0];
type FastifyPluginOptions = Parameters<NestFastifyApplication['register']>[1];

// Helper function to safely register Fastify plugins with proper typing
async function registerFastifyPlugin<T extends FastifyPluginOptions>(
  app: NestFastifyApplication,
  plugin: unknown,
  options: T
): Promise<void> {
  // Type assertion is required due to third-party plugin type incompatibilities
  // We use unknown -> FastifyPlugin instead of any for better type safety
  // Ignore return value as plugins register themselves with the app
  await app.register(plugin as FastifyPlugin, options);
}

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
  // Type-safe plugin registration using helper function
  await registerFastifyPlugin(app, fastifyCompress, {
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
  // Type-safe plugin registration using helper function
  await registerFastifyPlugin(app, fastifyRateLimit, {
    max: parseInt(process.env['RATE_LIMIT_MAX'] || '1000', 10),
    timeWindow: process.env['RATE_LIMIT_WINDOW'] || '1 minute',
      redis: (configService?.get('REDIS_URL') || process.env['REDIS_URL'])
      ? {
          host: configService?.get<string>('REDIS_HOST') || process.env['REDIS_HOST'] || 'localhost',
          port: configService?.get<number>('REDIS_PORT') || parseInt(process.env['REDIS_PORT'] || '6379', 10),
          ...((configService?.get<string>('REDIS_PASSWORD') || process.env['REDIS_PASSWORD'])?.trim() && {
            password: (configService?.get<string>('REDIS_PASSWORD') || process.env['REDIS_PASSWORD'])?.trim(),
          }),
        }
      : undefined,
    keyGenerator: (request: Partial<AuthenticatedRequest>) => {
      const ip = request.ip || 'unknown';
      const userAgent = request.headers?.['user-agent'];
      const userAgentStr = typeof userAgent === 'string' ? userAgent : 'unknown';
      return `${ip}:${userAgentStr}`;
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
  // Type-safe plugin registration using helper function
  await registerFastifyPlugin(app, fastifyMultipart, {
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

  // Set global prefix - can be disabled by setting API_PREFIX to empty string
  const apiPrefix = configService?.get<string>('API_PREFIX') || process.env['API_PREFIX'] || 'api/v1';
  if (apiPrefix && apiPrefix.trim() !== '') {
    app.setGlobalPrefix(apiPrefix, {
      exclude: ['health', 'metrics', 'docs', { path: 'docs/*', method: RequestMethod.GET }],
    });
  }

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
    // Cluster logging is acceptable in production for process management

    console.warn(` Primary process ${process.pid} starting with ${workerCount} workers`);

    // Fork workers
    for (let i = 0; i < workerCount; i++) {
      const worker = cluster.fork();

      console.warn(` Worker ${worker.process.pid} started`);
    }

    // Handle worker deaths and respawn
    cluster.on('exit', (worker: WorkerProcess, code: number | null, signal: string | null) => {
      const pid = worker.process.pid;

      if (signal) {
        console.warn(` Worker ${pid} killed by signal: ${signal}`);
      } else if (code !== 0 && code !== null) {
        console.error(` Worker ${pid} exited with error code: ${code}`);
      } else {
        console.warn(` Worker ${pid} exited successfully`);
      }

      // Respawn worker if not in shutdown mode
      if (!worker.exitedAfterDisconnect) {
        console.warn(' Respawning worker...');
        const newWorker = cluster.fork();

        console.warn(` New worker ${newWorker.process.pid} started`);
      }
    });

    // Graceful shutdown for cluster
    const shutdownCluster = async (signal: string) => {
      console.warn(`${signal} received, shutting down cluster gracefully...`);

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

      console.warn(' All workers shutdown successfully');
      process.exit(0);
    };

    process.on('SIGTERM', () => {
      void shutdownCluster('SIGTERM');
    });
    process.on('SIGINT', () => {
      void shutdownCluster('SIGINT');
    });

    return true; // This is the master process
  } else {
    // Worker process
    process.title = `healthcare-worker-${cluster.worker?.id}`;
    process.env['WORKER_ID'] = cluster.worker?.id?.toString() || '0';

    console.warn(` Worker ${process.pid} (ID: ${cluster.worker?.id}) initialized`);
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

    // Production optimized Fastify adapter with horizontal scaling support
    // Disable Fastify's built-in logger - we use custom LoggingService instead
    // LoggingInterceptor and HttpExceptionFilter will handle all logging through LoggingService
    const fastifyAdapterOptions: Record<string, unknown> = {
      // Omit logger option - Fastify will use default no-op logger
      // Custom LoggingService handles all logging via NestJS logger system
      disableRequestLogging: true, // Disable Fastify request logging - LoggingInterceptor handles this
      requestIdLogLabel: 'requestId',
      requestIdHeader: isHorizontalScaling ? `x-request-id-${instanceId}` : 'x-request-id',
      trustProxy: envConfig.security.trustProxy === 1,

      // Production performance optimizations
      bodyLimit: environment === 'production' ? 50 * 1024 * 1024 : 10 * 1024 * 1024, // 50MB in prod
      keepAliveTimeout: environment === 'production' ? 65000 : 5000,
      connectionTimeout: environment === 'production' ? 60000 : 30000,
      requestTimeout: environment === 'production' ? 30000 : 10000,

      // Router options (moved from deprecated root-level properties)
      routerOptions: {
        caseSensitive: false,
        ignoreTrailingSlash: true,
        maxParamLength: 500,
      },

      // Horizontal scaling optimizations
      ...(isHorizontalScaling && {
        pluginTimeout: 30000,
      }),

      // HTTP/2 support for production
      ...(environment === 'production' && process.env['ENABLE_HTTP2'] === 'true'
        ? ({ http2: true } as { http2: true })
        : {}),
    };

    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(
        fastifyAdapterOptions as unknown as ConstructorParameters<typeof FastifyAdapter>[0]
      ),
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
            void loggingService.log(
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
      const redisHost = configService?.get<string>('REDIS_HOST') || process.env['REDIS_HOST'] || '127.0.0.1';
      const redisPort = configService?.get<string>('REDIS_PORT') || process.env['REDIS_PORT'] || '6379';
      const redisPassword = configService?.get<string>('REDIS_PASSWORD') || process.env['REDIS_PASSWORD'];
      // Only include password if it's actually set (Redis might not require auth if protected mode is disabled)
      const redisConfig = {
        url: `redis://${String(redisHost).trim()}:${String(redisPort).trim()}`,
        ...(redisPassword && redisPassword.trim() && { password: redisPassword }),
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
        // Type assertion for Redis client - using unknown for type safety
        // Redis client types don't perfectly align with our RedisClient type
        pubClient = createClient(redisConfig) as unknown as RedisClient;
        subClient = (
          pubClient as unknown as { duplicate: () => unknown }
        ).duplicate() as RedisClient;

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
          } catch (_logError) {
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
          } catch (_logError) {
            originalConsole.log(`Redis ${client} Client Connected`);
          }
        };

        // Set up event handlers
        if (pubClient) {
          pubClient.on('error', (err: unknown) => {
            void handleRedisError('Pub', err as Error);
          });
          pubClient.on('connect', () => {
            void handleRedisConnect('Pub');
          });
        }
        if (subClient) {
          subClient.on('error', (err: unknown) => {
            void handleRedisError('Sub', err as Error);
          });
          subClient.on('connect', () => {
            void handleRedisConnect('Sub');
          });
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

          createIOServer(port: number, options?: Record<string, unknown>): unknown {
            // super.createIOServer returns unknown, we need to type assert it
            const serverRaw: unknown = super.createIOServer(port, {
              ...(options || {}),
              cors: {
                origin:
                  process.env['NODE_ENV'] === 'production'
                    ? ((configService?.get<string>('CORS_ORIGIN') || process.env['CORS_ORIGIN'] || '*')?.split(',') as string[]) || '*'
                    : (configService?.get<string>('CORS_ORIGIN') || process.env['CORS_ORIGIN'] || '*')?.split(',') || '*',
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
            // Type assertion for Socket.IO server - super.createIOServer returns unknown
            const server = serverRaw as {
              adapter?: (adapter: unknown) => void;
              of?: (path: string) => {
                on?: (event: string, handler: (socket: SocketConnection) => void) => void;
              } | null;
            };

            // Type-safe adapter assignment
            const serverWithAdapter = server;
            if (serverWithAdapter && typeof serverWithAdapter.adapter === 'function') {
              serverWithAdapter.adapter(this.adapterConstructor);
            }

            // Health check endpoint - type-safe namespace access
            const healthNamespace = server.of?.('/health');
            if (healthNamespace && typeof healthNamespace.on === 'function') {
              healthNamespace.on('connection', (socket: SocketConnection) => {
                socket.emit('health', {
                  status: 'healthy',
                  timestamp: new Date(),
                  environment: process.env['NODE_ENV'],
                });
              });
            }

            // Test namespace with improved error handling - type-safe namespace access
            const testNamespace = server.of?.('/test');
            if (testNamespace && typeof testNamespace.on === 'function') {
              testNamespace.on('connection', (socket: SocketConnection) => {
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
            }

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
    // Get CORS origins from environment variables
    const corsOrigin = configService?.get<string>('CORS_ORIGIN', '*') || process.env['CORS_ORIGIN'] || '*';
    const corsOrigins = corsOrigin === '*' ? '*' : corsOrigin.split(',').map(origin => origin.trim());
    
    app.enableCors({
      origin: corsOrigins,
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
          const corsOrigin = configService?.get<string>('CORS_ORIGIN', '*') || process.env['CORS_ORIGIN'] || '*';
          const allowedOrigins = corsOrigin === '*' ? ['*'] : corsOrigin.split(',').map(o => o.trim());

          if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
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
    // Type-safe plugin registration using helper function
    await registerFastifyPlugin(app, fastifyHelmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"] as readonly string[],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            "'unsafe-eval'",
            'https://accounts.google.com',
            'https://apis.google.com',
            'https://www.googleapis.com',
          ] as readonly string[],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
          ] as readonly string[],
          imgSrc: ["'self'", 'data:', 'https:', 'blob:'] as readonly string[],
          connectSrc: [
            "'self'",
            configService?.get<string>('FRONTEND_URL', '') || process.env['FRONTEND_URL'] || '',
            configService?.get<string>('API_URL', '') || process.env['API_URL'] || '',
            (configService?.get<string>('API_URL', '') || process.env['API_URL'] || '').replace('http://', 'wss://').replace('https://', 'wss://'),
            'https://accounts.google.com',
            'https://oauth2.googleapis.com',
            'https://www.googleapis.com',
          ].filter(Boolean) as readonly string[],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'] as readonly string[],
          frameSrc: ["'self'", 'https://accounts.google.com'] as readonly string[],
          objectSrc: ["'none'"] as readonly string[],
          baseUri: ["'self'"] as readonly string[],
          formAction: [
            "'self'",
            'https://accounts.google.com',
            configService?.get<string>('FRONTEND_URL', '') || process.env['FRONTEND_URL'] || '',
          ].filter(Boolean) as readonly string[],
          frameAncestors: ["'none'"] as readonly string[],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    });

    // Configure Swagger with environment variables
    // ConfigService.get<T>() returns T | undefined, using generic type parameter for type safety
    const _port =
      configService?.get<number | string>('PORT') ||
      configService?.get<number | string>('VIRTUAL_PORT') ||
      process.env['PORT'] ||
      process.env['VIRTUAL_PORT'] ||
      8088;
    const _virtualHost = configService?.get<string>('VIRTUAL_HOST') || process.env['VIRTUAL_HOST'] || 'localhost';
    const apiUrl = configService?.get<string>('API_URL') || process.env['API_URL'];
    const swaggerUrl = configService?.get<string>('SWAGGER_URL') || process.env['SWAGGER_URL'] || '/docs';
    const _bullBoardUrl = configService?.get<string>('BULL_BOARD_URL') || process.env['BULL_BOARD_URL'] || '/queue-dashboard';
    const _socketUrl = configService?.get<string>('SOCKET_URL') || process.env['SOCKET_URL'] || '/socket.io';
    const _redisCommanderUrl = configService?.get<string>('REDIS_COMMANDER_URL') || process.env['REDIS_COMMANDER_URL'];
    const _prismaStudioUrl = configService?.get<string>('PRISMA_STUDIO_URL') || process.env['PRISMA_STUDIO_URL'];
    const _loggerUrl = configService?.get<string>('LOGGER_URL') || process.env['LOGGER_URL'] || '/logger';

    const document = SwaggerModule.createDocument(app, swaggerConfig);

    // Add environment-specific Swagger setup
    if (process.env['NODE_ENV'] === 'production') {
      // In production, add CORS and security headers for Swagger UI
      // Type-safe plugin registration - using unknown for type safety
      await fastifyInstance.register(fastifyHelmet as unknown as FastifyPlugin, {
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

    const swaggerPath = typeof swaggerUrl === 'string' ? swaggerUrl.replace('/', '') : 'docs';
    SwaggerModule.setup(swaggerPath, app, document, {
      ...swaggerCustomOptions,
      swaggerOptions: {
        ...swaggerCustomOptions.swaggerOptions,
        // Set the default server based on environment
        urls: [
          {
            url: `${String(apiUrl || '')}${String(swaggerUrl || '/docs')}/swagger.json`,
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

      logger.log(`Application is running in ${envConfig.app.environment} mode on port ${port}`);
      logger.log(`- API URL: ${envConfig.app.baseUrl}`);
      logger.log(`- Swagger Docs: ${envConfig.app.baseUrl}${envConfig.urls.swagger}`);
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
        process.on(signal, () => {
          void (async () => {
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
          })();
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
    process.on('uncaughtException', _error => {
      void (async () => {
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
      })();
    });

    // Enhanced error handling for unhandled rejections
    process.on('unhandledRejection', (reason, promise) => {
      void (async () => {
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
      })();
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
