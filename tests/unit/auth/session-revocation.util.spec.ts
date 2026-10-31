/**
 * Revocation-list TTL: a revoked session id must stay listed for as long as any refresh token that
 * names it can still verify, otherwise the refresh token works again once the entry lapses.
 */

import { describe, expect, it } from '@jest/globals';
import {
  parseJwtDurationSeconds,
  sessionRevocationTtlSeconds,
} from '@core/session/session-revocation.util';

const DAY = 24 * 60 * 60;

describe('parseJwtDurationSeconds', () => {
  it('parses jsonwebtoken duration strings', () => {
    expect(parseJwtDurationSeconds('7d', 1)).toBe(7 * DAY);
    expect(parseJwtDurationSeconds('15m', 1)).toBe(15 * 60);
    expect(parseJwtDurationSeconds('12h', 1)).toBe(12 * 60 * 60);
    expect(parseJwtDurationSeconds('2w', 1)).toBe(14 * DAY);
    expect(parseJwtDurationSeconds(' 3600 ', 1)).toBe(3600);
    expect(parseJwtDurationSeconds(3600, 1)).toBe(3600);
  });

  it('falls back on missing or malformed values', () => {
    expect(parseJwtDurationSeconds(undefined, 42)).toBe(42);
    expect(parseJwtDurationSeconds(null, 42)).toBe(42);
    expect(parseJwtDurationSeconds('', 42)).toBe(42);
    expect(parseJwtDurationSeconds('seven days', 42)).toBe(42);
    expect(parseJwtDurationSeconds('0d', 42)).toBe(42);
    expect(parseJwtDurationSeconds(-5, 42)).toBe(42);
  });
});

describe('sessionRevocationTtlSeconds', () => {
  it('outlives the refresh token when it is longer than the session timeout', () => {
    expect(
      sessionRevocationTtlSeconds({
        sessionTimeoutSeconds: DAY,
        remainingSessionSeconds: 3600,
        refreshTokenLifetimeSeconds: 7 * DAY,
      })
    ).toBe(7 * DAY);
  });

  it('keeps the remaining session lifetime when that is the longest', () => {
    expect(
      sessionRevocationTtlSeconds({
        sessionTimeoutSeconds: DAY,
        remainingSessionSeconds: 10 * DAY,
        refreshTokenLifetimeSeconds: 7 * DAY,
      })
    ).toBe(10 * DAY);
  });

  it('never returns a non-positive TTL', () => {
    expect(
      sessionRevocationTtlSeconds({
        sessionTimeoutSeconds: 0,
        remainingSessionSeconds: -100,
        refreshTokenLifetimeSeconds: 0,
      })
    ).toBe(1);
  });
});
