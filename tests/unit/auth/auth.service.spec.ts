/**
 * Unit tests for AuthService public API.
 *
 * AuthService has 15 constructor dependencies. These tests provide all of them as plain
 * mock objects so the service can be instantiated and its guard paths tested in isolation
 * (the full OTP and password flows have their own suites: otp.service, password.service,
 * session-routes).
 */

import { AuthService } from '@services/auth/auth.service';
import type { AuthTokens } from '@core/types';

type Deps = ConstructorParameters<typeof AuthService>;

/** Every HealthcareErrorsService factory returns a tagged Error so tests can assert on it. */
function createErrors(): Record<string, jest.Mock> {
  const names = [
    'validationError',
    'clinicNotFound',
    'userNotFound',
    'invalidCredentials',
    'accountLocked',
    'authenticationError',
    'tokenExpired',
    'serviceUnavailable',
    'otpInvalid',
    'rateLimitExceeded',
  ];
  return Object.fromEntries(
    names.map(name => [
      name,
      jest.fn((...args: unknown[]) => {
        const error = new Error(`${name}: ${args.filter(a => typeof a === 'string').join(' | ')}`);
        error.name = name;
        return error;
      }),
    ])
  );
}

function createHarness() {
  const databaseService = {
    executeHealthcareRead: jest.fn(),
    executeHealthcareWrite: jest.fn(),
    findClinicByIdSafe: jest.fn(),
    findUserByEmailForAuth: jest.fn().mockResolvedValue(null),
    findUserByEmailSafe: jest.fn().mockResolvedValue(null),
    findUsersSafe: jest.fn().mockResolvedValue([]),
  };
  const jwtService = { signAsync: jest.fn(), verifyAsync: jest.fn(), decode: jest.fn() };
  const configService = {
    get: jest.fn(),
    getEnv: jest.fn((_key: string, fallback?: unknown) => fallback),
    getEnvBoolean: jest.fn((_key: string, fallback = false) => fallback),
  };
  const cacheService = {
    cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(undefined),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  };
  const logging = { log: jest.fn().mockResolvedValue(undefined) };
  const eventService = { emit: jest.fn().mockResolvedValue(undefined) };
  const errors = createErrors();
  const sessionService = {
    createSession: jest.fn().mockResolvedValue({ sessionId: 'session-123' }),
    invalidateSession: jest.fn().mockResolvedValue(true),
  };
  const rbacService = {
    getUserRoles: jest.fn().mockResolvedValue([{ roleId: 'role-1' }, { roleId: 'role-2' }]),
    getRolePermissions: jest.fn().mockResolvedValue(['users:read', 'users:write']),
  };
  const jwtAuthService = {
    refreshEnhancedToken: jest.fn().mockResolvedValue({
      accessToken: 'refreshed-access',
      refreshToken: 'refreshed-refresh',
      expiresIn: 900,
      sessionId: 'session-789',
    } as AuthTokens),
  };
  const otpService = {
    verifyOtp: jest.fn().mockResolvedValue({ success: false, message: 'Invalid OTP' }),
    generateOtp: jest.fn().mockReturnValue('123456'),
    issueReviewLoginOtp: jest.fn().mockResolvedValue(null),
    sendOtpPhone: jest.fn().mockResolvedValue({ success: true, message: 'OTP sent successfully' }),
  };

  const service = new AuthService(
    databaseService as unknown as Deps[0],
    jwtService as unknown as Deps[1],
    configService as unknown as Deps[2],
    cacheService as unknown as Deps[3],
    logging as unknown as Deps[4],
    eventService as unknown as Deps[5],
    errors as unknown as Deps[6],
    {} as unknown as Deps[7],
    {} as unknown as Deps[8],
    sessionService as unknown as Deps[9],
    rbacService as unknown as Deps[10],
    jwtAuthService as unknown as Deps[11],
    {} as unknown as Deps[12],
    otpService as unknown as Deps[13],
    {} as unknown as Deps[14]
  );

  return {
    service,
    databaseService,
    cacheService,
    eventService,
    errors,
    sessionService,
    rbacService,
    jwtAuthService,
    otpService,
    configService,
  };
}

