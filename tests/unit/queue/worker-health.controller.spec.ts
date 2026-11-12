import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkerHealthController } from '../../../src/libs/infrastructure/queue/src/worker-lifecycle/worker-health.controller';
import {
  HEARTBEAT_FILE_ENV,
  writeHeartbeat,
  type WorkerHeartbeat,
} from '../../../src/libs/infrastructure/queue/src/worker-lifecycle/worker-heartbeat';

/**
 * The worker had no HTTP health endpoint: only the container healthcheck read its heartbeat file.
 * GET /health now returns that same verdict over HTTP.
 */

const dir = mkdtempSync(join(tmpdir(), 'worker-health-'));
const file = join(dir, 'heartbeat.json');
const savedEnv = process.env[HEARTBEAT_FILE_ENV];

function heartbeat(overrides: Partial<WorkerHeartbeat> = {}): WorkerHeartbeat {
  return {
    ts: Date.now(),
    pid: 7,
    redisOk: true,
    dbOk: true,
    runningWorkers: 1,
    totalWorkers: 1,
    shuttingDown: false,
    ...overrides,
  };
}

function callHealth(): { status: number; body: Record<string, unknown> } {
  const result = { status: 0, body: {} as Record<string, unknown> };
  const reply = {
    code(status: number) {
      result.status = status;
      return reply;
    },
    send(body: Record<string, unknown>) {
      result.body = body;
      return reply;
    },
  };
  new WorkerHealthController().getHealth(reply as never);
  return result;
}

afterEach(() => {
  if (savedEnv === undefined) delete process.env[HEARTBEAT_FILE_ENV];
  else process.env[HEARTBEAT_FILE_ENV] = savedEnv;
  rmSync(file, { force: true });
});

describe('Worker GET /health', () => {
  it('is 200 healthy when the running worker reports Redis, DB and a BullMQ worker up', () => {
    process.env[HEARTBEAT_FILE_ENV] = file;
    writeHeartbeat(file, heartbeat());

    const { status, body } = callHealth();

    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: 'healthy',
      service: 'worker',
      redisOk: true,
      dbOk: true,
      runningWorkers: 1,
    });
    expect(body).not.toHaveProperty('reasons');
  });

  it('is 503 with the reasons when the database ping fails', () => {
    process.env[HEARTBEAT_FILE_ENV] = file;
    writeHeartbeat(file, heartbeat({ dbOk: false }));

    const { status, body } = callHealth();

    expect(status).toBe(503);
    expect(body).toMatchObject({ status: 'unhealthy', reasons: ['database ping failed'] });
  });

  it('is 503 before the worker has written any heartbeat', () => {
    process.env[HEARTBEAT_FILE_ENV] = join(dir, 'missing.json');

    const { status, body } = callHealth();

    expect(status).toBe(503);
    expect(body).toMatchObject({ status: 'unhealthy', reasons: ['no heartbeat written yet'] });
  });
});
