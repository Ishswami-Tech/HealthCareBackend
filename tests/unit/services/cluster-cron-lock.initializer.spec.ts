/// <reference types="jest" />
/**
 * The worker's lock source for @ClusterCron: tells "another replica has it" from "the cache
 * cannot be asked", warns about the latter (rate-limited), refuses ticks during shutdown, and
 * resolves through Nest's injector the way the worker module builds it.
 */

import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import {
  REFUSING_CLUSTER_CRON_LOCK,
  ClusterCron,
  setClusterCronLock,
} from '@core/decorators/cluster-cron.decorator';
import { CacheService } from '@infrastructure/cache/cache.service';
import {
  CLUSTER_CRON_UNAVAILABLE_WARN_INTERVAL_MS,
  ClusterCronLockInitializer,
} from '@infrastructure/cache/cluster-cron-lock.initializer';
import { LoggingService } from '@infrastructure/logging';

class Jobs {
  runs = 0;

  @ClusterCron('* * * * *')
  async tick(): Promise<void> {
    this.runs += 1;
  }
}

async function build(cache: { acquireLock: jest.Mock; isLockHeld: jest.Mock }): Promise<{
  initializer: ClusterCronLockInitializer;
  log: jest.Mock;
}> {
  const log = jest.fn(async () => undefined);
  const moduleRef = await Test.createTestingModule({
    providers: [
      ClusterCronLockInitializer,
      { provide: CacheService, useValue: cache },
      { provide: LoggingService, useValue: { log } },
    ],
  }).compile();
  return { initializer: moduleRef.get(ClusterCronLockInitializer), log };
}

afterEach(() => {
  setClusterCronLock(null);
  jest.useRealTimers();
});

describe('ClusterCronLockInitializer', () => {
  it('resolves through the Nest injector and installs the lock on module init', async () => {
    const cache = { acquireLock: jest.fn(async () => true), isLockHeld: jest.fn() };
    const { initializer } = await build(cache);

    initializer.onModuleInit();
    const jobs = new Jobs();
    await jobs.tick();

    expect(jobs.runs).toBe(1);
    expect(cache.acquireLock).toHaveBeenCalledWith('cron-lock:Jobs.tick', expect.any(Number));
  });

  it('reports "held" when another replica has the lock', async () => {
    const { initializer, log } = await build({
      acquireLock: jest.fn(async () => false),
      isLockHeld: jest.fn(async () => true),
    });

    await expect(initializer.lock.tryLock('cron-lock:Jobs.tick', 55)).resolves.toBe('held');
    expect(log).not.toHaveBeenCalled();
  });

  it('reports "unavailable" when the lock is not there either, and warns once per interval', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-16T10:00:00Z'));
    const { initializer, log } = await build({
      acquireLock: jest.fn(async () => false),
      isLockHeld: jest.fn(async () => false),
    });

    await expect(initializer.lock.tryLock('cron-lock:Jobs.tick', 55)).resolves.toBe('unavailable');
    initializer.lock.onUnavailable('Jobs.tick');
    initializer.lock.onUnavailable('Jobs.tick');
    expect(log).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(CLUSTER_CRON_UNAVAILABLE_WARN_INTERVAL_MS);
    initializer.lock.onUnavailable('Jobs.tick');
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('refuses every tick once the module is being destroyed', async () => {
    const { initializer } = await build({
      acquireLock: jest.fn(async () => true),
      isLockHeld: jest.fn(),
    });
    initializer.onModuleInit();

    initializer.onModuleDestroy();
    const jobs = new Jobs();
    await jobs.tick();

    expect(jobs.runs).toBe(0);
    await expect(REFUSING_CLUSTER_CRON_LOCK.tryLock('any', 1)).resolves.toBe('held');
  });
});
