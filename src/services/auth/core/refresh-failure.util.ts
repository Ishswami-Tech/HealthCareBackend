/**
 * Why a refresh-token exchange failed, derived from the raw error that jsonwebtoken or
 * JwtAuthService raised. Drives both the HTTP class the client receives and the log level:
 *
 * - `expired`   the refresh JWT is past its exp claim (client must log in again, 401)
 * - `revoked`   the token's jti is blacklisted (client must log in again, 401)
 * - `invalid`   signature / format / payload failure (client must log in again, 401)
 * - `unexpected` anything else, e.g. cache or database trouble (client should retry, 503)
 */
export type RefreshFailureKind = 'expired' | 'revoked' | 'invalid' | 'unexpected';

/** jsonwebtoken error classes that mean the token itself is bad (not merely expired). */
const INVALID_TOKEN_ERROR_NAMES: ReadonlySet<string> = new Set([
  'JsonWebTokenError',
  'NotBeforeError',
]);

export function classifyRefreshFailure(
  errorName: string,
  errorMessage: string
): RefreshFailureKind {
  if (errorName === 'TokenExpiredError') {
    return 'expired';
  }

  const message = (errorMessage || '').toLowerCase();
  if (message.includes('revoked') || message.includes('blacklist')) {
    return 'revoked';
  }

  if (
    INVALID_TOKEN_ERROR_NAMES.has(errorName) ||
    message.includes('jwt') ||
    message.includes('invalid token')
  ) {
    return 'invalid';
  }

  return 'unexpected';
}
