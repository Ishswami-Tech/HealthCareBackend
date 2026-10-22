import { describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeWorkersGracefully } from '../../../src/libs/infrastructure/queue/src/worker-lifecycle/close-workers.util';
import {
  evaluateHeartbeat,
  readHeartbeat,
  runHeartbeatCheck,
  writeHeartbeat,
  type WorkerHeartbeat,
} from '../../../src/libs/infrastructure/queue/src/worker-lifecycle/worker-heartbeat';
import {
  completionMarkerKey,
  runJobOnce,
  type CompletionMarkerStore,
} from '../../../src/libs/infrastructure/queue/src/worker-lifecycle/job-idempotency.util';

const healthy = (overrides: Partial<WorkerHeartbeat> = {}): WorkerHeartbeat => ({
  ts: 1_000_000,
  pid: 1,
  redisOk: true,
  dbOk: true,
  runningWorkers: 1,
  totalWorkers: 1,
  shuttingDown: false,
  ...overrides,
});

describe('closeWorkersGracefully', () => {
  it('waits for in-flight jobs (graceful close)', async () => {
    const close = jest.fn(async (_force?: boolean) => undefined);
    const results = await closeWorkersGracefully([{ name: 'w', close }], 1000);

    expect(results).toEqual([expect.objectContaining({ name: 'w', outcome: 'closed' })]);
    expect(close).toHaveBeenCalledWith(false);
  });

  it('force-closes a worker whose jobs exceed the timeout', async () => {
    const close = jest.fn((force?: boolean): Promise<void> =>
      force ? Promise.resolve() : new Promise<void>(() => undefined)
    );
    const results = await closeWorkersGracefully([{ name: 'slow', close }], 20);

    expect(results[0]?.outcome).toBe('forced');
    expect(close).toHaveBeenLastCalledWith(true);
  });

  it('reports a failing close without throwing', async () => {
    const close = jest.fn(async () => {
      throw new Error('redis gone');
    });
    const results = await closeWorkersGracefully([{ name: 'w', close }], 1000);

    expect(results[0]).toEqual(expect.objectContaining({ outcome: 'failed', error: 'redis gone' }));
  });
});

describe('worker heartbeat', () => {
  it('is healthy only when fresh, both pings pass and a worker runs', () => {
    expect(evaluateHeartbeat(healthy(), 1_010_000, 60_000).healthy).toBe(true);
    expect(evaluateHeartbeat(null, 0, 60_000).reasons).toEqual(['no heartbeat written yet']);
    expect(evaluateHeartbeat(healthy(), 1_100_000, 60_000).healthy).toBe(false);
    expect(evaluateHeartbeat(healthy({ redisOk: false }), 1_000_000, 60_000).reasons).toContain(
      'Redis/Dragonfly ping failed'
    );
    expect(evaluateHeartbeat(healthy({ dbOk: false }), 1_000_000, 60_000).healthy).toBe(false);
    expect(evaluateHeartbeat(healthy({ runningWorkers: 0 }), 1_000_000, 60_000).healthy).toBe(
      false
    );
    expect(evaluateHeartbeat(healthy({ shuttingDown: true }), 1_000_000, 60_000).healthy).toBe(
      false
    );
  });

  it('round-trips through the heartbeat file and drives the CLI exit code', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-'));
    const file = join(dir, 'heartbeat.json');
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(runHeartbeatCheck(60_000, file, 1_000_000)).toBe(1); // no file yet

      writeHeartbeat(file, healthy());
      expect(readHeartbeat(file)).toEqual(healthy());
      expect(runHeartbeatCheck(60_000, file, 1_010_000)).toBe(0);
      expect(runHeartbeatCheck(60_000, file, 2_000_000)).toBe(1); // stale
    } finally {
      stderr.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runJobOnce', () => {
  const makeStore = (): CompletionMarkerStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      get: async (key: string) => data.get(key) ?? null,
      set: async (key: string, value: string) => {
        data.set(key, value);
        return 'OK';
      },
    };
  };
  const job = { queueName: 'healthcare-queue', id: 'reminder-1', timestamp: 42 };

  it('skips a job that already completed (re-delivery after a crash)', async () => {
    const store = makeStore();
    const handler = jest.fn(async () => 'sent');

    await expect(runJobOnce(store, job, 60, handler)).resolves.toEqual({
      skipped: false,
      result: 'sent',
    });
    await expect(runJobOnce(store, job, 60, handler)).resolves.toEqual({ skipped: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('never marks a failed attempt, so BullMQ retries still run', async () => {
    const store = makeStore();
    await expect(
      runJobOnce(store, job, 60, async () => {
        throw new Error('smtp down');
      })
    ).rejects.toThrow('smtp down');
    expect(store.data.size).toBe(0);
  });

  it('treats a new job reusing the same id (new timestamp) as new', () => {
    expect(completionMarkerKey(job)).not.toBe(completionMarkerKey({ ...job, timestamp: 43 }));
  });

  it('fails open when the marker store is down', async () => {
    const store: CompletionMarkerStore = {
      get: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
    };
    await expect(runJobOnce(store, job, 60, async () => 'ran')).resolves.toEqual({
      skipped: false,
      result: 'ran',
    });
  });
});
