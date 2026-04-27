import { Module, DynamicModule, forwardRef } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
// Use direct import to avoid TDZ issues with barrel exports
import { ConfigModule } from '@config/config.module';
import { ConfigService } from '@config/config.service';
import { isCacheEnabled } from '@config/cache.config';
// Import helper functions for environment variable access in static factory
// Use top-level import for strict TypeScript compliance (no require())
import { getEnvWithDefault } from '../../../../config/environment/utils';
// Note: BillingModule is imported dynamically via forwardRef to avoid circular dependency
// InvoicePDFService is injected via token in QueueProcessor

// Internal imports - Core
import { QueueService } from './queue.service';
import { QueueProcessor } from './queue.processor';

import { QueueStatusGateway } from './sockets/queue-status.gateway';
import { QueueMonitoringModule } from './monitoring/queue-monitoring.module';
import { LoggingModule } from '@infrastructure/logging';
import { ResilienceModule } from '@core/resilience/resilience.module';
import { QueueHealthMonitorService } from './queue-health-monitor.service';
import { HEALTHCARE_QUEUE } from './queue.constants';
import { Queue, Worker, Job } from 'bullmq';
// Use direct imports to avoid TDZ issues with barrel exports
import { DatabaseModule } from '@infrastructure/database/database.module';
import { DatabaseService } from '@infrastructure/database/database.service';
import type { JobData, CanonicalJobEnvelope } from '@core/types/queue.types';
import { AppointmentQueueService } from './services/appointment-queue.service';
import { QueueController } from './controllers/queue.controller';

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
          forwardRef(() => ResilienceModule),
          QueueMonitoringModule,
        ],
        controllers: [QueueController],
        providers: [
          QueueService,
          AppointmentQueueService,
          QueueProcessor,
          QueueHealthMonitorService,
          {
            provide: 'BULLMQ_QUEUES',
            useValue: [], // Empty array when cache is disabled
          },
          {
            provide: 'BULLMQ_WORKERS',
            useValue: [], // Empty array when cache is disabled
          },
        ],
        exports: [QueueService, AppointmentQueueService, QueueProcessor],
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
        forwardRef(() => ResilienceModule), // Provides CircuitBreakerService for QueueHealthMonitorService
        QueueMonitoringModule,
        // Note: BillingModule NOT imported here to avoid circular dependency
        // InvoicePDFService is optional in QueueProcessor and will be null if BillingModule is not available
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
            const redisConfig: {
              host: string;
              port: number;
              password?: string;
              db: number;
            } = {
              host: cacheHost,
              port: cachePort,
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
                family: 4,
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
                removeOnComplete: 1000, // Keep more completed jobs for monitoring
                removeOnFail: 500, // Keep more failed jobs for debugging
                attempts: 5, // More retries for reliability
                backoff: {
                  type: 'exponential',
                  delay: 2000,
                },
                // Enterprise job options for 1M users
                delay: 0,
                priority: 0,
                lifo: false,
                timeout: 60000, // 60 second timeout for complex jobs
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
              removeOnComplete: 1000, // Keep more completed jobs for monitoring
              removeOnFail: 500, // Keep more failed jobs for debugging
              attempts: 5, // More retries for reliability
              backoff: {
                type: 'exponential',
                delay: 2000,
              },
              priority: 0, // Default priority
              lifo: false, // FIFO for better fairness
            },
          })
        ),
      ],
      controllers: [QueueController],
      providers: [
        // Core services first - QueueService must be available before QueueStatusGateway
        QueueService,
        AppointmentQueueService,
        QueueHealthMonitorService,
        QueueProcessor,
        // QueueStatusGateway depends on QueueService and LoggingService (via LoggingModule import)
        ...(serviceName !== 'worker' ? [QueueStatusGateway] : []),
        // Enhanced worker configuration for 1M users
        ...(serviceName === 'worker'
          ? [
              {
                provide: 'BULLMQ_WORKERS',
                useFactory: (
                  queueProcessor: QueueProcessor,
                  _prisma: DatabaseService,
                  configService: ConfigService
                ) => {
                  const workers = [];

                  // Build Redis config using ConfigService
                  const cacheHost = configService.getCacheHost();
                  const cachePort = configService.getCachePort();
                  const cachePassword = configService.getCachePassword();
                  const workerServiceName = configService.getEnv('SERVICE_NAME', 'clinic');

                  const workerRedisConfig: {
                    host: string;
                    port: number;
                    password?: string;
                    db: number;
                  } = {
                    host: cacheHost,
                    port: cachePort,
                    db: configService.getEnvNumber(
                      'REDIS_DB',
                      workerServiceName === 'clinic' ? 2 : 1
                    ),
                  };

                  if (cachePassword?.trim()) {
                    workerRedisConfig.password = cachePassword.trim();
                  }

                  // Create workers for each queue with enhanced concurrency
                  for (const queueName of queueNames) {
                    const concurrency = queueName.includes('appointment') ? 200 : 100; // Higher concurrency for appointment queues

                    workers.push(
                      new Worker(
                        queueName,
                        async (job: Job<JobData, unknown, string>) => {
                          const typedJob = job as unknown as Job<CanonicalJobEnvelope>;
                          return await queueProcessor.processJob(typedJob);
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
                          // Enhanced worker settings - using only valid BullMQ options
                          settings: {
                            // Note: BullMQ Worker doesn't support these settings directly
                            // They are handled internally by BullMQ
                          },
                          // Rate limiting for worker
                          limiter: {
                            max: 1000, // Max jobs per time window
                            duration: 60000, // 1 minute window
                          },
                        }
                      )
                    );
                  }

                  return workers;
                },
                inject: [QueueProcessor, DatabaseService, ConfigService],
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
        AppointmentQueueService,
        BullModule,
        // Export health monitor for HealthService
        QueueHealthMonitorService,

        ...(serviceName !== 'worker' ? [QueueStatusGateway] : []),
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
      ],
      exports: [
        BullModule,
        QueueService,
        QueueStatusGateway,
        // Export health monitor for HealthService
        QueueHealthMonitorService,
      ],
    };
  }
}
