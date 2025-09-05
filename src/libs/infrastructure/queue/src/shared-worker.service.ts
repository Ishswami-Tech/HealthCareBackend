/**
 * SHARED BULLMQ WORKER SERVICE
 * =============================
 * Centralized queue processing for both clinic and clinic microservices
 * Handles all queue types with domain-specific processing
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../cache';
import { LoggingService } from '../../logging';
import { LogType, LogLevel } from '../../logging/types/logging.types';

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
  FASHION_APPOINTMENT_QUEUE,
  FASHION_NOTIFICATION_QUEUE,
  FASHION_EMAIL_QUEUE,
  FASHION_PAYMENT_QUEUE,
  FASHION_ANALYTICS_QUEUE,
} from './queue.constants';

export interface QueueJobData {
  domain: 'clinic' | 'clinic';
  action: string;
  data: any;
  metadata?: Record<string, any>;
}

@Injectable()
export class SharedWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SharedWorkerService.name);
  private workers: Map<string, Worker> = new Map();
  private isShuttingDown = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
  ) {}

  async onModuleInit() {
    await this.initializeWorkers();
  }

  async onModuleDestroy() {
    await this.shutdownWorkers();
  }

  private async initializeWorkers() {
    try {
      const redisConnection = {
        host: this.configService.get('redis.host', 'localhost'),
        port: this.configService.get('redis.port', 6379),
        password: this.configService.get('redis.password'),
        db: this.configService.get('redis.db', 0),
        maxRetriesPerRequest: null,
        retryDelayOnFailover: 100,
        connectTimeout: 10000,
        commandTimeout: 5000,
        lazyConnect: true,
        keepAlive: 30000,
        family: 4,
        enableReadyCheck: false,
        retryDelayOnCloseConnection: 500,
      };

      // Define all queues with their configurations
      const queueConfigs = [
        // Clinic queues
        { name: APPOINTMENT_QUEUE, concurrency: 50, domain: 'clinic' },
        { name: ENHANCED_APPOINTMENT_QUEUE, concurrency: 30, domain: 'clinic' },
        { name: NOTIFICATION_QUEUE, concurrency: 100, domain: 'clinic' },
        { name: EMAIL_QUEUE, concurrency: 80, domain: 'clinic' },
        { name: VIDHAKARMA_QUEUE, concurrency: 20, domain: 'clinic' },
        { name: PANCHAKARMA_QUEUE, concurrency: 20, domain: 'clinic' },
        { name: CHEQUP_QUEUE, concurrency: 25, domain: 'clinic' },
        { name: AYURVEDA_THERAPY_QUEUE, concurrency: 15, domain: 'clinic' },
        { name: SERVICE_QUEUE, concurrency: 40, domain: 'clinic' },
        { name: DOCTOR_AVAILABILITY_QUEUE, concurrency: 30, domain: 'clinic' },
        { name: QUEUE_MANAGEMENT_QUEUE, concurrency: 20, domain: 'clinic' },
        { name: WAITING_LIST_QUEUE, concurrency: 25, domain: 'clinic' },
        { name: PAYMENT_PROCESSING_QUEUE, concurrency: 35, domain: 'clinic' },
        { name: CALENDAR_SYNC_QUEUE, concurrency: 20, domain: 'clinic' },
        { name: PATIENT_PREFERENCE_QUEUE, concurrency: 15, domain: 'clinic' },
        { name: ANALYTICS_QUEUE, concurrency: 25, domain: 'clinic' },
        { name: REMINDER_QUEUE, concurrency: 40, domain: 'clinic' },
        { name: FOLLOW_UP_QUEUE, concurrency: 30, domain: 'clinic' },
        { name: RECURRING_APPOINTMENT_QUEUE, concurrency: 20, domain: 'clinic' },
        
        // Fashion queues
        { name: FASHION_APPOINTMENT_QUEUE, concurrency: 40, domain: 'clinic' },
        { name: FASHION_NOTIFICATION_QUEUE, concurrency: 80, domain: 'clinic' },
        { name: FASHION_EMAIL_QUEUE, concurrency: 60, domain: 'clinic' },
        { name: FASHION_PAYMENT_QUEUE, concurrency: 30, domain: 'clinic' },
        { name: FASHION_ANALYTICS_QUEUE, concurrency: 20, domain: 'clinic' },
      ];

      // Initialize workers for each queue
      for (const config of queueConfigs) {
        await this.createWorker(config.name, config.concurrency, config.domain as 'clinic' | 'clinic', redisConnection);
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Shared worker service initialized with ${queueConfigs.length} queues`,
        'SharedWorkerService'
      );

    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to initialize shared worker service: ${(error as Error).message}`,
        'SharedWorkerService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  private async createWorker(
    queueName: string, 
    concurrency: number, 
    domain: 'clinic' | 'clinic',
    redisConnection: any
  ) {
    try {
      const worker = new Worker(
        queueName,
        async (job: Job<QueueJobData>) => {
          return await this.processJob(job, domain);
        },
        {
          connection: redisConnection,
          concurrency,
          prefix: `${domain}:worker`,
          autorun: true,
          stalledInterval: 30000,
          maxStalledCount: 1,
        }
      );

      // Worker event handlers
      worker.on('completed', async (job) => {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Job completed: ${job.name} on queue ${queueName}`,
          'SharedWorkerService',
          { jobId: job.id, queueName, domain }
        );
      });

      worker.on('failed', async (job, err) => {
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          `Job failed: ${job?.name} on queue ${queueName}`,
          'SharedWorkerService',
          { jobId: job?.id, queueName, domain, error: err.message }
        );
      });

      worker.on('error', async (err) => {
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          `Worker error on queue ${queueName}`,
          'SharedWorkerService',
          { queueName, domain, error: err.message }
        );
      });

      this.workers.set(queueName, worker);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Worker created for queue: ${queueName}`,
        'SharedWorkerService',
        { queueName, concurrency, domain }
      );

    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create worker for queue ${queueName}`,
        'SharedWorkerService',
        { queueName, domain, error: (error as Error).message }
      );
      throw error;
    }
  }

  private async processJob(job: Job<QueueJobData>, domain: 'clinic' | 'clinic') {
    try {
      const { action, data, metadata } = job.data;

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Processing job: ${action} for domain: ${domain}`,
        'SharedWorkerService',
        { jobId: job.id, action, domain, metadata }
      );

      // Route to domain-specific processors
      switch (domain) {
        case 'clinic':
          return await this.processClinicJob(action, data, metadata);
        case 'clinic':
          return await this.processFashionJob(action, data, metadata);
        default:
          throw new Error(`Unknown domain: ${domain}`);
      }

    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Job processing failed: ${(error as Error).message}`,
        'SharedWorkerService',
        { jobId: job.id, domain, error: (error as Error).stack }
      );
      throw error;
    }
  }

  private async processClinicJob(action: string, data: any, metadata?: Record<string, any>) {
    // TODO: Implement proper dependency injection for clinic job processor
    // For now, return a placeholder response to avoid compilation errors
    this.logger.warn(`Clinic job processing not implemented: ${action}`);
    return { success: false, message: 'Clinic job processing not implemented' };
  }

  private async processFashionJob(action: string, data: any, metadata?: Record<string, any>) {
    // TODO: Implement proper dependency injection for clinic job processor
    // For now, return a placeholder response to avoid compilation errors
    this.logger.warn(`Fashion job processing not implemented: ${action}`);
    return { success: false, message: 'Fashion job processing not implemented' };
  }

  private async shutdownWorkers() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    try {
      const shutdownPromises = Array.from(this.workers.values()).map(async (worker) => {
        await worker.close();
      });

      await Promise.all(shutdownPromises);
      this.workers.clear();

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'All workers shut down successfully',
        'SharedWorkerService'
      );

    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Error during worker shutdown: ${(error as Error).message}`,
        'SharedWorkerService',
        { error: (error as Error).stack }
      );
    }
  }

  // Public methods for health checks and monitoring
  async getWorkerStatus() {
    const status = {};
    for (const [queueName, worker] of this.workers) {
      (status as any)[queueName] = {
        isRunning: true, // Assume running if worker exists in map
        queueName,
        concurrency: worker.concurrency,
      };
    }
    return status;
  }

  async getActiveJobCount() {
    let totalActive = 0;
    for (const worker of this.workers.values()) {
      // Note: BullMQ doesn't expose active job count directly
      // This would need to be implemented with Redis queries
      totalActive += 0; // Placeholder
    }
    return totalActive;
  }
}
