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

import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Module, forwardRef, type DynamicModule } from '@nestjs/common';
import { ConfigService } from '@config';
import { ConfigModule } from '@config';
import { DatabaseModule } from '@infrastructure/database';
import { CacheModule } from '@infrastructure/cache';
import { QueueModule } from '@infrastructure/queue';
import { LoggingModule } from '@infrastructure/logging';
import type { LoggingService } from '@infrastructure/logging';
import { ResilienceModule } from '@core/resilience';
import { EventsModule } from '@infrastructure/events';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ErrorsModule } from '@core/errors';
import {
  GracefulShutdownService,
  ProcessErrorHandlersService,
} from '@core/resilience/graceful-shutdown.service';

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
  ],
  providers: [],
  exports: [],
})
class WorkerModule {}

async function bootstrap() {
  let app: INestApplication | null = null;
  let logService: LoggingService | null = null;

  try {
    app = await NestFactory.create(WorkerModule, {
      logger: ['error', 'warn'],
    });

    const configService = await app.resolve(ConfigService);

    // Initialize worker service
    await app.init();

    // Try to use LoggingService, fallback to console if not available
    try {
      const LoggingServiceClass = (await import('@infrastructure/logging')).LoggingService;
      logService = await app.resolve(LoggingServiceClass);
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
      }
    } catch (error) {
      // Fallback logging only if LoggingService completely fails
      // This is acceptable as a last resort fallback when LoggingService is unavailable
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
        const processErrorHandlersService = await app.resolve(ProcessErrorHandlersService);
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
        const gracefulShutdownService = await app.resolve(GracefulShutdownService);
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
              {}
            );
          } else {
            // Fallback logging only if LoggingService is not available
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
                  error:
                    shutdownError instanceof Error ? shutdownError.message : String(shutdownError),
                }
              );
            } else {
              // Fallback logging only if LoggingService is not available
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
          {}
        );
      } else {
        // Fallback logging only if LoggingService is not available
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
        {}
      );
    } else {
      // Fallback logging only if LoggingService is not available
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
        { error: error instanceof Error ? error.message : String(error) }
      );
    } else {
      // Fallback logging only if LoggingService is not available
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
  console.error('🚨 Bootstrap failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
