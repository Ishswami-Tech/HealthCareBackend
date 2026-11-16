/**
 * `@ScheduledTask` — marks a method as a recurring job run through BullMQ.
 *
 * The worker discovers every decorated method at boot (ScheduledTasksService), registers one
 * BullMQ job scheduler per task on the single `healthcare-queue`, and runs each tick as a normal
 * queue job: exactly one job per tick whichever worker replica takes it, a tick is not lost when a
 * worker restarts, failures are retried and kept, and every run shows up in the queue dashboard
 * under the "Scheduled Tasks" filter group (and in Bull Board's Job Schedulers view).
 *
 * The decorator only stores metadata; nothing runs in the API process.
 */

import { SetMetadata } from '@nestjs/common';

export const SCHEDULED_TASK_METADATA = 'healthcare:scheduled-task';

/** The process time zone the old @Cron jobs ran in (TZ=Asia/Kolkata on the worker). */
export const SCHEDULED_TASK_DEFAULT_TZ = 'Asia/Kolkata';

/** Dashboard groups for scheduled tasks; each is a filter in the "Scheduled Tasks" group. */
export const SCHEDULED_TASK_GROUPS = {
  appointments: {
    label: 'Appointments Upkeep',
    description: 'No-show cancellation, expiry and the doctors daily summary',
  },
  video: {
    label: 'Video Visits',
    description: 'Video no-shows, payment windows, expiry and completion reminders',
  },
  'in-person-queue': {
    label: 'In-person Queue',
    description: 'Live queue reconciliation, token counter cleanup and position alerts',
  },
  billing: {
    label: 'Billing & Payments',
    description: 'Payment reconciliation, unpaid checkouts and subscription expiry',
  },
  cache: {
    label: 'Cache Warming',
    description: 'Pre-loading popular data and doctor schedules into the cache',
  },
} as const;

export type ScheduledTaskGroup = keyof typeof SCHEDULED_TASK_GROUPS;

export interface ScheduledTaskOptions {
  /** Stable id, e.g. 'billing.expire-unpaid-checkouts'. Also the BullMQ job name. */
  readonly id: string;
  readonly group: ScheduledTaskGroup;
  /** Cron pattern (5 fields, or 6 with seconds). */
  readonly pattern: string;
  /** IANA time zone the pattern is read in. */
  readonly tz: string;
  /**
   * Attempts per tick. Frequent sweeps use 1 (the next tick is the retry); daily jobs use more,
   * since a missed run would otherwise wait a day.
   */
  readonly attempts: number;
}

/** BullMQ scheduler id of a task (the prefix marks schedulers this app owns). */
export const SCHEDULED_TASK_SCHEDULER_PREFIX = 'scheduled:';

export function scheduledTaskSchedulerId(taskId: string): string {
  return `${SCHEDULED_TASK_SCHEDULER_PREFIX}${taskId}`;
}

/** The dashboard `queueType` of a task group, e.g. 'scheduled_in_person_queue'. */
export function scheduledTaskQueueType(group: ScheduledTaskGroup): string {
  return `scheduled_${group.replace(/[^a-z0-9]+/g, '_')}`;
}

export function ScheduledTask(options: ScheduledTaskOptions): MethodDecorator {
  return SetMetadata(SCHEDULED_TASK_METADATA, options);
}
