/**
 * Cheap, generic job idempotency: "this exact job already completed, don't run it again".
 *
 * A job can be delivered twice when the worker finished the handler but died (deploy, OOM)
 * before BullMQ moved it to `completed`: the lock expires, the stall check puts it back in
 * `wait`, and reminders / payment follow-ups were sent twice. After a successful run the worker
 * writes a short-lived marker (SET EX) on the BullMQ connection (the queue DB, never
 * evicted); a re-delivery of the same job finds the marker and is skipped.
 *
 * The marker key includes the job's creation timestamp, so a NEW job that reuses a producer
 * dedupe id later (same jobId, new timestamp) is never mistaken for the old one. Failed attempts
 * never write a marker, so BullMQ retries still run.
 *
 * Store failures fail OPEN (the job runs): losing deduplication is better than losing a job.
 */

/** The subset of BullMQ's Redis client (`worker.getBackend().client`) used here. */
export interface CompletionMarkerStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
}

export interface IdempotentJobRef {
  readonly queueName: string;
  readonly id?: string | undefined;
  readonly timestamp: number;
}

export type IdempotentRunOutcome<T> =
  { readonly skipped: true } | { readonly skipped: false; readonly result: T };

const MARKER_PREFIX = 'healthcare:jobdone';

/** `null` when the job has no id (nothing stable to dedupe on). */
export function completionMarkerKey(job: IdempotentJobRef): string | null {
  if (!job.id) return null;
  return `${MARKER_PREFIX}:${job.queueName}:${job.id}:${job.timestamp}`;
}

async function safeGet(store: CompletionMarkerStore, key: string): Promise<string | null> {
  try {
    return await store.get(key);
  } catch {
    return null;
  }
}

/**
 * Runs `handler` unless a completion marker for `job` exists, then records the marker.
 * Errors from `handler` propagate unchanged (so BullMQ retry/DLQ behaviour is untouched).
 */
export async function runJobOnce<T>(
  store: CompletionMarkerStore | null,
  job: IdempotentJobRef,
  ttlSeconds: number,
  handler: () => Promise<T>
): Promise<IdempotentRunOutcome<T>> {
  const key = store ? completionMarkerKey(job) : null;
  if (!store || !key) return { skipped: false, result: await handler() };

  if ((await safeGet(store, key)) !== null) return { skipped: true };

  const result = await handler();
  try {
    await store.set(key, String(Date.now()), { EX: ttlSeconds });
  } catch {
    // Fail open: the job already ran; at worst a re-delivery runs it again (old behaviour).
  }
  return { skipped: false, result };
}
