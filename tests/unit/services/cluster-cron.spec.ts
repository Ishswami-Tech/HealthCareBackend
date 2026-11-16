/// <reference types="jest" />
/**
 * With two worker replicas every @Cron job ran twice per tick (on 2026-11-16 one booking was
 * expired by both workers). @ClusterCron takes a per-tick lock in the shared cache first.
 */

import 'reflect-metadata';
import { CronExpression } from '@nestjs/schedule';

import {
  ClusterCron,
  clusterCronLockKey,
  clusterCronLockTtlSeconds,
  setClusterCronLock,
} from '@core/decorators/cluster-cron.decorator';

// @nestjs/schedule's metadata keys (schedule.constants; the package does not export the file).
const SCHEDULER_TYPE = 'SCHEDULER_TYPE';
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

class SweepJobs {
  runs = 0;

  @ClusterCron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<string> {
    this.runs += 1;
    return 'swept';
  }

  @ClusterCron('0 7 * * *', { timeZone: 'Asia/Kolkata', name: 'daily-summary' })
  async dailySummary(): Promise<void> {
    this.runs += 1;
  }
}

afterEach(() => setClusterCronLock(null));

describe('@ClusterCron', () => {
  it('runs the job on the replica that gets the lock, with a per-job key', async () => {
    const acquireLock = jest.fn(async () => true);
    setClusterCronLock({ acquireLock });
    const jobs = new SweepJobs();

    await expect(jobs.sweep()).resolves.toBe('swept');

    expect(jobs.runs).toBe(1);
    expect(acquireLock).toHaveBeenCalledWith(
      clusterCronLockKey('SweepJobs', 'sweep'),
      expect.any(Number)
    );
  });

  it('skips the tick on the replica that loses the lock', async () => {
    let held = false;
    setClusterCronLock({
      acquireLock: async () => {
        if (held) return false;
        held = true;
        return true;
      },
    });
    const replicaA = new SweepJobs();
    const replicaB = new SweepJobs();

    await Promise.all([replicaA.sweep(), replicaB.sweep()]);

    expect(replicaA.runs + replicaB.runs).toBe(1);
  });

  it('skips the tick when the cache cannot be asked (same rule as the hand-locked crons)', async () => {
    setClusterCronLock({
      acquireLock: async () => {
        throw new Error('cache down');
      },
    });
    const jobs = new SweepJobs();

    await jobs.sweep();

    expect(jobs.runs).toBe(0);
  });

  it('runs unlocked when no lock source is installed (API process, tests)', async () => {
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
  // Source-level guard: these two lines are what keep scheduled jobs off the API replicas.
  const read = (path: string): string =>
    (jest.requireActual('fs') as typeof import('fs')).readFileSync(path, 'utf8');

  it('the API registers the scheduler with every cron job switched off', () => {
    expect(read('src/app.module.ts')).toMatch(
      /ScheduleModule\.forRoot\(\{\s*cronJobs:\s*false\s*\}\)/
    );
    expect(read('src/app.module.ts')).not.toContain('ClusterCronLockInitializer');
  });

  it('the worker runs the jobs and installs the one-replica lock', () => {
    const worker = read('src/worker-bootstrap.ts');
    expect(worker).toMatch(/ScheduleModule\.forRoot\(\)/);
    expect(worker).toMatch(/providers:\s*\[[^\]]*ClusterCronLockInitializer/);
  });
});
