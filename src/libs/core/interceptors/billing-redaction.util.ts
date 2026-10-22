/**
 * Billing blindness for clinical roles.
 *
 * Product rule: the doctor and the assistant doctor NEVER see billing amounts (fees, prices,
 * totals, revenue, payouts ...). The clinic admin owns billing; reception collects at the desk.
 * The UI hides these values, but hiding is not enforcement - this module strips them from every
 * JSON response the server sends to those two roles, whatever endpoint produced it.
 *
 * Matching is by key TOKENS (camelCase / snake_case words), never by substring, so `consultationFee`
 * and `totalAmount` are stripped while `feedback`, `total` (a page count) or `dosage` are not.
 */

import { StreamableFile } from '@nestjs/common';

/** Roles that must never receive billing amounts. */
export const BILLING_BLIND_ROLES: ReadonlySet<string> = new Set(['DOCTOR', 'ASSISTANT_DOCTOR']);

/**
 * Product switch: the doctor's own earnings / payout screens expose billing amounts, so they are
 * closed to the doctor while this is false. Flip only if the owner decides the doctor may see
 * their own payout figures (the interceptor would still strip every other amount).
 */
export const DOCTOR_SELF_EARNINGS_VISIBLE = false;

/** Words that make a key a billing amount. */
const BILLING_KEY_TOKENS: ReadonlySet<string> = new Set([
  'amount',
  'amounts',
  'price',
  'prices',
  'pricing',
  'mrp',
  'fee',
  'fees',
  'cost',
  'costs',
  'revenue',
  'earning',
  'earnings',
  'payout',
  'payouts',
  'tax',
  'discount',
  'subtotal',
  'surcharge',
  'refund',
  'outstanding',
  'paise',
  'charge',
  'charges',
  'billed',
  'payable',
  'gst',
  'commission',
  'balance',
]);

/**
 * Money words that are also everyday lab / logistics words (`sampleCollectedAt`, `collectionDate`).
 * They mark a billing key only when the key is not a timestamp and not about a sample / specimen.
 */
const AMBIGUOUS_KEY_TOKENS: ReadonlySet<string> = new Set([
  'collected',
  'collection',
  'collections',
]);

/** Key context that makes an ambiguous token non-billing. */
const NON_BILLING_CONTEXT_TOKENS: ReadonlySet<string> = new Set(['sample', 'samples', 'specimen']);
const TIMESTAMP_SUFFIX = /(At|Date|Time|On|_at|_date|_time|_on)$/;

/**
 * Whole-key matches (lower-cased) for money fields whose single word would be too generic to strip as a
 * token (`total` is also a page count, `due` reads like a flag).
 */
const BILLING_EXACT_KEYS: ReadonlySet<string> = new Set([
  'linetotal',
  'grandtotal',
  'totaldue',
  'balancedue',
  'netpayable',
]);

const TOKEN_SPLIT = /[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/;

const tokenCache = new Map<string, boolean>();

function classifyKey(key: string): boolean {
  if (BILLING_EXACT_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
    return true;
  }
  const tokens = key
    .split(TOKEN_SPLIT)
    .filter(token => token.length > 0)
    .map(token => token.toLowerCase());
  // `doctorInCharge` / `in_charge` is a person, not a charge.
  const isMoneyToken = (token: string, index: number): boolean =>
    BILLING_KEY_TOKENS.has(token) &&
    !((token === 'charge' || token === 'charges') && tokens[index - 1] === 'in');
  if (tokens.some(isMoneyToken)) {
    return true;
  }
  if (!tokens.some(token => AMBIGUOUS_KEY_TOKENS.has(token))) {
    return false;
  }
  return !TIMESTAMP_SUFFIX.test(key) && !tokens.some(t => NON_BILLING_CONTEXT_TOKENS.has(t));
}

export function isBillingKey(key: string): boolean {
  const cached = tokenCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const result = classifyKey(key);
  if (tokenCache.size < 2000) {
    tokenCache.set(key, result);
  }
  return result;
}

export function isBillingBlindRole(role: unknown): boolean {
  return typeof role === 'string' && BILLING_BLIND_ROLES.has(role.trim().toUpperCase());
}

/** Values that are not JSON shapes and must reach the serializer as they are. */
function isOpaqueValue(value: object): boolean {
  if (value instanceof Date || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return true;
  }
  if (value instanceof StreamableFile) {
    return true;
  }
  const maybeStream = value as { pipe?: unknown; getStream?: unknown };
  return typeof maybeStream.pipe === 'function' || typeof maybeStream.getStream === 'function';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep copy of `value` without the keys `isBlocked` rejects (JSON shapes only: Dates, Buffers and
 * other class instances are returned as they are; cycles and absurd depth are cut). Shared by the
 * billing redaction below and the reception clinical redaction.
 */
export function stripKeysDeep<T>(value: T, isBlocked: (key: string) => boolean): T {
  return strip(value, new WeakSet<object>(), 0, isBlocked) as T;
}

function strip(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
  isBlocked: (key: string) => boolean
): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth > 40) {
    return undefined;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return undefined;
    }
    seen.add(value);
    const out = value.map(item => strip(item, seen, depth + 1, isBlocked));
    seen.delete(value);
    return out;
  }
  if (!isPlainObject(value)) {
    // Dates, binary payloads (Buffer / Uint8Array / ArrayBuffer) and streams (StreamableFile, Node
    // streams) reach the serializer untouched; other class instances are redacted via their toJSON.
    if (isOpaqueValue(value)) {
      return value;
    }
    const withToJson = value as { toJSON?: () => unknown };
    if (typeof withToJson.toJSON === 'function') {
      try {
        return strip(withToJson.toJSON(), seen, depth + 1, isBlocked);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isBlocked(key)) {
      continue;
    }
    out[key] = strip(child, seen, depth + 1, isBlocked);
  }
  seen.delete(value);
  return out;
}

/** Deep copy of `value` without any billing-amount key. Non-JSON values are returned as they are. */
export function stripBillingFields<T>(value: T): T {
  return stripKeysDeep(value, isBillingKey);
}
