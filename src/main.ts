/**
 * Main Bootstrap File
 *
 * Console usage is limited to:
 * - Cluster management (before LoggingService is available)
 * - Critical error handling (when LoggingService fails)
 * - All other logging uses LoggingService
 */
// Register tsconfig-paths for path alias resolution at runtime
import 'tsconfig-paths/register';
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
import stagingConfig from './config/environment/staging.config';
import testConfig from './config/environment/test.config';
import { ConfigService } from '@config/config.service';
import { isCacheEnabled } from '@config/cache.config';
import {
  getEnv,
  getEnvWithDefault,
  getEnvBoolean,
  isProduction,
  getEnvironment,
} from '@config/environment/utils';
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
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

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
const validEnvironments = ['development', 'production', 'staging', 'test'] as const;
type Environment = (typeof validEnvironments)[number];

// Framework adapter instance - initialized in bootstrap
let frameworkAdapter: IFrameworkAdapter | undefined;

/**
 * Setup WebSocket adapter with Redis
 * This is custom logic that's not part of the framework wrappers
 */
async function _setupWebSocketAdapter(
  app: INestApplication,
  configService: ConfigService,
  logger: Logger,
  loggingService: LoggingService | undefined
): Promise<IoAdapter | null> {
  try {
    // Check if cache is enabled using single source of truth
    if (!isCacheEnabled()) {
      logger.log('[WebSocket] Cache is disabled - skipping WebSocket adapter setup');
      if (loggingService) {
        await loggingService
          .log(
            LogType.SYSTEM,
            AppLogLevel.INFO,
            'WebSocket adapter skipped - cache is disabled',
            'WebSocketAdapter',
            {}
          )
          .catch(() => {
            // Ignore logging errors
          });
      }
      return null;
    }

    const { createAdapter } = await import('@socket.io/redis-adapter');
    const { createClient } = await import('redis');

    // Use ConfigService for all cache configuration (single source of truth)
    if (!configService) {
      logger.warn('[WebSocket] ConfigService not available - skipping WebSocket adapter setup');
      return null;
    }

    const cacheProvider: 'redis' | 'dragonfly' | 'memory' = configService.getCacheProvider();
    const useDragonfly = cacheProvider === 'dragonfly';
    const cacheHost: string = configService.getCacheHost();
    const cachePort: number = configService.getCachePort();
    const cachePassword: string | undefined = configService.getCachePassword();

    // Debug logging
    logger.log(
      `[WebSocket] Using ${useDragonfly ? 'Dragonfly' : 'Redis'} for pub/sub: ${cacheHost}:${cachePort} (CACHE_PROVIDER=${cacheProvider})`
    );

    const redisConfig: {
      url: string;
      password?: string;
      retryStrategy: (times: number) => number | null;
    } = {
      url: `redis://${cacheHost.trim()}:${cachePort}`,
      ...(cachePassword && cachePassword.trim() && { password: cachePassword }),
      retryStrategy: (times: number) => {
        const maxRetries = 5;
        if (times > maxRetries) {
          logger.error(
            `${useDragonfly ? 'Dragonfly' : 'Redis'} connection failed after ${maxRetries} retries`
          );
          return null;
        }
        const maxDelay = 3000;
        const delay = Math.min(times * 100, maxDelay);
        logger.log(
          `${useDragonfly ? 'Dragonfly' : 'Redis'} reconnection attempt ${times}, delay: ${delay}ms`
        );
        return delay;
      },
    };

    try {
      // Type guard to check if object matches RedisClient interface
      // Uses bracket notation to access index signature properties
      const isRedisClient = (client: unknown): client is RedisClient => {
        if (!client || typeof client !== 'object') {
          return false;
        }
        const c = client as Record<string, unknown>;
        return (
          typeof c['quit'] === 'function' &&
          typeof c['disconnect'] === 'function' &&
          typeof c['connect'] === 'function' &&
          typeof c['on'] === 'function'
        );
      };

      const client = createClient(redisConfig);

      // Verify client has required methods before assignment
      if (isRedisClient(client)) {
        pubClient = client;

        // Verify duplicate method exists and returns valid client
        const clientWithDuplicate = client as RedisClient & {
          duplicate?: () => unknown;
        };

        if (typeof clientWithDuplicate.duplicate === 'function') {
          const duplicated = clientWithDuplicate.duplicate();
          if (isRedisClient(duplicated)) {
            subClient = duplicated;
          } else {
            throw new Error('SubClient duplicate() did not return a valid RedisClient');
          }
        } else {
          throw new Error('Redis client does not have duplicate() method');
        }
      } else {
        throw new Error(
          'Redis client does not have required methods (quit, disconnect, connect, on)'
        );
      }

      const cacheProviderName = useDragonfly ? 'Dragonfly' : 'Redis';

      const handleRedisError = async (client: string, err: Error) => {
        try {
          await loggingService?.log(
            LogType.ERROR,
            AppLogLevel.ERROR,
            `${cacheProviderName} ${client} Client Error: ${err.message}`,
            cacheProviderName,
            { client, _error: err.message, stack: err.stack }
          );
        } catch {
          originalConsole.error(`${cacheProviderName} ${client} Client Error:`, err);
        }
      };

      const handleRedisConnect = async (client: string) => {
        try {
          await loggingService?.log(
            LogType.SYSTEM,
            AppLogLevel.INFO,
            `${cacheProviderName} ${client} Client Connected`,
            cacheProviderName,
            { client }
          );
        } catch {
          originalConsole.warn(`${cacheProviderName} ${client} Client Connected`);
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

      // Try to connect, but don't fail if cache is not available
      // Since cache is disabled, WebSocket adapter is optional
      if (pubClient && subClient) {
        try {
          await Promise.all([
            connectWithTimeout(pubClient, 'Pub'),
            connectWithTimeout(subClient, 'Sub'),
          ]);
          // If connect() resolves successfully, clients are connected and ready
          // The connect() promise only resolves when connection is established
          logger.log('[WebSocket] Pub/Sub clients connected successfully');
        } catch (connectionError) {
          // Cache is disabled - WebSocket adapter is optional
          // Log warning but continue without Redis adapter
          logger.warn(
            `Failed to initialize ${useDragonfly ? 'Dragonfly' : 'Redis'} adapter: ${
              connectionError instanceof Error ? connectionError.message : String(connectionError)
            }`
          );
          if (loggingService) {
            await loggingService
              .log(
                LogType.SYSTEM,
                AppLogLevel.WARN,
                `WebSocket adapter skipped - ${useDragonfly ? 'Dragonfly' : 'Redis'} connection failed (cache disabled)`,
                'WebSocketAdapter',
                {
                  error:
                    connectionError instanceof Error
                      ? connectionError.message
                      : String(connectionError),
                }
              )
              .catch(() => {
                // Ignore logging errors
              });
          }
          // Clear clients to prevent using uninitialized clients
          pubClient = null;
          subClient = null;
          // Return null to indicate adapter setup failed - app will continue without it
          return null;
        }
      } else {
        // Clients not created - return null
        return null;
      }

      class CustomIoAdapter extends IoAdapter {
        private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

        constructor(app: INestApplication) {
          super(app);
          // Only create adapter if clients are properly initialized and connected
          if (pubClient && subClient) {
            try {
              // Validate clients have required methods before creating adapter
              if (
                typeof (pubClient as { set?: unknown }).set === 'function' &&
                typeof (subClient as { set?: unknown }).set === 'function'
              ) {
                this.adapterConstructor = createAdapter(pubClient, subClient);
              } else {
                logger.warn(
                  'Redis clients do not have required methods - skipping adapter creation'
                );
              }
            } catch (adapterError) {
              logger.warn(
                `Failed to create Socket.IO adapter: ${adapterError instanceof Error ? adapterError.message : String(adapterError)}`
              );
              this.adapterConstructor = null;
            }
          } else {
            logger.warn('Redis clients not initialized - skipping adapter creation');
          }
        }

        createIOServer(port: number, options?: Record<string, unknown>): unknown {
          // Use same CORS configuration as SecurityConfigService for consistency (DRY principle)
          // Use ConfigService (which uses dotenv) for environment variable access
          const corsConfig = configService?.getCorsConfig();
          const corsOrigin = corsConfig?.origin || '*';
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
          if (
            serverWithAdapter &&
            typeof serverWithAdapter.adapter === 'function' &&
            this.adapterConstructor !== null
          ) {
            try {
              serverWithAdapter.adapter(this.adapterConstructor);
            } catch (adapterError) {
              logger.warn(
                `Failed to set Socket.IO adapter: ${adapterError instanceof Error ? adapterError.message : String(adapterError)}`
              );
              // Continue without adapter - app will work but without pub/sub scaling
            }
          } else if (!this.adapterConstructor) {
            logger.warn('Socket.IO adapter not available - continuing without pub/sub scaling');
          }

          const healthNamespace = server.of?.('/health');
          if (healthNamespace && typeof healthNamespace.on === 'function') {
            healthNamespace.on('connection', (socket: SocketConnection) => {
              // Use ConfigService (which uses dotenv) for environment variable access
              socket.emit('health', {
                status: 'healthy',
                timestamp: new Date(),
                environment: configService?.getEnvironment() || 'development',
              });
            });
          }

          const testNamespace = server.of?.('/test');
          if (testNamespace && typeof testNamespace.on === 'function') {
            testNamespace.on('connection', (socket: SocketConnection) => {
              logger.log('Client connected to test namespace');

              let heartbeat: NodeJS.Timeout;

              const startHeartbeat = () => {
                // Use ConfigService (which uses dotenv) for environment variable access
                socket.emit('welcome', {
                  message: 'Connected to WebSocket server',
                  timestamp: new Date().toISOString(),
                  environment: configService?.getEnvironment() || 'development',
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
  // Use helper functions (which use dotenv) for environment variable access
  const isProductionEnv = isProduction();
  const enableClustering = getEnvBoolean('ENABLE_CLUSTERING', false);

  if (!isProductionEnv || !enableClustering) {
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
    // Note: WORKER_ID is set via process.env for cluster communication
    // This is acceptable as it's for Node.js cluster module inter-process communication
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
  // Use helper functions (which use dotenv) for environment variable access
  const isHorizontalScaling = getEnv('CLUSTER_MODE') === 'horizontal';
  const instanceId = getEnvWithDefault('INSTANCE_ID', getEnvWithDefault('WORKER_ID', '1'));
  const workerId = getEnvWithDefault('WORKER_ID', String(cluster.worker?.id || instanceId));

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

    // Use helper function (which uses dotenv) for environment variable access
    const environment = getEnvironment() as Environment;
    if (!validEnvironments.includes(environment)) {
      throw new Error(
        `Invalid NODE_ENV: ${environment}. Must be one of: ${validEnvironments.join(', ')}`
      );
    }

    // Get appropriate config based on environment
    let envConfig: ReturnType<typeof productionConfig> | ReturnType<typeof developmentConfig>;
    if (environment === 'production') {
      envConfig = productionConfig();
    } else if (environment === 'staging') {
      envConfig = stagingConfig();
    } else if (environment === 'test') {
      envConfig = testConfig();
    } else {
      envConfig = developmentConfig();
    }

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
      bodyLimit:
        environment === 'production' || environment === 'staging'
          ? 50 * 1024 * 1024
          : 10 * 1024 * 1024,
      keepAliveTimeout: environment === 'production' ? 65000 : 5000,
      connectionTimeout: environment === 'production' ? 60000 : 30000,
      requestTimeout: environment === 'production' ? 30000 : 10000,
      enableHttp2: environment === 'production' && getEnvBoolean('ENABLE_HTTP2', true),
    };

    app = await lifecycleManager.createApplication(AppModule, basicApplicationConfig);

    if (!app) {
      throw new Error('Application failed to initialize');
    }

    // Get service container for type-safe service retrieval
    const serviceContainer = lifecycleManager.getServiceContainer();

    // Get services from DI container using ServiceContainer
    // Use resolve() for scoped providers (like LoggingService) and get() for singletons
    const configService = await serviceContainer.getService<ConfigService>(ConfigService);
    const loggingServiceResult = await serviceContainer.getService<LoggingService>(LoggingService);
    loggingService = loggingServiceResult;
    const securityConfigService =
      await serviceContainer.getService<SecurityConfigService>(SecurityConfigService);
    const gracefulShutdownService =
      await serviceContainer.getService<GracefulShutdownService>(GracefulShutdownService);
    const processErrorHandlersService =
      await serviceContainer.getService<ProcessErrorHandlersService>(ProcessErrorHandlersService);

    // Set framework adapter in security service (if available)
    if (securityConfigService && frameworkAdapter) {
      securityConfigService.setFrameworkAdapter(frameworkAdapter);
    } else {
      if (!securityConfigService) {
        logger.warn('SecurityConfigService not available, skipping framework adapter setup');
      }
      if (!frameworkAdapter) {
        logger.warn('FrameworkAdapter not available, skipping framework adapter setup');
      }
    }

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

    // Setup process error handlers (if available)
    if (processErrorHandlersService) {
      processErrorHandlersService.setupErrorHandlers();
    } else {
      logger.warn('ProcessErrorHandlersService not available, using fallback error handlers');
    }

    // Configure middleware using MiddlewareManager
    const middlewareManager = lifecycleManager.getMiddlewareManager();

    // Session and cookie configuration
    logger.log('Session and cookie configuration initialized');

    // CRITICAL: Cookies must be registered before session
    // Fastify session plugin requires @fastify/cookie to be registered first
    try {
      await securityConfigService.configureCookies(app);
      logger.log('Fastify cookies configured');
    } catch (cookieError) {
      logger.warn(
        `Failed to configure cookies (non-critical): ${cookieError instanceof Error ? cookieError.message : String(cookieError)}`
      );
    }

    // Configure Fastify session with cache-backed store (for all environments)
    // Session store uses CacheService if cache is enabled, otherwise uses in-memory store
    // IMPORTANT: Cookies must be registered before session (done above)
    try {
      await securityConfigService.configureSession(app);
      logger.log('Fastify session configured');
    } catch (sessionError) {
      logger.error(
        `Failed to configure Fastify session: ${sessionError instanceof Error ? sessionError.message : String(sessionError)}`
      );
      // Don't throw - allow app to continue without session support
      logger.warn('Application will continue without session support');
    }

    // Prepare middleware configuration
    // Get app config early for middleware setup
    const appConfigForMiddleware = configService?.getAppConfig();
    const apiPrefixRaw = appConfigForMiddleware?.apiPrefix || '/api/v1';
    // Ensure prefix has leading slash for NestJS
    const apiPrefix = apiPrefixRaw.startsWith('/') ? apiPrefixRaw : `/${apiPrefixRaw}`;

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
        { path: 'logger/events', method: 'GET' },
        { path: 'logger/logs/data', method: 'GET' },
        { path: 'logger/events/data', method: 'GET' },
        { path: 'logger/logs/clear', method: 'POST' },
        { path: 'logger/events/clear', method: 'POST' },
        'socket-test',
        'email',
        'redis-ui',
        'prisma',
      ],
      enableShutdownHooks: true,
    };

    // Configure middleware (pipes, versioning, prefix, shutdown hooks)
    middlewareManager.configure(app, middlewareConfig);

    // CRITICAL: Manually register root route after global prefix is set
    // NestJS setGlobalPrefix exclusion doesn't always work reliably for root path
    // Manually register routes that should be excluded from global prefix
    // Fastify doesn't always respect NestJS global prefix exclusions
    try {
      // Use relative path for dynamic import to avoid path alias resolution issues at runtime
      const frameworkModule = await import('./libs/infrastructure/framework');
      if (
        frameworkModule &&
        typeof frameworkModule.registerManualRoutes === 'function' &&
        loggingService
      ) {
        const registerManualRoutes = frameworkModule.registerManualRoutes as (
          app: INestApplication,
          loggingService: LoggingService
        ) => Promise<void>;
        await registerManualRoutes(app, loggingService);
      } else if (!loggingService) {
        logger.warn('LoggingService not available, skipping manual route registration');
      }
    } catch (routeError) {
      logger.warn(
        `Failed to register manual routes (non-critical): ${routeError instanceof Error ? routeError.message : String(routeError)}`
      );
      // Continue - routes might still work via normal NestJS registration
    }

    // Configure filters and interceptors separately (not in configure method)
    if (loggingService) {
      // Use ConfigService already retrieved via ServiceContainer (line 686)
      // No need to call app.get() - use the existing configService variable
      middlewareManager.configureFilters(app, [
        {
          filter: HttpExceptionFilter,
          constructorArgs: [loggingService, configService],
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

    // Setup WebSocket adapter with Redis for horizontal scaling
    logger.log('Setting up WebSocket adapter with Redis...');
    try {
      customWebSocketAdapter = await _setupWebSocketAdapter(
        app,
        configService,
        logger,
        loggingService
      );
      if (customWebSocketAdapter) {
        logger.log('WebSocket adapter configured successfully');
      } else {
        logger.warn('WebSocket adapter setup returned null (cache may be disabled)');
      }
    } catch (wsError) {
      const wsErrorMessage = wsError instanceof Error ? wsError.message : 'Unknown error';
      logger.error(`Failed to setup WebSocket adapter: ${wsErrorMessage}`);
      logger.warn('Application will continue without WebSocket horizontal scaling');
      customWebSocketAdapter = null;
      // Don't throw - allow application to continue without WebSocket adapter
    }

    // Configure CORS using SecurityConfigService
    // SecurityConfigService is now framework-agnostic and uses the framework adapter
    logger.log('Configuring CORS...');
    if (app && securityConfigService) {
      try {
        // Ensure framework adapter is set before configuring CORS
        if (frameworkAdapter) {
          securityConfigService.setFrameworkAdapter(frameworkAdapter);
        }
        // Check if app has enableCors method before calling
        if (typeof app.enableCors === 'function') {
          logger.log('Calling securityConfigService.configureCORS...');
          securityConfigService.configureCORS(app);
          logger.log('CORS configured successfully');
        } else {
          logger.warn('Application does not have enableCors method, skipping CORS configuration');
          logger.warn('This may be expected if using a custom framework adapter');
        }
        // securityConfigService.addCorsPreflightHandler(app);
        // securityConfigService.addBotDetectionHook(app);
      } catch (corsError) {
        const corsErrorMessage = corsError instanceof Error ? corsError.message : 'Unknown error';
        const corsErrorStack = corsError instanceof Error ? corsError.stack : 'No stack trace';
        logger.error(`Failed to configure CORS: ${corsErrorMessage}`);
        logger.error(`CORS error stack: ${corsErrorStack}`);
        logger.warn('Application will continue without CORS configuration');
        // Don't throw - allow application to continue without CORS
      }
    } else {
      if (!app) {
        logger.warn('Application instance is undefined, skipping CORS configuration');
      }
      if (!securityConfigService) {
        logger.warn('SecurityConfigService is undefined, skipping CORS configuration');
      }
    }
    logger.log('CORS configuration completed');

    // Configure Swagger with ConfigService (centralized configuration)
    if (!configService) {
      throw new Error('ConfigService is required for Swagger configuration');
    }

    const appConfig = configService.getAppConfig();
    const urlsConfig = configService.getUrlsConfig();

    const _port = appConfig.port;
    const _virtualHost = appConfig.host;
    const _apiUrl = appConfig.apiUrl || appConfig.baseUrl;
    const _swaggerUrl = urlsConfig.swagger;
    const _bullBoardUrl = urlsConfig.bullBoard;
    const _socketUrl = urlsConfig.socket;
    const _redisCommanderUrl =
      urlsConfig.redisCommander ||
      configService.getEnv('REDIS_COMMANDER_URL') ||
      'http://localhost:8082';
    const _prismaStudioUrl =
      urlsConfig.prismaStudio ||
      configService.getEnv('PRISMA_STUDIO_URL') ||
      'http://localhost:5555';
    const _loggerUrl = '/logger';

    // Check if app is available before configuring Swagger
    if (!app) {
      logger.error('Application instance is undefined, cannot configure Swagger');
      throw new Error('Application instance is undefined');
    }

    // Configure Swagger with error handling
    try {
      logger.log('Starting Swagger configuration...');

      // Check if SwaggerModule methods exist
      if (typeof SwaggerModule.createDocument !== 'function') {
        throw new Error('SwaggerModule.createDocument is not a function');
      }
      if (typeof SwaggerModule.setup !== 'function') {
        throw new Error('SwaggerModule.setup is not a function');
      }

      logger.log('Creating Swagger document...');
      // Configure Swagger to handle circular dependencies
      // Disable deepScanRoutes to avoid scanning all types which can cause circular dependency issues
      // Using lazy resolvers for circular dependencies
      const document = SwaggerModule.createDocument(app, swaggerConfig, {
        extraModels: [],
        operationIdFactory: (controllerKey: string, methodKey: string) => methodKey,
        deepScanRoutes: false, // Disable deep scanning to avoid circular dependency issues
        ignoreGlobalPrefix: false,
      });
      logger.log('Swagger document created successfully');

      // Note: Helmet security headers are already configured in SecurityConfigService.configureProductionSecurity()
      // The CSP directives include Swagger UI requirements ('unsafe-inline', 'unsafe-eval') for production

      const swaggerPath = typeof _swaggerUrl === 'string' ? _swaggerUrl.replace(/^\//, '') : 'docs';
      logger.log(`Setting up Swagger at path: ${swaggerPath}`);
      SwaggerModule.setup(swaggerPath, app, document, {
        ...swaggerCustomOptions,
        swaggerOptions: {
          ...swaggerCustomOptions.swaggerOptions,
          // Set the default server based on environment
          urls: [
            {
              url: `${String(envConfig.app.baseUrl || _apiUrl || '')}${String(_swaggerUrl || '/docs')}/swagger.json`,
              name: appConfig.environment === 'production' ? 'Production' : 'Development',
            },
          ],
        },
      });

      logger.log(`Swagger API documentation configured for ${appConfig.environment} environment`);
    } catch (swaggerError) {
      const swaggerErrorMessage =
        swaggerError instanceof Error ? swaggerError.message : 'Unknown error';
      const swaggerErrorStack =
        swaggerError instanceof Error ? swaggerError.stack : 'No stack trace';
      logger.error(`Failed to configure Swagger: ${swaggerErrorMessage}`);
      logger.error(`Swagger error stack: ${swaggerErrorStack}`);
      logger.warn('Application will continue without Swagger documentation');
      // Don't throw - allow application to continue without Swagger
    }

    // Get server configuration and start server
    logger.log('Getting server configuration...');
    logger.log(`ServerConfigurator type: ${typeof serverConfigurator}`);
    logger.log(`ServerConfigurator value: ${serverConfigurator ? 'defined' : 'undefined'}`);
    if (serverConfigurator && typeof serverConfigurator.getServerConfig === 'function') {
      logger.log('Calling serverConfigurator.getServerConfig()...');
    } else {
      logger.error('ServerConfigurator or getServerConfig method is not available');
      throw new Error('ServerConfigurator.getServerConfig is not a function');
    }
    const serverConfig = serverConfigurator.getServerConfig();
    logger.log('serverConfigurator.getServerConfig() completed successfully');
    logger.log(
      `Server config: ${JSON.stringify({ port: serverConfig.port, host: serverConfig.host })}`
    );

    try {
      logger.log('Starting server using lifecycle manager...');
      logger.log(`LifecycleManager type: ${typeof lifecycleManager}`);
      logger.log(`LifecycleManager value: ${lifecycleManager ? 'defined' : 'undefined'}`);

      // Check if lifecycleManager and startServer method exist
      if (!lifecycleManager) {
        throw new Error('LifecycleManager is undefined');
      }
      if (typeof lifecycleManager.startServer !== 'function') {
        throw new Error('LifecycleManager.startServer is not a function');
      }

      logger.log('Calling lifecycleManager.startServer()...');
      // Start server using lifecycle manager
      await lifecycleManager.startServer(serverConfig);
      logger.log('lifecycleManager.startServer() completed successfully');

      // Log configuration values
      logger.log(`Application base URL: "${envConfig.app.baseUrl}"`);
      logger.log(`Swagger URL: "${envConfig.urls.swagger}"`);

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

        // Auto-start Prisma Studio in development mode
        // Use ConfigService (which uses dotenv) for environment variable access
        if (configService?.getEnvBoolean('ENABLE_PRISMA_STUDIO', true)) {
          // Function to start Prisma Studio with retry logic
          const startPrismaStudio = (retryCount = 0): void => {
            const maxRetries = 3;
            const retryDelay = 5000; // 5 seconds between retries

            try {
              // Prisma 7: Use --config flag instead of --schema
              // Run Prisma Studio with config file from the prisma directory
              const prismaDir = path.join(
                process.cwd(),
                'src',
                'libs',
                'infrastructure',
                'database',
                'prisma'
              );
              const prismaConfigPath = path.join(prismaDir, 'prisma.config.js');

              logger.log(
                `[Prisma Studio] Starting Prisma Studio${retryCount > 0 ? ` (retry ${retryCount}/${maxRetries})` : ''}...`
              );

              const prismaStudioProcess = spawn(
                'npx',
                [
                  'prisma',
                  'studio',
                  '--config',
                  prismaConfigPath,
                  '--port',
                  '5555',
                  '--browser',
                  'none', // Don't open browser automatically
                ],
                {
                  cwd: prismaDir, // Run from prisma directory for better compatibility
                  stdio: ['ignore', 'pipe', 'pipe'], // Capture output for debugging
                  detached: false, // Keep attached to parent process
                  shell: true, // Use shell for Windows compatibility
                  env: {
                    ...process.env,
                    // Ensure Prisma can find the schema and config
                    PRISMA_SCHEMA_PATH: path.join(prismaDir, 'schema.prisma'),
                    // Use DIRECT_URL if available (clean connection string), otherwise clean DATABASE_URL
                    // Prisma Studio needs a clean PostgreSQL connection string without Prisma-specific parameters
                    // Use ConfigService (which uses dotenv) for environment variable access
                    DATABASE_URL:
                      configService?.getEnv('DIRECT_URL') ||
                      (configService?.getDatabaseConfig()?.url || '').replace(
                        /[?&](connection_limit|pool_timeout|statement_timeout|idle_in_transaction_session_timeout|connect_timeout|pool_size|max_connections)=[^&]*/g,
                        ''
                      ),
                  },
                }
              );

              // Log Prisma Studio output for debugging
              let hasLoggedStartup = false;

              prismaStudioProcess.stdout?.on('data', (data: Buffer) => {
                const output = data.toString().trim();

                // Log startup messages
                if (!hasLoggedStartup && output) {
                  logger.log(`[Prisma Studio] ${output}`);
                  if (
                    output.toLowerCase().includes('running') ||
                    output.toLowerCase().includes('started')
                  ) {
                    hasLoggedStartup = true;
                  }
                }
              });

              prismaStudioProcess.stderr?.on('data', (data: Buffer) => {
                const errorMsg = data.toString().trim();
                if (errorMsg && !errorMsg.includes('DeprecationWarning')) {
                  logger.warn(`[Prisma Studio] ${errorMsg}`);
                }
              });

              prismaStudioProcess.on('error', (error: Error) => {
                logger.warn(`[Prisma Studio] Failed to start: ${error.message}`);
                // Retry if we haven't exceeded max retries
                if (retryCount < maxRetries) {
                  logger.log(`[Prisma Studio] Retrying in ${retryDelay / 1000} seconds...`);
                  setTimeout(() => startPrismaStudio(retryCount + 1), retryDelay);
                } else {
                  logger.error(
                    `[Prisma Studio] Failed to start after ${maxRetries} retries. You can start it manually with: pnpm prisma:studio`
                  );
                }
              });

              prismaStudioProcess.on('exit', (code: number | null) => {
                if (code !== null && code !== 0) {
                  logger.warn(`[Prisma Studio] Exited with code ${code}`);
                  // Retry if we haven't exceeded max retries and it's not a normal shutdown
                  if (retryCount < maxRetries && code !== 0) {
                    logger.log(`[Prisma Studio] Retrying in ${retryDelay / 1000} seconds...`);
                    setTimeout(() => startPrismaStudio(retryCount + 1), retryDelay);
                  } else if (code !== 0) {
                    logger.error(
                      `[Prisma Studio] Failed to start after ${maxRetries} retries. You can start it manually with: pnpm prisma:studio`
                    );
                  }
                } else {
                  logger.log(`[Prisma Studio] Stopped gracefully`);
                }
              });

              // Wait a bit to verify Prisma Studio starts successfully
              setTimeout(() => {
                if (prismaStudioProcess.killed) {
                  logger.warn('[Prisma Studio] Process was killed');
                  // Retry if we haven't exceeded max retries
                  if (retryCount < maxRetries) {
                    logger.log(`[Prisma Studio] Retrying in ${retryDelay / 1000} seconds...`);
                    setTimeout(() => startPrismaStudio(retryCount + 1), retryDelay);
                  }
                } else {
                  logger.log('[Prisma Studio] Started successfully in background');
                  logger.log(`[Prisma Studio] Access at: ${envConfig.urls.prismaStudio}`);
                }
              }, 3000); // Wait 3 seconds to check if process is still running

              // Store process reference for cleanup
              (global as { prismaStudioProcess?: ChildProcess }).prismaStudioProcess =
                prismaStudioProcess;
            } catch (prismaStudioError) {
              logger.warn(
                `[Prisma Studio] Failed to auto-start: ${prismaStudioError instanceof Error ? prismaStudioError.message : String(prismaStudioError)}`
              );
              // Retry if we haven't exceeded max retries
              if (retryCount < maxRetries) {
                logger.log(`[Prisma Studio] Retrying in ${retryDelay / 1000} seconds...`);
                setTimeout(() => startPrismaStudio(retryCount + 1), retryDelay);
              } else {
                logger.error(
                  `[Prisma Studio] Failed to start after ${maxRetries} retries. You can start it manually with: pnpm prisma:studio`
                );
              }
            }
          };

          // Start Prisma Studio (with automatic retry on failure)
          // Delay startup slightly to ensure database is ready
          setTimeout(() => {
            startPrismaStudio();
          }, 3000); // Wait 3 seconds after app starts to ensure database is ready
        }
      }

      // Setup graceful shutdown handlers using GracefulShutdownService
      if (app && gracefulShutdownService) {
        try {
          // Check if setupShutdownHandlers method exists
          if (typeof gracefulShutdownService.setupShutdownHandlers === 'function') {
            logger.log('Setting up graceful shutdown handlers...');
            gracefulShutdownService.setupShutdownHandlers(
              app,
              customWebSocketAdapter,
              pubClient,
              subClient
            );
            logger.log('Graceful shutdown handlers configured successfully');
          } else {
            logger.warn(
              'GracefulShutdownService.setupShutdownHandlers is not a function, skipping shutdown handlers setup'
            );
          }
        } catch (shutdownError) {
          const shutdownErrorMessage =
            shutdownError instanceof Error ? shutdownError.message : 'Unknown error';
          const shutdownErrorStack =
            shutdownError instanceof Error ? shutdownError.stack : 'No stack trace';
          logger.error(`Failed to setup graceful shutdown handlers: ${shutdownErrorMessage}`);
          logger.error(`Shutdown handlers error stack: ${shutdownErrorStack}`);
          logger.warn('Application will continue without graceful shutdown handlers');
          // Don't throw - allow application to continue without shutdown handlers
        }
      } else {
        if (!app) {
          logger.warn(
            'Application instance is undefined, skipping graceful shutdown handlers setup'
          );
        }
        if (!gracefulShutdownService) {
          logger.warn(
            'GracefulShutdownService is undefined, skipping graceful shutdown handlers setup'
          );
        }
      }
    } catch (listenError) {
      const errorMessage = listenError instanceof Error ? listenError.message : 'Unknown error';
      const errorStack = listenError instanceof Error ? listenError.stack : 'No stack trace';

      // Log full error details including stack trace
      logger.error(`Failed to start server: ${errorMessage}`);
      logger.error(`Stack trace: ${errorStack}`);

      // Log additional error details for debugging
      if (listenError instanceof Error) {
        logger.error(`Error name: ${listenError.name}`);
        logger.error(`Error constructor: ${listenError.constructor.name}`);
        if ('code' in listenError) {
          logger.error(`Error code: ${String(listenError.code)}`);
        }
      }

      // Log error context for troubleshooting
      if (errorMessage.includes("Cannot read properties of undefined (reading 'set')")) {
        logger.error('Error: Attempting to call .set() on undefined object');
        logger.error('Common causes: app.set(), app.getHttpAdapter().set(), or similar');
      }

      await loggingService?.log(
        LogType.ERROR,
        AppLogLevel.ERROR,
        `Failed to start server: ${errorMessage}`,
        'Bootstrap',
        {
          _error: errorStack,
          fullError: listenError,
          errorType:
            listenError instanceof Error ? listenError.constructor.name : typeof listenError,
        }
      );
      throw new Error(`Server startup failed: ${errorMessage}`);
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

bootstrap().catch((_error: unknown) => {
  console.error('CRITICAL: Fatal error during bootstrap:', _error);
  process.exit(1);
});
