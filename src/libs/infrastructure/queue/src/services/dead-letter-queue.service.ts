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

import { Injectable, Inject, forwardRef, Optional, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Job, JobsOptions } from 'bullmq';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { DatabaseService } from '@infrastructure/database/database.service';
import { DEAD_LETTER_QUEUE, DLQ_CONFIG, JOB_RETENTION } from '../queue.constants';
import type { CacheConnectionTarget } from '@infrastructure/cache/utils/cache-connection-target.util';

export interface DeadLetterEntry {
  jobId: string;
  originalQueue: string;
  name: string;
  data: unknown;
  /** Options the original job was added with (priority, backoff, ...). */
  opts?: Record<string, unknown>;
  error: string;
  stack: string | undefined;
  attemptsMade: number;
  failedAt: Date;
}

export interface DeadLetterRetryResult {
  /** `requeued`: the job was re-added; `already-pending`: the original is still queued/running. */
  readonly outcome: 'requeued' | 'already-pending';
  readonly originalQueue: string;
  readonly jobId: string;
}

export type DeadLetterConnection = CacheConnectionTarget & {
  password?: string;
  db: number;
};

/** The slice of a BullMQ Queue the DLQ needs; lets unit tests inject fakes. */
export type DeadLetterQueueLike = Pick<
  Queue,
  'add' | 'getJob' | 'getJobs' | 'getWaiting' | 'getFailed' | 'getCompleted' | 'clean' | 'close'
>;

export type DeadLetterQueueFactory = (
  name: string,
  connection: DeadLetterConnection
) => DeadLetterQueueLike;

const defaultQueueFactory: DeadLetterQueueFactory = (name, connection) =>
  new Queue(name, { connection });

/** States in which a job will still run (or is running) without any help from the DLQ. */
const PENDING_STATES: ReadonlySet<string> = new Set([
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'waiting-children',
]);

/** Job options copied from the original job when it is retried (the rest are BullMQ-internal). */
const RETRIED_OPTION_KEYS = ['priority', 'backoff', 'timeout', 'lifo'] as const;
const DEFAULT_RETRY_ATTEMPTS = 5;
const DEFAULT_RETRY_BACKOFF: NonNullable<JobsOptions['backoff']> = {
  type: 'exponential',
  delay: 2000,
};

@Injectable()
export class DeadLetterQueueService implements OnModuleDestroy {
  private dlqQueue: DeadLetterQueueLike | null = null;
  private redisConnection: DeadLetterConnection | null = null;
  /** One producer per target queue, reused across retries (was: a leaked connection per retry). */
  private readonly targetQueues = new Map<string, DeadLetterQueueLike>();
  private queueFactory: DeadLetterQueueFactory = defaultQueueFactory;
  private lastPruneAt = 0;

