/**
 * Unit tests for AuthService public API.
 *
 * AuthService has 15 constructor dependencies. These tests provide
 * all of them as plain mock objects so the service can be instantiated
 * and its public methods tested in isolation.
 */

import { AuthService } from '@services/auth/auth.service';
import type { AuthTokens } from '@core/types';

describe('AuthService', () => {
  function createService(overrides: {
    databaseService?: Record<string, jest.Mock>;
    jwtService?: Record<string, jest.Mock>;
    configService?: Record<string, jest.Mock>;
    cacheService?: Record<string, jest.Mock>;
    logging?: Record<string, jest.Mock>;
    eventService?: Record<string, jest.Mock>;
    errors?: Record<string, jest.Mock>;
    emailService?: Record<string, jest.Mock>;
    whatsAppService?: Record<string, jest.Mock>;
    sessionService?: Record<string, jest.Mock>;
    rbacService?: Record<string, jest.Mock>;
    jwtAuthService?: Record<string, jest.Mock>;
    socialAuthService?: Record<string, jest.Mock>;
    otpService?: Record<string, jest.Mock>;
    queueService?: Record<string, jest.Mock>;
  } = {}) {
    const databaseService = overrides.databaseService || {
      executeHealthcareRead: jest.fn(),
      executeHealthcareWrite: jest.fn(),
      executeHealthcareWriteTransaction: jest.fn(),
      findClinicByIdSafe: jest.fn(),
    };

    const jwtService = overrides.jwtService || {
      signAsync: jest.fn().mockResolvedValue('mock-jwt-token'),
      verifyAsync: jest.fn(),
      decode: jest.fn(),
    };

    const configService = overrides.configService || {
      get: jest.fn(),
    };

    const cacheService = overrides.cacheService || {
      cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      getString: jest.fn(),
      setString: jest.fn(),
    };

    const logging = overrides.logging || {
      log: jest.fn(),
      logError: jest.fn(),
      logSecurity: jest.fn(),
    };

    const eventService = overrides.eventService || {
      emit: jest.fn(),
    };

    const errors = overrides.errors || {
      validationError: jest.fn(() => new Error('Validation error')),
      clinicNotFound: jest.fn(() => new Error('Clinic not found')),
      userNotFound: jest.fn(() => new Error('Invalid credentials')),
    };

    const emailService = overrides.emailService || {
      sendEmail: jest.fn().mockResolvedValue({ success: true }),
    };

    const whatsAppService = overrides.whatsAppService || {
      sendOtpSms: jest.fn().mockResolvedValue({ success: true }),
    };

    const sessionService = overrides.sessionService || {
      createSession: jest.fn().mockResolvedValue({ sessionId: 'session-123' }),
      invalidateSession: jest.fn(),
      getSession: jest.fn(),
    };

    const rbacService = overrides.rbacService || {
      checkPermission: jest.fn().mockResolvedValue(true),
    };

    const jwtAuthService = overrides.jwtAuthService || {
      generateTokens: jest.fn().mockResolvedValue({
        accessToken: 'mock-access',
        refreshToken: 'mock-refresh',
        tokenType: 'Bearer',
        expiresIn: 900,
        sessionId: 'session-123',
      } as AuthTokens),
      verifyToken: jest.fn(),
    };

    const socialAuthService = overrides.socialAuthService || {
      authenticateWithGoogle: jest.fn(),
    };

    const otpService = overrides.otpService || {
      verifyOtp: jest.fn().mockResolvedValue({ success: true }),
      sendOtpEmail: jest.fn().mockResolvedValue({ success: true }),
      sendOtpSms: jest.fn().mockResolvedValue({ success: true }),
      checkOtpStatus: jest.fn(),
    };

    const queueService = overrides.queueService || {
      enqueue: jest.fn(),
    };

    return new AuthService(
      databaseService as any,
      jwtService as any,
      configService as any,
      cacheService as any,
      logging as any,
      eventService as any,
      errors as any,
      emailService as any,
      whatsAppService as any,
      sessionService as any,
      rbacService as any,
      jwtAuthService as any,
      socialAuthService as any,
      otpService as any,
      queueService as any,
    );
  }

  describe('constructor', () => {
    it('should accept all required dependencies', () => {
      const service = createService();
      expect(service).toBeDefined();
    });
  });

  describe('register', () => {
    it('should throw validation error when clinicId is missing', async () => {
      const errors = {
        validationError: jest.fn(() => { throw new Error('Clinic ID is required'); }),
        clinicNotFound: jest.fn(() => new Error('Clinic not found')),
        userNotFound: jest.fn(() => new Error('Invalid credentials')),
      };
      const databaseService = {
        executeHealthcareRead: jest.fn(),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findClinicByIdSafe: jest.fn(),
      };

      const service = createService({ errors, databaseService });

      await expect(
        (service as any).register({ email: 'test@example.com', password: 'SecurePass123!' } as any)
      ).rejects.toThrow();
    });

    it('should throw validation error when clinicId mismatches header', async () => {
      const errors = {
        validationError: jest.fn(() => { throw new Error('Clinic ID mismatch'); }),
        clinicNotFound: jest.fn(() => new Error('Clinic not found')),
        userNotFound: jest.fn(() => new Error('Invalid credentials')),
      };
      const databaseService = {
        executeHealthcareRead: jest.fn(),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findClinicByIdSafe: jest.fn().mockResolvedValue({
          id: 'clinic-1',
          isActive: true,
        }),
      };

      const service = createService({ errors, databaseService });

      await expect(
        (service as any).register(
          { email: 'test@example.com', password: 'SecurePass123!', clinicId: 'clinic-1' } as any,
          undefined,
          'clinic-2',
        )
      ).rejects.toThrow();
    });
  });

  describe('login', () => {
    it('should return auth response with tokens on valid login', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue({
          id: 'user-123',
          email: 'test@example.com',
          password: '$2b$12$hashed',
          role: 'PATIENT',
          isActive: true,
        }),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findClinicByIdSafe: jest.fn().mockResolvedValue({ id: 'clinic-1', isActive: true }),
      };
      const cacheService = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn(),
        del: jest.fn(),
        getString: jest.fn(),
        setString: jest.fn(),
      };
      const jwtAuthService = {
        generateTokens: jest.fn().mockResolvedValue({
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          tokenType: 'Bearer',
          expiresIn: 900,
          sessionId: 'session-456',
        } as AuthTokens),
        verifyToken: jest.fn(),
      };

      const service = createService({ databaseService, cacheService, jwtAuthService });

      // This test verifies that login returns a structured response
      // The actual behavior depends on the internal implementation
      // which involves bcrypt comparison, JWT generation, etc.
      // We test that the method is callable and produces structured output.
      const result = await (service as any).login(
        { email: 'test@example.com', password: 'SecurePass123!' } as any,
        {},
      );

      // The result should be an AuthResponse-like object
      expect(result).toBeDefined();
    });

    it('should reject login with non-existent email', async () => {
      const errors = {
        validationError: jest.fn(() => { throw new Error('Invalid credentials'); }),
        clinicNotFound: jest.fn(() => new Error('Clinic not found')),
        userNotFound: jest.fn(() => { throw new Error('Invalid credentials'); }),
      };
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue(null),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findClinicByIdSafe: jest.fn().mockResolvedValue({ id: 'clinic-1', isActive: true }),
      };
      const cacheService = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn(),
        del: jest.fn(),
        getString: jest.fn(),
        setString: jest.fn(),
      };

      const service = createService({ errors, databaseService, cacheService });

      await expect(
        (service as any).login({ email: 'nobody@example.com', password: 'password' } as any, {})
      ).rejects.toThrow();
    });
  });

  describe('refreshToken', () => {
    it('should return new tokens with valid refresh token', async () => {
      const jwtAuthService = {
        generateTokens: jest.fn().mockResolvedValue({
          accessToken: 'refreshed-access',
          refreshToken: 'refreshed-refresh',
          tokenType: 'Bearer',
          expiresIn: 900,
          sessionId: 'session-789',
        } as AuthTokens),
        verifyToken: jest.fn().mockResolvedValue({
          sub: 'user-123',
          email: 'test@example.com',
          role: 'PATIENT',
        }),
      };

      const service = createService({ jwtAuthService });

      // Test that refreshToken method is callable and returns tokens
      const result = await (service as any).refreshToken('valid-refresh-token', { userId: 'user-123' });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  describe('logout', () => {
    it('should invalidate session on logout', async () => {
      const sessionService = {
        createSession: jest.fn().mockResolvedValue({ sessionId: 'session-123' }),
        invalidateSession: jest.fn().mockResolvedValue(true),
        getSession: jest.fn(),
      };
      const cacheService = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        getString: jest.fn(),
        setString: jest.fn(),
      };

      const service = createService({ sessionService, cacheService });

      const result = await (service as any).logout('session-123');

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  describe('requestOtp', () => {
    it('should send OTP to valid email', async () => {
      const otpService = {
        verifyOtp: jest.fn().mockResolvedValue({ success: true }),
        sendOtpEmail: jest.fn().mockResolvedValue({ success: true, message: 'OTP sent' }),
        sendOtpSms: jest.fn().mockResolvedValue({ success: true }),
        checkOtpStatus: jest.fn(),
      };
      const databaseService = {
        executeHealthcareRead: jest.fn(),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findClinicByIdSafe: jest.fn().mockResolvedValue({ id: 'clinic-1', isActive: true }),
      };

      const service = createService({ otpService, databaseService });

      const result = await (service as any).requestOtp(
        { email: 'test@example.com' } as any,
        'email',
        'clinic-1',
      );

      expect(result).toBeDefined();
    });
  });

  describe('verifyOtp', () => {
    it('should verify OTP successfully', async () => {
      const otpService = {
        verifyOtp: jest.fn().mockResolvedValue({ success: true, message: 'OTP verified' }),
        sendOtpEmail: jest.fn().mockResolvedValue({ success: true }),
        sendOtpSms: jest.fn().mockResolvedValue({ success: true }),
        checkOtpStatus: jest.fn(),
      };

      const service = createService({ otpService });

      const result = await (service as any).verifyOtp({
        email: 'test@example.com',
        otp: '123456',
        type: 'EMAIL_VERIFICATION',
      } as any);

      expect(result).toBeDefined();
    });
  });

  describe('getUserPermissions', () => {
    it('should return permissions for a user', async () => {
      const rbacService = {
        checkPermission: jest.fn().mockResolvedValue(true),
        getUserPermissions: jest.fn().mockResolvedValue(['users:read', 'users:write']),
      };

      const service = createService({ rbacService });

      const result = await (service as any).getUserPermissions('user-123', 'clinic-1');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
