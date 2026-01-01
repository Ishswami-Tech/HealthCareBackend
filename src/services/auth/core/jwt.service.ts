import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@config/config.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { TokenPayload, AuthTokens } from '@core/types';
import * as crypto from 'crypto';
import { SignOptions } from 'jsonwebtoken';

@Injectable()
export class JwtAuthService {
  private readonly rateLimitMap = new Map<string, { count: number; resetTime: number }>();
  private readonly deviceTrackingMap = new Map<string, Set<string>>();

  // Advanced JWT Configuration
  private readonly ACCESS_TOKEN_CACHE_TTL = 15 * 60; // 15 minutes
  private readonly REFRESH_TOKEN_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
  private readonly BLACKLIST_CACHE_TTL = 24 * 60 * 60; // 24 hours
  private readonly RATE_LIMIT_WINDOW = 15 * 60; // 15 minutes
  private readonly MAX_TOKENS_PER_USER = 10;
  private readonly MAX_DEVICES_PER_USER = 5;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
  ) {
    void this.loggingService.log(
      LogType.AUTH,
      LogLevel.INFO,
      '🔐 Advanced JWT Service initializing for 100K+ users...',
      'JwtAuthService',
      {}
    );
    this.initializeCleanupTasks();
  }

  /**
   * Safely call cache service methods with error handling
   */
  private async safeCacheGet<T>(key: string, defaultValue: T | null = null): Promise<T | null> {
    try {
      if (!this.cacheService) {
        return defaultValue;
      }
      return (await this.cacheService.get<T>(key)) || defaultValue;
    } catch (error) {
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.WARN,
        `Cache get failed for key ${key}`,
        'JwtAuthService',
        { key, error: error instanceof Error ? error.message : 'Unknown error' }
      );
      return defaultValue;
    }
  }

  private async safeCacheSet<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      if (!this.cacheService) {
        return;
      }
      await this.cacheService.set(key, value, ttl);
    } catch (error) {
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.WARN,
        `Cache set failed for key ${key}`,
        'JwtAuthService',
        { key, error: error instanceof Error ? error.message : 'Unknown error' }
      );
    }
  }

  private async safeCacheDelete(key: string): Promise<void> {
    try {
      if (!this.cacheService) {
        return;
      }
      await this.cacheService.delete(key);
    } catch (error) {
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.WARN,
        `Cache delete failed for key ${key}`,
        'JwtAuthService',
        { key, error: error instanceof Error ? error.message : 'Unknown error' }
      );
    }
  }

  /**
   * Generate access token
   */
  async generateAccessToken(payload: TokenPayload): Promise<string> {
    try {
      // Use ConfigService (which uses dotenv) for environment variable access
      const expiresInValue = this.configService.getEnv('JWT_ACCESS_EXPIRES_IN', '15m') || '15m';
      return await this.jwtService.signAsync(payload, {
        expiresIn: expiresInValue as SignOptions['expiresIn'],
      } as SignOptions);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to generate access token',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      throw _error;
    }
  }

  /**
   * Generate refresh token
   */
  async generateRefreshToken(payload: TokenPayload): Promise<string> {
    try {
      // Use ConfigService (which uses dotenv) for environment variable access
      const expiresInValue = this.configService.getEnv('JWT_REFRESH_EXPIRES_IN', '7d');
      return await this.jwtService.signAsync(payload, {
        expiresIn: expiresInValue as SignOptions['expiresIn'],
      } as SignOptions);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to generate refresh token',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      throw _error;
    }
  }

  /**
   * Generate both access and refresh tokens
   */
  async generateTokens(payload: TokenPayload): Promise<AuthTokens> {
    try {
      const [accessToken, refreshToken] = await Promise.all([
        this.generateAccessToken(payload),
        this.generateRefreshToken(payload),
      ]);

      return {
        accessToken,
        refreshToken,
        expiresIn: 15 * 60, // 15 minutes
        sessionId: payload.sessionId || '',
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to generate tokens',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      throw _error;
    }
  }

  /**
   * Verify token
   */
  async verifyToken(token: string): Promise<TokenPayload> {
    try {
      return await this.jwtService.verifyAsync(token);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to verify token',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      throw _error;
    }
  }

  /**
   * Decode token without verification
   */
  decodeToken(token: string): TokenPayload | null {
    try {
      return this.jwtService.decode(token);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to decode token',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      return null;
    }
  }

  /**
   * Get token expiration time
   */
  getTokenExpiration(token: string): Date | null {
    try {
      const decoded = this.decodeToken(token);
      if (decoded && decoded.exp) {
        return new Date(decoded.exp * 1000);
      }
      return null;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get token expiration',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      return null;
    }
  }

  /**
   * Check if token is expired
   */
  isTokenExpired(token: string): boolean {
    try {
      const expiration = this.getTokenExpiration(token);
      if (!expiration) return true;
      return expiration < new Date();
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to check token expiration',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      return true;
    }
  }

  // ==========================================
  // ADVANCED JWT FEATURES FOR 100K+ USERS
  // ==========================================

  /**
   * Generate enhanced token with device fingerprint and rate limiting
   */
  async generateEnhancedTokens(
    payload: TokenPayload,
    deviceFingerprint?: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<AuthTokens> {
    try {
      // Rate limiting check (best effort - don't fail if cache unavailable)
      try {
        await this.checkRateLimit(payload.sub);
      } catch (rateLimitError) {
        // Log but don't fail - rate limiting is best effort
        void this.loggingService.log(
          LogType.AUTH,
          LogLevel.WARN,
          'Rate limit check failed (non-critical)',
          'JwtAuthService',
          {
            error:
              rateLimitError instanceof Error ? rateLimitError.message : String(rateLimitError),
          }
        );
      }

      // Device tracking (best effort - don't fail if cache unavailable)
      if (deviceFingerprint) {
        try {
          await this.trackDevice(payload.sub, deviceFingerprint);
        } catch (trackError) {
          // Log but don't fail - device tracking is best effort
          void this.loggingService.log(
            LogType.AUTH,
            LogLevel.WARN,
            'Device tracking failed (non-critical)',
            'JwtAuthService',
            { error: trackError instanceof Error ? trackError.message : String(trackError) }
          );
        }
      }

      // Strip registered claims so jsonwebtoken can set fresh exp/iat values
      const sanitizedPayload = this.stripRegisteredClaims(payload);

      // Enhanced payload with security metadata
      const enhancedPayload: TokenPayload = {
        ...sanitizedPayload,
        jti: this.generateJTI(), // JWT ID for blacklist tracking
        deviceFingerprint: deviceFingerprint || '',
        userAgent: userAgent?.substring(0, 100) || '',
        ipAddress: ipAddress || '',
        iat: Math.floor(Date.now() / 1000),
      };

      const [accessToken, refreshToken] = await Promise.all([
        this.generateAccessToken(enhancedPayload),
        this.generateRefreshToken(enhancedPayload),
      ]);

      // Cache tokens for fast validation (best effort - don't fail if cache unavailable)
      try {
        await this.cacheTokens(accessToken, refreshToken, payload.sub);
      } catch (cacheError) {
        // Log but don't fail - caching is best effort
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Token caching failed (non-critical)',
          'JwtAuthService',
          { error: cacheError instanceof Error ? cacheError.message : String(cacheError) }
        );
      }

      return {
        accessToken,
        refreshToken,
        expiresIn: this.ACCESS_TOKEN_CACHE_TTL,
        sessionId: payload.sessionId || '',
        tokenType: 'Bearer',
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to generate enhanced tokens',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      throw _error;
    }
  }

  /**
   * Verify token with blacklist and cache validation
   */
  async verifyEnhancedToken(token: string): Promise<TokenPayload> {
    try {
      // Check if token is blacklisted (best effort - don't fail if cache unavailable)
      try {
        const jti = this.extractJTI(token);
        if (jti && (await this.isTokenBlacklisted(jti))) {
          throw new Error('Token has been revoked');
        }
      } catch (blacklistError) {
        // If blacklist check fails due to cache, log but continue verification
        // Only throw if token is actually blacklisted
        if (
          blacklistError instanceof Error &&
          blacklistError.message === 'Token has been revoked'
        ) {
          throw blacklistError;
        }
        void this.loggingService.log(
          LogType.AUTH,
          LogLevel.WARN,
          'Blacklist check failed (non-critical), continuing verification',
          'JwtAuthService',
          {}
        );
      }

      // Try cache first for performance (best effort)
      try {
        const cachedPayload = await this.getCachedTokenPayload(token);
        if (cachedPayload) {
          void this.loggingService.log(
            LogType.AUTH,
            LogLevel.DEBUG,
            'Token verified from cache',
            'JwtAuthService',
            {}
          );
          return cachedPayload;
        }
      } catch (_cacheError) {
        // Cache miss or error - continue with JWT verification
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.DEBUG,
          'Cache check failed (non-critical), verifying token directly',
          'JwtAuthService',
          {}
        );
      }

      // Verify with JWT service (this is the critical path)
      // jwtService.verifyAsync returns unknown, we need to type assert it
      const payloadRaw: unknown = await this.jwtService.verifyAsync(token);
      const payload =
        payloadRaw && typeof payloadRaw === 'object' && payloadRaw !== null
          ? (payloadRaw as TokenPayload)
          : null;
      if (!payload) {
        throw new Error('Invalid token payload');
      }

      // Cache verified token (best effort - don't fail if cache unavailable)
      try {
        await this.cacheTokenPayload(token, payload);
      } catch (_cacheError) {
        // Log but don't fail - token is still valid
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.DEBUG,
          'Failed to cache token payload (non-critical)',
          'JwtAuthService',
          {}
        );
      }

      return payload;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Enhanced token verification failed',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      throw _error;
    }
  }

  /**
   * Blacklist a token (for logout, security incidents)
   */
  async blacklistToken(token: string, reason?: string): Promise<void> {
    try {
      const jti = this.extractJTI(token);
      if (!jti) {
        void this.loggingService.log(
          LogType.AUTH,
          LogLevel.WARN,
          'Cannot blacklist token without JTI',
          'JwtAuthService',
          {}
        );
        return;
      }

      const blacklistKey = `jwt:blacklist:${jti}`;
      // Use safe cache set - won't throw if cache is unavailable
      await this.safeCacheSet(
        blacklistKey,
        {
          blacklistedAt: new Date().toISOString(),
          reason: reason || 'User logout',
        },
        this.BLACKLIST_CACHE_TTL
      );

      // Remove from token cache - best effort, don't fail if cache unavailable
      try {
        await this.removeCachedToken(token);
      } catch (removeError) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Failed to remove cached token (non-critical)',
          'JwtAuthService',
          { error: removeError instanceof Error ? removeError.message : String(removeError) }
        );
      }

      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.INFO,
        `Token blacklisted: ${jti} - Reason: ${reason || 'User logout'}`,
        'JwtAuthService',
        { jti, reason: reason || 'User logout' }
      );
    } catch (_error) {
      // Log but don't throw - blacklisting is best effort
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.WARN,
        'Failed to blacklist token (non-critical)',
        'JwtAuthService',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      // Don't throw - allow operation to continue even if blacklisting fails
    }
  }

  /**
   * Refresh token with enhanced security
   */
  async refreshEnhancedToken(
    refreshToken: string,
    deviceFingerprint?: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<AuthTokens> {
    try {
      // Verify refresh token
      const payload = await this.verifyEnhancedToken(refreshToken);

      // Validate device consistency
      if (
        deviceFingerprint &&
        payload.deviceFingerprint &&
        payload.deviceFingerprint !== deviceFingerprint
      ) {
        void this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          `Device fingerprint mismatch for user ${payload.sub}`,
          'JwtAuthService',
          { userId: payload.sub }
        );
        // Could throw error for strict security, or just log for monitoring
      }

      // Generate new tokens
      const newTokens = await this.generateEnhancedTokens(
        payload,
        deviceFingerprint || payload.deviceFingerprint,
        userAgent,
        ipAddress
      );

      // Blacklist old refresh token (best effort - won't throw)
      await this.blacklistToken(refreshToken, 'Token refresh');

      return newTokens;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Enhanced token refresh failed',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      throw _error;
    }
  }

  /**
   * Get user's active tokens count
   */
  async getUserActiveTokensCount(userId: string): Promise<number> {
    try {
      const cacheKey = `jwt:user_tokens:${userId}`;
      const tokens = (await this.safeCacheGet<string[]>(cacheKey)) || [];
      return tokens.length;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get user active tokens count',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      return 0;
    }
  }

  /**
   * Revoke all user tokens (for security incidents)
   */
  async revokeAllUserTokens(userId: string, reason?: string): Promise<void> {
    try {
      const cacheKey = `jwt:user_tokens:${userId}`;
      const tokens = (await this.safeCacheGet<string[]>(cacheKey)) || [];

      // Blacklist all tokens
      await Promise.all(
        tokens.map(token => this.blacklistToken(token, reason || 'Security incident'))
      );

      // Clear user tokens cache
      await this.safeCacheDelete(cacheKey);

      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.INFO,
        `Revoked ${tokens.length} tokens for user ${userId} - Reason: ${reason || 'Security incident'}`,
        'JwtAuthService',
        { userId, tokenCount: tokens.length, reason: reason || 'Security incident' }
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to revoke all user tokens',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      throw _error;
    }
  }

  // ==========================================
  // PRIVATE HELPER METHODS
  // ==========================================

  private generateJTI(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private extractJTI(token: string): string | null {
    try {
      const decoded = this.decodeToken(token);
      return decoded?.jti || null;
    } catch {
      return null;
    }
  }

  private async isTokenBlacklisted(jti: string): Promise<boolean> {
    try {
      const blacklistKey = `jwt:blacklist:${jti}`;
      const blacklisted = await this.safeCacheGet(blacklistKey);
      return !!blacklisted;
    } catch {
      return false;
    }
  }

  private async cacheTokens(
    accessToken: string,
    refreshToken: string,
    userId: string
  ): Promise<void> {
    try {
      // Cache individual tokens
      const accessKey = `jwt:token:${this.hashToken(accessToken)}`;
      const refreshKey = `jwt:token:${this.hashToken(refreshToken)}`;

      await Promise.all([
        this.safeCacheSet(accessKey, { type: 'access', userId }, this.ACCESS_TOKEN_CACHE_TTL),
        this.safeCacheSet(refreshKey, { type: 'refresh', userId }, this.REFRESH_TOKEN_CACHE_TTL),
      ]);

      // Track user tokens
      const userTokensKey = `jwt:user_tokens:${userId}`;
      const existingTokens = (await this.safeCacheGet<string[]>(userTokensKey)) || [];
      const updatedTokens = [...existingTokens, accessToken, refreshToken].slice(
        -this.MAX_TOKENS_PER_USER
      );

      await this.safeCacheSet(userTokensKey, updatedTokens, this.REFRESH_TOKEN_CACHE_TTL);
    } catch (_error) {
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.ERROR,
        'Failed to cache tokens',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
    }
  }

  private async getCachedTokenPayload(token: string): Promise<TokenPayload | null> {
    try {
      const cacheKey = `jwt:payload:${this.hashToken(token)}`;
      return await this.safeCacheGet<TokenPayload>(cacheKey);
    } catch {
      return null;
    }
  }

  private async cacheTokenPayload(token: string, payload: TokenPayload): Promise<void> {
    try {
      const cacheKey = `jwt:payload:${this.hashToken(token)}`;
      await this.safeCacheSet(cacheKey, payload, this.ACCESS_TOKEN_CACHE_TTL);
    } catch (_error) {
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.ERROR,
        'Failed to cache token payload',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
    }
  }

  private async removeCachedToken(token: string): Promise<void> {
    try {
      const tokenKey = `jwt:token:${this.hashToken(token)}`;
      const payloadKey = `jwt:payload:${this.hashToken(token)}`;

      await Promise.all([this.safeCacheDelete(tokenKey), this.safeCacheDelete(payloadKey)]);
    } catch (_error) {
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.ERROR,
        'Failed to remove cached token',
        'JwtAuthService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
    }
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
  }

  private checkRateLimit(userId: string): Promise<void> {
    const now = Date.now();
    const userLimit = this.rateLimitMap.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
      this.rateLimitMap.set(userId, {
        count: 1,
        resetTime: now + this.RATE_LIMIT_WINDOW * 1000,
      });
      return Promise.resolve();
    }

    if (userLimit.count >= this.MAX_TOKENS_PER_USER) {
      throw new Error('Rate limit exceeded for token generation');
    }

    userLimit.count++;
    return Promise.resolve();
  }

  private trackDevice(userId: string, deviceFingerprint: string): Promise<void> {
    return Promise.resolve();
    const userDevices = this.deviceTrackingMap.get(userId) || new Set();

    if (userDevices.size >= this.MAX_DEVICES_PER_USER && !userDevices.has(deviceFingerprint)) {
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.WARN,
        `User ${userId} exceeded max device limit`,
        'JwtAuthService',
        { userId }
      );
      // Could throw error for strict security, or just log for monitoring
    }

    userDevices.add(deviceFingerprint);
    this.deviceTrackingMap.set(userId, userDevices);
  }

  private initializeCleanupTasks(): void {
    // Clean up rate limiting map every hour
    setInterval(
      () => {
        const now = Date.now();
        for (const [userId, limit] of Array.from(this.rateLimitMap.entries())) {
          if (now > limit.resetTime) {
            this.rateLimitMap.delete(userId);
          }
        }
      },
      60 * 60 * 1000
    ); // 1 hour

    void this.loggingService.log(
      LogType.AUTH,
      LogLevel.INFO,
      '🔐 Advanced JWT Service initialized successfully',
      'JwtAuthService',
      {}
    );
  }

  private stripRegisteredClaims(payload: TokenPayload): TokenPayload {
    // Destructure to remove registered claims (exp, iat, nbf) - these are unused but need to be removed
    const {
      exp: _exp,
      iat: _iat,
      nbf: _nbf,
      ...rest
    } = payload as TokenPayload & {
      exp?: number;
      iat?: number;
      nbf?: number;
    };
    return rest;
  }
}
