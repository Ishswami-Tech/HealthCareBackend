/**
 * PHI redaction for OpenTelemetry span attributes (used by `src/instrument/otel.ts`).
 *
 * - HTTP server spans: the http instrumentation only masks a short built-in list of query
 *   parameters, but this API takes phones, emails, names and search text in query strings.
 *   The whole query is replaced.
 * - HTTP client spans: `url.full` keeps the path only, so tokens or recipients in third-party
 *   query strings (e.g. WhatsApp/Graph API) never reach a span.
 * - Redis: keys embed identifiers (`otp:<email>`, `session:<id>`), so `db.statement` is the
 *   command name alone.
 */

import type { IncomingMessage, RequestOptions } from 'http';

export const REDACTED_QUERY = 'REDACTED';

type SpanUrlAttributes = Record<string, string>;

/** startIncomingSpanHook: overrides `url.query` when the request has one. */
export function incomingSpanUrlAttributes(request: IncomingMessage): SpanUrlAttributes {
  return request.url?.includes('?') ? { 'url.query': REDACTED_QUERY } : {};
}

/** startOutgoingSpanHook: overrides `url.full` with the query string removed. */
export function outgoingSpanUrlAttributes(options: RequestOptions): SpanUrlAttributes {
  const path = options.path ?? '/';
  const queryStart = path.indexOf('?');
  if (queryStart === -1) {
    return {};
  }
  const protocol = options.protocol ?? 'http:';
  const host = options.hostname ?? options.host ?? 'localhost';
  const port =
    options.port !== undefined && options.port !== null ? `:${String(options.port)}` : '';
  return { 'url.full': `${protocol}//${host}${port}${path.slice(0, queryStart)}` };
}

/** ioredis dbStatementSerializer: the command name only. */
export function redisStatementSerializer(
  cmdName: string,
  _cmdArgs: ReadonlyArray<unknown>
): string {
  return cmdName;
}
