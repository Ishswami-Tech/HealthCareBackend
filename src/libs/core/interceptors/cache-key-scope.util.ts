/**
 * Pure helpers that decide WHOSE data a cache key addresses.
 *
 * Guards run before interceptors and a cache HIT replays a stored response without the handler
 * (and its ownership checks) ever running. A key is therefore derived from the authenticated
 * principal and the guard-validated clinic, never from caller-controlled params/query/body.
 *
 * Final templated key (built by HealthcareCacheInterceptor):
 *   `[clinic:<clinicId>:]<resolved template>:<handler>[:<actor segment>]:q-<32hex query digest>`
 *
 * Query digest rule (see {@link hashQuery}): cache-buster params (`_t`, `_`, `t`, `ts`,
 * `timestamp`, `nocache`, `cb`) are ignored so clients that append them keep their hit rate; a
 * request with more than 20 query values or a value longer than 200 characters is NOT cached
 * (rather than truncated, which would let two different filters share one entry).
 */

import { createHash } from 'node:crypto';

import { Role } from '@core/types/enums.types';
import type { CustomFastifyRequest } from '@core/types/infrastructure.types';

/**
 * The request as the interceptor sees it.
 *
 * `user` (JwtAuthGuard) and `clinicContext` (ClinicGuard, built from the validated X-Clinic-ID
 * header / JWT membership) are authoritative whenever present. Route params, query and body are
 * caller-controlled input and must never decide whose data a key addresses.
 */
export type ScopedRequest = CustomFastifyRequest & {
  readonly clinicContext?: { readonly clinicId?: string } | null;
};

/** Who is calling and for which clinic, as established by the guards. */
export interface ActorScope {
  readonly userId: string | undefined;
  readonly userRole: string | undefined;
  readonly clinicId: string | undefined;
}

/** Text a `{placeholder}` collapses to when nothing resolves it (never leaves a literal `{...}`). */
const UNRESOLVED_PLACEHOLDER = 'none';
/** Hex characters of the query-string digest appended to every templated key (128 bits). */
const QUERY_HASH_LENGTH = 32;
/** Most query values (array items count individually) a cacheable request may carry. */
export const MAX_QUERY_VALUES = 20;
/** Longest query parameter name / value (as text) a cacheable request may carry. */
export const MAX_QUERY_TEXT_LENGTH = 200;
/**
 * Query parameters clients append only to defeat caching. They never change the response, so they
 * are left out of the digest (matched case-insensitively).
 */
export const CACHE_BUSTER_PARAMS: ReadonlySet<string> = new Set([
  '_t',
  '_',
  't',
  'ts',
  'timestamp',
  'nocache',
  'cb',
]);
const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;
const USER_ID_PLACEHOLDER = '{userId}';
const USER_ROLE_PLACEHOLDER = '{userRole}';
/** Key segment prefixes: `u-<userId>` isolates one caller, `r-<ROLE>` isolates one staff role. */
const USER_SEGMENT_PREFIX = 'u-';
const ROLE_SEGMENT_PREFIX = 'r-';

export function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Identity and clinic come from the guards' output, never from params/query/body. */
export function resolveActorScope(request: ScopedRequest): ActorScope {
  const user = request.user;
  return {
    userId: asNonEmptyString(user?.sub) ?? asNonEmptyString(user?.id),
    userRole: asNonEmptyString(user?.role),
    clinicId: asNonEmptyString(request.clinicContext?.clinicId),
  };
}

function placeholderToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value) && value.every(item => ['string', 'number'].includes(typeof item))) {
    return value.join(',');
  }
  return UNRESOLVED_PLACEHOLDER;
}

const KEY_ENCODED_CHARACTERS = /[%{}:]/g;

/**
 * Percent-encodes the characters that carry meaning inside a key: `{`/`}` (a substituted value can
 * never reintroduce a `{placeholder}`), `:` (it separates key segments, so a value can never
 * alias a different key by smuggling in a segment boundary) and `%` (keeps the encoding
 * injective: `a%3Ab` and `a:b` stay different). Applied to every substituted value, the clinic
 * segment and the actor segment, for keys, tags and invalidation patterns alike.
 */
