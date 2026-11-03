/**
 * Graceful BullMQ worker shutdown.
 *
 * `worker.close()` stops the worker fetching new jobs and resolves once the jobs it is running
 * have finished. A job that hangs would block shutdown forever (and the container would be
 * SIGKILLed mid-job anyway), so each close is bounded: after `timeoutMs` the worker is
 * force-closed. A force-closed job keeps its lock until it expires and is then picked up again by
 * the stall check, which is exactly what happened on EVERY deploy before workers were closed.
 *
 * Kept free of Nest/BullMQ imports so it can be unit tested with plain fakes.
 */

/** The part of a BullMQ `Worker` this helper needs. */
export interface ClosableWorker {
  readonly name: string;
  close(force?: boolean): Promise<void>;
  isRunning?(): boolean;
}

export type WorkerCloseOutcome = 'closed' | 'forced' | 'failed';

export interface WorkerCloseResult {
  readonly name: string;
  readonly outcome: WorkerCloseOutcome;
  readonly durationMs: number;
  readonly error?: string;
}

const TIMED_OUT = Symbol('timed-out');

async function closeOne(worker: ClosableWorker, timeoutMs: number): Promise<WorkerCloseResult> {
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>(resolve => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    timer.unref?.();
  });
  try {
    const result = await Promise.race([worker.close(false).then(() => 'done' as const), timeout]);
    if (result !== TIMED_OUT) {
      return { name: worker.name, outcome: 'closed', durationMs: Date.now() - startedAt };
    }
    await worker.close(true);
    return { name: worker.name, outcome: 'forced', durationMs: Date.now() - startedAt };
  } catch (error) {
    return {
      name: worker.name,
      outcome: 'failed',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Closes every worker in parallel (each bounded by `timeoutMs`). Never throws; the per-worker
 * outcome is returned for logging. Calling it twice is safe: BullMQ's close() is idempotent.
 */
export async function closeWorkersGracefully(
  workers: readonly ClosableWorker[],
  timeoutMs: number
): Promise<readonly WorkerCloseResult[]> {
  const unique = [...new Set(workers.filter(Boolean))];
  return Promise.all(unique.map(worker => closeOne(worker, timeoutMs)));
}
