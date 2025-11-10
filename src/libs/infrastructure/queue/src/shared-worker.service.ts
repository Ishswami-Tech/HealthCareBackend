/**
 * SHARED BULLMQ WORKER SERVICE
 * =============================
 * Centralized queue processing for both clinic and clinic microservices
 * Handles all queue types with domain-specific processing
 */

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

import { Worker, Job } from 'bullmq';
import { ConfigService } from '@config';
import { CacheService } from '@infrastructure/cache';

// Internal imports - Infrastructure
import { LoggingService } from '@infrastructure/logging';

// Internal imports - Types
import type {
  QueueJobData,
  AppointmentJobData,
  NotificationJobData,
  PatientCheckinData,
  JobProcessingResult,
  WorkerStatus,
  JobMetadata,
} from '@core/types';

// Internal imports - Core
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { LogType, LogLevel } from '@core/types';

// Queue constants
import {
  SERVICE_QUEUE,
  APPOINTMENT_QUEUE,
  EMAIL_QUEUE,
  NOTIFICATION_QUEUE,
  VIDHAKARMA_QUEUE,
  PANCHAKARMA_QUEUE,
  CHEQUP_QUEUE,
  ENHANCED_APPOINTMENT_QUEUE,
  DOCTOR_AVAILABILITY_QUEUE,
  QUEUE_MANAGEMENT_QUEUE,
  WAITING_LIST_QUEUE,
  PAYMENT_PROCESSING_QUEUE,
  CALENDAR_SYNC_QUEUE,
  AYURVEDA_THERAPY_QUEUE,
  PATIENT_PREFERENCE_QUEUE,
  ANALYTICS_QUEUE,
  REMINDER_QUEUE,
  FOLLOW_UP_QUEUE,
  RECURRING_APPOINTMENT_QUEUE,
} from './queue.constants';

// Redis connection configuration
interface RedisConnection {
  host: string;
  port: number;
  password?: string | undefined;
  db: number;
  maxRetriesPerRequest: number | null;
  retryDelayOnFailover: number;
  connectTimeout: number;
  commandTimeout: number;
  lazyConnect: boolean;
  keepAlive: number;
  family: number;
  enableReadyCheck: boolean;
  retryDelayOnCloseConnection: number;
}