export function encodeKeyValue(value: string): string {
  return value.replace(
    KEY_ENCODED_CHARACTERS,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  );
}

/** `clinic:<clinicId>:` as it appears at the start of every clinic-scoped key. */
export function clinicKeyPrefix(clinicId: string): string {
  return `clinic:${encodeKeyValue(clinicId)}:`;
}

/**
 * Replaces EVERY `{placeholder}` (repeated ones included) in a single pass.
 * Placeholders without a value become {@link UNRESOLVED_PLACEHOLDER}.
 */
export function resolvePlaceholders(
  template: string,
  params: Readonly<Record<string, unknown>>,
  escapeValue: (value: string) => string = (value: string): string => value
): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match: string, name: string): string =>
    escapeValue(encodeKeyValue(placeholderToString(params[name])))
  );
}

/** Key order and nesting never change the digest; array order does (it can change the result). */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key): [string, unknown] => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function queryValueCount(value: unknown): number {
  return Array.isArray(value) ? Math.max(value.length, 1) : 1;
}

function queryValueTexts(value: unknown): string[] {
  const items: unknown[] = Array.isArray(value) ? value : [value];
  return items.map(item => (typeof item === 'string' ? item : String(JSON.stringify(item))));
}

/** The query without cache-buster params (they never change the response). */
export function withoutCacheBusters(
  query: Record<string, unknown> | undefined
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(query ?? {}).filter(([name]) => !CACHE_BUSTER_PARAMS.has(name.toLowerCase()))
  );
}

/**
 * `url` without its cache-buster query params; identical to `url` when it has none. Used by keys
 * that embed the raw URL.
 */
export function stripCacheBusterParams(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart < 0) return url;
  const kept = url
    .slice(queryStart + 1)
    .split('&')
    .filter(segment => {
      const name = segment.split('=')[0] ?? '';
      let decoded = name;
      try {
        decoded = decodeURIComponent(name);
      } catch {
        // keep the raw name; an undecodable name is never a known buster
      }
      return segment.length > 0 && !CACHE_BUSTER_PARAMS.has(decoded.toLowerCase());
    });
  return kept.length > 0
    ? `${url.slice(0, queryStart)}?${kept.join('&')}`
    : url.slice(0, queryStart);
}

/**
 * True when the query is small enough to be part of a cache key: at most
 * {@link MAX_QUERY_VALUES} values (each array item counts) and no name or value longer than
 * {@link MAX_QUERY_TEXT_LENGTH}. Cache-busters are not counted.
 *
 * Over the limit the request is not cached at all. Truncating instead would let two different
 * filters (e.g. two long `?ids=` lists) share one entry and serve the wrong data, and an
 * unbounded query space is what lets `?x=<random>` flood the cache with one-hit entries.
 */
export function isCacheableQuery(query: Record<string, unknown> | undefined): boolean {
  const relevant = withoutCacheBusters(query);
  const entries = Object.entries(relevant);
  const valueCount = entries.reduce((sum, [, value]) => sum + queryValueCount(value), 0);
  if (valueCount > MAX_QUERY_VALUES) return false;
  return entries.every(
    ([name, value]) =>
      name.length <= MAX_QUERY_TEXT_LENGTH &&
      queryValueTexts(value).every(text => text.length <= MAX_QUERY_TEXT_LENGTH)
  );
}

/**
 * 32-hex digest of the query, ignoring cache-busters. Callers must check
 * {@link isCacheableQuery} first; the digest of an over-limit query is still well defined but must
 * not be used as a cache key.
 */
export function hashQuery(query: Record<string, unknown> | undefined): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(withoutCacheBusters(query))))
    .digest('hex')
    .slice(0, QUERY_HASH_LENGTH);
}

