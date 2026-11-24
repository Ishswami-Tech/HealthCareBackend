import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../../../src/libs/infrastructure/logging', () => ({
  LoggingService: class LoggingService {},
}));
jest.mock('../../../src/libs/infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));

import {
  DeadLetterQueueService,
  deadLetterJobId,
  isReusableCustomJobId,
  type DeadLetterEntry,
  type DeadLetterQueueLike,
} from '../../../src/libs/infrastructure/queue/src/services/dead-letter-queue.service';
import type { DatabaseService } from '../../../src/libs/infrastructure/database/database.service';
import type { LoggingService } from '../../../src/libs/infrastructure/logging';
import type { Job } from 'bullmq';

interface FakeJob {
  id: string;
  name: string;
  data: unknown;
  state: string;
  removed: boolean;
  retried?: { state: string; opts: unknown };
  getState: () => Promise<string>;
  remove: () => Promise<void>;
  retry: (state: string, opts: unknown) => Promise<void>;
}

/** BullMQ 5/6 Job.validateOptions rules for a custom jobId on add(). */
function assertBullMqAcceptsCustomId(jobId: string): void {
  if (`${parseInt(jobId, 10)}` === jobId) throw new Error('Custom Id cannot be integers');
  if (jobId.includes(':') && jobId.split(':').length !== 3) {
    throw new Error('Custom Id cannot contain :');
  }
}

/** In-memory stand-in for a BullMQ queue with BullMQ's duplicate-id and custom-id semantics. */
class FakeQueue {
  readonly jobs = new Map<string, FakeJob>();
  private nextId = 100;
  readonly add = jest.fn(async (name: string, data: unknown, opts: { jobId?: string } = {}) => {
    if (opts.jobId !== undefined) assertBullMqAcceptsCustomId(opts.jobId);
    const id = opts.jobId ?? String(this.nextId++);
    const existing = this.jobs.get(id);
    if (existing) return existing; // BullMQ: duplicate jobId is silently ignored
    return this.put(id, name, data, 'waiting');
  });

  constructor(readonly name: string) {}

  put(id: string, name: string, data: unknown, state: string): FakeJob {
    const job: FakeJob = {
      id,
      name,
      data,
      state,
      removed: false,
      getState: async () => job.state,
      remove: async () => {
        job.removed = true;
        this.jobs.delete(id);
      },
      retry: async (fromState: string, opts: unknown) => {
        job.retried = { state: fromState, opts };
        job.state = 'waiting';
      },
    };
    this.jobs.set(id, job);
    return job;
  }

  getJob = async (id: string): Promise<FakeJob | undefined> => this.jobs.get(id);
  getJobs = async (): Promise<FakeJob[]> => [];
  getWaiting = async (): Promise<FakeJob[]> => [];
  getFailed = async (): Promise<FakeJob[]> => [];
  getCompleted = async (): Promise<FakeJob[]> => [];
  clean = async (): Promise<string[]> => [];
  close = jest.fn(async (): Promise<void> => undefined);
}

const ORIGINAL_QUEUE = 'healthcare-queue';
const entry = (jobId: string): DeadLetterEntry => ({
  jobId,
  originalQueue: ORIGINAL_QUEUE,
  name: 'appointment',
  data: { jobType: 'appointment', data: { appointmentId: 'a-1' } },
  opts: { priority: 3 },
  error: 'boom',
  stack: undefined,
  attemptsMade: 5,
  failedAt: new Date(0),
});

describe('DeadLetterQueueService.retryDeadLetter', () => {
  let queues: Map<string, FakeQueue>;
  let service: DeadLetterQueueService;
  let dlq: FakeQueue;
  let target: FakeQueue;

  beforeEach(() => {
    queues = new Map();
    service = new DeadLetterQueueService(
      {} as DatabaseService,
      { log: jest.fn(async () => undefined) } as unknown as LoggingService
    );
    service.initialize({ host: 'x', port: 1, db: 1 }, name => {
      const queue = new FakeQueue(name);
      queues.set(name, queue);
      return queue as unknown as DeadLetterQueueLike;
    });
    dlq = queues.get('healthcare-queue-dead-letter')!;
    target = new FakeQueue(ORIGINAL_QUEUE);
    // Pre-register the target so the service's factory call reuses this instance.
    queues.set(ORIGINAL_QUEUE, target);
    (service as unknown as { targetQueues: Map<string, FakeQueue> }).targetQueues.set(
      ORIGINAL_QUEUE,
      target
    );
  });

  it('moves a job that still sits in the failed set back to wait (was silently dropped)', async () => {
    const original = target.put('reminder-a-1', 'appointment', entry('x').data, 'failed');
    const dlqJob = dlq.put('dlq-reminder-a-1', 'dead-letter', entry('reminder-a-1'), 'waiting');

    const result = await service.retryDeadLetter('dlq-reminder-a-1');

    expect(result).toEqual({
      outcome: 'requeued',
      originalQueue: ORIGINAL_QUEUE,
      jobId: 'reminder-a-1',
    });
    expect(original.state).toBe('waiting');
    expect(original.retried).toEqual({
      state: 'failed',
      opts: { resetAttemptsMade: true, resetAttemptsStarted: true },
    });
    expect(dlqJob.removed).toBe(true);
    expect(target.add).not.toHaveBeenCalled();
  });

  it('re-adds a pruned job under its custom id and verifies it landed', async () => {
    const dlqJob = dlq.put('dlq-reminder-a-1', 'dead-letter', entry('reminder-a-1'), 'waiting');

    const result = await service.retryDeadLetter('dlq-reminder-a-1');

    expect(result.outcome).toBe('requeued');
    expect(target.jobs.get('reminder-a-1')?.state).toBe('waiting');
    expect(target.add).toHaveBeenCalledWith(
      'appointment',
      entry('reminder-a-1').data,
      expect.objectContaining({ jobId: 'reminder-a-1', attempts: 5, priority: 3 })
    );
    expect(dlqJob.removed).toBe(true);
  });

  it('re-adds a pruned job with an auto id when the original id was a BullMQ integer id', async () => {
    dlq.put('dlq-1987', 'dead-letter', entry('1987'), 'waiting');

    const result = await service.retryDeadLetter('dlq-1987');

    const opts = target.add.mock.calls[0]?.[2] as { jobId?: string };
    expect(opts.jobId).toBeUndefined();
    expect(result.jobId).toBe('100');
    expect(target.jobs.get('100')?.state).toBe('waiting');
  });

  it('re-adds a pruned scheduled-task job under a fresh id BullMQ accepts', async () => {
    const original = 'repeat:scheduled:billing-sweep:1795000000000';
    const dlqId = deadLetterJobId(original);
    dlq.put(dlqId, 'dead-letter', entry(original), 'waiting');

    const result = await service.retryDeadLetter(dlqId);

    const opts = target.add.mock.calls[0]?.[2] as { jobId?: string };
    expect(opts.jobId).toBeUndefined();
    expect(result).toEqual({ outcome: 'requeued', originalQueue: ORIGINAL_QUEUE, jobId: '100' });
    expect(dlq.jobs.has(dlqId)).toBe(false);
  });

  it('does not re-add a job that is still pending, and clears the DLQ copy', async () => {
    target.put('reminder-a-1', 'appointment', {}, 'delayed');
    const dlqJob = dlq.put('dlq-reminder-a-1', 'dead-letter', entry('reminder-a-1'), 'waiting');

    const result = await service.retryDeadLetter('dlq-reminder-a-1');

    expect(result.outcome).toBe('already-pending');
    expect(target.add).not.toHaveBeenCalled();
    expect(dlqJob.removed).toBe(true);
  });

  it('keeps the DLQ entry when the re-add was not accepted', async () => {
    const dlqJob = dlq.put('dlq-reminder-a-1', 'dead-letter', entry('reminder-a-1'), 'waiting');
    target.add.mockImplementationOnce(async () => undefined as unknown as FakeJob);

    await expect(service.retryDeadLetter('dlq-reminder-a-1')).rejects.toThrow('DLQ entry kept');
    expect(dlqJob.removed).toBe(false);
  });

  it('throws for an unknown DLQ id', async () => {
    await expect(service.retryDeadLetter('dlq-missing')).rejects.toThrow('DLQ job not found');
  });

  it('reuses one producer per target queue and closes everything on destroy', async () => {
    dlq.put('dlq-a', 'dead-letter', entry('a-job'), 'waiting');
    dlq.put('dlq-b', 'dead-letter', entry('b-job'), 'waiting');

    await service.retryDeadLetter('dlq-a');
    await service.retryDeadLetter('dlq-b');
    await service.onModuleDestroy();

    expect(target.close).toHaveBeenCalledTimes(1);
    expect(dlq.close).toHaveBeenCalledTimes(1);
  });
});

describe('DeadLetterQueueService.moveToDeadLetter', () => {
  let dlq: FakeQueue;
  let log: ReturnType<typeof jest.fn>;
  let service: DeadLetterQueueService;

  beforeEach(() => {
    log = jest.fn(async () => undefined);
    service = new DeadLetterQueueService(
      {} as DatabaseService,
      { log } as unknown as LoggingService
    );
    service.initialize({ host: 'x', port: 1, db: 1 }, name => {
      const queue = new FakeQueue(name);
      if (name === 'healthcare-queue-dead-letter') dlq = queue;
      return queue as unknown as DeadLetterQueueLike;
    });
  });

  function failedJob(id: string): Job {
    return {
      id,
      name: 'scheduled-task',
      queueName: ORIGINAL_QUEUE,
      data: { taskId: 'billing-sweep' },
      opts: { priority: 2, attempts: 3 },
      attemptsMade: 3,
    } as unknown as Job;
  }

  const loggedErrors = (): string[] =>
    log.mock.calls.filter(call => call[1] === 'ERROR').map(call => String(call[2]));

  it.each([
    ['a scheduled task (BullMQ scheduler id with a colon)', 'repeat:scheduled:billing-sweep:1795'],
    ['a legacy repeat job', 'repeat:abc123:1795'],
    ['a plain custom id', 'reminder-a-1'],
    ['a BullMQ integer id', '1987'],
  ])('stores %s in the DLQ (was: "Custom Id cannot contain :")', async (_label, id) => {
    await service.moveToDeadLetter(failedJob(id), new Error('boom'));

    expect(loggedErrors()).toEqual([]);
    const stored = dlq.jobs.get(deadLetterJobId(id));
    expect(stored).toBeDefined();
    expect((stored?.data as DeadLetterEntry).jobId).toBe(id);
  });

  it('stores a job that fails twice only once', async () => {
    const id = 'repeat:scheduled:billing-sweep:1795';
    await service.moveToDeadLetter(failedJob(id), new Error('boom'));
    await service.moveToDeadLetter(failedJob(id), new Error('boom again'));

    expect(dlq.jobs.size).toBe(1);
  });
});

describe('dead-letter job ids', () => {
  it('never produce an id BullMQ refuses, and keep distinct ids distinct', () => {
    const ids = ['repeat:scheduled:a:1', 'repeat%3Ascheduled:a:1', 'a:b', 'a%3Ab', 'x', '42'];
    const dlqIds = ids.map(deadLetterJobId);
    for (const dlqId of dlqIds) {
      expect(dlqId).not.toContain(':');
      expect(() => assertBullMqAcceptsCustomId(dlqId)).not.toThrow();
    }
    expect(new Set(dlqIds).size).toBe(ids.length);
  });

  it('reuses an original id only when BullMQ accepts it back', () => {
    expect(isReusableCustomJobId('reminder-a-1')).toBe(true);
    expect(isReusableCustomJobId('repeat:abc:1795')).toBe(true);
    expect(isReusableCustomJobId('repeat:scheduled:task:1795')).toBe(false);
    expect(isReusableCustomJobId('a:b')).toBe(false);
    expect(isReusableCustomJobId('1987')).toBe(false);
  });
});
