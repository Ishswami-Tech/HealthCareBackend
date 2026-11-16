/**
 * `@ClusterCron` — a `@Cron` that runs on ONE worker replica per tick.
 *
 * @nestjs/schedule runs every job on every process that loads the module, and with two worker
 * replicas each tick ran twice (on 2026-11-16 the payment-window sweep expired one booking twice).
 * Each tick now first takes a lock in the shared cache, keyed by class and method:
 * - acquired: this replica runs the tick;
 * - held: another replica runs it, this one skips;
 * - unavailable (the cache cannot be asked): this replica runs it anyway and the lock source is
 *   told, so it can warn. A missed payment sweep or a skipped 7 AM summary costs more than the
 *   rare double run while the cache is down; every job here re-checks database state.
 *
 * The lock lives until shortly before the job's next scheduled run after this tick, so replicas
 * whose clocks differ by a few seconds still see it and the next tick is free again.
 *
 * Crons run only in the worker (the API registers ScheduleModule with `cronJobs: false`); the
 * worker installs the lock source (ClusterCronLockInitializer). Without one, a job runs as a plain
 * `@Cron` (unit tests).
 */

import { Cron, type CronOptions } from '@nestjs/schedule';
import { CronTime } from 'cron';

export type ClusterCronLockOutcome = 'acquired' | 'held' | 'unavailable';

export interface ClusterCronLock {
  tryLock(key: string, ttlSeconds: number): Promise<ClusterCronLockOutcome>;
  /** The cache could not be asked; the job named `job` runs on this replica anyway. */
  onUnavailable(job: string): void;
}

/** Installed while the worker shuts down: no new tick starts on a replica that is going away. */
export const REFUSING_CLUSTER_CRON_LOCK: ClusterCronLock = {
  tryLock: () => Promise.resolve('held'),
  onUnavailable: () => undefined,
};

let lockSource: ClusterCronLock | null = null;

/** Set by the worker (ClusterCronLockInitializer); null runs jobs unlocked (unit tests). */
export function setClusterCronLock(lock: ClusterCronLock | null): void {
  lockSource = lock;
}

/** Cache key of a job's per-tick lock. */
export function clusterCronLockKey(className: string, methodName: string): string {
  return `cron-lock:${className}.${methodName}`;
}

/** Fallback lock lifetime when the schedule cannot be parsed. */
const FALLBACK_LOCK_TTL_SECONDS = 50;

/**
 * Seconds the tick's lock lives: until shortly before the next scheduled run AFTER this tick.
 * The next run is looked up from one second ahead, so a callback that fires a hair before its
 * own boundary (timer rounding, clock slew) does not mistake the current tick for the next one
 * and take a one-second lock. The margin is 5 s, or a tenth of the gap for very frequent jobs.
 */
export function clusterCronLockTtlSeconds(
  cronTime: string,
  timeZone?: string,
  now: number = Date.now()
): number {
  try {
    // getNextDateFrom ignores the constructor's zone unless it is passed again.
    const next = new CronTime(cronTime, timeZone)
      .getNextDateFrom(new Date(now + 1_000), timeZone)
      .toMillis();
    const gapMs = next - now;
    const marginMs = Math.min(5_000, Math.max(gapMs / 10, 0));
    return Math.max(1, Math.floor((gapMs - marginMs) / 1000));
  } catch {
    return FALLBACK_LOCK_TTL_SECONDS;
  }
}

type CronJobMethod = (this: object) => Promise<void> | void;

export function ClusterCron(cronTime: string, options: CronOptions = {}) {
  return function <T extends CronJobMethod>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const original = descriptor.value;
    if (!original) {
      return descriptor;
    }
    const job = `${target.constructor.name}.${String(propertyKey)}`;
    const key = clusterCronLockKey(target.constructor.name, String(propertyKey));

    const wrapped = async function (this: object): Promise<void> {
      const lock = lockSource;
      if (lock) {
        const ttl = clusterCronLockTtlSeconds(cronTime, options.timeZone);
        let outcome: ClusterCronLockOutcome;
        try {
          outcome = await lock.tryLock(key, ttl);
        } catch {
          outcome = 'unavailable';
        }
        if (outcome === 'held') {
          return;
        }
        if (outcome === 'unavailable') {
          lock.onUnavailable(job);
        }
      }
      await original.call(this);
    };
    Object.defineProperty(wrapped, 'name', { value: original.name });
    descriptor.value = wrapped as T;

    // @Cron stores its metadata on descriptor.value, so it must see the wrapper.
    const decorate: MethodDecorator = Cron(cronTime, options);
    decorate(target, propertyKey, descriptor);
    return descriptor;
  };
}
