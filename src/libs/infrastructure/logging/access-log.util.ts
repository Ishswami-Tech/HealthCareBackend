/**
 * Access-log helpers (pure, no Nest / Fastify imports so they can be unit tested in isolation).
 *
 * - Request id: an incoming `x-request-id` is reused when it is a sane token, otherwise a fresh
 *   UUID is generated. The id is echoed back in the `x-request-id` response header and printed on
 *   every access-log line, so a client report ("request X took 8 s") maps to one log line.
 * - Access line: `METHOD url [status] 123ms rid=<id>`; requests slower than the threshold are
 *   logged at WARN with the matched route pattern so they can be grouped.
 */

import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

/** A request slower than this is logged at WARN (LOG-004). */
export const SLOW_REQUEST_THRESHOLD_MS = 500;

/**
 * Accepted incoming ids: letters, digits and `._:-`, 8-128 chars (UUIDs, ULIDs, trace ids).
 * Anything else (spaces, newlines, huge values) is replaced so a client cannot forge log lines.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** The request id for an incoming request: its own valid `x-request-id`, else a new UUID. */
export function resolveRequestId(
  incoming: string | readonly string[] | undefined,
  generate: () => string = randomUUID
): string {
  const candidate: string | undefined = typeof incoming === 'string' ? incoming : incoming?.[0];
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (SAFE_REQUEST_ID.test(trimmed)) return trimmed;
  }
  return generate();
}

export type AccessLogSeverity = 'INFO' | 'WARN' | 'ERROR';

/**
 * 5xx is ours: ERROR. 4xx is the client or a business rule saying "no" (expected traffic): WARN.
 * A successful but slow request is WARN too; everything else INFO.
 */
export function accessLogSeverity(
  statusCode: number,
  durationMs: number,
  slowThresholdMs: number = SLOW_REQUEST_THRESHOLD_MS
): AccessLogSeverity {
  if (statusCode >= 500) return 'ERROR';
  if (statusCode >= 400) return 'WARN';
  return durationMs > slowThresholdMs ? 'WARN' : 'INFO';
}

export function isSlowRequest(
  durationMs: number,
  slowThresholdMs: number = SLOW_REQUEST_THRESHOLD_MS
): boolean {
  return durationMs > slowThresholdMs;
}

/** Whole milliseconds, never negative (clock adjustments). */
export function toDurationMs(startMs: number, endMs: number): number {
  return Math.max(0, Math.round(endMs - startMs));
}

export interface AccessLogLineInput {
  readonly method: string;
  readonly url: string;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly requestId: string;
  /** Matched route pattern (e.g. /api/v1/appointments/:id), shown on slow lines. */
  readonly route?: string | undefined;
  readonly slowThresholdMs?: number | undefined;
}

/** `GET /api/v1/x [200] 42ms rid=abc`, plus ` SLOW route=/api/v1/x/:id` above the threshold. */
export function formatAccessLogLine(input: AccessLogLineInput): string {
  const base = `${input.method} ${input.url} [${input.statusCode}] ${input.durationMs}ms rid=${input.requestId}`;
  if (!isSlowRequest(input.durationMs, input.slowThresholdMs ?? SLOW_REQUEST_THRESHOLD_MS)) {
    return base;
  }
  return `${base} SLOW route=${input.route || input.url.split('?')[0]}`;
}