  constructor(
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  /**
   * Initialize the DLQ queue. Call once on module init. `queueFactory` exists for tests.
   */
  initialize(
    connection: DeadLetterConnection,
    queueFactory: DeadLetterQueueFactory = defaultQueueFactory
  ): void {
    this.redisConnection = connection;
    this.queueFactory = queueFactory;
    this.dlqQueue = queueFactory(DEAD_LETTER_QUEUE, connection);
  }

  async onModuleDestroy(): Promise<void> {
    const queues = [...this.targetQueues.values(), ...(this.dlqQueue ? [this.dlqQueue] : [])];
    this.targetQueues.clear();
    this.dlqQueue = null;
    await Promise.allSettled(queues.map(queue => queue.close()));
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
      const opts = pickRetriedOptions(job.opts as Record<string, unknown> | undefined);
      const entry: DeadLetterEntry = {
        jobId: String(job.id),
        originalQueue: job.queueName,
        name: job.name,
        data: job.data,
        ...(opts ? { opts } : {}),
        error: error.message,
        stack: error.stack,
        attemptsMade: job.attemptsMade,
        failedAt: new Date(),
      };

      await this.dlqQueue.add('dead-letter', entry, {
        jobId: deadLetterJobId(String(job.id)),
        removeOnComplete: DLQ_CONFIG.removeOnComplete,
        removeOnFail: DLQ_CONFIG.removeOnFail,
        priority: 0,
      });

      void this.loggingService?.log(
        LogType.QUEUE,
        LogLevel.WARN,
        `Job moved to dead letter queue: ${job.name} (${job.id})`,
        'DeadLetterQueueService',
        { jobId: String(job.id), jobName: job.name, error: error.message }
      );
      await this.pruneIfDue();
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
    return jobs.map((job: Job): DeadLetterEntry => {
      const entry = job.data as Partial<DeadLetterEntry> | undefined;
      return {
        jobId: String(job.id),
        originalQueue: entry?.originalQueue ?? 'unknown',
        name: job.name,
        data: job.data,
        error: typeof entry?.error === 'string' ? entry.error : 'unknown',
        stack: typeof entry?.stack === 'string' ? entry.stack : undefined,
        attemptsMade: job.attemptsMade,
        failedAt: job.timestamp ? new Date(job.timestamp) : new Date(),
      };
    });
  }

  /**
   * Retry a dead-letter job by re-enqueueing it on the original queue.
   *
   * The original job id usually still exists in the original queue's FAILED set (retained by
   * removeOnFail), and BullMQ silently ignores an add() whose jobId already exists. The previous
   * implementation therefore "succeeded", deleted the DLQ entry and lost the job. Now:
   *   - the original is still waiting/active/delayed: nothing to re-add, the DLQ entry is removed;
   *   - the original is finished (failed/completed): it is moved back to wait with Job.retry()
   *     under its own id, with the attempt counters reset;
   *   - the original is gone (pruned): it is re-added from the DLQ copy (reusing a custom id;
   *     BullMQ does not allow integer custom ids) and the add is verified;
   *   - the DLQ entry is removed only once the job is back on its queue.
   *
   * @throws Error when the DLQ is not initialized, the entry does not exist or carries no
   *   metadata, or the job could not be re-enqueued (the DLQ entry is kept in that case).
   */
  async retryDeadLetter(jobId: string): Promise<DeadLetterRetryResult> {
    if (!this.dlqQueue || !this.redisConnection) throw new Error('DLQ not initialized');

    const dlqJob = await this.dlqQueue.getJob(jobId);
    if (!dlqJob) throw new Error(`DLQ job not found: ${jobId}`);

    const entry = dlqJob.data as Partial<DeadLetterEntry> | undefined;
    if (!entry?.originalQueue || !entry.name || !entry.jobId) {
      throw new Error(`DLQ job ${jobId} has no original queue/job metadata`);
    }
    const target = this.getTargetQueue(entry.originalQueue);

    const existing = await target.getJob(entry.jobId);
    if (existing) {
      const state = await existing.getState();
      if (PENDING_STATES.has(state)) {
        await dlqJob.remove();
        this.logRetry(entry.jobId, entry.originalQueue, 'already-pending', state);
        return {
          outcome: 'already-pending',
          originalQueue: entry.originalQueue,
          jobId: entry.jobId,
        };
      }
      if (state === 'failed' || state === 'completed') {
        // The original hash is still there: move it back to wait under its own id, with a fresh
        // attempt budget (throws if BullMQ refuses, which keeps the DLQ entry).
        await existing.retry(state, { resetAttemptsMade: true, resetAttemptsStarted: true });
        return this.finishRetry(dlqJob, entry.jobId, entry.originalQueue);
      }
      // Unknown state: free the id so the re-add below is not a silent no-op.
      await existing.remove();
    }

    const added = await target.add(entry.name, entry.data, buildRetryOptions(entry));
    if (!added?.id || (isReusableCustomJobId(entry.jobId) && String(added.id) !== entry.jobId)) {
      throw new Error(
        `Re-enqueue of DLQ job ${jobId} to ${entry.originalQueue} was not accepted; DLQ entry kept`
      );
    }
    return this.finishRetry(dlqJob, String(added.id), entry.originalQueue);
  }

  /** Drops the DLQ copy only after the job is back on its queue. */
  private async finishRetry(
    dlqJob: Job,
    requeuedJobId: string,
    originalQueue: string
  ): Promise<DeadLetterRetryResult> {
    await dlqJob.remove();
    this.logRetry(requeuedJobId, originalQueue, 'requeued');
    return { outcome: 'requeued', originalQueue, jobId: requeuedJobId };
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

  /**
   * Caps DLQ growth (entries carry full job payloads, PHI included): entries older than
   * DLQ_CONFIG.maxAgeMs are removed, and the wait list is cut to the newest
   * DLQ_CONFIG.maxEntries. Throttled to once per DLQ_CONFIG.pruneIntervalMs; never throws.
   */
  async pruneIfDue(now: number = Date.now()): Promise<number> {
    if (!this.dlqQueue || now - this.lastPruneAt < DLQ_CONFIG.pruneIntervalMs) return 0;
    this.lastPruneAt = now;
    try {
      const expired = await this.dlqQueue.clean(DLQ_CONFIG.maxAgeMs, 1000, 'wait');
      // getJobs on 'wait' is newest-first (desc), so everything past maxEntries is the oldest.
      const overflow = await this.dlqQueue.getJobs(['wait'], DLQ_CONFIG.maxEntries, -1, false);
      await Promise.all(overflow.map(job => job.remove()));
      return expired.length + overflow.length;
    } catch (error) {
      void this.loggingService?.log(
        LogType.QUEUE,
        LogLevel.WARN,
        'DLQ prune failed',
        'DeadLetterQueueService',
        { error: error instanceof Error ? error.message : String(error) }
      );
      return 0;
    }
  }

  private getTargetQueue(name: string): DeadLetterQueueLike {
    const cached = this.targetQueues.get(name);
    if (cached) return cached;
    if (!this.redisConnection) throw new Error('DLQ not initialized');
    const queue = this.queueFactory(name, this.redisConnection);
    this.targetQueues.set(name, queue);
    return queue;
  }

  private logRetry(jobId: string, queueName: string, outcome: string, state?: string): void {
    void this.loggingService?.log(
      LogType.QUEUE,
      LogLevel.INFO,
      `Retried DLQ job: ${jobId} -> ${queueName} (${outcome})`,
      'DeadLetterQueueService',
      { jobId, queue: queueName, outcome, ...(state ? { state } : {}) }
    );
  }
}

/**
 * Whether BullMQ accepts `jobId` as a CUSTOM id on add(). It refuses integers ("Custom Id cannot
 * be integers": those are its own auto ids) and ids with ':' unless they split into exactly three
 * parts ("Custom Id cannot contain :"), the shape of its legacy repeat ids. Its own job-scheduler
 * ids (`repeat:<schedulerId>:<millis>`) skip that check, so a scheduled task, whose scheduler id is
 * `scheduled:<task>`, runs as `repeat:scheduled:<task>:<millis>`: an id BullMQ itself created but
 * will not accept back.
 */
export function isReusableCustomJobId(jobId: string): boolean {
  if (`${parseInt(jobId, 10)}` === jobId) return false;
  return !jobId.includes(':') || jobId.split(':').length === 3;
}

/**
 * The DLQ copy's id: deterministic (a job failing twice is stored once) and always accepted by
 * BullMQ. ':' is percent-encoded ('%' first, so distinct ids stay distinct): `dlq-${id}` of a
 * scheduled task's `repeat:scheduled:<task>:<millis>` was refused, and the failed job was lost
 * instead of reaching the DLQ.
 */
export function deadLetterJobId(jobId: string): string {
  return `dlq-${jobId.replace(/%/g, '%25').replace(/:/g, '%3A')}`;
}

function buildRetryOptions(entry: Partial<DeadLetterEntry>): JobsOptions {
  const savedBackoff = entry.opts?.['backoff'] as JobsOptions['backoff'] | undefined;
  const backoff: NonNullable<JobsOptions['backoff']> = savedBackoff ?? DEFAULT_RETRY_BACKOFF;
  return {
    ...(entry.opts ?? {}),
    // An id BullMQ would refuse is not reused: the job is re-added under a fresh auto id.
    ...(entry.jobId && isReusableCustomJobId(entry.jobId) ? { jobId: entry.jobId } : {}),
    attempts: DEFAULT_RETRY_ATTEMPTS,
    backoff,
    removeOnComplete: JOB_RETENTION.removeOnComplete,
    removeOnFail: JOB_RETENTION.removeOnFail,
  };
}

function pickRetriedOptions(
  opts: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!opts) return undefined;
  const picked = Object.fromEntries(
    RETRIED_OPTION_KEYS.filter(key => opts[key] !== undefined).map(key => [key, opts[key]])
  );
  return Object.keys(picked).length > 0 ? picked : undefined;
}
