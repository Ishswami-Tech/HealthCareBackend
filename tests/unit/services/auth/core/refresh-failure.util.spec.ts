import { describe, expect, it } from '@jest/globals';
import { classifyRefreshFailure } from '@services/auth/core/refresh-failure.util';

describe('classifyRefreshFailure', () => {
  it('treats an expired refresh JWT as expired', () => {
    expect(classifyRefreshFailure('TokenExpiredError', 'jwt expired')).toBe('expired');
  });

  it('treats a blacklisted token as revoked', () => {
    expect(classifyRefreshFailure('Error', 'Token has been revoked')).toBe('revoked');
  });

  it('treats signature, format and payload failures as invalid', () => {
    expect(classifyRefreshFailure('JsonWebTokenError', 'invalid signature')).toBe('invalid');
    expect(classifyRefreshFailure('JsonWebTokenError', 'jwt malformed')).toBe('invalid');
    expect(classifyRefreshFailure('NotBeforeError', 'jwt not active')).toBe('invalid');
    expect(classifyRefreshFailure('Error', 'Invalid token payload')).toBe('invalid');
  });

  it('treats infrastructure errors as unexpected so the client retries instead of logging out', () => {
    expect(classifyRefreshFailure('Error', 'Cache service not ready')).toBe('unexpected');
    expect(classifyRefreshFailure('UnknownError', '')).toBe('unexpected');
  });
});
