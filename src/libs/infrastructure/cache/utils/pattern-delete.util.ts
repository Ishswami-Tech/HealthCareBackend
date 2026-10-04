/**
 * The ONE implementation of "delete every key matching a glob" shared by the Redis and Dragonfly
 * clients (and therefore by every provider, repository and service above them).
 *
 * Why a shared helper:
 *
 * - ioredis applies `keyPrefix` to the key ARGUMENTS of DEL/UNLINK but not to the glob of
 *   KEYS/SCAN, and KEYS/SCAN return the raw, already prefixed names. A pattern delete therefore
 *   has to prefix the glob, strip the prefix from the result and only then hand the names to
 *   DEL/UNLINK (which add it again). Getting this wrong makes every delete a silent no-op.
 * - KEYS blocks the server for the whole keyspace; SCAN walks it in bounded pages. SCAN is the
 *   default here, KEYS is only the fallback for a client without SCAN.
 * - Deletes are batched (UNLINK/DEL accept a bounded number of keys per call).
 * - Security namespaces are never deleted (see protected-keys.util.ts): the pattern is refused
 *   when it targets one, and the keys a broad glob resolves to are filtered before deletion.
 */

import type Redis from 'ioredis';

import { isProtectedKey, isProtectedPattern } from './protected-keys.util';

/** Keys requested per SCAN page. */
export const SCAN_PAGE_SIZE = 500;
/** Keys per UNLINK/DEL call. */
export const DELETE_BATCH_SIZE = 500;
/** Hard stop for a runaway cursor (about 50M keys at SCAN_PAGE_SIZE). */
const MAX_SCAN_PAGES = 100_000;

export interface PatternDeleteOptions {
  /** Admin tooling only: also delete keys in protected namespaces. */
  readonly allowProtected?: boolean;
}

/** The subset of the ioredis client a pattern delete needs. */
export type PatternDeleteClient = Pick<Redis, 'keys' | 'del'> &
  Partial<Pick<Redis, 'scan' | 'unlink'>>;

export interface PatternDeleteResult {
  readonly pattern: string;
  /** Keys actually deleted. */
  readonly deleted: number;
  /** Keys the glob matched and that were eligible for deletion. */
  readonly matched: number;
  /** Matching keys left alone because they live in a protected namespace. */
  readonly protectedSkipped: number;
  /** The pattern explicitly targets a protected namespace, so nothing was scanned or deleted. */
  readonly refused: boolean;
  /** The cache client was missing or not ready, so nothing was attempted. */
  readonly unavailable: boolean;
  readonly usedScan: boolean;
  /** Set when the scan or a delete failed part-way; `deleted` still counts what succeeded. */
  readonly error?: string;
}

/** The configured key prefix is literal text inside a glob, never a wildcard. */
export function escapeGlobLiteral(value: string): string {
  return value.replace(/[\\*?[\]]/g, match => `\\${match}`);
}

/** SCAN/KEYS return raw names; DEL re-applies `keyPrefix`, so hand it the logical names. */
export function stripKeyPrefix(keys: readonly string[], prefix: string): string[] {
  return keys.map(key => (prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key));
}

export function emptyPatternDeleteResult(
  pattern: string,
  overrides: Partial<PatternDeleteResult> = {}
): PatternDeleteResult {
  return {
    pattern,
    deleted: 0,
    matched: 0,
    protectedSkipped: 0,
    refused: false,
    unavailable: false,
    usedScan: false,
    ...overrides,
  };
}

