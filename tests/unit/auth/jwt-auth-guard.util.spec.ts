import { describe, expect, it } from '@jest/globals';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import {
  COUNTED_AUTH_FAILURE_MESSAGES,
  buildAuthRateLimitKey,
  resolveVerifiedSessionId,
  resolveVerifiedUserId,
  shouldCheckLockout,
  shouldCountFailedAuthAttempt,
} from '../../../src/libs/core/guards/jwt-auth-guard.util';

const BYPASS = ['/api/v1/profile/completion', '/api/v1/user/', '/api/v1/appointments/'];

describe('resolveVerifiedUserId', () => {
  it('prefers sub, falls back to the legacy id claim and ignores anything else', () => {
    expect(resolveVerifiedUserId({ sub: 'u1' })).toBe('u1');
    expect(resolveVerifiedUserId({ id: 'u2' })).toBe('u2');
    expect(resolveVerifiedUserId({ sub: '', id: 'u3' })).toBe('u3');
    expect(resolveVerifiedUserId({ id: 42 })).toBeUndefined();
    expect(resolveVerifiedUserId({})).toBeUndefined();
    expect(resolveVerifiedUserId(null)).toBeUndefined();
  });
});

describe('resolveVerifiedSessionId', () => {
  it('uses only the signed sessionId claim, never a client header, and needs a verified token', () => {
    expect(resolveVerifiedSessionId({ sub: 'u1', sessionId: ' sess-1 ' })).toBe('sess-1');
    expect(resolveVerifiedSessionId({ sub: 'u1' })).toBeUndefined();
    expect(resolveVerifiedSessionId({ sub: 'u1', sessionId: '' })).toBeUndefined();
    expect(resolveVerifiedSessionId({ sub: 'u1', sessionId: 'x'.repeat(129) })).toBeUndefined();
    expect(resolveVerifiedSessionId({ sub: 'u1', sessionId: 42 })).toBeUndefined();
    expect(resolveVerifiedSessionId(null)).toBeUndefined();
  });
});

describe('buildAuthRateLimitKey', () => {
  it('keys a verified request by user so web users behind one proxy IP never share a bucket', () => {
    const a = buildAuthRateLimitKey({ userId: 'u1', clientIp: '10.0.0.5', path: '/api/v1/x' });
    const b = buildAuthRateLimitKey({ userId: 'u2', clientIp: '10.0.0.5', path: '/api/v1/x' });
    expect(a).toBe('user:u1:/api/v1/x');
    expect(b).toBe('user:u2:/api/v1/x');
    expect(a).not.toBe(b);
  });

  it('separates the devices of one login by session when the session id is known', () => {
    const phone = buildAuthRateLimitKey({
      userId: 'u1',
      sessionId: 'sess-phone',
      clientIp: '10.0.0.5',
      path: '/api/v1/x',
    });
    const laptop = buildAuthRateLimitKey({
      userId: 'u1',
      sessionId: 'sess-laptop',
      clientIp: '10.0.0.5',
      path: '/api/v1/x',
    });
    expect(phone).toBe('user:u1:sess-phone:/api/v1/x');
    expect(laptop).toBe('user:u1:sess-laptop:/api/v1/x');
    expect(phone).not.toBe(laptop);
    expect(
      buildAuthRateLimitKey({ sessionId: 'sess-1', clientIp: '10.0.0.5', path: '/api/v1/x' })
    ).toBe('ip:10.0.0.5:/api/v1/x');
  });

  it('keys an unauthenticated request by IP and keeps the limit per path', () => {
    expect(buildAuthRateLimitKey({ clientIp: '10.0.0.5', path: '/api/v1/x' })).toBe(
      'ip:10.0.0.5:/api/v1/x'
    );
    expect(buildAuthRateLimitKey({ userId: undefined, clientIp: '1.2.3.4', path: '/a' })).toBe(
      'ip:1.2.3.4:/a'
    );
    expect(buildAuthRateLimitKey({ userId: 'u1', clientIp: '1.2.3.4', path: '/a' })).not.toBe(
      buildAuthRateLimitKey({ userId: 'u1', clientIp: '1.2.3.4', path: '/b' })
    );
  });
});

describe('shouldCheckLockout', () => {
  const base = {
    isProduction: true,
    hasRateLimitService: true,
    hasVerifiedToken: false,
    path: '/api/v1/pharmacy/inventory',
    bypassPrefixes: BYPASS,
  };

  it('checks the IP lockout only for unauthenticated attempts in production', () => {
    expect(shouldCheckLockout(base)).toBe(true);
    expect(shouldCheckLockout({ ...base, hasVerifiedToken: true })).toBe(false);
    expect(shouldCheckLockout({ ...base, isProduction: false })).toBe(false);
    expect(shouldCheckLockout({ ...base, hasRateLimitService: false })).toBe(false);
  });

  it('keeps the existing bypass prefixes reachable during a lockout', () => {
    expect(shouldCheckLockout({ ...base, path: '/api/v1/profile/completion' })).toBe(false);
    expect(shouldCheckLockout({ ...base, path: '/api/v1/appointments/today' })).toBe(false);
    expect(shouldCheckLockout({ ...base, path: '/api/v1/appointmentsx' })).toBe(true);
  });
});

describe('shouldCountFailedAuthAttempt', () => {
  it('counts only a forged, malformed or unverifiable token', () => {
    for (const message of COUNTED_AUTH_FAILURE_MESSAGES) {
      expect(shouldCountFailedAuthAttempt(new UnauthorizedException(message))).toBe(true);
    }
    expect(shouldCountFailedAuthAttempt(new UnauthorizedException('Invalid token format'))).toBe(
      true
    );
  });

  it('never counts an expired, revoked or missing token nor a session problem', () => {
    for (const message of [
      'Token has expired',
      'Token has been revoked',
      'No token provided',
      'Invalid session',
      'Session ID is missing',
      'Account has been deactivated',
    ]) {
      expect(shouldCountFailedAuthAttempt(new UnauthorizedException(message))).toBe(false);
    }
  });

  it('never counts authorization, profile, clinic or request validation errors', () => {
    expect(
      shouldCountFailedAuthAttempt(
        new ForbiddenException({
          error: 'Profile Incomplete',
          message: 'Please complete your profile to access this feature.',
        })
      )
    ).toBe(false);
    expect(shouldCountFailedAuthAttempt(new ForbiddenException('Insufficient role'))).toBe(false);
    expect(shouldCountFailedAuthAttempt(new ForbiddenException('Clinic access denied'))).toBe(
      false
    );
    expect(
      shouldCountFailedAuthAttempt(new HttpException('Invalid origin', HttpStatus.FORBIDDEN))
    ).toBe(false);
    expect(
      shouldCountFailedAuthAttempt(
        new HttpException('Missing required headers: accept', HttpStatus.BAD_REQUEST)
      )
    ).toBe(false);
    expect(
      shouldCountFailedAuthAttempt(
        new HttpException({ message: 'Rate limit exceeded' }, HttpStatus.TOO_MANY_REQUESTS)
      )
    ).toBe(false);
    expect(shouldCountFailedAuthAttempt(new Error('Invalid token format'))).toBe(false);
    expect(shouldCountFailedAuthAttempt('Invalid token')).toBe(false);
    expect(shouldCountFailedAuthAttempt(undefined)).toBe(false);
  });
});
