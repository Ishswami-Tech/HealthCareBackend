/**
 * Main Bootstrap File
 *
 * Console usage is limited to:
 * - Cluster management (before LoggingService is available)
 * - Critical error handling (when LoggingService fails)
 * - All other logging uses LoggingService
 */
import { SwaggerModule } from '@nestjs/swagger';
import { Logger, INestApplication, ValidationPipeOptions } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from '@core/filters';
import { swaggerConfig, swaggerCustomOptions } from './config/swagger.config';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel as AppLogLevel } from '@core/types';
import { ValidationPipeConfig } from '@config/validation-pipe.config';
import developmentConfig from './config/environment/development.config';
import productionConfig from './config/environment/production.config';
import { ConfigService } from '@config';
import { LoggingInterceptor } from '@infrastructure/logging/logging.interceptor';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cluster from 'cluster';
import * as os from 'os';
import { SocketConnection, WorkerProcess } from '@core/types';
import type { RedisClient } from '@core/types/common.types';
import { SecurityConfigService } from '@security/security-config.service';
import {
  GracefulShutdownService,
  ProcessErrorHandlersService,
} from '@core/resilience/graceful-shutdown.service';
import {
  createFrameworkAdapter,
  IFrameworkAdapter,
  ApplicationLifecycleManager,
  ServerConfigurator,
} from '@infrastructure/framework';
import type { ApplicationConfig, MiddlewareConfig } from '@core/types/framework.types';

