#!/usr/bin/env node

/**
 * DEDICATED WORKER BOOTSTRAP
 * ==========================
 * High-performance worker process for background job processing.
 * Runs QueueModule.forRoot() workers in a separate container for:
 * - Better resource isolation
 * - Independent scaling
 * - Optimized queue processing
 */

import type { INestApplication } from '@nestjs/common';
import { Module, forwardRef, type DynamicModule, Logger } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { ConfigModule } from '@config/config.module';
import { DatabaseModule } from '@infrastructure/database/database.module'; // Direct import avoids TDZ circular dep
import { CacheModule } from '@infrastructure/cache/cache.module';
import { QueueModule } from '@infrastructure/queue';
import { LoggingModule } from '@infrastructure/logging';
import type { LoggingService } from '@infrastructure/logging';
import { ResilienceModule } from '@core/resilience/resilience.module';
import { GuardsModule } from '@core/guards/guards.module';
import { SessionModule } from '@core/session/session.module';
import { EventsModule } from '@infrastructure/events/events.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ErrorsModule } from '@core/errors';
import { CommunicationModule } from '@communication/communication.module';
import { ScheduleModule } from '@nestjs/schedule';
import { createFrameworkAdapter } from '@infrastructure/framework/adapters/fastify.adapter';
import { ApplicationLifecycleManager } from '@infrastructure/framework/wrappers/application-lifecycle.manager';
import { BullBoardModule } from '@infrastructure/queue/src/bull-board/bull-board.module';
import {
  GracefulShutdownService,
  ProcessErrorHandlersService,
} from '@core/resilience/graceful-shutdown.service';
import type { ApplicationConfig } from '@core/types/framework.types';

/**
 * Service modules that own @Cron jobs.
 * On the worker these register schedulers; on the API the same modules
 * are loaded as plain providers (no ScheduleModule → @Cron is a no-op).
 *
 * AppointmentsModule: 4 crons (3 AM, 7 AM, 2× hourly)
 * BillingModule: 2 crons (hourly)
 * VideoModule: 5 crons (4× every minute, every 10 min)
 * CacheWarmingService (via CacheModule.forRoot when not worker): 2 crons
 */
import { AppointmentsModule } from '@services/appointments/appointments.module';
import { BillingModule } from '@services/billing/billing.module';
import { VideoModule } from '@services/video/video.module';

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
    ErrorsModule,
    ScheduleModule.forRoot(), // ONLY on worker — owns all cron execution
    forwardRef(() => {
      const CacheModuleRef = CacheModule as unknown as {
        forRoot: () => DynamicModule;
      };
      return CacheModuleRef.forRoot();
    }),
    ResilienceModule,
    EventsModule,
    CommunicationModule,
    QueueModule.forRoot(),
    BullBoardModule.forRoot(), // Bull Board on worker — actual job processor, real data
    // Service modules with @Cron decorators — these fire only here, not on API
    AppointmentsModule,
    BillingModule,
    VideoModule,
    forwardRef(() => GuardsModule),
    forwardRef(() => SessionModule),
  ],
  providers: [],
  exports: [],
})
class WorkerModule {}

async function bootstrap() {
  if (process.argv.includes('--healthcheck')) {
    console.error('Worker health check passed');
    process.exit(0);
  }

  let app: INestApplication | null = null;

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

    // Start HTTP server for Bull Board dashboard (worker-only, no API endpoints)
    // PORT env is set to 8080 in docker-compose for the worker (vs 8088 for API)
    // startServer() internally calls app.init() which triggers OnModuleInit hooks
    const serverPort = parseInt(configService.getEnv('PORT') ?? '8088', 10);
    await lifecycleManager.startServer({ port: serverPort, host: '0.0.0.0' });

    // Log startup info via LoggingService (fire-and-forget so cache writes don't block startup)
    // All logs route through cache + /logger dashboard for unified observability
    try {
      const importedLogging = await import('@infrastructure/logging');
      const { LogType, LogLevel } = await import('@core/types');
      const logService = await serviceContainer.getService<LoggingService>(
        importedLogging.LoggingService
      );

      const cacheProvider = configService.getCacheProvider();
      const cacheHost = configService.getCacheHost();
      const cachePort = configService.getCachePort();

      void logService.log(
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

      void logService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Processing queues for ${configService.get<string>('SERVICE_NAME', 'clinic')} domain`,
        'WorkerBootstrap',
        {
          serviceName: configService.get<string>('SERVICE_NAME', 'clinic'),
        }
      );

      void logService.log(
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

      // Setup resilience services for production stability
      try {
        const gracefulShutdownService =
          await serviceContainer.getService<GracefulShutdownService>(GracefulShutdownService);
        gracefulShutdownService.setupShutdownHandlers(app!, null, null, null);

        const processErrorHandlersService =
          await serviceContainer.getService<ProcessErrorHandlersService>(
            ProcessErrorHandlersService
          );
        processErrorHandlersService.setupErrorHandlers();
      } catch {
        // Resilience services not available — fallback shutdown handler below covers basics
      }
    } catch {
      // Fallback to console if LoggingService is not available
      const cacheProvider = configService.getCacheProvider();
      const cacheHost = configService.getCacheHost();
      const cachePort = configService.getCachePort();
      console.error('Worker initialized successfully');
      console.error(
        `Processing queues for ${configService.get<string>('SERVICE_NAME', 'clinic')} domain`
      );
      console.error(
        `${cacheProvider === 'dragonfly' ? 'Dragonfly' : cacheProvider === 'redis' ? 'Redis' : 'Memory'} Connection: ${cacheHost}:${cachePort}`
      );
    }

    // Setup graceful shutdown handlers
    const shutdownHandler = async (signal: string): Promise<void> => {
      console.error(`Received ${signal}, shutting down worker gracefully...`);
      try {
        if (app) {
          await app.close();
        }
        process.exit(0);
      } catch {
        console.error(`Error during ${signal} shutdown`);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => {
      void shutdownHandler('SIGTERM');
    });

    process.on('SIGINT', () => {
      void shutdownHandler('SIGINT');
    });
    console.error('Worker is running and processing queues...');
  } catch (error) {
    console.error(
      'Worker failed to start:',
      error instanceof Error ? error.message : String(error)
    );
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
