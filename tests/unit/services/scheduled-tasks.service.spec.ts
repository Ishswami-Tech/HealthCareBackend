/// <reference types="jest" />
/**
 * ScheduledTasksService (worker): finds @ScheduledTask methods, registers one BullMQ job scheduler
 * per task on healthcare-queue (removing stale ones), and runs each tick. Plus the pieces that put
 * scheduled runs in the dashboard ("Scheduled Tasks" filters) and route them in QueueProcessor.
 */

import 'reflect-metadata';
import { MetadataScanner, Reflector } from '@nestjs/core';
import type { DiscoveryService } from '@nestjs/core';
import type { Job, Queue } from 'bullmq';

import {
  ScheduledTask,
  scheduledTaskQueueType,
  scheduledTaskSchedulerId,
} from '@core/decorators/scheduled-task.decorator';
import { JobType } from '@core/types/queue.types';
import { JOB_RETENTION } from '@infrastructure/queue/src/queue.constants';
import {
  SCHEDULED_TASK_JOB_FAMILY,
  ScheduledTasksService,
  scheduledTaskEnvelope,
  type ScheduledTaskEnvelope,
} from '@infrastructure/queue/src/scheduled/scheduled-tasks.service';
import { QueueService } from '@infrastructure/queue/src/queue.service';
import { QueueController } from '@infrastructure/queue/src/controllers/queue.controller';
import { QueueProcessor } from '@infrastructure/queue/src/queue.processor';

class SweepJobs {
  calls: string[] = [];

  @ScheduledTask({
    id: 'test.sweep',
    group: 'billing',
    pattern: '* * * * *',
    tz: 'Asia/Kolkata',
    attempts: 1,
  })
  async sweep(): Promise<void> {
    this.calls.push('sweep');
  }

  @ScheduledTask({
    id: 'test.daily',
    group: 'appointments',
    pattern: '0 7 * * *',
    tz: 'Asia/Kolkata',
    attempts: 3,
  })
  async daily(): Promise<void> {
    this.calls.push('daily');
  }

  async notScheduled(): Promise<void> {
    this.calls.push('never');
  }
}

type FakeQueue = {
  upsertJobScheduler: jest.Mock;
  getJobSchedulers: jest.Mock;
  removeJobScheduler: jest.Mock;
  getActive: jest.Mock;
};

function setup(options: { existingSchedulers?: string[]; active?: Partial<Job>[] } = {}): {
  service: ScheduledTasksService;
  jobs: SweepJobs;
  queue: FakeQueue;
  log: jest.Mock;
} {
  const jobs = new SweepJobs();
  const discovery = {
    getProviders: () => [
      { instance: jobs, isAlias: false },
      { instance: jobs, isAlias: true }, // alias wrapper of the same provider: skipped
      { instance: undefined, isAlias: false },
    ],
  } as unknown as DiscoveryService;
  const queue: FakeQueue = {
    upsertJobScheduler: jest.fn(async () => undefined),
    getJobSchedulers: jest.fn(async () => (options.existingSchedulers ?? []).map(key => ({ key }))),
    removeJobScheduler: jest.fn(async () => true),
    getActive: jest.fn(async () => options.active ?? []),
  };
  const log = jest.fn(async () => undefined);
  const service = new ScheduledTasksService(
    discovery,
    new MetadataScanner(),
    new Reflector(),
    queue as unknown as Queue,
    { log } as never
  );
  return { service, jobs, queue, log };
}

function tick(
  taskId: string,
  extra: Partial<Job<ScheduledTaskEnvelope>> = {}
): Job<ScheduledTaskEnvelope> {
  return {
    id: `repeat:${scheduledTaskSchedulerId(taskId)}:1794806692000`,
    name: taskId,
    timestamp: 1794806692000,
    repeatJobKey: scheduledTaskSchedulerId(taskId),
    data: { action: taskId } as ScheduledTaskEnvelope,
    ...extra,
  } as Job<ScheduledTaskEnvelope>;
}

