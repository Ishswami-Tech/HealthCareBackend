import { createHash } from 'node:crypto';

import type { ExecutionContext } from '@nestjs/common';

import { canonicalize } from '@core/interceptors/cache-key-scope.util';

/**
 * Cache keys for the billing controller's HTTP response cache.
 *
 * HealthcareCacheInterceptor runs AFTER the guards but BEFORE the handler, and its
 * `keyTemplate` placeholders only see route params, the query string and the caller's id/role
 * (never the guard-validated clinic). With a template key a warm entry was served to any later
 * caller who passed the guards - skipping the service-level ownership/clinic checks - and
 * `{clinicId}` placeholders were never substituted, so every clinic shared one entry.
 *
 * Keys built here always carry the clinic the guards validated, the caller's role and (for
 * personal data) the caller's id, so a response cached for one requester can never be replayed
 * to another.
 */

type BillingCacheRequest = {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  user?: Record<string, unknown>;
  clinicContext?: { clinicId?: unknown } | null;
};

export interface BillingScopedCacheKeyOptions {
  /** Key the entry per caller (use for anything that is personal to the requester). */
  readonly perCaller?: boolean;
  /** Query string parameters that change the response and therefore belong in the key. */
  readonly queryKeys?: readonly string[];
}

const NONE = 'none';

/**
 * One request value as a key segment. Absent values are `none`; arrays and objects
 * (`?status=a&status=b`, `?filter[x]=1`) are hashed. They must never collapse to `none`: that is
 * the key of the UNFILTERED request, so a filtered response would be replayed to every caller
 * asking for the unfiltered one.
 */
function scalar(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && value !== null) {
    const digest = createHash('sha256')
      .update(JSON.stringify(canonicalize(value)))
      .digest('hex')
      .slice(0, 32);
    return `${Array.isArray(value) ? 'list' : 'obj'}-${digest}`;
  }
  return NONE;
}

function serializeParams(source: Record<string, unknown> | undefined): string {
  if (!source) {
    return '';
  }
  return Object.keys(source)
    .sort()
    .map(key => `${key}=${scalar(source[key])}`)
    .join('&');
}

export function buildBillingScopedCacheKey(
  prefix: string,
  request: BillingCacheRequest,
  handlerName: string,
  options: BillingScopedCacheKeyOptions = {}
): string {
  const clinicId = scalar(request.clinicContext?.clinicId);
  const role = scalar(request.user?.['role']);
  const caller = options.perCaller ? scalar(request.user?.['sub'] ?? request.user?.['id']) : '*';

  const query: Record<string, unknown> = {};
  for (const key of options.queryKeys ?? []) {
    query[key] = request.query?.[key];
  }

  return [
    prefix,
    `clinic=${clinicId}`,
    `role=${role}`,
    `caller=${caller}`,
    `params=${serializeParams(request.params)}`,
    `query=${serializeParams(query)}`,
    handlerName,
  ].join(':');
}

/**
 * `customKeyGenerator` for `@Cache(...)` on billing routes.
 */
export function billingScopedCacheKey(
  prefix: string,
  options: BillingScopedCacheKeyOptions = {}
): (context: unknown) => string {
  return (context: unknown): string => {
    const executionContext = context as ExecutionContext;
    const request = executionContext.switchToHttp().getRequest<BillingCacheRequest>();
    return buildBillingScopedCacheKey(prefix, request, executionContext.getHandler().name, options);
  };
}
