/// <reference types="jest" />
/**
 * Scheduled tasks on a REAL BullMQ + Redis/Dragonfly: two worker replicas, one scheduler firing
 * every second, run through ScheduledTasksService exactly as the worker does.
 *
 * Needs a Redis-compatible server: set SCHEDULED_TASKS_TEST_REDIS (e.g. redis://127.0.0.1:16399).
 * Skipped without it. Run against Dragonfly started WITHOUT `disable-atomicity` in
 * --default_lua_flags: with that flag BullMQ's scripts are not atomic and two workers can take the
 * same job (seen on df-v2.0.2: "Lock mismatch", a tick processed twice).
 */

import 'reflect-metadata';
import { MetadataScanner, Reflector } from '@nestjs/core';
import type { DiscoveryService } from '@nestjs/core';
import { Queue, Worker, type Job } from 'bullmq';

import { ScheduledTask, scheduledTaskSchedulerId } from '@core/decorators/scheduled-task.decorator';
import {
  ScheduledTasksService,
  type ScheduledTaskEnvelope,
} from '@infrastructure/queue/src/scheduled/scheduled-tasks.service';

const REDIS_URL = process.env['SCHEDULED_TASKS_TEST_REDIS'];
const describeWithRedis = REDIS_URL ? describe : describe.skip;

const connection = (): { host: string; port: number; maxRetriesPerRequest: null } => {
  const url = new URL(REDIS_URL ?? 'redis://127.0.0.1:6379');
  return { host: url.hostname, port: Number(url.port || 6379), maxRetriesPerRequest: null };
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describeWithRedis('scheduled tasks on real BullMQ', () => {
  jest.setTimeout(60_000);

  const queueName = `scheduled-it-${Date.now()}`;
  const runs: Array<{ replica: string; jobId: string }> = [];
  const services: ScheduledTasksService[] = [];
  let queue: Queue;

  class EverySecond {
    constructor(private readonly replica: string) {}

    @ScheduledTask({
      id: 'it.every-second',
      group: 'billing',
      pattern: '* * * * * *',
      tz: 'Asia/Kolkata',
      attempts: 1,
    })
    async tick(): Promise<void> {
      await sleep(100);
      runs.push({ replica: this.replica, jobId: '' });
    }
  }

  function replica(name: string): { service: ScheduledTasksService; worker: Worker } {
    const discovery = {
      getProviders: () => [{ instance: new EverySecond(name), isAlias: false }],
    } as unknown as DiscoveryService;
    const service = new ScheduledTasksService(
      discovery,
      new MetadataScanner(),
      new Reflector(),
      queue,
      { log: async () => undefined } as never
    );
    services.push(service);
    const worker = new Worker(
      queueName,
      async (job: Job<ScheduledTaskEnvelope>) => {
        const result = await service.run(job);
        runs[runs.length - 1] = { replica: name, jobId: String(job.id) };
        return result;
      },
      { connection: connection(), concurrency: 10 }
    );
    return { service, worker };
  }

  beforeAll(() => {
    queue = new Queue(queueName, { connection: connection() });
  });

  afterAll(async () => {
    for (const service of services) service.onModuleDestroy();
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('two replicas: one scheduler, one run per tick, no tick lost when a replica stops', async () => {
    const a = replica('A');
    const b = replica('B');

    // Both replicas register at boot, at the same time.
    await Promise.all([a.service.onApplicationBootstrap(), b.service.onApplicationBootstrap()]);
    const schedulers = await queue.getJobSchedulers(0, -1);
    expect(schedulers.map(scheduler => scheduler.key)).toEqual([
      scheduledTaskSchedulerId('it.every-second'),
    ]);

    await sleep(5_000);
    await a.worker.close(); // replica A goes away mid-run
    await sleep(5_000);
    await b.worker.close();

    const jobIds = runs.map(run => run.jobId);
    expect(new Set(jobIds).size).toBe(jobIds.length); // no tick ran twice
    expect(runs.length).toBeGreaterThanOrEqual(8); // ~10 ticks in 10 s, none lost
    expect(runs.some(run => run.replica === 'B')).toBe(true);

    // Tick times are one second apart: nothing skipped while A stopped.
    const tickTimes = jobIds
      .map(id => Number(id.split(':').pop()))
      .sort((left, right) => left - right);
    const gaps = tickTimes.slice(1).map((time, index) => time - (tickTimes[index] ?? time));
    expect(Math.max(...gaps)).toBeLessThanOrEqual(1_000);
  });

  it('a task removed from the code has its scheduler removed at the next boot', async () => {
    await queue.upsertJobScheduler(scheduledTaskSchedulerId('it.retired'), { every: 60_000 });
    const { service, worker } = replica('C');
    await service.onApplicationBootstrap();
    await worker.close();

    const keys = (await queue.getJobSchedulers(0, -1)).map(scheduler => scheduler.key);
    expect(keys).not.toContain(scheduledTaskSchedulerId('it.retired'));
    expect(keys).toContain(scheduledTaskSchedulerId('it.every-second'));
  });
});
