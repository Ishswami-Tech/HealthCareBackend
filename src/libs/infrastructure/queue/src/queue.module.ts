import { Module, DynamicModule, forwardRef } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ScheduledTasksService } from '@infrastructure/queue/src/scheduled/scheduled-tasks.service';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
// Use direct import to avoid TDZ issues with barrel exports
import { ConfigModule } from '@config/config.module';
import { ConfigService } from '@config/config.service';
import { isCacheEnabled } from '@config/cache.config';
// Import helper functions for environment variable access in static factory
// Use top-level import for strict TypeScript compliance (no require())
import { getEnvWithDefault } from '../../../../config/environment/utils';
// InvoicePDFService is provided via standalone InvoicePDFModule to avoid
// pulling the full BillingModule (and its QueueModule dependency) into QueueModule.
import { InvoicePDFModule, InvoicePDFService } from '@services/billing/invoice-pdf.module';

// Internal imports - Core
import { QueueService } from './queue.service';
import { QueueProcessor } from './queue.processor';

import { QueueStatusGateway } from './sockets/queue-status.gateway';
import { QueueMonitoringModule } from './monitoring/queue-monitoring.module';
import { LoggingModule } from '@infrastructure/logging';
import { EventsModule } from '@infrastructure/events';
import { ResilienceModule } from '@core/resilience/resilience.module';
import { QueueHealthMonitorService } from './queue-health-monitor.service';
import {
  HEALTHCARE_QUEUE,
  DEAD_LETTER_QUEUE,
  DLQ_CONFIG,
  JOB_COMPLETION_MARKER_TTL_SECONDS,
  JOB_RETENTION,
} from './queue.constants';
import { runJobOnce, type CompletionMarkerStore } from './worker-lifecycle/job-idempotency.util';
import { captureError } from '../../../../instrument/sentry';
import { JobType } from '@core/types/queue.types';

/** The worker's own BullMQ connection (queue DB) as a marker store; null if unavailable. */
async function resolveMarkerStore(worker: Worker): Promise<CompletionMarkerStore | null> {
  try {
    return await worker.getBackend().client;
  } catch {
    return null;
  }
}
import { Queue, Worker, Job } from 'bullmq';
// Use direct imports to avoid TDZ issues with barrel exports
import { DatabaseModule } from '@infrastructure/database/database.module';
import { DatabaseService } from '@infrastructure/database/database.service';
import { StorageModule } from '@infrastructure/storage';
import type { JobData, CanonicalJobEnvelope } from '@core/types/queue.types';
import { AppointmentQueueService } from './services/appointment-queue.service';
import { QueueController } from './controllers/queue.controller';
import { DeadLetterQueueService } from './services/dead-letter-queue.service';
import { CacheModule } from '@infrastructure/cache';
import {
  getCacheConnectionTarget,
  type CacheConnectionTarget,
} from '@infrastructure/cache/utils/cache-connection-target.util';

