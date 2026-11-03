/**
 * Unit tests for JwtAuthService
 *
 * Built against the current service surface: signAsync/verifyAsync/decode on the
 * Nest JwtService, cache access through get/set/delete, and the jwt:* cache keys.
 */

import { JwtAuthService } from '@services/auth/core/jwt.service';
import type { TokenPayload } from '@core/types';

type Deps = ConstructorParameters<typeof JwtAuthService>;

interface Mocks {
  jwt: { signAsync: jest.Mock; verifyAsync: jest.Mock; decode: jest.Mock };
  cache: { get: jest.Mock; set: jest.Mock; delete: jest.Mock };
  logging: { log: jest.Mock };
  config: { getEnv: jest.Mock };
}

function createService(): { service: JwtAuthService } & Mocks {
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('mock-token'),
    verifyAsync: jest.fn(),
    decode: jest.fn(),
  };
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const logging = { log: jest.fn().mockResolvedValue(undefined) };
  const config = {
    getEnv: jest.fn((_key: string, fallback?: unknown) => fallback),
  };

  const service = new JwtAuthService(
    jwt as unknown as Deps[0],
    config as unknown as Deps[1],
    cache as unknown as Deps[2],
    logging as unknown as Deps[3]
  );

  return { service, jwt, cache, logging, config };
}

