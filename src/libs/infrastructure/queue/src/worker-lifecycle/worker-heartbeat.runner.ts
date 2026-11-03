/**
 * Periodic heartbeat writer for the worker process (see worker-heartbeat.ts for the format and
 * the checker). Each tick pings Redis/Dragonfly through every BullMQ worker's own connection
 * (`pingWorkerRedis`) and the database (`pingDatabase`), counts running workers, and writes the
 * file.
 */

import { writeHeartbeat, type WorkerHeartbeat } from './worker-heartbeat';

/** The part of a BullMQ `Worker` the heartbeat needs. */
export interface HeartbeatWorker {
  readonly name: string;
  isRunning(): boolean;
}

export interface WorkerHeartbeatOptions {
  readonly workers: readonly HeartbeatWorker[];
  /** Round-trips to Redis/Dragonfly on the given worker's connection; throws on failure. */
  readonly pingWorkerRedis: (worker: HeartbeatWorker) => Promise<void>;
  /** Resolves true when the database answered; may throw. */
  readonly pingDatabase: () => Promise<boolean>;
  readonly filePath: string;
  readonly intervalMs: number;
  readonly pingTimeoutMs: number;
  /** Called with a short reason when a tick could not write the file. */
  readonly onWriteError?: (message: string) => void;
}

export interface WorkerHeartbeatHandle {
  /** Writes one heartbeat now (also used by tests). */
  tick(): Promise<WorkerHeartbeat>;
  /** Stops the timer and writes a final `shuttingDown: true` heartbeat. */
  stop(): Promise<void>;
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function startWorkerHeartbeat(options: WorkerHeartbeatOptions): WorkerHeartbeatHandle {
  let shuttingDown = false;
  let timer: NodeJS.Timeout | null = null;

  const pingRedis = async (errors: string[]): Promise<boolean> => {
    if (options.workers.length === 0) {
      errors.push('no BullMQ workers registered');
      return false;
    }
    const results = await Promise.allSettled(
      options.workers.map(worker =>
        withTimeout(options.pingWorkerRedis(worker), options.pingTimeoutMs, 'redis ping')
      )
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    failures.forEach(failure => errors.push(`redis: ${errorText(failure.reason)}`));
    return failures.length === 0;
  };

  const pingDb = async (errors: string[]): Promise<boolean> => {
    try {
      return await withTimeout(options.pingDatabase(), options.pingTimeoutMs, 'db ping');
    } catch (error) {
      errors.push(`db: ${errorText(error)}`);
      return false;
    }
  };

  const tick = async (): Promise<WorkerHeartbeat> => {
    const errors: string[] = [];
    const [redisOk, dbOk] = await Promise.all([pingRedis(errors), pingDb(errors)]);
    const heartbeat: WorkerHeartbeat = {
      ts: Date.now(),
      pid: process.pid,
      redisOk,
      dbOk,
      runningWorkers: options.workers.filter(worker => worker.isRunning()).length,
      totalWorkers: options.workers.length,
      shuttingDown,
      ...(errors.length > 0 ? { errors } : {}),
    };
    try {
      writeHeartbeat(options.filePath, heartbeat);
    } catch (error) {
      options.onWriteError?.(`heartbeat write failed: ${errorText(error)}`);
    }
    return heartbeat;
  };

  const schedule = (): void => {
    timer = setTimeout(() => {
      void tick().finally(() => {
        if (!shuttingDown) schedule();
      });
    }, options.intervalMs);
    timer.unref?.();
  };

  void tick().finally(() => {
    if (!shuttingDown) schedule();
  });

  return {
    tick,
    stop: async (): Promise<void> => {
      shuttingDown = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await tick();
    },
  };
}
