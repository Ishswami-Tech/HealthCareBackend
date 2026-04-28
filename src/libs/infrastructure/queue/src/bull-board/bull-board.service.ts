import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { InjectQueue } from '@nestjs/bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { Queue } from 'bullmq';

import { isCacheEnabled } from '@config/cache.config';

// Internal imports - Infrastructure
import { LoggingService } from '@infrastructure/logging';

// Internal imports - Core
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { LogType, LogLevel } from '@core/types';

import { HEALTHCARE_QUEUE } from '@queue/src/queue.constants';

type FastifyLikeInstance = {
  register: (plugin: unknown, options?: { prefix?: string }) => unknown;
};

function isFastifyLikeInstance(value: unknown): value is FastifyLikeInstance {
  return typeof (value as { register?: unknown } | null)?.register === 'function';
}

/**
 * Bull Board Service for Queue Management
 *
 * Provides comprehensive queue monitoring, statistics, and health checks
 * for the unified HEALTHCARE_QUEUE. Integrates with Bull Board dashboard
 * for real-time queue visualization and management.
 */
@Injectable()
export class BullBoardService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BullBoardService.name);
  private bullBoardRegistered = false;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Optional() @InjectQueue(HEALTHCARE_QUEUE) private healthcareQueue: Queue | null,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  onApplicationBootstrap(): void {
    if (this.bullBoardRegistered) {
      return;
    }

    if (!isCacheEnabled()) {
      this.logger.warn('Bull Board skipped: cache is disabled.');
      return;
    }

    const enableBullBoardEnv = process.env['ENABLE_BULL_BOARD']?.trim().toLowerCase();
    const bullBoardEnabled =
      enableBullBoardEnv === undefined
        ? true
        : ['true', '1', 'yes', 'on'].includes(enableBullBoardEnv);

    if (!bullBoardEnabled) {
      this.logger.warn('Bull Board skipped: dashboard is disabled for this environment.');
      return;
    }

    const httpAdapter = this.httpAdapterHost.httpAdapter;
    if (!httpAdapter) {
      this.logger.warn('Bull Board skipped: no HTTP adapter is available.');
      return;
    }

    const appInstance: unknown = httpAdapter.getInstance();
    if (!isFastifyLikeInstance(appInstance)) {
      this.logger.warn('Bull Board skipped: Fastify instance is not available.');
      return;
    }

    try {
      const routePrefix = '/queue-dashboard';
      const serverAdapter = new FastifyAdapter();
      serverAdapter.setBasePath(routePrefix);

      createBullBoard({
        queues: this.healthcareQueue ? [new BullMQAdapter(this.healthcareQueue)] : [],
        serverAdapter,
        options: {
          uiConfig: {
            boardTitle: 'Healthcare Queue Dashboard',
          },
        },
      });

      appInstance.register(serverAdapter.registerPlugin(), { prefix: routePrefix });
      this.bullBoardRegistered = true;
      this.logger.log('Bull Board registered at /queue-dashboard');
    } catch (error) {
      this.logger.error(
        `Bull Board registration failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get all registered queues for BullBoard
   */
  getQueues(): Record<string, Queue | undefined> {
    const queues: Record<string, Queue | undefined> = {};
    if (this.healthcareQueue) queues[HEALTHCARE_QUEUE] = this.healthcareQueue;
    return queues;
  }

  /**
   * Get queue statistics for monitoring
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
        if (this.loggingService) {
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
        }
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
          waiting: waiting.slice(0, 10),
          active: active.slice(0, 10),
          failed: failed.slice(0, 10),
        },
      };
    } catch (error) {
      if (this.loggingService) {
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
      }
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
        const failedJobs = await queue.getFailed();
        const results = [];
        for (const job of failedJobs) {
          await job.retry();
          results.push({ jobId: job.id, status: 'retried' });
        }
        return results;
      }
    } catch (error) {
      if (this.loggingService) {
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
      }
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
      if (this.loggingService) {
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
      }
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
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.QUEUE,
            LogLevel.INFO,
            `Queue ${queueName} paused`,
            'BullBoardService',
            { queueName }
          );
        }
      } else {
        await queue.resume();
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.QUEUE,
            LogLevel.INFO,
            `Queue ${queueName} resumed`,
            'BullBoardService',
            { queueName }
          );
        }
      }
      return { queueName, paused: pause };
    } catch (error) {
      if (this.loggingService) {
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
      }
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
