/**
 * Refresh-token exchange and logout session decisions: a revoked / logged-out session can never
 * mint new tokens, and logout revokes the app session (never Fastify's cookie-session id).
 */

import { describe, expect, it } from '@jest/globals';
import {
  REFRESH_SESSION_REFUSALS,
  decideRefreshSessionAccess,
  pickLogoutSessionId,
} from '@services/auth/core/refresh-session.util';

const SID = 'a'.repeat(64);
const OTHER_SID = 'b'.repeat(64);

describe('decideRefreshSessionAccess', () => {
  const base = { sessionId: SID, belongsToAnotherUser: false };

  it('allows an active, non-revoked session', () => {
    expect(decideRefreshSessionAccess({ ...base, hasActiveSession: true, revoked: false })).toBe(
      'allow'
    );
  });

  it('allows a never-revoked session missing from a cold cache (guard restores it)', () => {
    expect(decideRefreshSessionAccess({ ...base, hasActiveSession: false, revoked: false })).toBe(
      'allow'
    );
  });

  it('rejects a logged-out / revoked session that is gone from the store', () => {
    expect(decideRefreshSessionAccess({ ...base, hasActiveSession: false, revoked: true })).toBe(
      'reject-revoked'
    );
  });

  it('rejects a revoked session even when a stale copy is still readable', () => {
    expect(decideRefreshSessionAccess({ ...base, hasActiveSession: true, revoked: true })).toBe(
      'reject-revoked'
    );
  });

  it('rejects a refresh token without a session claim', () => {
    expect(
      decideRefreshSessionAccess({
        sessionId: undefined,
        hasActiveSession: false,
        belongsToAnotherUser: false,
        revoked: false,
      })
    ).toBe('reject-no-session');
  });

  it("rejects a refresh token naming another user's session", () => {
    expect(
      decideRefreshSessionAccess({
        sessionId: SID,
        hasActiveSession: true,
        belongsToAnotherUser: true,
        revoked: false,
      })
    ).toBe('reject-mismatch');
  });

  it('has a distinct machine reason for every refusal', () => {
    const reasons = Object.values(REFRESH_SESSION_REFUSALS).map(refusal => refusal.reason);
    expect(new Set(reasons).size).toBe(reasons.length);
    expect(REFRESH_SESSION_REFUSALS['reject-revoked'].reason).toBe('session_revoked');
  });
});

describe('pickLogoutSessionId', () => {
  it('revokes the session of the authenticating token by default', () => {
    expect(
      pickLogoutSessionId({
        verifiedSessionId: SID,
        requestedSessionId: undefined,
        requestedIsOwn: false,
        serverSessionId: undefined,
      })
    ).toBe(SID);
  });

  it('honours a body session id that is the caller own session', () => {
    expect(
      pickLogoutSessionId({
        verifiedSessionId: SID,
        requestedSessionId: OTHER_SID,
        requestedIsOwn: true,
        serverSessionId: undefined,
      })
    ).toBe(OTHER_SID);
  });

  it("ignores a body session id of another user's session and logs out the current one", () => {
    expect(
      pickLogoutSessionId({
        verifiedSessionId: SID,
        requestedSessionId: OTHER_SID,
        requestedIsOwn: false,
        serverSessionId: undefined,
      })
    ).toBe(SID);
  });

  it('falls back to the server-stored app session id only when the token has none', () => {
    expect(
      pickLogoutSessionId({
        verifiedSessionId: undefined,
        requestedSessionId: undefined,
        requestedIsOwn: false,
        serverSessionId: OTHER_SID,
      })
    ).toBe(OTHER_SID);
    expect(
      pickLogoutSessionId({
        verifiedSessionId: undefined,
        requestedSessionId: '   ',
        requestedIsOwn: false,
        serverSessionId: undefined,
      })
    ).toBeUndefined();
  });
});
