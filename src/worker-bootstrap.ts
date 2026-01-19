#!/usr/bin/env node

/**
 * DEDICATED WORKER BOOTSTRAP
 * ==========================
 * High-performance worker process for 100,000+ concurrent users
 * Runs SharedWorkerService in a separate container for:
 * - Better resource isolation
 * - Independent scaling
 * - Optimized queue processing
 */

import type { INestApplication } from '@nestjs/common';
import { Module, forwardRef, type DynamicModule, Logger } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { ConfigModule } from '@config';
import { DatabaseModule } from '@infrastructure/database';
import { CacheModule } from '@infrastructure/cache';
import { QueueModule } from '@infrastructure/queue';
import { LoggingModule } from '@infrastructure/logging';
import type { LoggingService } from '@infrastructure/logging';
import { ResilienceModule } from '@core/resilience';
import { GuardsModule } from '@core/guards/guards.module';
import { SessionModule } from '@core/session/session.module';
import { EventsModule } from '@infrastructure/events';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ErrorsModule } from '@core/errors';
import {
  GracefulShutdownService,
  ProcessErrorHandlersService,
} from '@core/resilience/graceful-shutdown.service';
import { createFrameworkAdapter, ApplicationLifecycleManager } from '@infrastructure/framework';
import type { ApplicationConfig } from '@core/types/framework.types';

@Module({
  imports: [
    // ConfigModule is @Global() and already configured in config.module.ts
    ConfigModule,
    // EventEmitterModule must be configured before EventsModule
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 20,
      verboseMemoryLeak: false,
    }),
    DatabaseModule,
    LoggingModule,
    ErrorsModule, // Provides CacheErrorHandler globally - required before CacheModule
    // Use forRoot() to exclude CacheWarmingService in worker
    // Worker only needs CacheService for queue processing, not cron jobs
    // Note: forwardRef needed due to circular dependency with ConfigModule/DatabaseModule
    forwardRef(() => {
      // TypeScript has trouble inferring types in forwardRef with circular dependencies
      // Use double assertion to work around this
      const CacheModuleRef = CacheModule as unknown as {
        forRoot: () => DynamicModule;
      };
      return CacheModuleRef.forRoot();
    }),
    ResilienceModule, // Provides GracefulShutdownService and ProcessErrorHandlersService
    EventsModule, // Central event system - required for queue event emissions
    QueueModule.forRoot(),
    // GuardsModule provides JwtAuthGuard and configures JwtModule (JwtService) globally
    // Required for worker queue processors/controllers that use JwtAuthGuard
    forwardRef(() => GuardsModule),
    // SessionModule provides SessionManagementService required by JwtAuthGuard
    forwardRef(() => SessionModule),
  ],
  providers: [],
  exports: [],
})
class WorkerModule {}