/**
 * Values available to `{placeholder}` substitution in key, tag and invalidation-pattern
 * templates. Used by the read path (keys and tags) and the write path (tags and patterns) so
 * both resolve identically.
 *
 * - Route params identify the resource (e.g. GET /ehr/comprehensive/:userId is the PATIENT's
 *   record) and win over query/body values of the same name.
 * - Query values (and, on writes only, body values) can only fill filter-style placeholders
 *   such as {page} or {type}.
 * - `userId`, `userRole` and `clinicId` are identity: a route param that declares `userId` /
 *   `clinicId` keeps identifying its resource, otherwise they come from the authenticated
 *   principal (JwtAuthGuard / ClinicGuard). A query or body value can NEVER supply them, so
 *   `?userId=<victim>` or `?clinicId=<other clinic>` cannot address someone else's cache entry.
 */
export function buildTemplateParams(
  request: ScopedRequest,
  includeBody: boolean = false
): Record<string, unknown> {
  const actor = resolveActorScope(request);
  const routeParams = request.params ?? {};
  const body = includeBody && isRecord(request.body) ? request.body : {};
  return {
    ...body,
    ...(request.query ?? {}),
    ...routeParams,
    userId: asNonEmptyString(routeParams['userId']) ?? actor.userId,
    clinicId: asNonEmptyString(routeParams['clinicId']) ?? actor.clinicId,
    userRole: actor.userRole,
  };
}

function isPatientActor(actor: ActorScope): boolean {
  return actor.userRole?.toUpperCase() === Role.PATIENT;
}

/**
 * Segment that stops one caller's cached response from being replayed to a different caller
 * whose handler-level ownership/authorization check would never run on a hit.
 *
 * - PATIENT (and an authenticated caller with no role claim, fail-closed): `u-<userId>`, ALWAYS,
 *   even when the template has no `{userId}`. The only exception is a template whose `{userId}`
 *   already resolved to the caller themselves (the key then names them; a duplicate segment
 *   would be noise). A `{userId}` taken from a route param naming someone else still gets the
 *   segment, so a patient asking for another user's resource can never read an entry a
 *   clinician (or that user) created.
 * - Staff roles: `r-<ROLE>`, so a receptionist's response is never served to a doctor. Staff of
 *   the same role and clinic still share an entry. Skipped when the template has `{userRole}`.
 * - Unauthenticated requests: no segment (nothing to separate).
 *
 * @throws Error when the caller is a patient but the token carries no user id (the caller of
 *   this helper treats that as "do not cache").
 */
export function resolveActorKeySegment(
  template: string,
  params: Readonly<Record<string, unknown>>,
  actor: ActorScope
): string | undefined {
  if (isPatientActor(actor) || (!actor.userRole && actor.userId)) {
    if (!actor.userId) {
      throw new Error('Cannot build a patient cache key without an authenticated user id');
    }
    const keyNamesCaller =
      template.includes(USER_ID_PLACEHOLDER) && asNonEmptyString(params['userId']) === actor.userId;
    return keyNamesCaller ? undefined : `${USER_SEGMENT_PREFIX}${encodeKeyValue(actor.userId)}`;
  }
  if (!actor.userRole || template.includes(USER_ROLE_PLACEHOLDER)) return undefined;
  return `${ROLE_SEGMENT_PREFIX}${encodeKeyValue(actor.userRole)}`;
}

/**
 * Tags with `{placeholder}`s resolved exactly like keys and invalidation patterns. Shared by the
 * read path (tags registered with an entry) and the write path (tags invalidated after a
 * mutation) so both address the same tag strings. Tags never receive the query digest. `includeBody`
 * lets a write fill non-identity placeholders from the body.
 */
export function resolveTagTemplates(
  tags: readonly string[] | undefined,
  request: ScopedRequest,
  includeBody: boolean
): string[] {
  if (!tags || tags.length === 0) return [];
  try {
    const params = buildTemplateParams(request, includeBody);
    return tags.map(tag => resolvePlaceholders(tag, params));
  } catch {
    return [...tags];
  }
}
