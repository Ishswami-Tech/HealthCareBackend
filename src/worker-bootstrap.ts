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

// Initialize Sentry first so background-job errors in this worker process are
// captured too. Relative path avoids depending on path-alias registration
// timing. No-ops when no DSN is configured.
import './instrument/sentry';
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
import { DiscoveryService } from '@nestjs/core';
import { SCHEDULER_TYPE_METADATA_KEY, findDuplicateSchedulers } from '@utils/scheduler-alias.util';
import { createFrameworkAdapter } from '@infrastructure/framework/adapters/fastify.adapter';
import { ApplicationLifecycleManager } from '@infrastructure/framework/wrappers/application-lifecycle.manager';
import { BullBoardModule } from '@infrastructure/queue/src/bull-board/bull-board.module';
import { ProcessErrorHandlersService } from '@core/resilience/graceful-shutdown.service';
import type { ApplicationConfig } from '@core/types/framework.types';
import { DatabaseService } from '@infrastructure/database/database.service';
import { WORKER_LIFECYCLE } from '@infrastructure/queue/src/queue.constants';
import { closeWorkersGracefully } from '@infrastructure/queue/src/worker-lifecycle/close-workers.util';
import {
  heartbeatFilePath,
  runHeartbeatCheck,
} from '@infrastructure/queue/src/worker-lifecycle/worker-heartbeat';
import { WorkerHealthController } from '@infrastructure/queue/src/worker-lifecycle/worker-health.controller';
import {
  startWorkerHeartbeat,
  type HeartbeatWorker,
  type WorkerHeartbeatHandle,
} from '@infrastructure/queue/src/worker-lifecycle/worker-heartbeat.runner';
import type { Worker } from 'bullmq';

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
import { TopologyHeartbeatService } from '@services/health/topology-heartbeat.service';

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
  // Reports this worker replica into the live deployment-topology registry
  // (dashboard's "Cluster & Node Information" panel) — same mechanism the API uses.
  providers: [TopologyHeartbeatService],
  // GET /health: the same heartbeat verdict as the container healthcheck, over HTTP.
  controllers: [WorkerHealthController],
  exports: [],
})
class WorkerModule {}

async function bootstrap() {
  if (process.argv.includes('--healthcheck')) {
    // Judges the heartbeat the RUNNING worker writes (process alive, Redis/Dragonfly + DB pings
    // OK, at least one BullMQ worker running). Prefer `node dist/worker-healthcheck.js`, which
    // does the same without loading this module graph.
    process.exit(runHeartbeatCheck(WORKER_LIFECYCLE.heartbeatMaxAgeMs));
  }

  let app: INestApplication | null;

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

      // A scheduled class that is also registered under an alias (`useExisting`) gets every job
      // registered twice by @nestjs/schedule: each tick runs twice. Say so at boot.
      try {
        const duplicates = findDuplicateSchedulers(
          app.get(DiscoveryService, { strict: false }).getProviders(),
          fn =>
            typeof fn === 'function'
              ? Reflect.getMetadata(SCHEDULER_TYPE_METADATA_KEY, fn as object)
              : undefined
        );
        for (const duplicate of duplicates) {
          void logService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Scheduled jobs of ${duplicate.className} are registered ${duplicate.registrations} times (alias provider): each tick runs ${duplicate.registrations}x. Move the @Cron methods to a class without an alias.`,
            'WorkerBootstrap',
            { className: duplicate.className, methods: duplicate.methods }
          );
        }
      } catch {
        // Discovery unavailable: the check is diagnostic only.
      }

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

      // Process error handlers only. GracefulShutdownService.setupShutdownHandlers is NOT used
      // on the worker: it raced the handler below (10s forced exit, DB disconnected before the
      // BullMQ workers had drained). The single SIGTERM/SIGINT handler is installWorkerShutdown.
      try {
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

    const workers = resolveBullWorkers(app);
    const heartbeat = startHeartbeat(app, workers);
    installWorkerShutdown(app, workers, heartbeat);
    console.error(
      `Worker is running and processing queues... (${workers.length} BullMQ worker(s), heartbeat ${heartbeatFilePath()})`
    );
  } catch (error) {
    console.error(
      'Worker failed to start:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

/** Key read (never written) by the heartbeat's Redis round-trip probe. */
const WORKER_REDIS_PING_KEY = 'healthcare:worker:heartbeat-probe';

/** The BullMQ workers QueueModule created (empty when cache/queues are disabled). */
function resolveBullWorkers(app: INestApplication): Worker[] {
  try {
    const workers = app.get<Worker[]>('BULLMQ_WORKERS', { strict: false });
    return Array.isArray(workers) ? workers : [];
  } catch {
    return [];
  }
}

function startHeartbeat(app: INestApplication, workers: readonly Worker[]): WorkerHeartbeatHandle {
  let databaseService: DatabaseService | null = null;
  try {
    databaseService = app.get(DatabaseService, { strict: false });
  } catch {
    databaseService = null;
  }
  return startWorkerHeartbeat({
    workers,
    pingWorkerRedis: async (worker: HeartbeatWorker): Promise<void> => {
      // A GET on the worker's own BullMQ connection (the queue DB) is the round-trip probe.
      const client = await (worker as Worker).getBackend().client;
      await client.get(WORKER_REDIS_PING_KEY);
    },
    pingDatabase: async (): Promise<boolean> => {
      if (!databaseService) throw new Error('DatabaseService not available');
      const status = await databaseService.getHealthStatus();
      return status.isHealthy;
    },
    filePath: heartbeatFilePath(),
    intervalMs: WORKER_LIFECYCLE.heartbeatIntervalMs,
    pingTimeoutMs: WORKER_LIFECYCLE.pingTimeoutMs,
    onWriteError: message => console.error(`[WorkerHeartbeat] ${message}`),
  });
}

/**
 * The ONE SIGTERM/SIGINT handler of the worker process:
 *   1. mark the heartbeat as shutting down (healthcheck goes red, no new traffic expected);
 *   2. close the BullMQ workers: stop fetching jobs, let in-flight jobs finish (bounded by
 *      WORKER_LIFECYCLE.closeTimeoutMs, then force-closed);
 *   3. app.close() runs every onModuleDestroy (queues, DLQ, DB, cache);
 *   4. exit. A hard deadline (WORKER_LIFECYCLE.shutdownTimeoutMs) guarantees the process exits
 *      before the container's stop_grace_period SIGKILLs it.
 * A second signal while shutting down is ignored.
 */
function installWorkerShutdown(
  app: INestApplication,
  workers: readonly Worker[],
  heartbeat: WorkerHeartbeatHandle
): void {
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`Received ${signal}, draining BullMQ workers before exit...`);
    const deadline = setTimeout(() => {
      console.error(
        `Worker shutdown exceeded ${WORKER_LIFECYCLE.shutdownTimeoutMs}ms, forcing exit`
      );
      process.exit(1);
    }, WORKER_LIFECYCLE.shutdownTimeoutMs);
    deadline.unref();

    let exitCode = 0;
    try {
      await heartbeat.stop();
      const results = await closeWorkersGracefully(workers, WORKER_LIFECYCLE.closeTimeoutMs);
      for (const result of results) {
        console.error(`BullMQ worker ${result.name}: ${result.outcome} in ${result.durationMs}ms`);
        if (result.outcome === 'failed') exitCode = 1;
      }
      await app.close();
    } catch (error) {
      console.error(
        `Error during ${signal} shutdown: ${error instanceof Error ? error.message : String(error)}`
      );
      exitCode = 1;
    }
    clearTimeout(deadline);
    process.exit(exitCode);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
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
