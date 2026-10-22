/**
 * JwtAuthGuard session decision: a revoked / logged-out session is never allowed or restored.
 */

import { describe, expect, it } from '@jest/globals';
import { decideSessionAccess } from '@core/guards/jwt-auth-guard.util';

describe('decideSessionAccess', () => {
  it('allows an active, non-revoked session', () => {
    expect(decideSessionAccess({ hasActiveSession: true, revoked: false })).toBe('allow');
  });

  it('restores a session missing from a cold cache when it was never revoked', () => {
    expect(decideSessionAccess({ hasActiveSession: false, revoked: false })).toBe('restore');
  });

  it('rejects a revoked session that is gone from the store (logout)', () => {
    expect(decideSessionAccess({ hasActiveSession: false, revoked: true })).toBe('reject');
  });

  it('rejects a revoked session even when a stale copy is still readable', () => {
    expect(decideSessionAccess({ hasActiveSession: true, revoked: true })).toBe('reject');
  });
});
