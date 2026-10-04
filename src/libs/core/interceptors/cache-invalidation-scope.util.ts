/**
 * Decides which invalidation patterns a write request may run.
 *
 * `@InvalidateCache({ patterns })` is declared per route, but a pattern delete is global: a bare
 * `clinic:*`, `appointments:*` or `*:appointments` deletes every tenant's entries, and a write by
 * one clinic would then flush the whole platform's cache (a cache-stampede DoS). So every pattern
 * is reduced to what the caller is entitled to touch:
 *
 * - the CALLER'S CLINIC: the validated clinic (ClinicGuard) or, on controllers without
 *   ClinicGuard, the clinic named by the route (the handler already authorised it, because
 *   invalidation only runs after a successful response);
 * - the caller's / target user's own keys (`user:<id>:...`).
 *
 * Rules, applied to each resolved pattern (placeholder values are already glob-escaped):
 *
 * 1. It names a protected namespace (`auth:*`, `user_sessions:*`, ...): REFUSED.
 * 2. `clinic:<literal>:...`: kept when the literal is the caller's clinic, otherwise REFUSED.
 * 3. `clinic:<wildcard>...` (`clinic:*`, `clinic:*:appointments`): the wildcard clinic slot is
 *    rewritten to the caller's clinic, or REFUSED when there is none.
 * 4. `user:<literal id>:...`: kept as is, and also applied inside the caller's clinic because the
 *    HTTP cache stores user keys under `clinic:<id>:`.
 * 5. A pattern that already contains the caller's clinic id as a whole segment
 *    (`clinic_locations:<id>:*`): kept.
 * 6. Anything else (`appointments:*`, `*:appointments`, `*`): applied inside the caller's clinic
 *    only (`clinic:<id>:<pattern>`), or REFUSED when there is no clinic.
 */

import { encodeKeyValue, isRecord } from '@core/interceptors/cache-key-scope.util';
import { escapeGlobLiteral } from '@infrastructure/cache/utils/pattern-delete.util';
import { isProtectedPattern } from '@infrastructure/cache/utils/protected-keys.util';

export type PatternRefusalReason = 'protected-namespace' | 'foreign-clinic' | 'no-tenant-context';

export interface RefusedPattern {
  readonly pattern: string;
  readonly reason: PatternRefusalReason;
}

export interface PatternPlan {
  /** Patterns safe to run, de-duplicated, in declaration order. */
  readonly accepted: readonly string[];
  readonly refused: readonly RefusedPattern[];
}

/** Who a write may invalidate for. */
export interface InvalidationTenant {
  readonly clinicId: string | undefined;
}

const GLOB_METACHARACTERS = /[*?[\]]/;
const WILDCARD_CLINIC_PREFIX = 'clinic:';
const USER_PREFIX = 'user:';

/** Splits a glob on `:` separators that are not backslash-escaped. */
function splitSegments(pattern: string): string[] {
  const segments: string[] = [];
  let current = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern.charAt(index);
    if (char === '\\') {
      current += char + pattern.charAt(index + 1);
      index += 1;
    } else if (char === ':') {
      segments.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  segments.push(current);
  return segments;
}

/** True when the segment contains an UNESCAPED glob metacharacter. */
function isWildcardSegment(segment: string): boolean {
  return GLOB_METACHARACTERS.test(segment.replace(/\\./g, ''));
}

/** The clinic id exactly as it appears inside a resolved pattern (encoded, then glob-escaped). */
function clinicSegment(clinicId: string): string {
  return escapeGlobLiteral(encodeKeyValue(clinicId));
}

function planOne(
  pattern: string,
  clinicId: string | undefined
): { readonly patterns: readonly string[] } | { readonly refusal: PatternRefusalReason } {
  if (isProtectedPattern(pattern)) return { refusal: 'protected-namespace' };

  const segments = splitSegments(pattern);
  const ownSegment = clinicId ? clinicSegment(clinicId) : undefined;
  const clinicPrefix = ownSegment ? `${WILDCARD_CLINIC_PREFIX}${ownSegment}:` : undefined;

  if (pattern.startsWith(WILDCARD_CLINIC_PREFIX)) {
    const slot = segments[1] ?? '';
    if (!isWildcardSegment(slot)) {
      if (!ownSegment) return { refusal: 'no-tenant-context' };
      return slot === ownSegment ? { patterns: [pattern] } : { refusal: 'foreign-clinic' };
    }
    if (!clinicPrefix) return { refusal: 'no-tenant-context' };
    const rest = segments.slice(2).join(':');
    return { patterns: [rest ? `${clinicPrefix}${rest}` : `${clinicPrefix}*`] };
  }

  const userSlot = segments[1];
  if (
    pattern.startsWith(USER_PREFIX) &&
    segments.length > 2 &&
    userSlot !== undefined &&
    userSlot.length > 0 &&
    !isWildcardSegment(userSlot)
  ) {
    return { patterns: clinicPrefix ? [pattern, `${clinicPrefix}${pattern}`] : [pattern] };
  }

  if (ownSegment && segments.includes(ownSegment)) return { patterns: [pattern] };
  if (!clinicPrefix) return { refusal: 'no-tenant-context' };
  return { patterns: [`${clinicPrefix}${pattern}`] };
}

export function planInvalidationPatterns(
  resolvedPatterns: readonly string[],
  tenant: InvalidationTenant
): PatternPlan {
  const accepted = new Set<string>();
  const refused: RefusedPattern[] = [];
  for (const pattern of new Set(resolvedPatterns)) {
    const outcome = planOne(pattern, tenant.clinicId);
    if ('refusal' in outcome) {
      refused.push({ pattern, reason: outcome.refusal });
    } else {
      outcome.patterns.forEach(planned => accepted.add(planned));
    }
  }
  return { accepted: [...accepted], refused };
}

/** The route's `:clinicId`, when the route declares one. */
export function routeClinicId(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined;
  const value = params['clinicId'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
