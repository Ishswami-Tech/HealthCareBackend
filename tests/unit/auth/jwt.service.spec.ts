/**
 * Unit tests for JwtAuthService
 */

import { JwtAuthService } from '@services/auth/core/jwt.service';
import { LogType, LogLevel } from '@core/types';
import type { TokenPayload, AuthTokens } from '@core/types';
import { JwtService } from '@nestjs/jwt';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { ConfigService } from '@config/config.service';

jest.mock('@nestjs/jwt');
jest.mock('@infrastructure/cache/cache.service');
jest.mock('@infrastructure/logging/logging.service');
jest.mock('@config/config.service');

const MockedJwtService = JwtService as jest.MockedClass<typeof JwtService>;
const MockedCache = CacheService as jest.MockedClass<typeof CacheService>;
const MockedLogging = LoggingService as jest.MockedClass<typeof LoggingService>;
const MockedConfig = ConfigService as jest.MockedClass<typeof ConfigService>;

function createService() {
  const mockJwt: Partial<Record<keyof jest.Mocked<JwtService>, jest.Mock>> = {
    sign: jest.fn().mockResolvedValue('mock-token'),
    verify: jest.fn(),
    decode: jest.fn(),
  };

  const mockCache: Record<string, jest.Mock> = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    ttl: jest.fn(),
  };

  const mockLogging = { log: jest.fn() };

  const mockConfig = {
    get: jest.fn(),
    getEnv: jest.fn(),
    getAppConfig: jest.fn(),
    isDevelopment: jest.fn().mockReturnValue(false),
    isProduction: jest.fn().mockReturnValue(true),
  };

  const service = new JwtAuthService(
    mockJwt as any,
    mockConfig as any,
    mockCache as any,
    mockLogging as any,
  );

  return { service, mockJwt, mockCache, mockLogging, mockConfig };
}

describe('JwtAuthService', () => {
  const payload: TokenPayload = {
    sub: 'user-123',
    email: 'test@example.com',
    role: 'PATIENT',
    clinicId: 'clinic-1',
  };

  describe('generateTokens', () => {
    it('should generate access and refresh tokens', async () => {
      const { service, mockJwt } = createService();
      mockJwt.sign
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');

      const result = await (service as any).generateTokens(payload);

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(mockJwt.sign).toHaveBeenCalledTimes(2);
    });

    it('should cache the refresh token', async () => {
      const { service, mockCache } = createService();
      mockCache.set.mockResolvedValue(undefined);

      await (service as any).generateTokens(payload);

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('refresh_token'),
        'refresh-token',
        expect.any(Number),
      );
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', async () => {
      const { service, mockJwt, mockCache } = createService();
      mockJwt.verify.mockResolvedValue({
        sub: 'user-123',
        email: 'test@example.com',
        role: 'PATIENT',
        clinicId: 'clinic-1',
      });
      mockCache.get.mockResolvedValue(null);

      const result = await (service as any).verifyToken('valid-token');

      expect(result).not.toBeNull();
      expect(result?.sub).toBe('user-123');
    });

    it('should return null for a blacklisted token', async () => {
      const { service, mockCache } = createService();
      mockCache.get.mockResolvedValue('blacklisted');

      const result = await (service as any).verifyToken('blacklisted-token');

      expect(result).toBeNull();
    });

    it('should return null for an invalid token', async () => {
      const { service, mockJwt, mockCache } = createService();
      mockJwt.verify.mockRejectedValue(new Error('Invalid token'));
      mockCache.get.mockResolvedValue(null);

      const result = await (service as any).verifyToken('invalid-token');

      expect(result).toBeNull();
    });
  });

  describe('decodeToken', () => {
    it('should decode a token without verification', () => {
      const { service, mockJwt } = createService();
      mockJwt.decode.mockReturnValue({
        sub: 'user-123',
        email: 'test@example.com',
      });

      const result = (service as any).decodeToken('token');

      expect(result).not.toBeNull();
      expect(result?.sub).toBe('user-123');
    });

    it('should return null for undecodable token', () => {
      const { service, mockJwt } = createService();
      mockJwt.decode.mockReturnValue(null);

      const result = (service as any).decodeToken('bad-token');

      expect(result).toBeNull();
    });
  });

  describe('isTokenExpired', () => {
    it('should return false for a non-expired token', () => {
      const future = Math.floor(Date.now() / 1000) + 3600;
      const { service, mockJwt } = createService();
      mockJwt.decode.mockReturnValue({ exp: future });

      const result = (service as any).isTokenExpired('valid-token');

      expect(result).toBe(false);
    });

    it('should return true for an expired token', () => {
      const past = Math.floor(Date.now() / 1000) - 3600;
      const { service, mockJwt } = createService();
      mockJwt.decode.mockReturnValue({ exp: past });

      const result = (service as any).isTokenExpired('expired-token');

      expect(result).toBe(true);
    });

    it('should return false for token without expiration', () => {
      const { service, mockJwt } = createService();
      mockJwt.decode.mockReturnValue({ sub: 'user-123' });

      const result = (service as any).isTokenExpired('no-exp-token');

      expect(result).toBe(false);
    });
  });

  describe('blacklistToken', () => {
    it('should add token to blacklist', async () => {
      const { service, mockCache } = createService();
      mockCache.set.mockResolvedValue(undefined);

      await (service as any).blacklistToken('token-to-blacklist', 'user-logout');

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('blacklist'),
        expect.any(String),
        expect.any(Number),
      );
    });
  });

  describe('revokeAllUserTokens', () => {
    it('should revoke all active tokens for a user', async () => {
      const { service, mockCache } = createService();
      mockCache.del.mockResolvedValue(1);
      mockCache.set.mockResolvedValue(undefined);

      await (service as any).revokeAllUserTokens('user-123');

      expect(mockCache.del).toHaveBeenCalled();
    });
  });
});
