import { Module, DynamicModule, forwardRef } from "@nestjs/common";
import { BullModule, getQueueToken } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { QueueService } from "./queue.service";
import { QueueProcessor } from "./queue.processor";
import { SharedWorkerService } from "./shared-worker.service";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import { QueueStatusGateway } from "./sockets/queue-status.gateway";
import { QueueMonitoringModule } from "./monitoring/queue-monitoring.module";
import {
  APPOINTMENT_QUEUE,
  EMAIL_QUEUE,
  NOTIFICATION_QUEUE,
  SERVICE_QUEUE,
  VIDHAKARMA_QUEUE,
  PANCHAKARMA_QUEUE,
  CHEQUP_QUEUE,
  DOCTOR_AVAILABILITY_QUEUE,
  QUEUE_MANAGEMENT_QUEUE,
  PAYMENT_PROCESSING_QUEUE,
  ANALYTICS_QUEUE,
  ENHANCED_APPOINTMENT_QUEUE,
  WAITING_LIST_QUEUE,
  CALENDAR_SYNC_QUEUE,
  AYURVEDA_THERAPY_QUEUE,
  PATIENT_PREFERENCE_QUEUE,
  REMINDER_QUEUE,
  FOLLOW_UP_QUEUE,
  RECURRING_APPOINTMENT_QUEUE,
} from "./queue.constants";
import { Queue, Worker, Job } from "bullmq";
import { DatabaseModule, DatabaseService } from "../../database";

