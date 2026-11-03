/**
 * `Idempotency-Key` support for payment-intent creation.
 *
 * A client (mobile on flaky 4G, a double tap) sends the same `Idempotency-Key` header when it
 * retries the same "open payment" request. The first response is stored per user + route +
 * resource + key for 24h and returned as-is for every retry, so a retry never opens a second
 * gateway order or invoice. A retry that arrives while the first request is still running gets a
 * 409 instead of running in parallel.
 */
import { createHash } from 'crypto';

export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
/** How long the in-flight marker of one request lives (well above a gateway round trip). */
export const IDEMPOTENCY_IN_FLIGHT_TTL_SECONDS = 60;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

const KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

export type IdempotencyKeyParse =
  { kind: 'absent' } | { kind: 'invalid' } | { kind: 'valid'; key: string };

/** Reads the header value (Fastify gives a string, or an array when repeated). */
export function parseIdempotencyKey(
  raw: string | string[] | undefined | null
): IdempotencyKeyParse {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || value.trim() === '') {
    return { kind: 'absent' };
  }
  const key = value.trim();
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH || !KEY_PATTERN.test(key)) {
    return { kind: 'invalid' };
  }
  return { kind: 'valid', key };
}

/** Cache key of the stored response; the client key is hashed (never stored raw). */
export function idempotencyCacheKey(args: {
  userId: string;
  route: string;
  resourceId: string;
  key: string;
}): string {
  const digest = createHash('sha256')
    .update([args.userId, args.route, args.resourceId, args.key].join('|'))
    .digest('hex');
  return `idem:payment-intent:${digest}`;
}

/** The stored response, parsed back (the cache may hand back the raw JSON string or an object). */
export function readStoredResponse<T>(stored: unknown): T | null {
  if (stored === null || stored === undefined) {
    return null;
  }
  if (typeof stored === 'string') {
    try {
      return JSON.parse(stored) as T;
    } catch {
      return null;
    }
  }
  return typeof stored === 'object' ? (stored as T) : null;
}
