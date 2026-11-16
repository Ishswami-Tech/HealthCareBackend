/// <reference types="jest" />
/**
 * With two worker replicas every @Cron job ran twice per tick (on 2026-11-16 one booking was
 * expired by both workers). @ClusterCron takes a per-tick lock in the shared cache first.
 */

import 'reflect-metadata';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { CronExpression } from '@nestjs/schedule';

import {
  ClusterCron,
  REFUSING_CLUSTER_CRON_LOCK,
  clusterCronLockKey,
  clusterCronLockTtlSeconds,
  setClusterCronLock,
  type ClusterCronLock,
  type ClusterCronLockOutcome,
} from '@core/decorators/cluster-cron.decorator';

// @nestjs/schedule's metadata keys (schedule.constants; the package does not export the file).
const SCHEDULER_TYPE = 'SCHEDULER_TYPE';
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

class SweepJobs {
  runs = 0;

  @ClusterCron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    this.runs += 1;
  }

  @ClusterCron('0 7 * * *', { timeZone: 'Asia/Kolkata', name: 'daily-summary' })
  async dailySummary(): Promise<void> {
    this.runs += 1;
  }
}

type MockLock = ClusterCronLock & {
  tryLock: jest.Mock<Promise<ClusterCronLockOutcome>, [string, number]>;
  onUnavailable: jest.Mock<void, [string]>;
};

function lockAnswering(outcome: ClusterCronLockOutcome): MockLock {
  return {
    tryLock: jest.fn<Promise<ClusterCronLockOutcome>, [string, number]>(async () => outcome),
    onUnavailable: jest.fn<void, [string]>(),
  };
}

afterEach(() => setClusterCronLock(null));

describe('@ClusterCron', () => {
  it('runs the job on the replica that gets the lock, with a per-job key', async () => {
    const lock = lockAnswering('acquired');
    setClusterCronLock(lock);
    const jobs = new SweepJobs();

    await jobs.sweep();

    expect(jobs.runs).toBe(1);
    expect(lock.tryLock).toHaveBeenCalledWith(
      clusterCronLockKey('SweepJobs', 'sweep'),
      expect.any(Number)
    );
    expect(lock.onUnavailable).not.toHaveBeenCalled();
  });

  it('runs each tick once across replicas', async () => {
    let taken = false;
    setClusterCronLock({
      tryLock: async () => {
        if (taken) return 'held';
        taken = true;
        return 'acquired';
      },
      onUnavailable: () => undefined,
    });
    const replicaA = new SweepJobs();
    const replicaB = new SweepJobs();

    await Promise.all([replicaA.sweep(), replicaB.sweep()]);

    expect(replicaA.runs + replicaB.runs).toBe(1);
  });

  it('runs anyway and reports it when the cache cannot be asked', async () => {
    const lock = lockAnswering('unavailable');
    setClusterCronLock(lock);
    const jobs = new SweepJobs();

    await jobs.sweep();

    expect(jobs.runs).toBe(1);
    expect(lock.onUnavailable).toHaveBeenCalledWith('SweepJobs.sweep');
  });

  it('treats a lock source that throws as unavailable', async () => {
    const onUnavailable = jest.fn();
    setClusterCronLock({
      tryLock: async () => {
        throw new Error('cache down');
      },
      onUnavailable,
    });
    const jobs = new SweepJobs();

    await jobs.sweep();

    expect(jobs.runs).toBe(1);
    expect(onUnavailable).toHaveBeenCalledWith('SweepJobs.sweep');
  });

  it('starts no tick while the worker shuts down', async () => {
    setClusterCronLock(REFUSING_CLUSTER_CRON_LOCK);
    const jobs = new SweepJobs();

    await jobs.sweep();

    expect(jobs.runs).toBe(0);
  });

  it('runs unlocked when no lock source is installed (unit tests)', async () => {
    const jobs = new SweepJobs();

    await jobs.sweep();

    expect(jobs.runs).toBe(1);
  });

  it('still registers as a @nestjs/schedule cron job with its options', () => {
    const method = SweepJobs.prototype.dailySummary;

    expect(Reflect.getMetadata(SCHEDULER_TYPE, method)).toBeDefined();
    expect(Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, method)).toEqual(
      expect.objectContaining({
        cronTime: '0 7 * * *',
        timeZone: 'Asia/Kolkata',
        name: 'daily-summary',
      })
    );
    expect(method.name).toBe('dailySummary');
  });
});

describe('clusterCronLockTtlSeconds', () => {
  const at = (iso: string): number => new Date(iso).getTime();

  it('holds an every-minute lock until 5 s before the next minute', () => {
    expect(
      clusterCronLockTtlSeconds(
        CronExpression.EVERY_MINUTE,
        undefined,
        at('2026-11-16T10:00:00.000Z')
      )
    ).toBe(55);
  });

  it('does not take the current tick for the next one when it fires a hair early', () => {
    // The 10:00 tick firing at 09:59:59.998 must still lock until just before 10:01.
    expect(
      clusterCronLockTtlSeconds(
        CronExpression.EVERY_MINUTE,
        undefined,
        at('2026-11-16T09:59:59.998Z')
      )
    ).toBe(55);
  });

  it('holds a daily lock until just before the next day', () => {
    expect(
      clusterCronLockTtlSeconds('0 7 * * *', 'Asia/Kolkata', at('2026-11-16T01:30:00.000Z'))
    ).toBe(24 * 3600 - 5);
  });

  it('follows irregular schedules from the moment the tick starts', () => {
    // 9:00 and 17:00 UTC: at 9:00 the next run is 8 hours away, not 16.
    expect(clusterCronLockTtlSeconds('0 9,17 * * *', 'UTC', at('2026-11-16T09:00:00.000Z'))).toBe(
      8 * 3600 - 5
    );
  });

  it('keeps a short margin for very frequent jobs', () => {
    expect(
      clusterCronLockTtlSeconds(
        CronExpression.EVERY_10_SECONDS,
        undefined,
        at('2026-11-16T10:00:00.000Z')
      )
    ).toBe(9);
  });
});

describe('crons run on the worker only', () => {
  // Source-level guard on the places that decide where scheduled jobs run. Paths resolve from
  // this file, so the test does not depend on jest's working directory.
  const source = (relative: string): string =>
    readFileSync(resolve(__dirname, '../../..', relative), 'utf8');

  it('the API registers the scheduler with every cron job switched off', () => {
    const app = source('src/app.module.ts');
    expect(app).toMatch(/ScheduleModule\.forRoot\(\s*\{[^}]*\bcronJobs:\s*false\b/);
    expect(app).not.toContain('ClusterCronLockInitializer');
  });

  it('the worker runs the jobs and installs the one-replica lock', () => {
    const worker = source('src/worker-bootstrap.ts');
    expect(worker).toMatch(/ScheduleModule\.forRoot\(\s*\)/);
    expect(worker).toMatch(/providers:\s*\[[^\]]*\bClusterCronLockInitializer\b/);
  });

  it('no job is a plain @Cron any more', () => {
    const files = [
      'src/services/appointments/appointments-scheduler.service.ts',
      'src/services/appointments/in-person/in-person-queue-maintenance.service.ts',
      'src/services/appointments/plugins/video/video-scheduler.service.ts',
      'src/services/billing/billing-scheduler.service.ts',
      'src/libs/infrastructure/cache/services/cache-warming.service.ts',
    ];
    for (const file of files) {
      expect(source(file)).not.toMatch(/@Cron\(/);
    }
  });
});