@Module({})
export class QueueModule {
  static forRoot(): DynamicModule {
    // Filter queues based on service type to prevent conflicts
    const serviceName = process.env["SERVICE_NAME"] || "clinic";

    // Define service-specific queues with domain prefixes
    const clinicQueues = [
      APPOINTMENT_QUEUE,
      EMAIL_QUEUE,
      NOTIFICATION_QUEUE,
      SERVICE_QUEUE,
      VIDHAKARMA_QUEUE,
      PANCHAKARMA_QUEUE,
      CHEQUP_QUEUE,
      DOCTOR_AVAILABILITY_QUEUE,
      QUEUE_MANAGEMENT_QUEUE,
      PAYMENT_PROCESSING_QUEUE,
      ANALYTICS_QUEUE,
      ENHANCED_APPOINTMENT_QUEUE,
      WAITING_LIST_QUEUE,
      CALENDAR_SYNC_QUEUE,
      AYURVEDA_THERAPY_QUEUE,
      PATIENT_PREFERENCE_QUEUE,
      REMINDER_QUEUE,
      FOLLOW_UP_QUEUE,
      RECURRING_APPOINTMENT_QUEUE,
    ];

    // Select appropriate queues based on service
    let queueNames: string[];
    let redisConfig: unknown;

    if (serviceName === "clinic") {
      queueNames = clinicQueues;
      // Fashion-specific Redis configuration
      redisConfig = {
        host: process.env["REDIS_HOST"] || "localhost",
        port: parseInt(process.env["REDIS_PORT"] || "6379"),
        password: process.env["REDIS_PASSWORD"],
        db: parseInt(process.env["REDIS_DB"] || "2"), // Database for queue operations
      };
    } else if (serviceName === "worker") {
      // Worker processes ALL queues from both services
      queueNames = [...clinicQueues, ...clinicQueues];
      // Worker uses default Redis configuration
      redisConfig = {
        host: process.env["REDIS_HOST"] || "localhost",
        port: parseInt(process.env["REDIS_PORT"] || "6379"),
        password: process.env["REDIS_PASSWORD"],
        db: parseInt(process.env["REDIS_DB"] || "1"),
      };
    } else {
      // Default to clinic queues (including 'clinic' service)
      queueNames = clinicQueues;
      // Clinic-specific Redis configuration
      redisConfig = {
        host:
          process.env["CLINIC_REDIS_HOST"] ||
          process.env["REDIS_HOST"] ||
          "localhost",
        port: parseInt(
          process.env["CLINIC_REDIS_PORT"] ||
            process.env["REDIS_PORT"] ||
            "6379",
        ),
        password:
          process.env["CLINIC_REDIS_PASSWORD"] || process.env["REDIS_PASSWORD"],
        db: parseInt(process.env["CLINIC_REDIS_DB"] || "1"), // Separate DB for clinic
      };
    }

    return {
      module: QueueModule,
      imports: [
        forwardRef(() => DatabaseModule),
        ConfigModule,
        QueueMonitoringModule,
        BullModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: (_configService: ConfigService) => ({
            connection: {
              ...(redisConfig || {}),
              // Enterprise connection settings for 1M users
              maxRetriesPerRequest: 5,
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
              loadBalancing: "round-robin",
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
                type: "exponential",
                delay: 2000,
              },
              // Enterprise job options for 1M users
              delay: 0,
              priority: 0,
              lifo: false,
              timeout: 60000, // 60 second timeout for complex jobs
            },
          }),
          inject: [ConfigService],
        }),
        // Enhanced queue registration with domain-specific settings
        ...queueNames.map((queueName, index) =>
          BullModule.registerQueue({
            name: queueName,
            defaultJobOptions: {
              delay: Math.floor(index / 20) * 200, // Optimized stagger for 1M users
              removeOnComplete: 1000, // Keep more completed jobs for monitoring
              removeOnFail: 500, // Keep more failed jobs for debugging
              attempts: 5, // More retries for reliability
              backoff: {
                type: "exponential",
                delay: 2000,
              },
              priority: 0, // Default priority
              lifo: false, // FIFO for better fairness
            },
          }),
        ),
      ],
      providers: [
        QueueService,
        QueueProcessor,
        ...(serviceName === "worker" ? [SharedWorkerService] : []),
        ...(serviceName !== "worker" ? [QueueStatusGateway] : []),
        {
          provide: "BullBoard",
          useFactory: (...queues: Queue[]) => {
            const serverAdapter = new FastifyAdapter();

            // Domain-aware Bull Board - only show queues for current domain
            const domainQueues = queues.filter((queue) => {
              const queueName = queue.name;
              if (serviceName === "clinic") {
                return queueName.includes("clinic");
              } else if (serviceName === "worker") {
                return true; // Worker sees all queues
              }
              return true; // Worker sees all queues
            });

            createBullBoard({
              queues: domainQueues.map((queue) => new BullMQAdapter(queue)),
              serverAdapter,
              // Enhanced Bull Board configuration
              options: {
                uiBasePath:
                  serviceName === "clinic"
                    ? "/clinic-queue-dashboard"
                    : "/clinic-queue-dashboard",
              },
            });
            return serverAdapter;
          },
          inject: queueNames.map((queueName) => getQueueToken(queueName)),
        },
        // Enhanced worker configuration for 1M users
        ...(serviceName === "worker"
          ? [
              {
                provide: "BULLMQ_WORKERS",
                useFactory: (
                  queueProcessor: QueueProcessor,
                  _prisma: DatabaseService,
                ) => {
                  const workers = [];

                  // Create workers for each queue with enhanced concurrency
                  for (const queueName of queueNames) {
                    const concurrency = queueName.includes("appointment")
                      ? 200
                      : 100; // Higher concurrency for appointment queues

                    workers.push(
                      new Worker(
                        queueName,
                        async (job: Job<any, any, string>) => {
                          try {
                            switch (job.name) {
                              case "create":
                                return queueProcessor.processCreateJob(job);
                              case "update":
                                return queueProcessor.processUpdateJob(job);
                              case "confirm":
                                return queueProcessor.processConfirmJob(job);
                              case "complete":
                                return queueProcessor.processCompleteJob(job);
                              case "notify":
                                return queueProcessor.processNotifyJob(job);
                              case "process":
                                // Generic job processing - delegate to appropriate method based on job data
                                return queueProcessor.processCreateJob(job);
                              default:
                                throw new Error(
                                  `Unknown job type: ${job.name}`,
                                );
                            }
                          } catch (_error) {
                            // Enhanced _error handling for 1M users
                            console.error(
                              `Worker error for job ${job.id} in queue ${queueName}:`,
                              _error,
                            );
                            throw _error;
                          }
                        },
                        {
                          connection: {
                            ...(redisConfig || {}),
                            // Enhanced worker connection settings
                            maxRetriesPerRequest: 3,
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
                        },
                      ),
                    );
                  }

                  return workers;
                },
                inject: [QueueProcessor, DatabaseService],
              },
            ]
          : []),
        // Always provide BULLMQ_QUEUES for QueueService - with error handling
        {
          provide: "BULLMQ_QUEUES",
          useFactory: (...queues: unknown[]) => {
            console.log(
              `🔄 BULLMQ_QUEUES factory called with ${queues.length} queues for ${serviceName} service`,
            );
            // Filter out any undefined queues and ensure we have valid Queue instances
            const validQueues = queues.filter(
              (queue) => queue && typeof queue === "object",
            );
            console.log(
              `✅ BULLMQ_QUEUES providing ${validQueues.length} valid queues`,
            );
            return validQueues;
          },
          inject: queueNames.map((queueName) => getQueueToken(queueName)),
        },
        // Always provide BULLMQ_WORKERS (empty array if not worker service)
        ...(serviceName !== "worker"
          ? [
              {
                provide: "BULLMQ_WORKERS",
                useValue: [],
              },
            ]
          : []),
      ],
      exports: [
        QueueService,
        BullModule,
        ...(serviceName === "worker" ? [SharedWorkerService] : []),
        ...(serviceName !== "worker" ? [QueueStatusGateway] : []),
      ],
    };
  }

  static register(): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        forwardRef(() => DatabaseModule),
        BullModule.registerQueue({
          name: SERVICE_QUEUE,
        }),
        BullModule.registerQueue({
          name: APPOINTMENT_QUEUE,
        }),
        BullModule.registerQueue({
          name: EMAIL_QUEUE,
        }),
        BullModule.registerQueue({
          name: NOTIFICATION_QUEUE,
        }),
        BullModule.registerQueue({
          name: VIDHAKARMA_QUEUE,
        }),
        BullModule.registerQueue({
          name: PANCHAKARMA_QUEUE,
        }),
        BullModule.registerQueue({
          name: CHEQUP_QUEUE,
        }),
        BullModule.registerQueue({
          name: DOCTOR_AVAILABILITY_QUEUE,
        }),
        BullModule.registerQueue({
          name: QUEUE_MANAGEMENT_QUEUE,
        }),
        BullModule.registerQueue({
          name: PAYMENT_PROCESSING_QUEUE,
        }),
        BullModule.registerQueue({
          name: ANALYTICS_QUEUE,
        }),
      ],
      providers: [QueueService, QueueStatusGateway],
      exports: [BullModule, QueueService, QueueStatusGateway],
    };
  }
}