interface BatchOutcome {
  readonly deleted: number;
  readonly matched: number;
  readonly protectedSkipped: number;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function removeKeys(client: PatternDeleteClient, logicalKeys: string[]): Promise<number> {
  return typeof client.unlink === 'function'
    ? client.unlink(...logicalKeys)
    : client.del(...logicalKeys);
}

/** Filters protected keys, strips the prefix and deletes the rest in bounded batches. */
async function deleteMatchedKeys(
  client: PatternDeleteClient,
  rawKeys: readonly string[],
  keyPrefix: string,
  allowProtected: boolean
): Promise<BatchOutcome> {
  const logicalKeys = stripKeyPrefix([...new Set(rawKeys)], keyPrefix);
  const eligible = allowProtected ? logicalKeys : logicalKeys.filter(key => !isProtectedKey(key));
  let deleted = 0;
  for (const batch of chunk(eligible, DELETE_BATCH_SIZE)) {
    deleted += await removeKeys(client, batch);
  }
  return {
    deleted,
    matched: eligible.length,
    protectedSkipped: logicalKeys.length - eligible.length,
  };
}

function addOutcome(total: BatchOutcome, next: BatchOutcome): BatchOutcome {
  return {
    deleted: total.deleted + next.deleted,
    matched: total.matched + next.matched,
    protectedSkipped: total.protectedSkipped + next.protectedSkipped,
  };
}

const NOTHING_DELETED: BatchOutcome = { deleted: 0, matched: 0, protectedSkipped: 0 };

/** Carries what a failed pattern delete had already removed. */
class PartialDeleteError extends Error {
  constructor(
    readonly reason: Error,
    readonly outcome: BatchOutcome
  ) {
    super(reason.message);
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Walks the keyspace with SCAN and deletes each page as it arrives, so memory stays bounded and a
 * mid-scan failure keeps what was already deleted. The error carries the outcome so far.
 */
async function scanAndDelete(
  client: PatternDeleteClient & Required<Pick<PatternDeleteClient, 'scan'>>,
  glob: string,
  keyPrefix: string,
  allowProtected: boolean
): Promise<BatchOutcome> {
  let total = NOTHING_DELETED;
  let cursor = '0';
  let pages = 0;
  try {
    do {
      const [nextCursor, rawKeys] = await client.scan(
        cursor,
        'MATCH',
        glob,
        'COUNT',
        SCAN_PAGE_SIZE
      );
      cursor = nextCursor;
      pages += 1;
      total = addOutcome(
        total,
        await deleteMatchedKeys(client, rawKeys, keyPrefix, allowProtected)
      );
    } while (cursor !== '0' && pages < MAX_SCAN_PAGES);
  } catch (error) {
    throw new PartialDeleteError(toError(error), total);
  }
  if (cursor !== '0') {
    throw new PartialDeleteError(new Error('SCAN page limit reached'), total);
  }
  return total;
}

function hasScan(
  client: PatternDeleteClient
): client is PatternDeleteClient & Required<Pick<PatternDeleteClient, 'scan'>> {
  return typeof client.scan === 'function';
}

/**
 * Deletes every key matching `pattern` (a glob over the LOGICAL, unprefixed key names).
 * Never throws: a failure is reported in `error` together with what was deleted before it.
 */
export async function deleteKeysByPattern(
  client: PatternDeleteClient,
  keyPrefix: string,
  pattern: string,
  options: PatternDeleteOptions = {}
): Promise<PatternDeleteResult> {
  const allowProtected = options.allowProtected === true;
  if (!allowProtected && isProtectedPattern(pattern)) {
    return emptyPatternDeleteResult(pattern, { refused: true });
  }

  const glob = `${escapeGlobLiteral(keyPrefix)}${pattern}`;
  const usedScan = hasScan(client);
  try {
    const outcome = hasScan(client)
      ? await scanAndDelete(client, glob, keyPrefix, allowProtected)
      : await deleteMatchedKeys(client, await client.keys(glob), keyPrefix, allowProtected);
    return emptyPatternDeleteResult(pattern, { ...outcome, usedScan });
  } catch (error) {
    const partial = error instanceof PartialDeleteError ? error : undefined;
    return emptyPatternDeleteResult(pattern, {
      ...(partial?.outcome ?? NOTHING_DELETED),
      usedScan,
      error: partial ? partial.reason.message : toError(error).message,
    });
  }
}

/**
 * Lists the keys matching `pattern` (a glob over the LOGICAL, unprefixed key names) and returns
 * them as LOGICAL names, so a caller can pass them straight back to get/lRange/del (ioredis adds
 * the `keyPrefix` again) without a double prefix.
 *
 * Same prefix handling as {@link deleteKeysByPattern}: the glob is prefixed (ioredis does not
 * prefix KEYS/SCAN patterns) and the prefix is stripped from the raw result. Walks the keyspace
 * with SCAN; KEYS is only the fallback for a client without SCAN. THROWS on failure.
 */
export async function listKeysByPattern(
  client: PatternDeleteClient,
  keyPrefix: string,
  pattern: string
): Promise<string[]> {
  const glob = `${escapeGlobLiteral(keyPrefix)}${pattern}`;
  if (!hasScan(client)) {
    return stripKeyPrefix([...new Set(await client.keys(glob))], keyPrefix);
  }

  const found = new Set<string>();
  let cursor = '0';
  let pages = 0;
  do {
    const [nextCursor, rawKeys] = await client.scan(cursor, 'MATCH', glob, 'COUNT', SCAN_PAGE_SIZE);
    cursor = nextCursor;
    pages += 1;
    for (const key of stripKeyPrefix(rawKeys, keyPrefix)) {
      found.add(key);
    }
  } while (cursor !== '0' && pages < MAX_SCAN_PAGES);
  if (cursor !== '0') {
    throw new Error('SCAN page limit reached');
  }
  return [...found];
}