describe('JwtAuthService', () => {
  const payload: TokenPayload = {
    sub: 'user-123',
    email: 'test@example.com',
    role: 'PATIENT',
    clinicId: 'clinic-1',
  };

  beforeEach(() => {
    // The constructor schedules an hourly cleanup interval; keep it off the real clock.
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('generateTokens', () => {
    it('signs an access and a refresh token', async () => {
      const { service, jwt } = createService();
      jwt.signAsync.mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token');

      const result = await service.generateTokens({ ...payload, sessionId: 'session-1' });

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.sessionId).toBe('session-1');
      expect(jwt.signAsync).toHaveBeenCalledTimes(2);
    });

    it('uses the configured expiries, defaulting to 15m / 7d', async () => {
      const { service, jwt, config } = createService();

      await service.generateTokens(payload);

      expect(config.getEnv).toHaveBeenCalledWith('JWT_ACCESS_EXPIRES_IN', '15m');
      expect(config.getEnv).toHaveBeenCalledWith('JWT_REFRESH_EXPIRES_IN', '7d');
      expect(jwt.signAsync).toHaveBeenCalledWith(payload, { expiresIn: '15m' });
      expect(jwt.signAsync).toHaveBeenCalledWith(payload, { expiresIn: '7d' });
    });

    it('turns a numeric expiry into seconds', async () => {
      const { service, jwt, config } = createService();
      config.getEnv.mockReturnValue(900);

      await service.generateAccessToken(payload);

      expect(jwt.signAsync).toHaveBeenCalledWith(payload, { expiresIn: '900s' });
    });

    it('rethrows a signing failure', async () => {
      const { service, jwt } = createService();
      jwt.signAsync.mockRejectedValue(new Error('no secret'));

      await expect(service.generateTokens(payload)).rejects.toThrow('no secret');
    });
  });

  describe('verifyToken', () => {
    it('returns the verified payload', async () => {
      const { service, jwt } = createService();
      jwt.verifyAsync.mockResolvedValue(payload);

      await expect(service.verifyToken('valid-token')).resolves.toEqual(payload);
    });

    it('rethrows for an invalid token', async () => {
      const { service, jwt } = createService();
      jwt.verifyAsync.mockRejectedValue(new Error('Invalid token'));

      await expect(service.verifyToken('invalid-token')).rejects.toThrow('Invalid token');
    });
  });

  describe('verifyEnhancedToken', () => {
    it('rejects a blacklisted token', async () => {
      const { service, jwt, cache } = createService();
      jwt.decode.mockReturnValue({ ...payload, jti: 'jti-1' });
      cache.get.mockImplementation(async (key: string) =>
        key === 'jwt:blacklist:jti-1' ? { reason: 'logout' } : null
      );

      await expect(service.verifyEnhancedToken('revoked-token')).rejects.toThrow(
        'Token has been revoked'
      );
      expect(jwt.verifyAsync).not.toHaveBeenCalled();
    });

    it('verifies and caches a valid token', async () => {
      const { service, jwt, cache } = createService();
      jwt.decode.mockReturnValue({ ...payload, jti: 'jti-2' });
      jwt.verifyAsync.mockResolvedValue(payload);

      await expect(service.verifyEnhancedToken('valid-token')).resolves.toEqual(payload);
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringMatching(/^jwt:payload:/),
        payload,
        expect.any(Number)
      );
    });

    it('still verifies when the cache is down', async () => {
      const { service, jwt, cache } = createService();
      jwt.decode.mockReturnValue({ ...payload, jti: 'jti-3' });
      jwt.verifyAsync.mockResolvedValue(payload);
      cache.get.mockRejectedValue(new Error('cache not ready'));
      cache.set.mockRejectedValue(new Error('cache not ready'));

      await expect(service.verifyEnhancedToken('valid-token')).resolves.toEqual(payload);
    });
  });

  describe('decodeToken', () => {
    it('decodes a token without verification', () => {
      const { service, jwt } = createService();
      jwt.decode.mockReturnValue({ sub: 'user-123', email: 'test@example.com' });

      expect(service.decodeToken('token')?.sub).toBe('user-123');
    });

    it('returns null for an undecodable token', () => {
      const { service, jwt } = createService();
      jwt.decode.mockReturnValue(null);

      expect(service.decodeToken('bad-token')).toBeNull();
    });

    it('returns null when decode throws', () => {
      const { service, jwt } = createService();
      jwt.decode.mockImplementation(() => {
        throw new Error('malformed');
      });

      expect(service.decodeToken('bad-token')).toBeNull();
    });
  });

  describe('isTokenExpired', () => {
    it('is false for a non-expired token', () => {
      const { service, jwt } = createService();
      jwt.decode.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 });

      expect(service.isTokenExpired('valid-token')).toBe(false);
    });

    it('is true for an expired token', () => {
      const { service, jwt } = createService();
      jwt.decode.mockReturnValue({ exp: Math.floor(Date.now() / 1000) - 3600 });

      expect(service.isTokenExpired('expired-token')).toBe(true);
    });

    it('treats a token without an expiry as expired (fail closed)', () => {
      const { service, jwt } = createService();
      jwt.decode.mockReturnValue({ sub: 'user-123' });

      expect(service.isTokenExpired('no-exp-token')).toBe(true);
    });
  });

  describe('blacklistToken', () => {
    it('stores the jti on the blacklist and drops the cached token', async () => {
      const { service, jwt, cache } = createService();
      jwt.decode.mockReturnValue({ ...payload, jti: 'jti-9' });

      await service.blacklistToken('token-to-blacklist', 'user-logout');

      expect(cache.set).toHaveBeenCalledWith(
        'jwt:blacklist:jti-9',
        expect.objectContaining({ reason: 'user-logout' }),
        24 * 60 * 60
      );
      expect(cache.delete).toHaveBeenCalledWith(expect.stringMatching(/^jwt:token:/));
      expect(cache.delete).toHaveBeenCalledWith(expect.stringMatching(/^jwt:payload:/));
    });

    it('does nothing for a token without a jti', async () => {
      const { service, jwt, cache } = createService();
      jwt.decode.mockReturnValue({ ...payload });

      await service.blacklistToken('no-jti-token');

      expect(cache.set).not.toHaveBeenCalled();
    });

    it('never throws when the cache fails', async () => {
      const { service, jwt, cache } = createService();
      jwt.decode.mockReturnValue({ ...payload, jti: 'jti-10' });
      cache.set.mockRejectedValue(new Error('down'));
      cache.delete.mockRejectedValue(new Error('down'));

      await expect(service.blacklistToken('token')).resolves.toBeUndefined();
    });
  });

  describe('revokeAllUserTokens', () => {
    it('blacklists every tracked token and clears the user token list', async () => {
      const { service, jwt, cache } = createService();
      cache.get.mockImplementation(async (key: string) =>
        key === 'jwt:user_tokens:user-123' ? ['token-a', 'token-b'] : null
      );
      jwt.decode.mockImplementation((token: string) => ({ ...payload, jti: `jti-${token}` }));

      await service.revokeAllUserTokens('user-123');

      expect(cache.set).toHaveBeenCalledWith(
        'jwt:blacklist:jti-token-a',
        expect.objectContaining({ reason: 'Security incident' }),
        expect.any(Number)
      );
      expect(cache.set).toHaveBeenCalledWith(
        'jwt:blacklist:jti-token-b',
        expect.any(Object),
        expect.any(Number)
      );
      expect(cache.delete).toHaveBeenCalledWith('jwt:user_tokens:user-123');
    });
  });

  describe('getUserActiveTokensCount', () => {
    it('counts the tracked tokens', async () => {
      const { service, cache } = createService();
      cache.get.mockResolvedValue(['a', 'b', 'c']);

      await expect(service.getUserActiveTokensCount('user-123')).resolves.toBe(3);
    });
  });
});
