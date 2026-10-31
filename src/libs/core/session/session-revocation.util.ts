/**
 * How long a revoked session id stays on the revocation list (pure, unit tested).
 *
 * The list is what stops a revoked session from coming back: JwtAuthGuard restores a session that
 * is missing from the store unless its id is listed, and the refresh-token exchange applies the
 * same rule. The entry therefore has to outlive every token that still names the session; a
 * refresh token lives JWT_REFRESH_EXPIRES_IN (7 days) while SESSION_TIMEOUT is one day, so keying
 * the TTL on the session timeout alone let a revoked session's refresh token work again after a day.
 */

const UNIT_SECONDS: Readonly<Record<string, number>> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
};

/** Seconds in a jsonwebtoken `expiresIn` value ('7d', '15m', '3600', 3600); fallback otherwise. */
export function parseJwtDurationSeconds(
  raw: string | number | undefined | null,
  fallbackSeconds: number
): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallbackSeconds;
  }
  if (typeof raw !== 'string') {
    return fallbackSeconds;
  }
  const match = /^(\d+)\s*([smhdw])?$/i.exec(raw.trim());
  if (!match || !match[1]) {
    return fallbackSeconds;
  }
  const amount = Number.parseInt(match[1], 10);
  const unit = (match[2] ?? 's').toLowerCase();
  const multiplier = UNIT_SECONDS[unit] ?? 1;
  const seconds = amount * multiplier;
  return seconds > 0 ? seconds : fallbackSeconds;
}

export interface RevocationTtlInput {
  readonly sessionTimeoutSeconds: number;
  /** Seconds until the stored session would have expired (0 or negative when unknown / past). */
  readonly remainingSessionSeconds: number;
  readonly refreshTokenLifetimeSeconds: number;
}

/** The longest of the three lifetimes, at least one second. */
export function sessionRevocationTtlSeconds(input: RevocationTtlInput): number {
  const candidates = [
    input.sessionTimeoutSeconds,
    input.remainingSessionSeconds,
    input.refreshTokenLifetimeSeconds,
  ].filter(value => Number.isFinite(value));
  return Math.max(1, Math.floor(Math.max(0, ...candidates)));
}