// Store original console methods for critical error handling
// Only used when LoggingService is unavailable (cluster management, critical errors)
// Only error and warn are allowed per ESLint rules
const originalConsole = {
  error: console.error,
  warn: console.warn,
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

// Framework adapter instance - initialized in bootstrap
let frameworkAdapter: IFrameworkAdapter | undefined;

/**
 * Setup WebSocket adapter with Redis
 * This is custom logic that's not part of the framework wrappers
 */
async function setupWebSocketAdapter(
  app: INestApplication,
  configService: ConfigService,
  logger: Logger,
  loggingService: LoggingService | undefined
): Promise<IoAdapter | null> {
  try {
    const { createAdapter } = await import('@socket.io/redis-adapter');
    const { createClient } = await import('redis');

    // Redis client configuration
    const redisHost =
      configService?.get<string>('REDIS_HOST') || process.env['REDIS_HOST'] || '127.0.0.1';
    const redisPort =
      configService?.get<string>('REDIS_PORT') || process.env['REDIS_PORT'] || '6379';
    const redisPassword =
      configService?.get<string>('REDIS_PASSWORD') || process.env['REDIS_PASSWORD'];
    const redisConfig = {
      url: `redis://${String(redisHost).trim()}:${String(redisPort).trim()}`,
      ...(redisPassword && redisPassword.trim() && { password: redisPassword }),
      retryStrategy: (times: number) => {
        const maxRetries = 5;
        if (times > maxRetries) {
          logger.error(`Redis connection failed after ${maxRetries} retries`);
          return null;
        }
        const maxDelay = 3000;
        const delay = Math.min(times * 100, maxDelay);
        logger.log(`Redis reconnection attempt ${times}, delay: ${delay}ms`);
        return delay;
      },
    };

    try {
      pubClient = createClient(redisConfig) as unknown as RedisClient;
      subClient = (pubClient as unknown as { duplicate: () => unknown }).duplicate() as RedisClient;

      const handleRedisError = async (client: string, err: Error) => {
        try {
          await loggingService?.log(
            LogType.ERROR,
            AppLogLevel.ERROR,
            `Redis ${client} Client Error: ${err.message}`,
            'Redis',
            { client, _error: err.message, stack: err.stack }
          );
        } catch {
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
        } catch {
          originalConsole.warn(`Redis ${client} Client Connected`);
        }
      };

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
          // Use same CORS configuration as SecurityConfigService for consistency (DRY principle)
          const corsOrigin =
            configService?.get<string>('CORS_ORIGIN') || process.env['CORS_ORIGIN'] || '*';
          const corsOrigins =
            corsOrigin === '*' ? '*' : corsOrigin.split(',').map((o: string) => o.trim());

          const serverRaw: unknown = super.createIOServer(port, {
            ...(options || {}),
            cors: {
              origin: corsOrigins,
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
          const server = serverRaw as {
            adapter?: (adapter: unknown) => void;
            of?: (path: string) => {
              on?: (event: string, handler: (socket: SocketConnection) => void) => void;
            } | null;
          };

          const serverWithAdapter = server;
          if (serverWithAdapter && typeof serverWithAdapter.adapter === 'function') {
            serverWithAdapter.adapter(this.adapterConstructor);
          }

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

          const testNamespace = server.of?.('/test');
          if (testNamespace && typeof testNamespace.on === 'function') {
            testNamespace.on('connection', (socket: SocketConnection) => {
              logger.log('Client connected to test namespace');

              let heartbeat: NodeJS.Timeout;

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
                }, 30000);
              };

              startHeartbeat();

              socket.on('disconnect', () => {
                clearInterval(heartbeat);
                logger.log('Client disconnected from test namespace');
              });

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

              socket.on('error', (_error: unknown) => {
                logger.error('Socket _error:', _error);
                clearInterval(heartbeat);
              });
            });
          }

          return server;
        }
      }

      const adapter = new CustomIoAdapter(app);
      app.useWebSocketAdapter(adapter);

      logger.log('WebSocket adapter configured successfully');

      await loggingService?.log(
        LogType.SYSTEM,
        AppLogLevel.INFO,
        'WebSocket adapter configured successfully',
        'WebSocket'
      );

      return adapter;
    } catch (redisError) {
      logger.warn('Failed to initialize Redis adapter:', redisError);
      await loggingService?.log(
        LogType.ERROR,
        AppLogLevel.WARN,
        'Continuing without Redis adapter',
        'WebSocket'
      );
      return null;
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
    logger.warn('Continuing without WebSocket support');
    return null;
  }
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
  let app: INestApplication | undefined;
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

    // Create framework adapter
    frameworkAdapter = createFrameworkAdapter();
    logger.log(`Using ${frameworkAdapter.getFrameworkName()} framework adapter`);

    // Create application lifecycle manager
    const lifecycleManager = new ApplicationLifecycleManager(
      frameworkAdapter,
      logger,
      undefined // LoggingService not available yet
    );

    // Create application with basic configuration (will get full config after services are available)
    // We need to create the app first to get services from DI container
    const basicApplicationConfig: ApplicationConfig = {
      environment,
      isHorizontalScaling,
      instanceId,
      trustProxy: envConfig.security.trustProxy === 1,
      bodyLimit: environment === 'production' ? 50 * 1024 * 1024 : 10 * 1024 * 1024,
      keepAliveTimeout: environment === 'production' ? 65000 : 5000,
      connectionTimeout: environment === 'production' ? 60000 : 30000,
      requestTimeout: environment === 'production' ? 30000 : 10000,
      enableHttp2: environment === 'production' && process.env['ENABLE_HTTP2'] !== 'false',
    };

    app = await lifecycleManager.createApplication(AppModule, basicApplicationConfig);

    if (!app) {
      throw new Error('Application failed to initialize');
    }

    // Get service container for type-safe service retrieval
    const serviceContainer = lifecycleManager.getServiceContainer();

    // Get services from DI container using ServiceContainer
    const configService = serviceContainer.getService<ConfigService>(ConfigService);
    const loggingServiceResult = serviceContainer.getService<LoggingService>(LoggingService);
    loggingService = loggingServiceResult;
    const securityConfigService =
      serviceContainer.getService<SecurityConfigService>(SecurityConfigService);
    const gracefulShutdownService =
      serviceContainer.getService<GracefulShutdownService>(GracefulShutdownService);
    const processErrorHandlersService = serviceContainer.getService<ProcessErrorHandlersService>(
      ProcessErrorHandlersService
    );

    // Set framework adapter in security service
    securityConfigService.setFrameworkAdapter(frameworkAdapter);

    logger.log('Core services initialized');

    // Initialize server configurator with ConfigService now that it's available
    const serverConfigurator = new ServerConfigurator(
      logger,
      {
        environment,
        configService,
      },
      loggingService
    );

    // Set up console redirection to the logging service
    if (loggingService) {
      setupConsoleRedirect(loggingService);
    }

    // Setup process error handlers
    processErrorHandlersService.setupErrorHandlers();

    // Configure middleware using MiddlewareManager
    const middlewareManager = lifecycleManager.getMiddlewareManager();

    // Configure production security middleware
    if (environment === 'production') {
      await securityConfigService.configureProductionSecurity(app, logger);
    }

    // Prepare middleware configuration
    const apiPrefix =
      configService?.get<string>('API_PREFIX') || process.env['API_PREFIX'] || 'api/v1';

    // Use ValidationPipeConfig to avoid duplication
    // ValidationPipeConfig.getOptions returns ValidationPipeOptions
    // Explicitly type to avoid TypeScript inference issues
    const validationPipeOptions: ValidationPipeOptions =
      ValidationPipeConfig.getOptions(loggingService);

    const middlewareConfig: MiddlewareConfig = {
      validationPipe: validationPipeOptions,
      enableVersioning: true,
      versioningType: 'header',
      versioningHeader: 'X-API-Version',
      defaultVersion: '1',
      ...(apiPrefix && apiPrefix.trim() !== '' && { globalPrefix: apiPrefix }),
      prefixExclude: [
        { path: '', method: 'GET' },
        { path: '/', method: 'GET' },
        'health',
        'metrics',
        'docs',
        'queue-dashboard',
        'logger',
        'socket-test',
        'email',
        'redis-ui',
        'prisma',
        'pgadmin',
      ],
      enableShutdownHooks: true,
    };

    // Configure middleware (pipes, versioning, prefix, shutdown hooks)
    middlewareManager.configure(app, middlewareConfig);

    // CRITICAL: Manually register root route after global prefix is set
    // NestJS setGlobalPrefix exclusion doesn't always work reliably for root path
    // This ensures the dashboard route is accessible at /
    try {
      const httpAdapter = app.getHttpAdapter();
      const fastifyInstance = httpAdapter.getInstance() as {
        get?: (
          path: string,
          handler: (request: unknown, reply: unknown) => Promise<unknown>
        ) => void;
      };
      if (fastifyInstance?.get) {
        // Get AppController instance from NestJS container using the class token
        const { AppController } = await import('./app.controller');
        const appController = app.get(AppController);
        if (
          appController &&
          typeof (appController as { getDashboard?: (reply: unknown) => Promise<unknown> })
            .getDashboard === 'function'
        ) {
          const typedController = appController as {
            getDashboard: (reply: unknown) => Promise<unknown>;
          };
          fastifyInstance.get('/', async (_request: unknown, reply: unknown) => {
            return typedController.getDashboard(reply);
          });
          logger.log('Root route / manually registered for dashboard');
        }

        // CRITICAL: Manually register /health route for Fastify
        // Fastify doesn't always respect NestJS global prefix exclusions
        const { HealthController } = await import('./services/health/health.controller');
        const healthController = app.get(HealthController);
        if (
          healthController &&
          typeof (healthController as { getHealth?: (reply: unknown) => Promise<unknown> })
            .getHealth === 'function'
        ) {
          const typedHealthController = healthController as {
            getHealth: (reply: unknown) => Promise<unknown>;
          };
          fastifyInstance.get('/health', async (_request: unknown, reply: unknown) => {
            return typedHealthController.getHealth(reply);
          });
          logger.log('Health route /health manually registered for Fastify');
        }
      }
    } catch (error) {
      logger.warn(
        `Failed to manually register root/health routes: ${error instanceof Error ? error.message : String(error)}`
      );
      // Continue - the routes might still work via normal NestJS registration
    }

    // Configure filters and interceptors separately (not in configure method)
    if (loggingService) {
      middlewareManager.configureFilters(app, [
        {
          filter: HttpExceptionFilter,
          constructorArgs: [loggingService],
        },
      ]);
      middlewareManager.configureInterceptors(app, [
        {
          interceptor: LoggingInterceptor,
          constructorArgs: [loggingService],
        },
      ]);
    }

    logger.log('Global pipes, filters, and interceptors configured');

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

    // Set up WebSocket adapter with Redis (custom logic)
    customWebSocketAdapter = await setupWebSocketAdapter(
      app,
      configService,
      logger,
      loggingService
    );

    // Configure CORS using SecurityConfigService
    // SecurityConfigService is now framework-agnostic and uses the framework adapter
    if (app) {
      securityConfigService.configureCORS(app);
      securityConfigService.addCorsPreflightHandler(app);
      securityConfigService.addBotDetectionHook(app);
    }

    // Configure Swagger with environment variables
    // ConfigService.get<T>() returns T | undefined, using generic type parameter for type safety
    const _port =
      configService?.get<number | string>('PORT') ||
      configService?.get<number | string>('VIRTUAL_PORT') ||
      process.env['PORT'] ||
      process.env['VIRTUAL_PORT'] ||
      8088;
    const _virtualHost =
      configService?.get<string>('VIRTUAL_HOST') || process.env['VIRTUAL_HOST'] || 'localhost';
    const apiUrl = configService?.get<string>('API_URL') || process.env['API_URL'];
    const swaggerUrl =
      configService?.get<string>('SWAGGER_URL') || process.env['SWAGGER_URL'] || '/docs';
    const _bullBoardUrl =
      configService?.get<string>('BULL_BOARD_URL') ||
      process.env['BULL_BOARD_URL'] ||
      '/queue-dashboard';
    const _socketUrl =
      configService?.get<string>('SOCKET_URL') || process.env['SOCKET_URL'] || '/socket.io';
    const _redisCommanderUrl =
      configService?.get<string>('REDIS_COMMANDER_URL') || process.env['REDIS_COMMANDER_URL'];
    const _prismaStudioUrl =
      configService?.get<string>('PRISMA_STUDIO_URL') || process.env['PRISMA_STUDIO_URL'];
    const _loggerUrl =
      configService?.get<string>('LOGGER_URL') || process.env['LOGGER_URL'] || '/logger';

    const document = SwaggerModule.createDocument(app, swaggerConfig);

    // Note: Helmet security headers are already configured in SecurityConfigService.configureProductionSecurity()
    // The CSP directives include Swagger UI requirements ('unsafe-inline', 'unsafe-eval') for production

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

    // Get server configuration and start server
    const serverConfig = serverConfigurator.getServerConfig();

    try {
      // Start server using lifecycle manager
      await lifecycleManager.startServer(serverConfig);

      logger.log(
        `Application is running in ${envConfig.app.environment} mode on port ${serverConfig.port}`
      );
      logger.log(`- API URL: ${envConfig.app.baseUrl}`);
      logger.log(`- Swagger Docs: ${envConfig.app.baseUrl}${envConfig.urls.swagger}`);
      logger.log(`- Health Check: ${envConfig.app.baseUrl}/health`);

      if (envConfig.app.environment === 'development') {
        logger.log('Development services:');
        logger.log(`- Redis Commander: ${envConfig.urls.redisCommander}`);
        logger.log(`- Prisma Studio: ${envConfig.urls.prismaStudio}`);
        logger.log(`- PgAdmin: ${envConfig.urls.pgAdmin}`);
      }

      // Setup graceful shutdown handlers using GracefulShutdownService
      if (app) {
        // Service is properly typed, so method calls are type-safe
        gracefulShutdownService.setupShutdownHandlers(
          app,
          customWebSocketAdapter,
          pubClient,
          subClient
        );
      }
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

    // Process error handlers are already set up via ProcessErrorHandlersService
    // No need to duplicate the handlers here
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
