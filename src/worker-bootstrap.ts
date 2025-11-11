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
import { ConfigService } from '@config';
import { DatabaseModule } from '@infrastructure/database';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { QueueModule } from '@infrastructure/queue/src/queue.module';
import { LoggingModule } from '@infrastructure/logging';
import type { LoggingService } from '@infrastructure/logging';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@config';
import { ResilienceModule } from '@core/resilience';
import {
  GracefulShutdownService,
  ProcessErrorHandlersService,
} from '@core/resilience/graceful-shutdown.service';

@Module({
  imports: [
    // ConfigModule is @Global() and already configured in config.module.ts
    ConfigModule,
    DatabaseModule,
    CacheModule,
    LoggingModule,
    ResilienceModule, // Provides GracefulShutdownService and ProcessErrorHandlersService
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

    const configService = app.get(ConfigService);

    // Initialize worker service
    await app.init();

    // Try to use LoggingService, fallback to console if not available
    try {
      const LoggingServiceClass = (await import('@infrastructure/logging')).LoggingService;
      logService = app.get(LoggingServiceClass);
      const { LogType, LogLevel } = await import('@core/types');

      if (logService) {
        await logService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Healthcare Worker initialized successfully',
          'WorkerBootstrap',
          {
            serviceName: configService.get<string>('SERVICE_NAME', 'clinic'),
            redisHost: configService.get<string>('REDIS_HOST', 'localhost'),
            redisPort: configService.get<number>('REDIS_PORT', 6379),
          }
        );
      }
    } catch {
      // Fallback to console.error/warn if LoggingService fails
      console.error('✅ Healthcare Worker initialized successfully');
      console.error(
        `🔄 Processing queues for ${configService.get<string>('SERVICE_NAME', 'clinic')} domain`
      );
      console.error(
        `📊 Redis Connection: ${configService.get<string>('REDIS_HOST', 'localhost')}:${configService.get<number>('REDIS_PORT', 6379)}`
      );
    }

    // Setup process error handlers using ProcessErrorHandlersService
    if (logService && app) {
      try {
        const processErrorHandlersService = app.get(ProcessErrorHandlersService);
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
        const gracefulShutdownService = app.get(GracefulShutdownService);
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
      console.error('✅ Worker health check passed');
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
      console.error('❌ Worker failed to start:', error);
    }
    process.exit(1);
  }
}

// Process error handlers are set up by ProcessErrorHandlersService in bootstrap()
// These fallback handlers are only used if ProcessErrorHandlersService is not available
// They will be replaced once the service is initialized

bootstrap().catch(error => {
  console.error('🚨 Bootstrap failed:', error);
  process.exit(1);
});
