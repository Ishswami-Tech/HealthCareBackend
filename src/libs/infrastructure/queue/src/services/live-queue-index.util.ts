/**
 * Per clinic / domain / IST day index of the live queue lists (pure, no Nest imports).
 *
 * The live lists are `queue:<domain>:<clinicId>:<ownerId>:<day>`. Finding a clinic's lists of a
 * day used a keyspace SCAN (`queue:<domain>:<clinicId>:*:<day>`) on every queue read, check-in and
 * per-minute reconcile. Instead every list write SADDs its key into one SET per clinic / domain /
 * day (same TTL as the lists) and readers SMEMBERS it. The SET lives under `queue-index:` so no
 * `queue:*` glob (pattern deletes, the remaining all-day searches) ever matches it.
 *
 * A SET without the backfill sentinel was never reconciled with the keyspace (lists written
 * before this index existed, or the index was lost): the reader falls back to the SCAN once and
 * stores what it found plus the sentinel, so the SCAN runs at most once per clinic / domain / day.
 */

/** Marks an index that has been backfilled from the keyspace (never a queue key). */
export const LIVE_QUEUE_INDEX_SENTINEL = '__backfilled__';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export interface LiveQueueKeyParts {
  readonly domain: string;
  readonly clinicId: string;
  readonly day: string;
}

export function liveQueueIndexKey(domain: string, clinicId: string, day: string): string {
  return `queue-index:${domain}:${clinicId}:${day}`;
}

/** The SCAN glob the index replaces (also its one-time fallback). */
export function liveQueueDayPattern(domain: string, clinicId: string, day: string): string {
  return `queue:${domain}:${clinicId}:*:${day}`;
}

/**
 * Domain / clinic / day of a live list key, or null for anything else. The owner id may itself
 * contain colons (`medicine-desk:<clinicId>`), so domain and clinic are read from the front and
 * the day from the end, the same way the `queue:<domain>:<clinicId>:*:<day>` glob matches.
 */
export function parseLiveQueueKey(queueKey: string): LiveQueueKeyParts | null {
  const parts = queueKey.split(':');
  if (parts.length < 5 || parts[0] !== 'queue') return null;
  const domain = parts[1] ?? '';
  const clinicId = parts[2] ?? '';
  const day = parts[parts.length - 1] ?? '';
  const owner = parts.slice(3, -1).join(':');
  if (!domain || !clinicId || !owner || !DAY_KEY.test(day)) return null;
  return { domain, clinicId, day };
}

export function isLiveQueueIndexBackfilled(members: readonly string[]): boolean {
  return members.includes(LIVE_QUEUE_INDEX_SENTINEL);
}

/** The queue keys of an index (sentinel removed, de-duplicated, stable order). */
export function liveQueueKeysOfIndex(members: readonly string[]): string[] {
  return [...new Set(members.filter(member => member !== LIVE_QUEUE_INDEX_SENTINEL))].sort();
}
