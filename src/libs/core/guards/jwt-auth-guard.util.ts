/**
 * Pure decision helpers of JwtAuthGuard (throttle key, lockout gating, what counts as a failed
 * login). Kept free of the guard's dependencies so they can be unit tested directly; the guard
 * itself cannot be loaded by the local unit runner.
 */
import { UnauthorizedException } from '@nestjs/common';

/** Minimal shape of a verified JWT payload the helpers need. */
export interface VerifiedTokenPayload {
  readonly sub?: string | undefined;
  readonly [key: string]: unknown;
}

export interface AuthRateLimitKeyInput {
  /** User id (`sub`) of a token whose signature verified; undefined when there is none. */
  readonly userId?: string | undefined;
  /** Session (device) id of that token, see resolveVerifiedSessionId; undefined when unknown. */
  readonly sessionId?: string | undefined;
  readonly clientIp: string;
  readonly path: string;
}

const SESSION_ID_MAX_LENGTH = 128;

export interface LockoutCheckInput {
  readonly isProduction: boolean;
  readonly hasRateLimitService: boolean;
  /** True when the request carries a token whose signature verified. */
  readonly hasVerifiedToken: boolean;
  readonly path: string;
  readonly bypassPrefixes: readonly string[];
}

/**
 * verifyToken() messages that mean the credential itself was bad: a forged, malformed or
 * otherwise unverifiable token. Only these count towards the per-IP lockout.
 */
export const COUNTED_AUTH_FAILURE_MESSAGES: ReadonlySet<string> = new Set<string>([
  'Invalid token format',
  'Token validation failed',
  'Invalid token',
]);

/** The authenticated user id of a verified payload (`sub`, or the legacy `id` claim). */
export function resolveVerifiedUserId(payload: VerifiedTokenPayload | null): string | undefined {
  if (!payload) return undefined;
  const candidate = payload.sub || payload['id'];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

/**
 * The session (device) id of a verified request: the signed `sessionId` claim only. The
 * `X-Session-ID` header is client-controlled and the session it names is checked only later,
 * so keying the throttle on it would let a caller mint a fresh bucket per request.
 */
export function resolveVerifiedSessionId(payload: VerifiedTokenPayload | null): string | undefined {
  if (!payload) return undefined;
  const candidate = payload['sessionId'];
  if (typeof candidate !== 'string') return undefined;
  const trimmed = candidate.trim();
  return trimmed.length > 0 && trimmed.length <= SESSION_ID_MAX_LENGTH ? trimmed : undefined;
}

/**
 * Per-path request throttle key. Every web request reaches the API from the Next.js server's
 * IP, so an IP key would throttle all web users together: once a token verified the limit is
 * per user and, when known, per session so one login on several devices does not share a
 * bucket; only tokenless or unverifiable requests share the IP bucket.
 */
export function buildAuthRateLimitKey(input: AuthRateLimitKeyInput): string {
  if (!input.userId) {
    return `ip:${input.clientIp}:${input.path}`;
  }
  return input.sessionId
    ? `user:${input.userId}:${input.sessionId}:${input.path}`
    : `user:${input.userId}:${input.path}`;
}

/**
 * The per-IP lockout only guards unauthenticated attempts. A request whose token verified is
 * attributable to a user, so the shared IP must not be punished for it. The bypass prefixes
 * (profile completion, session recovery routes) stay reachable during a lockout.
 */
export function shouldCheckLockout(input: LockoutCheckInput): boolean {
  if (!input.isProduction || !input.hasRateLimitService || input.hasVerifiedToken) {
    return false;
  }
  return !input.bypassPrefixes.some(prefix => input.path.startsWith(prefix));
}

/**
 * Whether a guard failure is a genuine credential failure that should count towards the
 * lockout. Only an UnauthorizedException raised by token verification for a forged, malformed
 * or unverifiable token counts. Expired or revoked tokens, a missing token, session problems
 * of a verified user, ForbiddenException ('Profile Incomplete', RBAC, clinic) and request
 * validation errors never do.
 */
export function shouldCountFailedAuthAttempt(error: unknown): boolean {
  if (!(error instanceof UnauthorizedException)) {
    return false;
  }
  return COUNTED_AUTH_FAILURE_MESSAGES.has(error.message);
}
