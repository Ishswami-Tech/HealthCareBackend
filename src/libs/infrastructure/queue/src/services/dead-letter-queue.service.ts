/**
 * Dead Letter Queue Service
 * ==========================
 * Moves jobs that have exhausted all retry attempts to a dedicated DLQ
 * so they can be investigated and replayed later.
 *
 * Usage:
 *   // In a worker event listener:
 *   worker.on('failed', (job, err) => {
 *     if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
 *       void dlqService.moveToDeadLetter(job, err);
 *     }
 *   });
 *
 *   // Inspect DLQ:
 *   const failed = await dlqService.getDeadLetters();
 *
 *   // Retry a DLQ job:
 *   await dlqService.retryDeadLetter(jobId);
 *
 *   // Purge DLQ:
 *   await dlqService.purgeDeadLetter();
 */

import { Injectable, Inject, forwardRef, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { DatabaseService } from '@infrastructure/database/database.service';
import { DEAD_LETTER_QUEUE } from '../queue.constants';
import type { Job } from 'bullmq';

export interface DeadLetterEntry {
  jobId: string;
  originalQueue: string;
  name: string;
  data: unknown;
  error: string;
  stack: string | undefined;
  attemptsMade: number;
  failedAt: Date;
}

@Injectable()
export class DeadLetterQueueService {
  private dlqQueue: Queue | null = null;
  private redisConnection: {
    host: string;
    port: number;
    password?: string;
    db: number;
  } | null = null;

  constructor(
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  /**
   * Initialize the DLQ queue. Call once on module init.
   */
  initialize(connection: { host: string; port: number; password?: string; db: number }): void {
    this.redisConnection = connection;
    this.dlqQueue = new Queue(DEAD_LETTER_QUEUE, { connection });
  }

  /**
   * Move a failed job to the dead letter queue.
   * Creates a new DLQ job with the original job's data + error metadata.
   */
  async moveToDeadLetter(job: Job, error: Error): Promise<void> {
    if (!this.dlqQueue || !this.redisConnection) {
      void this.loggingService?.log(
        LogType.QUEUE,
        LogLevel.WARN,
        'DLQ not initialized — cannot move job to dead letter queue',
        'DeadLetterQueueService',
        { jobId: String(job.id), jobName: job.name }
      );
      return;
    }

    try {
      const entry: DeadLetterEntry = {
        jobId: String(job.id),
        originalQueue: job.queueName,
        name: job.name,
        data: job.data,
        error: error.message,
        stack: error.stack,
        attemptsMade: job.attemptsMade,
        failedAt: new Date(),
      };

      await this.dlqQueue.add('dead-letter', entry, {
        jobId: `dlq-${job.id}`,
        removeOnComplete: 0,
        removeOnFail: 0,
        priority: 0,
      });

      void this.loggingService?.log(
        LogType.QUEUE,
        LogLevel.WARN,
        `Job moved to dead letter queue: ${job.name} (${job.id})`,
        'DeadLetterQueueService',
        { jobId: String(job.id), jobName: job.name, error: error.message }
      );
    } catch (dlqError) {
      void this.loggingService?.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to move job to DLQ',
        'DeadLetterQueueService',
        {
          jobId: String(job.id),
          jobName: job.name,
          error: dlqError instanceof Error ? dlqError.message : String(dlqError),
        }
      );
    }
  }

  /**
   * Return all dead letter entries.
   */
  async getDeadLetters(limit = 100): Promise<DeadLetterEntry[]> {
    if (!this.dlqQueue) return [];

    const jobs = await this.dlqQueue.getJobs(['wait', 'active', 'delayed', 'failed'], 0, limit - 1);
    return jobs.map(
      (job: Job): DeadLetterEntry => ({
        jobId: String(job.id),
        originalQueue: (job.data as DeadLetterEntry)?.originalQueue ?? 'unknown',
        name: job.name,
        data: job.data,
        error: (job.progress as string) ?? 'unknown',
        stack: undefined,
        attemptsMade: job.attemptsMade,
        failedAt: job.timestamp ? new Date(job.timestamp) : new Date(),
      })
    );
  }

  /**
   * Retry a dead-letter job by re-enqueueing it on the original queue.
   */
  async retryDeadLetter(jobId: string): Promise<void> {
    if (!this.dlqQueue) throw new Error('DLQ not initialized');

    const dlqJob = await this.dlqQueue.getJob(jobId);
    if (!dlqJob) throw new Error(`DLQ job not found: ${jobId}`);

    const entry = dlqJob.data as DeadLetterEntry;
    // Remove the 'dead-letter' marker so it doesn't look like a DLQ entry
    const { jobId: _, ...cleanData } = entry.data as Record<string, unknown>;

    // Re-add to the original queue
    const originalQueue = new Queue(entry.originalQueue, { connection: this.redisConnection! });
    await originalQueue.add(entry.name, cleanData, {
      jobId: entry.jobId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
    });

    // Remove from DLQ
    await dlqJob.remove();

    void this.loggingService?.log(
      LogType.QUEUE,
      LogLevel.INFO,
      `Retried DLQ job: ${entry.jobId} -> ${entry.originalQueue}`,
      'DeadLetterQueueService',
      { jobId: entry.jobId, queue: entry.originalQueue }
    );
  }

  /**
   * Purge all completed/failed jobs from the DLQ. Use with caution.
   */
  async purgeDeadLetter(): Promise<number> {
    if (!this.dlqQueue) return 0;

    // BullMQ doesn't have a direct "purge" — we clean by state
    const waiting = await this.dlqQueue.getWaiting();
    const failed = await this.dlqQueue.getFailed();
    const completed = await this.dlqQueue.getCompleted();

    const toRemove = [...waiting, ...failed, ...completed];
    let purged = 0;

    for (const job of toRemove) {
      await job.remove();
      purged++;
    }

    return purged;
  }
}
