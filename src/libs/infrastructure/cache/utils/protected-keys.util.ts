/**
 * Deny-list of cache namespaces that hold security or integrity state.
 *
 * Pattern deletes (`clearCache`, the HTTP cache interceptor's `@InvalidateCache`, service-level
 * `invalidateCacheByPattern`) exist to drop CACHED DATA. They must never be able to wipe:
 *
 * - brute-force counters and lockouts (`auth:lockout:*`, `auth:attempts:*`, `account_lock:*`, OTP
 *   attempt/cooldown/verified keys),
 * - sessions, session indexes and token blacklists / JWT bookkeeping,
 * - the PHI access audit trail and security event streams,
 * - rate limiter state, locks and replay/idempotency markers (`lock:*`, `payment-handoff:jti:*`,
 *   `webhook:processed:*`),
 * - cache bookkeeping itself (tag-index sets, stats, version) and BullMQ keys.
 *
 * A pattern delete is checked twice (see pattern-delete.util.ts): the PATTERN is refused when it
 * explicitly targets one of these namespaces, and every key a broader glob (`*`, `*<userId>*`)
 * resolves to is filtered against {@link isProtectedKey} before it is deleted. Only admin tooling
 * may bypass this, with an explicit `allowProtected` flag.
 */

import type { ICacheProvider } from '@core/types';

/**
 * Lower-case key prefixes (after the connection `keyPrefix` has been removed). Prefixes without a
 * trailing `:` deliberately cover the whole family (`session` -> `session:`, `sessions:`,
 * `session_data:`; `otp` -> `otp:`, `otp_attempts:`, ...).
 */
const PROTECTED_KEY_PREFIXES: readonly string[] = [
  // authentication state
  'auth:',
  'auth_',
  'jwt:',
  'blacklist:',
  'account_lock:',
  'otp',
  // sessions and their indexes
  'session',
  'user_sessions:',
  'clinic_sessions:',
  // security and compliance
  'security:',
  'phi:access',
  // rate limiting / throttling
  'rate_limit',
  'rate-limit',
  'ratelimit',
  'throttl',
  // locks, replay and idempotency markers
  'lock:',
  'refund:payment:',
  'payment-handoff:',
  'webhook:processed:',
  'video:rate:',
  'video:complete-reminder:',
  // cache and queue bookkeeping (tag-index sets, stats, version, bull queues)
  'cache:',
  'tag:',
  'system:',
  'bull:',
];

/** Keys written through the key factory carry a literal `healthcare:` ahead of the logical name. */
const KEY_FACTORY_PREFIX = 'healthcare:';

/** Both spellings of a logical key: as stored, and without the key-factory prefix. */
function keyForms(logicalKey: string): readonly string[] {
  const lower = logicalKey.toLowerCase();
  return lower.startsWith(KEY_FACTORY_PREFIX)
    ? [lower, lower.slice(KEY_FACTORY_PREFIX.length)]
    : [lower];
}

function startsWithProtectedPrefix(text: string): boolean {
  return PROTECTED_KEY_PREFIXES.some(prefix => text.startsWith(prefix));
}

/** True when a (logical, unprefixed) cache key belongs to a protected namespace. */
export function isProtectedKey(logicalKey: string): boolean {
  return keyForms(logicalKey).some(startsWithProtectedPrefix);
}

/**
 * The literal text a glob must match before its first wildcard (`*`, `?`, `[`). A backslash
 * escapes the next character, which then counts as literal text.
 */
export function literalGlobPrefix(pattern: string): string {
  let literal = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern.charAt(index);
    if (char === '*' || char === '?' || char === '[') break;
    if (char === '\\') {
      index += 1;
      literal += pattern.charAt(index);
    } else {
      literal += char;
    }
  }
  return literal;
}

/**
 * True when the glob EXPLICITLY targets a protected namespace (`auth:*`, `user_sessions:*`,
 * `session*`). Broad globs such as `*` or `*<id>*` return false here: they are allowed to run and
 * their result set is filtered key by key instead.
 */
export function isProtectedPattern(pattern: string): boolean {
  return keyForms(literalGlobPrefix(pattern)).some(startsWithProtectedPrefix);
}

/**
 * Capabilities the Redis and Dragonfly providers offer on top of `IAdvancedCacheProvider`.
 *
 * They are declared here (not on the shared interface) so a provider that does not implement
 * them, such as the no-op provider used when the cache is disabled, keeps working: callers
 * feature-detect with the guards below and fall back to the interface methods.
 */

/** Exact-key delete that THROWS on failure (the interface's `delMultiple` swallows errors). */
export interface StrictKeyDeleter {
  deleteKeysStrict(keys: readonly string[]): Promise<number>;
}

/** Raises a key's TTL to at least `seconds`; never shortens it. */
export interface ExpiryExtender {
  extendExpiry(key: string, seconds: number): Promise<number>;
}

/**
 * Pattern delete that also removes protected (security) namespaces. Admin tooling only: the
 * regular `clearByPattern` refuses those namespaces.
 */
export interface ProtectedPatternClearer {
  clearByPatternAllowProtected(pattern: string): Promise<number>;
}

export function canDeleteKeysStrictly(
  provider: ICacheProvider
): provider is ICacheProvider & StrictKeyDeleter {
  return 'deleteKeysStrict' in provider && typeof provider.deleteKeysStrict === 'function';
}

export function canExtendExpiry(
  provider: ICacheProvider
): provider is ICacheProvider & ExpiryExtender {
  return 'extendExpiry' in provider && typeof provider.extendExpiry === 'function';
}

export function canClearProtectedPatterns(
  provider: ICacheProvider
): provider is ICacheProvider & ProtectedPatternClearer {
  return (
    'clearByPatternAllowProtected' in provider &&
    typeof provider.clearByPatternAllowProtected === 'function'
  );
}