describe('ScheduledTasksService', () => {
  it('discovers decorated methods once, skipping alias wrappers', () => {
    const { service } = setup();
    service.discover();
    expect(service.definitions().map(task => task.id)).toEqual(['test.sweep', 'test.daily']);
  });

  it('registers one scheduler per task with its pattern, zone, attempts and retention', async () => {
    const { service, queue } = setup();
    await service.onApplicationBootstrap();

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'scheduled:test.daily',
      { pattern: '0 7 * * *', tz: 'Asia/Kolkata' },
      {
        name: 'test.daily',
        data: expect.objectContaining({
          jobType: JobType.SCHEDULED_TASK,
          action: 'test.daily',
          jobFamily: SCHEDULED_TASK_JOB_FAMILY,
          queueType: 'scheduled_appointments',
        }),
        opts: expect.objectContaining({
          attempts: 3,
          backoff: expect.any(Object),
          removeOnComplete: JOB_RETENTION.removeOnComplete,
          removeOnFail: JOB_RETENTION.removeOnFail,
        }),
      }
    );
    const sweepCall = queue.upsertJobScheduler.mock.calls.find(
      call => call[0] === 'scheduled:test.sweep'
    );
    expect(sweepCall?.[2].opts).not.toHaveProperty('backoff');
  });

  it("removes this app's stale schedulers and leaves others alone", async () => {
    const { service, queue } = setup({
      existingSchedulers: ['scheduled:test.sweep', 'scheduled:old.renamed', 'send-recurring-email'],
    });
    await service.onApplicationBootstrap();

    expect(queue.removeJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith('scheduled:old.renamed');
  });

  it('keeps the worker up when registration fails (and logs it)', async () => {
    const { service, queue, log } = setup();
    queue.upsertJobScheduler.mockRejectedValueOnce(new Error('NOSCRIPT'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.anything(),
      'ERROR',
      'Could not register the scheduled tasks with BullMQ',
      'ScheduledTasksService',
      expect.any(Object)
    );
  });

  it('runs the task behind a tick, discovering lazily if the tick beats bootstrap', async () => {
    const { service, jobs } = setup();

    await expect(service.run(tick('test.daily'))).resolves.toEqual(
      expect.objectContaining({ success: true, taskId: 'test.daily' })
    );
    expect(jobs.calls).toEqual(['daily']);
  });

  it('fails a tick for an unknown task', async () => {
    const { service } = setup();
    await expect(service.run(tick('nope.gone'))).rejects.toThrow('No scheduled task "nope.gone"');
  });

  it('skips a tick while an older tick of the same scheduler is still running', async () => {
    const { service, jobs } = setup({
      active: [
        {
          id: 'repeat:scheduled:test.sweep:1794806632000',
          repeatJobKey: 'scheduled:test.sweep',
          timestamp: 1794806632000,
        },
      ],
    });

    await expect(service.run(tick('test.sweep'))).resolves.toEqual(
      expect.objectContaining({ skipped: 'overlap' })
    );
    expect(jobs.calls).toEqual([]);
  });

  it('a newer active tick does not block an older one', async () => {
    const { service, jobs } = setup({
      active: [
        {
          id: 'repeat:scheduled:test.sweep:1794806752000',
          repeatJobKey: 'scheduled:test.sweep',
          timestamp: 1794806752000,
        },
      ],
    });

    await service.run(tick('test.sweep'));
    expect(jobs.calls).toEqual(['sweep']);
  });
});

describe('scheduled runs in the queue dashboard', () => {
  it('the envelope carries the dashboard taxonomy', () => {
    expect(
      scheduledTaskEnvelope({
        id: 'video.doctor-no-shows',
        group: 'in-person-queue',
        pattern: '* * * * *',
        tz: 'Asia/Kolkata',
        attempts: 1,
      })
    ).toEqual(
      expect.objectContaining({
        jobType: JobType.SCHEDULED_TASK,
        domain: 'clinic',
        action: 'video.doctor-no-shows',
        jobFamily: 'scheduled-tasks',
        queueType: 'scheduled_in_person_queue',
        queueCategory: 'SCHEDULED_TASK',
      })
    );
  });

  it('the filter catalog has a Scheduled Tasks group: all runs plus one filter per group', () => {
    const group = QueueService.QUEUE_FILTER_CATALOG.find(entry => entry.key === 'scheduled-tasks');
    expect(group?.label).toBe('Scheduled Tasks');
    expect(group?.filters.map(filter => filter.value)).toEqual([
      'scheduled_task',
      scheduledTaskQueueType('appointments'),
      scheduledTaskQueueType('video'),
      scheduledTaskQueueType('in-person-queue'),
      scheduledTaskQueueType('billing'),
      scheduledTaskQueueType('cache'),
    ]);
    expect(QueueService.SUPPORTED_QUEUE_FILTERS).toEqual(
      expect.arrayContaining(['scheduled_task', 'scheduled_billing'])
    );
  });

  it('a scheduled billing sweep is counted under Scheduled Tasks, not Billing (service)', () => {
    const service = Object.create(QueueService.prototype) as {
      getQueueJobFamily(jobType: string, data?: Record<string, unknown>): string;
    };
    expect(service.getQueueJobFamily('scheduled_task', { queueType: 'scheduled_billing' })).toBe(
      'scheduled-tasks'
    );
    expect(service.getQueueJobFamily('payment_processing', {})).toBe('billing-and-payments');
  });

  it('a scheduled billing sweep is counted under Scheduled Tasks, not Billing (controller)', () => {
    const controller = Object.create(QueueController.prototype) as {
      queueFamilyFromJobType(jobType?: string, queueType?: string): string;
    };
    expect(controller.queueFamilyFromJobType('scheduled_task', 'scheduled_billing')).toBe(
      'scheduled-tasks'
    );
    expect(controller.queueFamilyFromJobType('payment_processing', 'payment')).toBe(
      'billing-and-payments'
    );
  });
});

describe('QueueProcessor routes scheduled ticks', () => {
  it('hands a SCHEDULED_TASK job to ScheduledTasksService', async () => {
    const run = jest.fn(async () => ({ success: true, taskId: 'test.sweep', durationMs: 1 }));
    const processor = Object.create(QueueProcessor.prototype) as {
      moduleRef: { get: jest.Mock };
      processScheduledTask(job: Job): Promise<unknown>;
    };
    processor.moduleRef = { get: jest.fn(() => ({ run })) };

    await expect(processor.processScheduledTask(tick('test.sweep') as Job)).resolves.toEqual(
      expect.objectContaining({ taskId: 'test.sweep' })
    );
    expect(processor.moduleRef.get).toHaveBeenCalledWith(ScheduledTasksService, { strict: false });
  });

  it('fails clearly in a process without the scheduled-task runner', async () => {
    const processor = Object.create(QueueProcessor.prototype) as {
      moduleRef: { get: jest.Mock };
      processScheduledTask(job: Job): Promise<unknown>;
    };
    processor.moduleRef = {
      get: jest.fn(() => {
        throw new Error('not found');
      }),
    };

    await expect(processor.processScheduledTask(tick('test.sweep') as Job)).rejects.toThrow(
      'Scheduled tasks are not available in this process'
    );
  });
});
