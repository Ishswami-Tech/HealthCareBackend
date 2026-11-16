/**
 * Scheduled tasks on BullMQ (worker only).
 *
 * At boot the worker discovers every `@ScheduledTask` method, registers one BullMQ job scheduler
 * per task on `healthcare-queue` and removes the schedulers this app no longer defines. Every
 * tick is then an ordinary queue job (JobType.SCHEDULED_TASK, `action` = task id) that
 * QueueProcessor hands to `run()`:
 * - one job per tick whichever replica takes it (the job id is derived from the scheduler and
 *   the tick time, so a second copy cannot exist);
 * - a tick survives a worker restart (the job waits in the queue);
 * - failures are retried per the task's attempts and kept in the failed list;
 * - each run is listed in the queue dashboard under the "Scheduled Tasks" filter group, and the
 *   schedules in Bull Board's Job Schedulers view.
 *
 * Both replicas register at boot: upsertJobScheduler is idempotent per scheduler id.
 */

import { Inject, Injectable, forwardRef, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';

import {
  SCHEDULED_TASK_METADATA,
  SCHEDULED_TASK_SCHEDULER_PREFIX,
  scheduledTaskQueueType,
  scheduledTaskSchedulerId,
  type ScheduledTaskOptions,
} from '@core/decorators/scheduled-task.decorator';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import {
  JobPriorityLevel,
  JobType,
  LogLevel,
  LogType,
  type CanonicalJobEnvelope,
} from '@core/types';
import { LoggingService } from '@infrastructure/logging';

import { HEALTHCARE_QUEUE, JOB_RETENTION } from '@infrastructure/queue/src/queue.constants';
import { SCHEDULED_TASK_JOB_FAMILY } from '@infrastructure/queue/src/scheduled/scheduled-tasks.constants';

export { SCHEDULED_TASK_JOB_FAMILY };

const SOURCE = 'ScheduledTasksService';

/** Back-off between attempts of a task that retries (daily jobs). */
const RETRY_BACKOFF = { type: 'exponential', delay: 60_000 } as const;

/** How many active jobs the overlap guard inspects (the worker runs at most 100 at once). */
const ACTIVE_SCAN_LIMIT = 500;

export interface ScheduledTaskData {
  taskId: string;
  group: ScheduledTaskOptions['group'];
  pattern: string;
  tz: string;
  /** What the scheduler was registered with; boot re-registers only when this changes. */
  signature: string;
}

export type ScheduledTaskEnvelope = CanonicalJobEnvelope<ScheduledTaskData>;

export interface ScheduledTaskRunResult {
  success: boolean;
  taskId: string;
  skipped?: 'overlap';
  durationMs: number;
}

interface DiscoveredTask {
  readonly options: ScheduledTaskOptions;
  readonly owner: string;
  readonly invoke: () => Promise<void>;
}

/**
 * Everything a task's scheduler is registered with. Re-registering an unchanged scheduler is not
 * free: upsertJobScheduler replaces the tick job, and if a replica is running that tick right
 * then, its job is swapped out under it ("Lock mismatch", the tick runs twice). That happened
 * once when the second worker booted on the 07:11 tick of 2026-11-16.
 */
export function scheduledTaskSignature(options: ScheduledTaskOptions): string {
  return JSON.stringify([
    options.pattern,
    options.tz,
    options.attempts,
    JOB_RETENTION.removeOnComplete,
    JOB_RETENTION.removeOnFail,
    options.attempts > 1 ? RETRY_BACKOFF : null,
  ]);
}

/** The queue job data of one task's ticks. */
export function scheduledTaskEnvelope(options: ScheduledTaskOptions): ScheduledTaskEnvelope {
  return {
    jobType: JobType.SCHEDULED_TASK,
    priority: JobPriorityLevel.NORMAL,
    domain: 'clinic',
    action: options.id,
    data: {
      taskId: options.id,
      group: options.group,
      pattern: options.pattern,
      tz: options.tz,
      signature: scheduledTaskSignature(options),
    },
    jobFamily: SCHEDULED_TASK_JOB_FAMILY,
    queueType: scheduledTaskQueueType(options.group),
    queueCategory: 'SCHEDULED_TASK',
  };
}

@Injectable()
export class ScheduledTasksService implements OnApplicationBootstrap {
  private readonly tasks = new Map<string, DiscoveredTask>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    @InjectQueue(HEALTHCARE_QUEUE) private readonly queue: Queue,
    @Inject(forwardRef(() => LoggingService)) private readonly logging: LoggingService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.ensureDiscovered();
    try {
      await this.registerSchedulers();
    } catch (error) {
      // The worker keeps processing other jobs; the schedulers registered on the previous boot
      // stay in place and keep firing.
      void this.logging.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Could not register the scheduled tasks with BullMQ',
        SOURCE,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /** Every task found on the providers, by id. */
  definitions(): ScheduledTaskOptions[] {
    return [...this.tasks.values()].map(task => task.options);
  }

  /**
   * The BullMQ workers start taking jobs when they are created, which can be before
   * onApplicationBootstrap; a tick left from before a restart must still find its task.
   */
  private ensureDiscovered(): void {
    if (this.tasks.size === 0) this.discover();
  }

  /** Finds every @ScheduledTask method on the application's providers. */
  discover(): void {
    this.tasks.clear();
    for (const wrapper of this.discovery.getProviders()) {
      const instance: object | undefined = wrapper.instance as object | undefined;
      if (!instance || typeof instance !== 'object' || wrapper.isAlias) continue;
      const prototype = Object.getPrototypeOf(instance) as object | null;
      if (!prototype) continue;
      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const method = (prototype as Record<string, unknown>)[methodName];
        if (typeof method !== 'function') continue;
        const options = this.reflector.get<ScheduledTaskOptions | undefined>(
          SCHEDULED_TASK_METADATA,
          method
        );
        if (!options) continue;
        const owner = `${instance.constructor.name}.${methodName}`;
        const existing = this.tasks.get(options.id);
        if (existing) {
          if (existing.owner === owner) continue; // same provider registered twice
          throw new HealthcareError(
            ErrorCode.QUEUE_INITIALIZATION_FAILED,
            `Scheduled task id "${options.id}" is used by both ${existing.owner} and ${owner}`,
            undefined,
            { taskId: options.id },
            SOURCE
          );
        }
        const bound = (method as () => Promise<void> | void).bind(instance);
        this.tasks.set(options.id, {
          options,
          owner,
          invoke: async (): Promise<void> => {
            await bound();
          },
        });
      }
    }
  }

  /**
   * Registers one scheduler per task, updating only those whose definition changed (see
   * scheduledTaskSignature: a restart or a second replica must not touch running ticks), and
   * removes this app's schedulers that are no longer defined.
   */
  async registerSchedulers(): Promise<void> {
    const existing = new Map(
      (await this.queue.getJobSchedulers(0, -1)).map(scheduler => [scheduler.key, scheduler])
    );
    const wanted = new Set<string>();
    const updated: string[] = [];
    for (const { options } of this.tasks.values()) {
      const schedulerId = scheduledTaskSchedulerId(options.id);
      wanted.add(schedulerId);
      const current = existing.get(schedulerId);
      const currentSignature = (
        current?.template?.data as Partial<ScheduledTaskEnvelope> | undefined
      )?.data?.signature;
      if (
        current &&
        current.name === options.id &&
        current.pattern === options.pattern &&
        current.tz === options.tz &&
        currentSignature === scheduledTaskSignature(options)
      ) {
        continue;
      }
      updated.push(options.id);
      await this.queue.upsertJobScheduler(
        schedulerId,
        { pattern: options.pattern, tz: options.tz },
        {
          name: options.id,
          data: scheduledTaskEnvelope(options),
          opts: {
            attempts: options.attempts,
            ...(options.attempts > 1 ? { backoff: RETRY_BACKOFF } : {}),
            removeOnComplete: JOB_RETENTION.removeOnComplete,
            removeOnFail: JOB_RETENTION.removeOnFail,
          },
        }
      );
    }

    const removed: string[] = [];
    for (const schedulerId of existing.keys()) {
      if (schedulerId.startsWith(SCHEDULED_TASK_SCHEDULER_PREFIX) && !wanted.has(schedulerId)) {
        await this.queue.removeJobScheduler(schedulerId);
        removed.push(schedulerId);
      }
    }

    void this.logging.log(
      LogType.QUEUE,
      LogLevel.INFO,
      `Scheduled tasks: ${wanted.size} defined, ${updated.length} registered or updated${removed.length ? `, ${removed.length} removed` : ''}`,
      SOURCE,
      { tasks: [...this.tasks.keys()], updated, removed }
    );
  }

  /** Runs the task behind one tick (called by QueueProcessor for JobType.SCHEDULED_TASK). */
  async run(job: Job<ScheduledTaskEnvelope>): Promise<ScheduledTaskRunResult> {
    const taskId = job.data?.action ?? job.name;
    this.ensureDiscovered();
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new HealthcareError(
        ErrorCode.QUEUE_JOB_NOT_FOUND,
        `No scheduled task "${taskId}" on this worker`,
        undefined,
        { taskId, jobId: job.id },
        `${SOURCE}.run`
      );
    }

    const startedAt = Date.now();
    if (await this.previousTickStillRunning(job)) {
      void this.logging.log(
        LogType.QUEUE,
        LogLevel.WARN,
        `Scheduled task ${taskId} skipped: its previous run is still in progress`,
        SOURCE,
        { taskId, jobId: job.id }
      );
      return { success: true, taskId, skipped: 'overlap', durationMs: 0 };
    }

    await task.invoke();
    return { success: true, taskId, durationMs: Date.now() - startedAt };
  }

  /**
   * True when an older tick of the same scheduler is still active. The scheduler queues the next
   * tick when the current one starts, so a run that outlives its interval would otherwise run
   * alongside the next one.
   */
  private async previousTickStillRunning(job: Job<ScheduledTaskEnvelope>): Promise<boolean> {
    const schedulerId = job.repeatJobKey;
    if (!schedulerId) return false;
    try {
      const active = await this.queue.getActive(0, ACTIVE_SCAN_LIMIT - 1);
      return active.some(
        other =>
          other.id !== job.id &&
          other.repeatJobKey === schedulerId &&
          (other.timestamp ?? 0) < (job.timestamp ?? 0)
      );
    } catch {
      return false;
    }
  }
}