async function bootstrap() {
  let app: INestApplication | null = null;
  let logService: LoggingService | null = null;

  try {
    // Use framework adapter to create application (framework-agnostic approach)
    const logger = new Logger('WorkerBootstrap');
    const frameworkAdapter = createFrameworkAdapter();
    logger.log(`Using ${frameworkAdapter.getFrameworkName()} framework adapter for worker`);

    // Create application lifecycle manager
    const lifecycleManager = new ApplicationLifecycleManager(
      frameworkAdapter,
      logger,
      undefined // LoggingService not available yet
    );

    // Create application with basic configuration
    const basicApplicationConfig: ApplicationConfig = {
      environment: 'production', // Workers typically run in production mode
      isHorizontalScaling: false,
      instanceId: 'worker-1',
      trustProxy: false,
      bodyLimit: 10 * 1024 * 1024, // 10MB for worker
      keepAliveTimeout: 5000,
      connectionTimeout: 30000,
      requestTimeout: 10000,
      enableHttp2: false, // Workers don't need HTTP/2
    };

    app = await lifecycleManager.createApplication(WorkerModule, basicApplicationConfig);

    if (!app) {
      throw new Error('Worker application failed to initialize');
    }

    // Get service container for type-safe service retrieval
    const serviceContainer = lifecycleManager.getServiceContainer();
    const configService = await serviceContainer.getService<ConfigService>(ConfigService);

    // Initialize worker service
    await app.init();

    // Try to use LoggingService, fallback to console if not available
    try {
      const LoggingServiceClass = (await import('@infrastructure/logging')).LoggingService;
      logService = await serviceContainer.getService<LoggingService>(LoggingServiceClass);
      const { LogType, LogLevel } = await import('@core/types');

      if (logService) {
        // Use ConfigService for all cache configuration (single source of truth)
        const cacheProvider = configService.getCacheProvider();
        const cacheHost = configService.getCacheHost();
        const cachePort = configService.getCachePort();

        await logService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Healthcare Worker initialized successfully',
          'WorkerBootstrap',
          {
            serviceName: configService.get<string>('SERVICE_NAME', 'clinic'),
            cacheProvider,
            cacheHost,
            cachePort,
          }
        );

        // Log additional startup information through LoggingService
        await logService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Processing queues for ${configService.get<string>('SERVICE_NAME', 'clinic')} domain`,
          'WorkerBootstrap',
          {
            serviceName: configService.get<string>('SERVICE_NAME', 'clinic'),
          }
        );

        await logService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `${cacheProvider === 'dragonfly' ? 'Dragonfly' : cacheProvider === 'redis' ? 'Redis' : 'Memory'} Connection: ${cacheHost}:${cachePort}`,
          'WorkerBootstrap',
          {
            cacheProvider,
            cacheHost,
            cachePort,
          }
        );
      }
    } catch (error) {
      // Fallback logging only if LoggingService completely fails
      // This is acceptable as a last resort fallback when LoggingService is unavailable
      // These logs will NOT appear in logger dashboard, only in terminal
      console.error('✅ Healthcare Worker initialized successfully');
      console.error(
        `🔄 Processing queues for ${configService.get<string>('SERVICE_NAME', 'clinic')} domain`
      );
      // Use ConfigService for all cache configuration (single source of truth)
      const cacheProvider = configService.getCacheProvider();
      const cacheHost = configService.getCacheHost();
      const cachePort = configService.getCachePort();
      console.error(
        `📊 ${cacheProvider === 'dragonfly' ? 'Dragonfly' : cacheProvider === 'redis' ? 'Redis' : 'Memory'} Connection: ${cacheHost}:${cachePort}`
      );
      // Log the error that prevented LoggingService from being used
      if (error instanceof Error) {
        console.error(`⚠️ LoggingService initialization failed: ${error.message}`);
      }
    }

    // Setup process error handlers using ProcessErrorHandlersService
    if (logService && app) {
      try {
        const processErrorHandlersService =
          await serviceContainer.getService<ProcessErrorHandlersService>(
            ProcessErrorHandlersService
          );
        processErrorHandlersService.setupErrorHandlers();
      } catch (error) {
        // If service is not available, log and continue
        if (logService) {
          const { LogType, LogLevel } = await import('@core/types');
          await logService.log(
            LogType.ERROR,
            LogLevel.WARN,
            'ProcessErrorHandlersService not available, using fallback handlers',
            'WorkerBootstrap',
            { error: error instanceof Error ? error.message : String(error) }
          );
        }
      }
    }

    // Setup graceful shutdown using GracefulShutdownService
    if (app && logService) {
      try {
        const gracefulShutdownService =
          await serviceContainer.getService<GracefulShutdownService>(GracefulShutdownService);
        gracefulShutdownService.setupShutdownHandlers(app, null, null, null);
      } catch (error) {
        // If service is not available, use fallback shutdown handler
        if (logService) {
          const { LogType, LogLevel } = await import('@core/types');
          await logService.log(
            LogType.ERROR,
            LogLevel.WARN,
            'GracefulShutdownService not available, using fallback shutdown handler',
            'WorkerBootstrap',
            { error: error instanceof Error ? error.message : String(error) }
          );
        }

        // Fallback shutdown handler
        const shutdownHandler = async (signal: string): Promise<void> => {
          if (logService) {
            const { LogType, LogLevel } = await import('@core/types');
            await logService.log(
              LogType.SYSTEM,
              LogLevel.WARN,
              `Received ${signal}, shutting down worker gracefully...`,
              'WorkerBootstrap',
              { signal }
            );
          } else {
            // Fallback logging only if LoggingService is not available
            // These logs will NOT appear in logger dashboard, only in terminal
            console.error(`📤 Received ${signal}, shutting down worker gracefully...`);
          }
          try {
            if (app) {
              await app.close();
            }
            process.exit(0);
          } catch (shutdownError) {
            if (logService) {
              const { LogType, LogLevel } = await import('@core/types');
              await logService.log(
                LogType.ERROR,
                LogLevel.ERROR,
                `Error during ${signal} shutdown`,
                'WorkerBootstrap',
                {
                  signal,
                  error:
                    shutdownError instanceof Error ? shutdownError.message : String(shutdownError),
                  stack: shutdownError instanceof Error ? shutdownError.stack : undefined,
                }
              );
            } else {
              // Fallback logging only if LoggingService is not available
              // These logs will NOT appear in logger dashboard, only in terminal
              console.error(`❌ Error during ${signal} shutdown:`, shutdownError);
            }
            process.exit(1);
          }
        };

        process.on('SIGTERM', () => {
          void shutdownHandler('SIGTERM');
        });

        process.on('SIGINT', () => {
          void shutdownHandler('SIGINT');
        });
      }
    }

    // Health check endpoint for Docker
    if (process.argv.includes('--healthcheck')) {
      if (logService) {
        const { LogType, LogLevel } = await import('@core/types');
        await logService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Worker health check passed',
          'WorkerBootstrap',
          { healthCheck: true }
        );
      } else {
        // Fallback logging only if LoggingService is not available
        // These logs will NOT appear in logger dashboard, only in terminal
        console.error('✅ Worker health check passed');
      }
      process.exit(0);
    }

    // Keep the process alive
    if (logService) {
      const { LogType, LogLevel } = await import('@core/types');
      await logService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Worker is running and processing queues...',
        'WorkerBootstrap',
        { status: 'running' }
      );
    } else {
      // Fallback logging only if LoggingService is not available
      // These logs will NOT appear in logger dashboard, only in terminal
      console.error('🔄 Worker is running and processing queues...');
    }
  } catch (error) {
    if (logService) {
      const { LogType, LogLevel } = await import('@core/types');
      await logService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Worker failed to start',
        'WorkerBootstrap',
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    } else {
      // Fallback logging only if LoggingService is not available
      // These logs will NOT appear in logger dashboard, only in terminal
      console.error('❌ Worker failed to start:', error);
    }
    process.exit(1);
  }
}

// Process error handlers are set up by ProcessErrorHandlersService in bootstrap()
// These fallback handlers are only used if ProcessErrorHandlersService is not available
// They will be replaced once the service is initialized

bootstrap().catch((error: unknown) => {
  // Bootstrap-level error handler - LoggingService may not be available yet
  // This is the absolute last resort - LoggingService is not initialized at this point
  // These logs will NOT appear in logger dashboard, only in terminal
  console.error('🚨 Bootstrap failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