@Module({})
export class QueueModule {
  static forRoot(): DynamicModule {
    // Note: This is a static method, so we can't inject ConfigService directly
    // We'll use a factory function that will be called when the module initializes
    // The actual ConfigService will be injected in the factory

    if (!isCacheEnabled()) {
      // Return a minimal module without BullMQ queues when cache is disabled
      return {
        module: QueueModule,
        global: true,
        imports: [
          forwardRef(() => DatabaseModule),
          ConfigModule,
          LoggingModule,
          StorageModule,
          forwardRef(() => CacheModule),
          forwardRef(() => ResilienceModule),
          QueueMonitoringModule,
          InvoicePDFModule,
        ],
        controllers: [QueueController],
        providers: [
          QueueService,
          AppointmentQueueService,
          QueueProcessor,
          QueueHealthMonitorService,
          // String-token alias so consumers (e.g. CacheWarmingService) can inject
          // QueueService via `import type` — avoids a static circular import
          // between the queue and cache modules while DI still resolves correctly.
          { provide: 'QUEUE_SERVICE', useExisting: QueueService },
          {
            provide: 'BULLMQ_QUEUES',
            useValue: [], // Empty array when cache is disabled
          },
          {
            provide: 'BULLMQ_WORKERS',
            useValue: [], // Empty array when cache is disabled
          },
        ],
        exports: [QueueService, 'QUEUE_SERVICE', AppointmentQueueService, QueueProcessor],
      };
    }

    // Filter queues based on service type to prevent conflicts
    // Helper function is imported at top-level for strict TypeScript compliance
    const serviceName = getEnvWithDefault('SERVICE_NAME', 'clinic');

    // Define service-specific queues with domain prefixes
    const clinicQueues = [HEALTHCARE_QUEUE];

    // Select appropriate queues based on service
    const queueNames = clinicQueues; // All services use clinic queues for now

    return {
      module: QueueModule,
      global: true, // Make QueueModule global so QueueService is available everywhere
      imports: [
        forwardRef(() => DatabaseModule),
        forwardRef(() => ConfigModule), // Use forwardRef to handle circular dependency with DatabaseModule
        LoggingModule, // Explicitly import LoggingModule to ensure LoggingService is available
        StorageModule,
        forwardRef(() => CacheModule),
        forwardRef(() => ResilienceModule), // Provides CircuitBreakerService for QueueHealthMonitorService
        // EventsModule is NOT @Global() — without importing it here, AppointmentQueueService's
        // and QueueStatusGateway's `@Optional() @Inject(forwardRef(() => EventService))` silently
        // resolve to undefined (Optional swallows the DI miss), so every queue domain event
        // (check-in, call-next, reorder, priority) emits nothing and no staff client, on any
        // process, ever gets a live push — only the `STAFF_LIVE_MS` poll ever refreshed them.
        forwardRef(() => EventsModule),
        QueueMonitoringModule,
        InvoicePDFModule,
        // ScheduledTasksService (worker) discovers @ScheduledTask methods on the providers.
        DiscoveryModule,
        BullModule.forRootAsync({
          imports: [forwardRef(() => ConfigModule)],
          useFactory: (configService: ConfigService) => {
            // Use ConfigService for all cache configuration (single source of truth)
            if (!configService.isCacheEnabled()) {
              throw new Error('Cache is disabled but BullMQ requires cache');
            }

            const cacheHost = configService.getCacheHost();
            const cachePort = configService.getCachePort();
            const cachePassword = configService.getCachePassword();
            const serviceName = configService.getEnv('SERVICE_NAME', 'clinic');

            // Build Redis config based on service
            const redisConfig: CacheConnectionTarget & { password?: string; db: number } = {
              ...getCacheConnectionTarget(key => configService.getEnv(key), {
                host: cacheHost,
                port: cachePort,
              }),
              db: configService.getEnvNumber('REDIS_DB', serviceName === 'clinic' ? 2 : 1),
            };

            if (cachePassword?.trim()) {
              redisConfig.password = cachePassword.trim();
            }

            return {
              connection: {
                ...redisConfig,
                // Enterprise connection settings for 1M users
                // BullMQ requires maxRetriesPerRequest to be null
                maxRetriesPerRequest: null,
                retryDelayOnFailover: 50,
                enableReadyCheck: true,
                connectTimeout: 30000,
                commandTimeout: 15000,
                lazyConnect: false,
                family: 0, // 0 = auto (IPv4 + IPv6); Docker DNS may return IPv6
                keepAlive: 60000,
                keepAliveInitialDelay: 0,
                showFriendlyErrorStack: false,
                enableAutoPipelining: true, // Enable for better performance
                maxLoadingTimeout: 30000,
                // Enterprise connection pooling for ultra-high concurrency
                maxConnections: 200,
                minConnections: 50,
                // Load balancing
                loadBalancing: 'round-robin',
                // Failover support
                failover: true,
                // Performance optimization
                maxMemoryUsage: 2 * 1024 * 1024 * 1024, // 2GB
              },
              defaultJobOptions: {
                // Bounded by count AND age: Dragonfly runs noeviction, so finished-job hashes
                // must never grow without limit.
                removeOnComplete: JOB_RETENTION.removeOnComplete,
                removeOnFail: JOB_RETENTION.removeOnFail,
                attempts: 5, // More retries for reliability
                backoff: {
                  type: 'exponential',
                  delay: 2000,
                },
                // Enterprise job options for 1M users
                delay: 0,
                priority: 0,
                lifo: false,
                timestamp: Date.now(),
              },
            };
          },
          inject: [ConfigService],
        }),
        // Enhanced queue registration with domain-specific settings
        ...queueNames.map((queueName: string, index: number) =>
          BullModule.registerQueue({
            name: queueName,
            defaultJobOptions: {
              delay: Math.floor(index / 20) * 200, // Optimized stagger for 1M users
              removeOnComplete: JOB_RETENTION.removeOnComplete,
              removeOnFail: JOB_RETENTION.removeOnFail,
              attempts: 5, // More retries for reliability
              backoff: {
                type: 'exponential',
                delay: 2000,
              },
              priority: 0, // Default priority
              lifo: false, // FIFO for better fairness
              timestamp: Date.now(),
            },
          })
        ),
        // Dead-letter queue — jobs that exhaust all retry attempts are routed here
        // instead of being silently discarded. Bounded: see DLQ_CONFIG (0 would mean
        // "delete immediately" in BullMQ, not "keep forever").
        BullModule.registerQueue({
          name: DEAD_LETTER_QUEUE,
          defaultJobOptions: {
            removeOnComplete: DLQ_CONFIG.removeOnComplete,
            removeOnFail: DLQ_CONFIG.removeOnFail,
            attempts: 1, // No retries in DLQ itself
            priority: 0,
            lifo: false,
          },
        }),
      ],
      controllers: [QueueController],
      providers: [
        // Core services first - QueueService must be available before QueueStatusGateway
        QueueService,
        AppointmentQueueService,
        DeadLetterQueueService,
        QueueHealthMonitorService,
        QueueProcessor,
        // String-token alias so consumers (e.g. CacheWarmingService) can inject
        // QueueService via `import type` — avoids a static circular import
        // between the queue and cache modules while DI still resolves correctly.
        { provide: 'QUEUE_SERVICE', useExisting: QueueService },
        // QueueStatusGateway depends on QueueService and LoggingService (via LoggingModule import).
        // Unconditional, like the app's other client-facing gateways (AppGateway,
        // RealtimeHealthGateway): staff clients (mobile/web) connect to the API service's
        // published port, never to the worker's (no published port, background-jobs only), so
        // gating this to `serviceName === 'worker'` made the namespace unreachable — the client
        // got "Invalid namespace" since no gateway ever bound it on the process it could reach.
        QueueStatusGateway,
        // Enhanced worker configuration for 1M users
        ...(serviceName === 'worker'
          ? [
              // @ScheduledTask jobs: registers their BullMQ schedulers and runs each tick.
              ScheduledTasksService,
              {
                provide: 'BULLMQ_WORKERS',
                useFactory: (
                  queueProcessor: QueueProcessor,
                  _prisma: DatabaseService,
                  configService: ConfigService,
                  deadLetterQueueService: DeadLetterQueueService,
                  _invoicePDFService: InvoicePDFService
                ) => {
                  const workers: Worker[] = [];

                  // Build Redis config using ConfigService
                  const cacheHost = configService.getCacheHost();
                  const cachePort = configService.getCachePort();
                  const cachePassword = configService.getCachePassword();
                  const workerServiceName = configService.getEnv('SERVICE_NAME', 'clinic');

                  const workerRedisConfig: CacheConnectionTarget & {
                    password?: string;
                    db: number;
                  } = {
                    ...getCacheConnectionTarget(key => configService.getEnv(key), {
                      host: cacheHost,
                      port: cachePort,
                    }),
                    db: configService.getEnvNumber(
                      'REDIS_DB',
                      workerServiceName === 'clinic' ? 2 : 1
                    ),
                  };

                  if (cachePassword?.trim()) {
                    workerRedisConfig.password = cachePassword.trim();
                  }

                  // Initialize Dead Letter Queue so failed jobs can be moved out of the main queue
                  void deadLetterQueueService.initialize({ ...workerRedisConfig });

                  // Create workers for each queue with enhanced concurrency
                  for (const queueName of queueNames) {
                    const concurrency = queueName.includes('appointment') ? 200 : 100;

                    const worker: Worker = new Worker(
                      queueName,
                      async (job: Job<JobData, unknown, string>) => {
                        const typedJob = job as unknown as Job<CanonicalJobEnvelope>;
                        // A job re-delivered after it already completed (worker killed before
                        // BullMQ recorded completion) is skipped instead of run twice.
                        const markerStore = await resolveMarkerStore(worker);
                        const outcome = await runJobOnce(
                          markerStore,
                          {
                            queueName: job.queueName,
                            id: job.id,
                            timestamp: job.timestamp,
                          },
                          JOB_COMPLETION_MARKER_TTL_SECONDS,
                          () => queueProcessor.processJob(typedJob)
                        );
                        return outcome.skipped
                          ? { success: true, skipped: true, reason: 'already completed' }
                          : outcome.result;
                      },
                      {
                        connection: {
                          ...workerRedisConfig,
                          // Enhanced worker connection settings
                          // BullMQ requires maxRetriesPerRequest to be null
                          maxRetriesPerRequest: null,
                          retryDelayOnFailover: 100,
                          connectTimeout: 60000,
                          commandTimeout: 30000,
                          lazyConnect: false,
                          enableReadyCheck: true,
                          keepAlive: 30000,
                        },
                        concurrency: concurrency, // Enhanced concurrency for 1M users
                        // Stalled job detection — prevents jobs from sitting forever
                        // after a worker restart/crash. A job is marked stalled if its
                        // lock hasn't been renewed within stalledInterval, and after
                        // maxStalledCount checks it's moved to failed → DLQ.
                        stalledInterval: 60000, // Check for stalled jobs every 60s
                        maxStalledCount: 3, // After 3 checks, mark job as failed
                        // Rate limiting for worker
                        limiter: {
                          max: 1000, // Max jobs per time window
                          duration: 60000, // 1 minute window
                        },
                      }
                    );

                    // When a job exhausts all retries, move it to the dead-letter queue and
                    // report it to Sentry — previously only logged to the internal /logger
                    // dashboard, so permanently-failed jobs never showed up as errors.
                    worker.on('failed', (job: Job | undefined, err: Error) => {
                      if (!job) return;
                      const maxAttempts = job.opts.attempts ?? 3;
                      // A job that stalled past maxStalledCount (see the Worker options
                      // above) is also terminal - BullMQ moves it straight to failed via an
                      // UnrecoverableError without ever incrementing attemptsMade, so
                      // attemptsMade can still read well below maxAttempts even though
                      // nothing will retry it again. Without this check, a worker
                      // crash/restart mid-job silently skips both dead-lettering and any
                      // job-type-specific cleanup below, leaving dependent state (e.g. a
                      // patient document's HealthRecord) stuck PENDING/PROCESSING forever.
                      const isTerminal =
                        job.attemptsMade >= maxAttempts || err.name === 'UnrecoverableError';
                      if (isTerminal) {
                        void deadLetterQueueService.moveToDeadLetter(job, err);
                        captureError(err, {
                          level: 'error',
                          tags: {
                            queue: job.queueName,
                            jobName: job.name,
                          },
                          extra: {
                            jobId: String(job.id),
                            attemptsMade: job.attemptsMade,
                          },
                        });
                        // A dead-lettered PATIENT_DOCUMENT_UPLOAD job would otherwise leave its
                        // HealthRecord stuck showing PENDING/PROCESSING forever, with no record
                        // anywhere that the upload actually failed.
                        if (job.name === (JobType.PATIENT_DOCUMENT_UPLOAD as string)) {
                          void queueProcessor.handlePatientDocumentUploadExhausted(job, err);
                        }
                      }
                    });

                    // Tracked so QueueService.onModuleDestroy and the worker's SIGTERM handler
                    // can close it: an unclosed worker is killed mid-job on every deploy and
                    // the job runs a second time after the stall check.
                    workers.push(worker);
                  }

                  return workers;
                },
                inject: [
                  QueueProcessor,
                  'DATABASE_SERVICE',
                  ConfigService,
                  DeadLetterQueueService,
                  'InvoicePDFService',
                ],
              },
            ]
          : []),
        // Always provide BULLMQ_QUEUES for QueueService - with error handling
        {
          provide: 'BULLMQ_QUEUES',
          useFactory: (...queues: Queue[]) => {
            // Filter out any undefined queues and ensure we have valid Queue instances
            const validQueues = (queues as unknown[]).filter(
              queue => queue && typeof queue === 'object'
            );
            return validQueues;
          },
          inject: [getQueueToken(HEALTHCARE_QUEUE)],
        },
        // Always provide BULLMQ_WORKERS (empty array if not worker service)
        ...(serviceName !== 'worker'
          ? [
              {
                provide: 'BULLMQ_WORKERS',
                useValue: [],
              },
            ]
          : []),
      ],
      exports: [
        QueueService,
        'QUEUE_SERVICE',
        AppointmentQueueService,
        BullModule,
        // Export health monitor for HealthService
        QueueHealthMonitorService,

        QueueStatusGateway,
      ],
    };
  }

  static register(): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        forwardRef(() => DatabaseModule),
        forwardRef(() => ResilienceModule), // Provides CircuitBreakerService for QueueHealthMonitorService
        BullModule.registerQueue({
          name: HEALTHCARE_QUEUE,
        }),
      ],
      providers: [
        QueueService,
        QueueStatusGateway,
        // Provide health monitor for HealthService
        QueueHealthMonitorService,
        { provide: 'QUEUE_SERVICE', useExisting: QueueService },
      ],
      exports: [
        BullModule,
        QueueService,
        'QUEUE_SERVICE',
        QueueStatusGateway,
        // Export health monitor for HealthService
        QueueHealthMonitorService,
      ],
    };
  }
}
