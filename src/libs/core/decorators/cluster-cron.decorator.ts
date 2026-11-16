/**
 * `@ClusterCron` — a `@Cron` that runs on ONE worker replica per tick.
 *
 * @nestjs/schedule runs every job on every process that loads the module. With two worker
 * replicas each tick ran twice: the payment-window sweep expired the same booking twice, the
 * queue-position job messaged patients twice, the 7 AM summary reached doctors twice. Each tick
 * now first takes a lock in the shared cache, keyed by class and method; the replica that loses
 * skips the tick.
 *
 * The lock lasts until just before the job's NEXT scheduled run (computed when the tick starts,
 * so irregular schedules such as "9:00 and 17:00" work too). Replicas whose clocks differ by a
 * few seconds therefore still see the lock, and the next tick is free again.
 *
 * Without a lock source (API process, unit tests) the job runs as a plain `@Cron`. When the cache
 * is unreachable `acquireLock` reports false and the tick is skipped, the same rule the
 * hand-locked crons in AppointmentsScheduler follow; every job using this decorator is a sweep
 * over database state, so the next tick catches up.
 */

import { Logger } from '@nestjs/common';
import { Cron, type CronOptions } from '@nestjs/schedule';
import { CronTime } from 'cron';

export interface ClusterCronLock {
  acquireLock(key: string, ttlSeconds: number): Promise<boolean>;
}

const logger = new Logger('ClusterCron');
let lockSource: ClusterCronLock | null = null;

/** Installed once by the worker (ClusterCronLockInitializer); null runs jobs unlocked. */
export function setClusterCronLock(lock: ClusterCronLock | null): void {
  lockSource = lock;
}

/** Cache key of a job's per-tick lock. */
export function clusterCronLockKey(className: string, methodName: string): string {
  return `cron-lock:${className}.${methodName}`;
}

/**
 * Seconds the tick's lock lives: until shortly before the next scheduled run. The margin is 5 s,
 * or a tenth of the gap for very frequent jobs, and the result is at least 1 s.
 */
export function clusterCronLockTtlSeconds(
  cronTime: string,
  timeZone?: string,
  now: number = Date.now()
): number {
  try {
    // getNextDateFrom ignores the constructor's zone unless it is passed again.
    const next = new CronTime(cronTime, timeZone)
      .getNextDateFrom(new Date(now), timeZone)
      .toMillis();
    const gapMs = next - now;
    const marginMs = Math.min(5_000, Math.max(gapMs / 10, 0));
    return Math.max(1, Math.floor((gapMs - marginMs) / 1000));
  } catch {
    return 50;
  }
}

export function ClusterCron(cronTime: string, options: CronOptions = {}): MethodDecorator {
  return (target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (...args: unknown[]) => unknown;
    const className = (target as { constructor: { name: string } }).constructor.name;
    const methodName = String(propertyKey);
    const key = clusterCronLockKey(className, methodName);

    const wrapped = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const lock = lockSource;
      if (lock) {
        const ttl = clusterCronLockTtlSeconds(cronTime, options.timeZone);
        let acquired: boolean;
        try {
          acquired = await lock.acquireLock(key, ttl);
        } catch {
          acquired = false;
        }
        if (!acquired) {
          logger.debug(`${className}.${methodName}: another replica runs this tick (or no cache)`);
          return undefined;
        }
      }
      return original.apply(this, args);
    };
    Object.defineProperty(wrapped, 'name', { value: original.name });
    descriptor.value = wrapped;

    // @Cron stores its metadata on descriptor.value, so it must see the wrapper.
    const decorate = Cron(cronTime, options) as MethodDecorator;
    return decorate(target, propertyKey, descriptor) ?? descriptor;
  };
}