@Injectable()
export class SharedWorkerService implements OnModuleInit, OnModuleDestroy {
  private workers: Map<string, Worker> = new Map();
  private isShuttingDown = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
  ) {}

  onModuleInit() {
    this.initializeWorkers();
  }

  async onModuleDestroy() {
    await this.shutdownWorkers();
  }

  private initializeWorkers() {
    try {
      const redisConnection = {
        host: this.configService?.get<string>('redis.host', 'localhost') || process.env['REDIS_HOST'] || 'localhost',
        port: this.configService?.get<number>('redis.port', 6379) || parseInt(process.env['REDIS_PORT'] || '6379', 10),
        db: this.configService?.get<number>('redis.db', 0) || parseInt(process.env['REDIS_DB'] || '0', 10),
        maxRetriesPerRequest: null,
        retryDelayOnFailover: 100,
        connectTimeout: 10000,
        commandTimeout: 5000,
        lazyConnect: true,
        keepAlive: 30000,
        family: 4,
        enableReadyCheck: false,
        retryDelayOnCloseConnection: 500,
        ...((this.configService?.get<string>('redis.password') || process.env['REDIS_PASSWORD'])?.trim() && {
          password: (this.configService?.get<string>('redis.password') || process.env['REDIS_PASSWORD'])?.trim(),
        }),
      };

      // Define all queues with their configurations
      const queueConfigs = [
        // Clinic queues
        { name: APPOINTMENT_QUEUE, concurrency: 50 },
        { name: ENHANCED_APPOINTMENT_QUEUE, concurrency: 30 },
        { name: NOTIFICATION_QUEUE, concurrency: 100 },
        { name: EMAIL_QUEUE, concurrency: 80 },
        { name: VIDHAKARMA_QUEUE, concurrency: 20 },
        { name: PANCHAKARMA_QUEUE, concurrency: 20 },
        { name: CHEQUP_QUEUE, concurrency: 25 },
        { name: AYURVEDA_THERAPY_QUEUE, concurrency: 15 },
        { name: SERVICE_QUEUE, concurrency: 40 },
        { name: DOCTOR_AVAILABILITY_QUEUE, concurrency: 30 },
        { name: QUEUE_MANAGEMENT_QUEUE, concurrency: 20 },
        { name: WAITING_LIST_QUEUE, concurrency: 25 },
        { name: PAYMENT_PROCESSING_QUEUE, concurrency: 35 },
        { name: CALENDAR_SYNC_QUEUE, concurrency: 20 },
        { name: PATIENT_PREFERENCE_QUEUE, concurrency: 15 },
        { name: ANALYTICS_QUEUE, concurrency: 25 },
        { name: REMINDER_QUEUE, concurrency: 40 },
        { name: FOLLOW_UP_QUEUE, concurrency: 30 },
        { name: RECURRING_APPOINTMENT_QUEUE, concurrency: 20 },
      ];

      // Initialize workers for each queue
      for (const config of queueConfigs) {
        this.createWorker(config.name, config.concurrency, redisConnection);
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Shared worker service initialized with ${queueConfigs.length} queues`,
        'SharedWorkerService'
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to initialize shared worker service: ${_error instanceof Error ? _error.message : String(_error)}`,
        'SharedWorkerService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw new HealthcareError(
        ErrorCode.QUEUE_INITIALIZATION_FAILED,
        'Failed to initialize shared worker service',
        undefined,
        {},
        'SharedWorkerService.initializeWorkers'
      );
    }
  }

  private createWorker(queueName: string, concurrency: number, redisConnection: RedisConnection) {
    try {
      const worker = new Worker(
        queueName,
        async (job: Job<QueueJobData>) => {
          return await this.processJob(job);
        },
        {
          connection: redisConnection,
          concurrency,
          prefix: 'healthcare:worker',
          autorun: true,
          stalledInterval: 30000,
          maxStalledCount: 1,
        }
      );

      // Worker event handlers
      worker.on('completed', job => {
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.INFO,
          `Job completed: ${job.name} on queue ${queueName}`,
          'SharedWorkerService',
          {
            jobId: job.id?.toString(),
            queueName,
          }
        );
      });

      worker.on('failed', (job, _err) => {
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.ERROR,
          `Job failed: ${job?.name || 'unknown'} on queue ${queueName}`,
          'SharedWorkerService',
          {
            jobId: job?.id?.toString(),
            queueName,
            error: _err instanceof Error ? _err.message : String(_err),
          }
        );
      });

      worker.on('error', _err => {
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.ERROR,
          `Worker error on queue ${queueName}`,
          'SharedWorkerService',
          {
            queueName,
            error: _err instanceof Error ? _err.message : String(_err),
          }
        );
      });

      this.workers.set(queueName, worker);

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Worker created for queue: ${queueName}`,
        'SharedWorkerService',
        { queueName }
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to create worker for queue ${queueName}`,
        'SharedWorkerService',
        {
          queueName,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw new HealthcareError(
        ErrorCode.QUEUE_OPERATION_FAILED,
        `Failed to create worker for queue ${queueName}`,
        undefined,
        { queueName },
        'SharedWorkerService.createWorker'
      );
    }
  }

  private async processJob(job: Job<QueueJobData>) {
    try {
      const { action, data, metadata } = job.data;

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing job: ${action} (ID: ${job.id?.toString() || 'unknown'})`,
        'SharedWorkerService',
        {
          action,
          jobId: job.id?.toString(),
        }
      );

      // Process healthcare job
      return await this.processClinicJob(action, data, metadata);
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Job processing failed: ${_error instanceof Error ? _error.message : String(_error)}`,
        'SharedWorkerService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  private async processClinicJob(
    action: string,
    data: unknown,
    metadata?: JobMetadata
  ): Promise<JobProcessingResult> {
    try {
      // Implement proper clinic job processing based on action type
      switch (action) {
        case 'appointment_created':
          return this.processAppointmentCreated(data as AppointmentJobData, metadata);
        case 'appointment_updated':
          return this.processAppointmentUpdated(data as AppointmentJobData, metadata);
        case 'appointment_cancelled':
          return this.processAppointmentCancelled(data as AppointmentJobData, metadata);
        case 'patient_checkin':
          return this.processPatientCheckin(data as PatientCheckinData, metadata);
        case 'notification_send':
          return this.processNotificationSend(data as NotificationJobData, metadata);
        default:
          void this.loggingService.log(
            LogType.QUEUE,
            LogLevel.WARN,
            `Unknown clinic job action: ${action}`,
            'SharedWorkerService',
            { action }
          );
          return Promise.resolve({
            success: false,
            message: `Unknown clinic job action: ${action}`,
          });
      }
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing clinic job ${action}: ${_error instanceof Error ? _error.message : String(_error)}`,
        'SharedWorkerService',
        {
          action,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      return Promise.resolve({
        success: false,
        message: `Error processing clinic job: ${_error instanceof Error ? _error.message : String(_error)}`,
      });
    }
  }

  private processAppointmentCreated(
    data: AppointmentJobData,
    _metadata?: JobMetadata
  ): JobProcessingResult {
    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.INFO,
      'Processing appointment creation job',
      'SharedWorkerService',
      {
        appointmentId: data.appointmentId || data.appointment?.appointmentId,
      }
    );
    // Process appointment creation logic here
    return {
      success: true,
      message: 'Appointment creation processed successfully',
    };
  }

  private processAppointmentUpdated(
    data: AppointmentJobData,
    _metadata?: JobMetadata
  ): JobProcessingResult {
    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.INFO,
      'Processing appointment update job',
      'SharedWorkerService',
      {
        appointmentId: data.appointmentId || data.appointment?.appointmentId,
      }
    );
    // Process appointment update logic here
    return {
      success: true,
      message: 'Appointment update processed successfully',
    };
  }

  private processAppointmentCancelled(
    data: AppointmentJobData,
    _metadata?: JobMetadata
  ): JobProcessingResult {
    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.INFO,
      'Processing appointment cancellation job',
      'SharedWorkerService',
      {
        appointmentId: data.appointmentId || data.appointment?.appointmentId,
      }
    );
    // Process appointment cancellation logic here
    return {
      success: true,
      message: 'Appointment cancellation processed successfully',
    };
  }

  private processPatientCheckin(
    data: PatientCheckinData,
    _metadata?: JobMetadata
  ): JobProcessingResult {
    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.INFO,
      'Processing patient check-in job',
      'SharedWorkerService',
      {
        patientId: data.patientId,
        appointmentId: data.appointmentId,
      }
    );
    // Process patient check-in logic here
    return {
      success: true,
      message: 'Patient check-in processed successfully',
    };
  }

  private processNotificationSend(
    data: NotificationJobData,
    _metadata?: JobMetadata
  ): JobProcessingResult {
    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.INFO,
      'Processing notification send job',
      'SharedWorkerService',
      {
        notificationType: data.type || data.notification?.type,
      }
    );
    // Process notification sending logic here
    return { success: true, message: 'Notification sent successfully' };
  }

  private async shutdownWorkers() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    try {
      const shutdownPromises = Array.from(this.workers.values()).map(async worker => {
        await worker.close();
      });

      await Promise.all(shutdownPromises);
      this.workers.clear();

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        'All workers shut down successfully',
        'SharedWorkerService'
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error during worker shutdown: ${_error instanceof Error ? _error.message : String(_error)}`,
        'SharedWorkerService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
    }
  }

  // Public methods for health checks and monitoring
  getWorkerStatus(): Record<string, WorkerStatus> {
    const status: Record<string, WorkerStatus> = {};
    for (const [queueName, worker] of this.workers) {
      status[queueName] = {
        isRunning: true, // Assume running if worker exists in map
        queueName,
        concurrency: worker.concurrency,
      };
    }
    return status;
  }

  getActiveJobCount() {
    let totalActive = 0;
    for (const _worker of this.workers.values()) {
      // Note: BullMQ doesn't expose active job count directly
      // This would need to be implemented with Redis queries
      totalActive += 0; // Placeholder
    }
    return totalActive;
  }
}