describe('AuthService', () => {
  describe('constructor', () => {
    it('reads the OTP debug flags from config', () => {
      const h = createHarness();

      expect(h.service).toBeDefined();
      expect(h.configService.getEnvBoolean).toHaveBeenCalledWith('ENABLE_OTP_DEBUG', false);
    });
  });

  describe('register', () => {
    it('rejects a body clinicId that mismatches the header', async () => {
      const h = createHarness();

      await expect(
        h.service.register(
          { email: 'test@example.com', password: 'SecurePass123!', clinicId: 'clinic-1' } as never,
          undefined,
          'clinic-2'
        )
      ).rejects.toThrow('Clinic ID mismatch');
      expect(h.errors['validationError']).toHaveBeenCalledWith(
        'clinicId',
        expect.stringContaining('mismatch'),
        'AuthService.register'
      );
    });
  });

  describe('login', () => {
    it('rejects an unknown email with invalid credentials and counts the attempt', async () => {
      const h = createHarness();

      await expect(
        h.service.login({ email: 'nobody@example.com', password: 'password' } as never, {})
      ).rejects.toThrow('invalidCredentials');
      expect(h.databaseService.findUserByEmailForAuth).toHaveBeenCalledWith('nobody@example.com');
      expect(h.cacheService.incr).toHaveBeenCalledWith('failed_login:nobody@example.com');
      expect(h.sessionService.createSession).not.toHaveBeenCalled();
    });

    it('refuses a locked account before looking the user up', async () => {
      const h = createHarness();
      const unlockAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      h.cacheService.get.mockImplementation(async (key: string) =>
        key === 'account_lock:locked@example.com' ? unlockAt : null
      );

      await expect(
        h.service.login({ email: 'locked@example.com', password: 'password' } as never, {})
      ).rejects.toThrow('accountLocked');
      expect(h.databaseService.findUserByEmailForAuth).not.toHaveBeenCalled();
    });

    it('clears an expired lock and continues', async () => {
      const h = createHarness();
      const unlockedAt = new Date(Date.now() - 60 * 1000).toISOString();
      h.cacheService.get.mockImplementation(async (key: string) =>
        key === 'account_lock:old@example.com' ? unlockedAt : null
      );

      await expect(
        h.service.login({ email: 'old@example.com', password: 'password' } as never, {})
      ).rejects.toThrow('invalidCredentials');
      expect(h.cacheService.del).toHaveBeenCalledWith('account_lock:old@example.com');
      expect(h.databaseService.findUserByEmailForAuth).toHaveBeenCalled();
    });

    it('rejects a user without a password', async () => {
      const h = createHarness();
      h.databaseService.findUserByEmailForAuth.mockResolvedValue({
        id: 'user-123',
        email: 'otp-only@example.com',
        password: '',
        role: 'PATIENT',
      });

      await expect(
        h.service.login({ email: 'otp-only@example.com', password: 'password' } as never, {})
      ).rejects.toThrow('invalidCredentials');
    });
  });

  describe('refreshToken', () => {
    it('delegates to the enhanced JWT refresh', async () => {
      const h = createHarness();

      const result = await h.service.refreshToken(
        { refreshToken: 'valid-refresh-token', deviceFingerprint: 'fp-1' } as never,
        { userAgent: 'ua', ipAddress: '10.0.0.1' }
      );

      expect(result.accessToken).toBe('refreshed-access');
      expect(h.jwtAuthService.refreshEnhancedToken).toHaveBeenCalledWith(
        'valid-refresh-token',
        'fp-1',
        'ua',
        '10.0.0.1',
        // 677e00c9: the refresh is refused unless the token's session is still live.
        expect.any(Function)
      );
    });

    it('requires a refresh token', async () => {
      const h = createHarness();

      // (The real factory returns a HealthcareError, which is rethrown as is; this plain Error
      // mock goes through the generic classification instead, so only assert the factory call.)
      await expect(h.service.refreshToken({ refreshToken: '' } as never)).rejects.toThrow();
      expect(h.errors['authenticationError']).toHaveBeenCalledWith(
        'Refresh token is required',
        'AuthService.refreshToken'
      );
      expect(h.jwtAuthService.refreshEnhancedToken).not.toHaveBeenCalled();
    });

    it('maps an expired refresh token to tokenExpired', async () => {
      const h = createHarness();
      const expired = new Error('jwt expired');
      expired.name = 'TokenExpiredError';
      h.jwtAuthService.refreshEnhancedToken.mockRejectedValue(expired);

      await expect(h.service.refreshToken({ refreshToken: 'old' } as never)).rejects.toThrow(
        'tokenExpired'
      );
    });

    it('maps a revoked refresh token to an authentication error', async () => {
      const h = createHarness();
      h.jwtAuthService.refreshEnhancedToken.mockRejectedValue(new Error('Token has been revoked'));

      await expect(h.service.refreshToken({ refreshToken: 'revoked' } as never)).rejects.toThrow(
        'revoked'
      );
    });

    it('maps an infrastructure failure to 503 so the client keeps its session', async () => {
      const h = createHarness();
      h.jwtAuthService.refreshEnhancedToken.mockRejectedValue(new Error('ECONNRESET'));

      await expect(h.service.refreshToken({ refreshToken: 'any' } as never)).rejects.toThrow(
        'serviceUnavailable'
      );
    });
  });

  describe('logout', () => {
    it('invalidates the session and emits user.logged_out', async () => {
      const h = createHarness();

      const result = await h.service.logout('session-123');

      expect(result.success).toBe(true);
      expect(h.sessionService.invalidateSession).toHaveBeenCalledWith('session-123');
      expect(h.eventService.emit).toHaveBeenCalledWith('user.logged_out', {
        sessionId: 'session-123',
      });
    });

    it('still succeeds when the session store is unavailable', async () => {
      const h = createHarness();
      h.sessionService.invalidateSession.mockRejectedValue(new Error('cache down'));

      await expect(h.service.logout('session-123')).resolves.toMatchObject({ success: true });
    });
  });

  describe('requestOtp', () => {
    it('answers a concurrent request without sending a second OTP', async () => {
      const h = createHarness();
      h.cacheService.acquireLock.mockResolvedValue(false);

      const result = await h.service.requestOtp({
        identifier: 'Test@Example.com ',
        clinicId: 'clinic-1',
      } as never);

      expect(result.success).toBe(false);
      expect(h.cacheService.acquireLock).toHaveBeenCalledWith(
        'otp_request_lock:test@example.com',
        8,
        expect.any(String)
      );
      expect(h.otpService.generateOtp).not.toHaveBeenCalled();
    });

    it('requires a clinic and releases the lock', async () => {
      const h = createHarness();

      await expect(
        h.service.requestOtp({ identifier: 'test@example.com' } as never)
      ).rejects.toThrow('Clinic ID is required for OTP requests');
      expect(h.cacheService.releaseLock).toHaveBeenCalledWith('otp_request_lock:test@example.com');
    });

    describe('review login', () => {
      const reviewPhone = '+919000000001';
      const issued = { success: true, message: 'OTP sent successfully' };
      const request = (h: ReturnType<typeof createHarness>) =>
        h.service.requestOtp({ identifier: reviewPhone, clinicId: 'clinic-1' } as never);

      it('sends the normal OTP when the number is not the review number', async () => {
        const h = createHarness();

        await expect(request(h)).resolves.toMatchObject({ success: true });

        expect(h.otpService.issueReviewLoginOtp).toHaveBeenCalledWith(reviewPhone);
        expect(h.otpService.sendOtpPhone).toHaveBeenCalledWith(
          reviewPhone,
          'login',
          'clinic-1',
          '123456'
        );
      });

      it('issues the review code without delivery for a new number', async () => {
        const h = createHarness();
        h.otpService.issueReviewLoginOtp.mockResolvedValue(issued);

        await expect(request(h)).resolves.toMatchObject({ success: true });

        expect(h.otpService.sendOtpPhone).not.toHaveBeenCalled();
      });

      it('issues the review code without delivery for an existing patient', async () => {
        const h = createHarness();
        h.databaseService.findUsersSafe.mockResolvedValue([
          { id: 'user-1', role: 'PATIENT', phone: reviewPhone },
        ]);
        h.otpService.issueReviewLoginOtp.mockResolvedValue(issued);

        await expect(request(h)).resolves.toMatchObject({ success: true });

        expect(h.otpService.sendOtpPhone).not.toHaveBeenCalled();
      });

      it.each(['DOCTOR', 'CLINIC_ADMIN', 'SUPER_ADMIN'])(
        'never gives the review code to a %s account',
        async role => {
          const h = createHarness();
          h.databaseService.findUsersSafe.mockResolvedValue([
            { id: 'user-1', role, phone: reviewPhone },
          ]);
          h.otpService.issueReviewLoginOtp.mockResolvedValue(issued);

          await expect(request(h)).resolves.toMatchObject({ success: true });

          expect(h.otpService.issueReviewLoginOtp).not.toHaveBeenCalled();
          expect(h.otpService.sendOtpPhone).toHaveBeenCalled();
        }
      );

      it('surfaces a locked-out review number as rate limited', async () => {
        const h = createHarness();
        h.otpService.issueReviewLoginOtp.mockResolvedValue({
          success: false,
          message: 'Too many incorrect codes',
          rateLimited: true,
        });

        await expect(request(h)).rejects.toThrow('rateLimitExceeded');

        expect(h.otpService.sendOtpPhone).not.toHaveBeenCalled();
      });
    });
  });

  describe('verifyOtp', () => {
    it('rejects a wrong code before touching any user', async () => {
      const h = createHarness();

      await expect(
        h.service.verifyOtp({ identifier: 'test@example.com', otp: '000000' } as never)
      ).rejects.toThrow('otpInvalid');
      expect(h.otpService.verifyOtp).toHaveBeenCalledWith('test@example.com', '000000');
      expect(h.databaseService.findUserByEmailSafe).not.toHaveBeenCalled();
    });

    it('surfaces the per-identifier lockout as a rate limit', async () => {
      const h = createHarness();
      h.otpService.verifyOtp.mockResolvedValue({
        success: false,
        rateLimited: true,
        message: 'Too many attempts',
      });

      await expect(
        h.service.verifyOtp({ identifier: 'test@example.com', otp: '000000' } as never)
      ).rejects.toThrow('rateLimitExceeded');
    });
  });

  describe('getUserPermissions', () => {
    it('resolves the permissions of the user roles in the clinic, cached per user and clinic', async () => {
      const h = createHarness();

      const result = await h.service.getUserPermissions('user-123', 'clinic-1');

      expect(result).toEqual(['users:read', 'users:write']);
      expect(h.rbacService.getUserRoles).toHaveBeenCalledWith('user-123', 'clinic-1');
      expect(h.rbacService.getRolePermissions).toHaveBeenCalledWith(['role-1', 'role-2']);
      expect(h.cacheService.cache).toHaveBeenCalledWith(
        'user:user-123:clinic:clinic-1:permissions',
        expect.any(Function),
        expect.objectContaining({ tags: expect.arrayContaining(['user:user-123']) })
      );
    });
  });
});
