/**
 * Session decisions of the refresh-token exchange and of logout, kept free of Nest dependencies
 * so they can be unit tested directly (AuthService itself cannot be loaded by the local runner).
 *
 * The refresh exchange applies the SAME session rule JwtAuthGuard applies to every request
 * (decideSessionAccess): a session that was revoked (logout, DELETE /auth/sessions/:id, session
 * limit eviction, expiry detected on read) can no longer mint tokens, while a session that is
 * merely missing from a cold cache and was never revoked stays usable, exactly like the guard
 * restores it on the next request.
 */
import { decideSessionAccess } from '@core/guards/jwt-auth-guard.util';

/** Outcome of the session check made before a refresh token is exchanged. */
export type RefreshSessionDecision =
  'allow' | 'reject-no-session' | 'reject-revoked' | 'reject-mismatch';

export interface RefreshSessionState {
  /** Signed `sessionId` claim of the verified refresh token (undefined when absent). */
  readonly sessionId: string | undefined;
  /** An active, unexpired, non-revoked session is stored under that id. */
  readonly hasActiveSession: boolean;
  /** The stored session belongs to a different user than the token's `sub`. */
  readonly belongsToAnotherUser: boolean;
  /** The id is on the session revocation list. */
  readonly revoked: boolean;
}

export function decideRefreshSessionAccess(state: RefreshSessionState): RefreshSessionDecision {
  if (!state.sessionId) {
    return 'reject-no-session';
  }
  if (state.belongsToAnotherUser) {
    return 'reject-mismatch';
  }
  const access = decideSessionAccess({
    hasActiveSession: state.hasActiveSession,
    revoked: state.revoked,
  });
  return access === 'reject' ? 'reject-revoked' : 'allow';
}

/** Client-facing message and machine reason for each refused refresh (all are 401). */
export const REFRESH_SESSION_REFUSALS: Readonly<
  Record<
    Exclude<RefreshSessionDecision, 'allow'>,
    { readonly reason: string; readonly message: string }
  >
> = {
  'reject-revoked': {
    reason: 'session_revoked',
    message: 'Session has been revoked. Please log in again.',
  },
  'reject-no-session': {
    reason: 'session_missing',
    message: 'Refresh token is not bound to a session. Please log in again.',
  },
  'reject-mismatch': {
    reason: 'session_mismatch',
    message: 'Session is not valid for this token. Please log in again.',
  },
};

export interface LogoutSessionInput {
  /** Signed `sessionId` claim of the access token that authenticated the logout. */
  readonly verifiedSessionId: string | undefined;
  /** `sessionId` the client named in the logout body, if any. */
  readonly requestedSessionId: string | undefined;
  /** True when the requested session is stored and belongs to the caller. */
  readonly requestedIsOwn: boolean;
  /** App session id the server itself stored on the Fastify session, if any. */
  readonly serverSessionId: string | undefined;
}

/**
 * Which app session a logout revokes. Fastify's own `session.sessionId` (the cookie session id)
 * is NOT an app session id and is never used: revoking it left the real session, and its refresh
 * token, alive. A session named in the body is honoured only when it is the caller's own; anything
 * else falls back to the session of the token that authenticated the call.
 */
export function pickLogoutSessionId(input: LogoutSessionInput): string | undefined {
  const requested = input.requestedSessionId?.trim();
  if (requested && (requested === input.verifiedSessionId || input.requestedIsOwn)) {
    return requested;
  }
  return input.verifiedSessionId || input.serverSessionId || undefined;
}
