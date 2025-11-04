import { Injectable, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

// Internal imports - Infrastructure
import { LoggingService } from '@infrastructure/logging';

// Internal imports - Core
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { LogType, LogLevel } from '@core/types';

import {
  SERVICE_QUEUE,
  APPOINTMENT_QUEUE,
  EMAIL_QUEUE,
  NOTIFICATION_QUEUE,
  VIDHAKARMA_QUEUE,
  PANCHAKARMA_QUEUE,
  CHEQUP_QUEUE,
} from '../queue.constants';

/**
 * Bull Board Service for Queue Management
 *
 * Provides comprehensive queue monitoring, statistics, and health checks
 * for all healthcare system queues. Integrates with Bull Board dashboard
 * for real-time queue visualization and management.
 *
 * @class BullBoardService
 * @description Enterprise-grade queue monitoring service with health checks and statistics
 * @example
 * ```typescript
 * // Inject the service
 * constructor(private readonly bullBoardService: BullBoardService) {}
 *
 * // Get queue statistics
 * const stats = await this.bullBoardService.getQueueStats();
 *
 * // Check queue health
 * const health = await this.bullBoardService.getQueueHealth();
 * ```
 */
@Injectable()
export class BullBoardService {
  /**
   * Constructor for BullBoardService
   *
   * @param loggingService - Logging service for structured logging
   * @param serviceQueue - Service queue instance (optional)
   * @param appointmentQueue - Appointment queue instance (optional)
   * @param emailQueue - Email queue instance (optional)
   * @param notificationQueue - Notification queue instance (optional)
   * @param vidhakarmaQueue - Vidhakarma queue instance (optional)
   * @param panchakarmaQueue - Panchakarma queue instance (optional)
   * @param chequpQueue - Chequp queue instance (optional)
   */
  constructor(
    private readonly loggingService: LoggingService,
    @Optional() @InjectQueue(SERVICE_QUEUE) private serviceQueue: Queue,
    @Optional() @InjectQueue(APPOINTMENT_QUEUE) private appointmentQueue: Queue,
    @Optional() @InjectQueue(EMAIL_QUEUE) private emailQueue: Queue,
    @Optional()
    @InjectQueue(NOTIFICATION_QUEUE)
    private notificationQueue: Queue,
    @Optional() @InjectQueue(VIDHAKARMA_QUEUE) private vidhakarmaQueue: Queue,
    @Optional() @InjectQueue(PANCHAKARMA_QUEUE) private panchakarmaQueue: Queue,
    @Optional() @InjectQueue(CHEQUP_QUEUE) private chequpQueue: Queue
  ) {}

  /**
   * Get all registered queues for BullBoard
   *
   * @returns Record of queue names to queue instances
   * @description Returns all available queue instances for dashboard display
   */
  getQueues(): Record<string, Queue | undefined> {
    const queues: Record<string, Queue | undefined> = {};
    if (this.serviceQueue) queues[SERVICE_QUEUE] = this.serviceQueue;
    if (this.appointmentQueue) queues[APPOINTMENT_QUEUE] = this.appointmentQueue;
    if (this.emailQueue) queues[EMAIL_QUEUE] = this.emailQueue;
    if (this.notificationQueue) queues[NOTIFICATION_QUEUE] = this.notificationQueue;
    if (this.vidhakarmaQueue) queues[VIDHAKARMA_QUEUE] = this.vidhakarmaQueue;
    if (this.panchakarmaQueue) queues[PANCHAKARMA_QUEUE] = this.panchakarmaQueue;
    if (this.chequpQueue) queues[CHEQUP_QUEUE] = this.chequpQueue;
    return queues;
  }

  /**
   * Get queue statistics for monitoring
   *
   * @returns Promise resolving to queue statistics
   * @description Collects comprehensive statistics from all registered queues
   */
  async getQueueStats() {
    const queues = this.getQueues();
    const stats: Record<string, unknown> = {};

    for (const [name, queue] of Object.entries(queues)) {
      if (!queue) {
        stats[name] = { _error: 'Queue not available' };
        continue;
      }

      try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          queue.getWaiting(),
          queue.getActive(),
          queue.getCompleted(),
          queue.getFailed(),
          queue.getDelayed(),
        ]);

        stats[name] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
          total: waiting.length + active.length + completed.length + failed.length + delayed.length,
        };
      } catch (error) {
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.ERROR,
          `Failed to get stats for queue ${name}`,
          'BullBoardService',
          {
            queueName: name,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
        stats[name] = {
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }

    return stats;
  }

  /**
   * Get detailed queue information
   */
  async getQueueDetails(queueName: string) {
    const queues = this.getQueues();
    const queue = queues[queueName];

    if (!queue) {
      throw new HealthcareError(
        ErrorCode.QUEUE_NOT_FOUND,
        `Queue ${queueName} not found`,
        undefined,
        { queueName },
        'BullBoardService.getQueueDetails'
      );
    }

    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed(),
        queue.getDelayed(),
      ]);

      return {
        name: queueName,
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        total: waiting.length + active.length + completed.length + failed.length + delayed.length,
        jobs: {
          waiting: waiting.slice(0, 10), // First 10 waiting jobs
          active: active.slice(0, 10), // First 10 active jobs
          failed: failed.slice(0, 10), // First 10 failed jobs
        },
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to get details for queue ${queueName}`,
        'BullBoardService',
        {
          queueName,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      if (error instanceof HealthcareError) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.QUEUE_OPERATION_FAILED,
        `Failed to get details for queue ${queueName}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        { queueName, originalError: error instanceof Error ? error.message : String(error) },
        'BullBoardService.getQueueDetails'
      );
    }
  }

  /**
   * Retry failed jobs
   */
  async retryFailedJobs(queueName: string, jobIds?: string[]) {
    const queues = this.getQueues();
    const queue = queues[queueName];

    if (!queue) {
      throw new HealthcareError(
        ErrorCode.QUEUE_NOT_FOUND,
        `Queue ${queueName} not found`,
        undefined,
        { queueName },
        'BullBoardService.retryFailedJobs'
      );
    }

    try {
      if (jobIds && jobIds.length > 0) {
        // Retry specific jobs
        const results = [];
        for (const jobId of jobIds) {
          const job = await queue.getJob(jobId);
          if (job) {
            await job.retry();
            results.push({ jobId, status: 'retried' });
          } else {
            results.push({ jobId, status: 'not_found' });
          }
        }
        return results;
      } else {
        // Retry all failed jobs
        const failedJobs = await queue.getFailed();
        const results = [];
        for (const job of failedJobs) {
          await job.retry();
          results.push({ jobId: job.id, status: 'retried' });
        }
        return results;
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to retry jobs in queue ${queueName}`,
        'BullBoardService',
        {
          queueName,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      if (error instanceof HealthcareError) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.QUEUE_OPERATION_FAILED,
        `Failed to retry jobs in queue ${queueName}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        {
          queueName,
          jobIds,
          originalError: error instanceof Error ? error.message : String(error),
        },
        'BullBoardService.retryFailedJobs'
      );
    }
  }

  /**
   * Remove jobs from queue
   */
  async removeJobs(queueName: string, jobIds: string[]) {
    const queues = this.getQueues();
    const queue = queues[queueName];

    if (!queue) {
      throw new HealthcareError(
        ErrorCode.QUEUE_NOT_FOUND,
        `Queue ${queueName} not found`,
        undefined,
        { queueName },
        'BullBoardService.removeJobs'
      );
    }

    try {
      const results = [];
      for (const jobId of jobIds) {
        const job = await queue.getJob(jobId);
        if (job) {
          await job.remove();
          results.push({ jobId, status: 'removed' });
        } else {
          results.push({ jobId, status: 'not_found' });
        }
      }
      return results;
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to remove jobs from queue ${queueName}`,
        'BullBoardService',
        {
          queueName,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      if (error instanceof HealthcareError) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.QUEUE_OPERATION_FAILED,
        `Failed to remove jobs from queue ${queueName}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        {
          queueName,
          jobIds,
          originalError: error instanceof Error ? error.message : String(error),
        },
        'BullBoardService.removeJobs'
      );
    }
  }

  /**
   * Pause/Resume queue
   */
  async toggleQueue(queueName: string, pause: boolean) {
    const queues = this.getQueues();
    const queue = queues[queueName];

    if (!queue) {
      throw new HealthcareError(
        ErrorCode.QUEUE_NOT_FOUND,
        `Queue ${queueName} not found`,
        undefined,
        { queueName },
        'BullBoardService.toggleQueue'
      );
    }

    try {
      if (pause) {
        await queue.pause();
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.INFO,
          `Queue ${queueName} paused`,
          'BullBoardService',
          { queueName }
        );
      } else {
        await queue.resume();
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.INFO,
          `Queue ${queueName} resumed`,
          'BullBoardService',
          { queueName }
        );
      }
      return { queueName, paused: pause };
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to ${pause ? 'pause' : 'resume'} queue ${queueName}`,
        'BullBoardService',
        {
          queueName,
          action: pause ? 'pause' : 'resume',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      if (error instanceof HealthcareError) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.QUEUE_OPERATION_FAILED,
        `Failed to ${pause ? 'pause' : 'resume'} queue ${queueName}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        {
          queueName,
          action: pause ? 'pause' : 'resume',
          originalError: error instanceof Error ? error.message : String(error),
        },
        'BullBoardService.toggleQueue'
      );
    }
  }

  /**
   * Get queue health status
   */
  async getQueueHealth() {
    const stats = await this.getQueueStats();
    const health = {
      overall: 'healthy' as string,
      queues: {} as Record<string, string>,
      issues: [] as string[],
    };

    for (const [queueName, queueStats] of Object.entries(stats)) {
      const stat = queueStats as Record<string, unknown>;
      if (stat['error']) {
        health.queues[queueName] = 'unhealthy';
        health.issues.push(
          `Queue ${queueName}: ${stat['error'] instanceof Error ? stat['error'].message : JSON.stringify(stat['error'])}`
        );
        health.overall = 'unhealthy';
      } else if ((stat['failed'] as number) > 100) {
        health.queues[queueName] = 'degraded';
        health.issues.push(
          `Queue ${queueName}: High failure rate (${String(stat['failed'])} failed jobs)`
        );
        health.overall = health.overall === 'healthy' ? 'degraded' : health.overall;
      } else if ((stat['waiting'] as number) > 1000) {
        health.queues[queueName] = 'degraded';
        health.issues.push(
          `Queue ${queueName}: High queue depth (${String(stat['waiting'])} waiting jobs)`
        );
        health.overall = health.overall === 'healthy' ? 'degraded' : health.overall;
      } else {
        health.queues[queueName] = 'healthy';
      }
    }

    return health;
  }
}
