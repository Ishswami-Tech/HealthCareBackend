import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { CacheService } from "../../../libs/infrastructure/cache/cache.service";
import { TokenPayload, AuthTokens } from "../../../libs/core/types";
import * as crypto from "crypto";

@Injectable()
export class JwtAuthService {
  private readonly logger = new Logger(JwtAuthService.name);
  private readonly rateLimitMap = new Map<
    string,
    { count: number; resetTime: number }
  >();
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
  ) {
    this.logger.log("🔐 Advanced JWT Service initializing for 100K+ users...");
    this.initializeCleanupTasks();
  }

  /**
   * Generate access token
   */
  async generateAccessToken(payload: TokenPayload): Promise<string> {
    try {
      return await this.jwtService.signAsync(payload, {
        expiresIn: this.configService.get("JWT_ACCESS_EXPIRES_IN") || "15m",
      });
    } catch (_error) {
      this.logger.error(
        "Failed to generate access token",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Generate refresh token
   */
  async generateRefreshToken(payload: TokenPayload): Promise<string> {
    try {
      return await this.jwtService.signAsync(payload, {
        expiresIn: this.configService.get("JWT_REFRESH_EXPIRES_IN") || "7d",
      });
    } catch (_error) {
      this.logger.error(
        "Failed to generate refresh token",
        _error instanceof Error ? _error.stack : "No stack trace available",
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
        sessionId: payload.sessionId || "",
      };
    } catch (_error) {
      this.logger.error(
        "Failed to generate tokens",
        _error instanceof Error ? _error.stack : "No stack trace available",
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
      this.logger.error(
        "Failed to verify token",
        _error instanceof Error ? _error.stack : "No stack trace available",
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
      this.logger.error(
        "Failed to decode token",
        _error instanceof Error ? _error.stack : "No stack trace available",
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
      this.logger.error(
        "Failed to get token expiration",
        _error instanceof Error ? _error.stack : "No stack trace available",
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
      this.logger.error(
        "Failed to check token expiration",
        _error instanceof Error ? _error.stack : "No stack trace available",
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
    ipAddress?: string,
  ): Promise<AuthTokens> {
    try {
      // Rate limiting check
      await this.checkRateLimit(payload.sub);

      // Device tracking
      if (deviceFingerprint) {
        await this.trackDevice(payload.sub, deviceFingerprint);
      }

      // Enhanced payload with security metadata
      const enhancedPayload: TokenPayload = {
        ...payload,
        jti: this.generateJTI(), // JWT ID for blacklist tracking
        deviceFingerprint,
        userAgent: userAgent?.substring(0, 100), // Limit user agent length
        ipAddress,
        iat: Math.floor(Date.now() / 1000),
      };

      const [accessToken, refreshToken] = await Promise.all([
        this.generateAccessToken(enhancedPayload),
        this.generateRefreshToken(enhancedPayload),
      ]);

      // Cache tokens for fast validation
      await this.cacheTokens(accessToken, refreshToken, payload.sub);

      return {
        accessToken,
        refreshToken,
        expiresIn: this.ACCESS_TOKEN_CACHE_TTL,
        sessionId: payload.sessionId || "",
        tokenType: "Bearer",
      };
    } catch (_error) {
      this.logger.error(
        "Failed to generate enhanced tokens",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Verify token with blacklist and cache validation
   */
  async verifyEnhancedToken(token: string): Promise<TokenPayload> {
    try {
      // Check if token is blacklisted
      const jti = this.extractJTI(token);
      if (jti && (await this.isTokenBlacklisted(jti))) {
        throw new Error("Token has been revoked");
      }

      // Try cache first for performance
      const cachedPayload = await this.getCachedTokenPayload(token);
      if (cachedPayload) {
        this.logger.debug("Token verified from cache");
        return cachedPayload;
      }

      // Verify with JWT service
      const payload = await this.jwtService.verifyAsync(token);

      // Cache verified token
      await this.cacheTokenPayload(token, payload);

      return payload;
    } catch (_error) {
      this.logger.error(
        "Enhanced token verification failed",
        _error instanceof Error ? _error.stack : "No stack trace available",
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
        this.logger.warn("Cannot blacklist token without JTI");
        return;
      }

      const blacklistKey = `jwt:blacklist:${jti}`;
      await this.cacheService.set(
        blacklistKey,
        {
          blacklistedAt: new Date().toISOString(),
          reason: reason || "User logout",
        },
        this.BLACKLIST_CACHE_TTL,
      );

      // Remove from token cache
      await this.removeCachedToken(token);

      this.logger.log(
        `Token blacklisted: ${jti} - Reason: ${reason || "User logout"}`,
      );
    } catch (_error) {
      this.logger.error(
        "Failed to blacklist token",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Refresh token with enhanced security
   */
  async refreshEnhancedToken(
    refreshToken: string,
    deviceFingerprint?: string,
    userAgent?: string,
    ipAddress?: string,
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
        this.logger.warn(`Device fingerprint mismatch for user ${payload.sub}`);
        // Could throw error for strict security, or just log for monitoring
      }

      // Generate new tokens
      const newTokens = await this.generateEnhancedTokens(
        payload,
        deviceFingerprint || payload.deviceFingerprint,
        userAgent,
        ipAddress,
      );

      // Blacklist old refresh token
      await this.blacklistToken(refreshToken, "Token refresh");

      return newTokens;
    } catch (_error) {
      this.logger.error(
        "Enhanced token refresh failed",
        _error instanceof Error ? _error.stack : "No stack trace available",
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
      const tokens = (await this.cacheService.get<string[]>(cacheKey)) || [];
      return tokens.length;
    } catch (_error) {
      this.logger.error(
        "Failed to get user active tokens count",
        _error instanceof Error ? _error.stack : "No stack trace available",
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
      const tokens = (await this.cacheService.get<string[]>(cacheKey)) || [];

      // Blacklist all tokens
      await Promise.all(
        tokens.map((token) =>
          this.blacklistToken(token, reason || "Security incident"),
        ),
      );

      // Clear user tokens cache
      await this.cacheService.delete(cacheKey);

      this.logger.log(
        `Revoked ${tokens.length} tokens for user ${userId} - Reason: ${reason || "Security incident"}`,
      );
    } catch (_error) {
      this.logger.error(
        "Failed to revoke all user tokens",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  // ==========================================
  // PRIVATE HELPER METHODS
  // ==========================================

  private generateJTI(): string {
    return crypto.randomBytes(16).toString("hex");
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
      const blacklisted = await this.cacheService.get(blacklistKey);
      return !!blacklisted;
    } catch {
      return false;
    }
  }

  private async cacheTokens(
    accessToken: string,
    refreshToken: string,
    userId: string,
  ): Promise<void> {
    try {
      // Cache individual tokens
      const accessKey = `jwt:token:${this.hashToken(accessToken)}`;
      const refreshKey = `jwt:token:${this.hashToken(refreshToken)}`;

      await Promise.all([
        this.cacheService.set(
          accessKey,
          { type: "access", userId },
          this.ACCESS_TOKEN_CACHE_TTL,
        ),
        this.cacheService.set(
          refreshKey,
          { type: "refresh", userId },
          this.REFRESH_TOKEN_CACHE_TTL,
        ),
      ]);

      // Track user tokens
      const userTokensKey = `jwt:user_tokens:${userId}`;
      const existingTokens =
        (await this.cacheService.get<string[]>(userTokensKey)) || [];
      const updatedTokens = [
        ...existingTokens,
        accessToken,
        refreshToken,
      ].slice(-this.MAX_TOKENS_PER_USER);

      await this.cacheService.set(
        userTokensKey,
        updatedTokens,
        this.REFRESH_TOKEN_CACHE_TTL,
      );
    } catch (_error) {
      this.logger.error(
        "Failed to cache tokens",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
    }
  }

  private async getCachedTokenPayload(
    token: string,
  ): Promise<TokenPayload | null> {
    try {
      const cacheKey = `jwt:payload:${this.hashToken(token)}`;
      return (await this.cacheService.get<TokenPayload>(cacheKey)) || null;
    } catch {
      return null;
    }
  }

  private async cacheTokenPayload(
    token: string,
    payload: TokenPayload,
  ): Promise<void> {
    try {
      const cacheKey = `jwt:payload:${this.hashToken(token)}`;
      await this.cacheService.set(
        cacheKey,
        payload,
        this.ACCESS_TOKEN_CACHE_TTL,
      );
    } catch (_error) {
      this.logger.error(
        "Failed to cache token payload",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
    }
  }

  private async removeCachedToken(token: string): Promise<void> {
    try {
      const tokenKey = `jwt:token:${this.hashToken(token)}`;
      const payloadKey = `jwt:payload:${this.hashToken(token)}`;

      await Promise.all([
        this.cacheService.delete(tokenKey),
        this.cacheService.delete(payloadKey),
      ]);
    } catch (_error) {
      this.logger.error(
        "Failed to remove cached token",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
    }
  }

  private hashToken(token: string): string {
    return crypto
      .createHash("sha256")
      .update(token)
      .digest("hex")
      .substring(0, 16);
  }

  private async checkRateLimit(userId: string): Promise<void> {
    const now = Date.now();
    const userLimit = this.rateLimitMap.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
      this.rateLimitMap.set(userId, {
        count: 1,
        resetTime: now + this.RATE_LIMIT_WINDOW * 1000,
      });
      return;
    }

    if (userLimit.count >= this.MAX_TOKENS_PER_USER) {
      throw new Error("Rate limit exceeded for token generation");
    }

    userLimit.count++;
  }

  private async trackDevice(
    userId: string,
    deviceFingerprint: string,
  ): Promise<void> {
    const userDevices = this.deviceTrackingMap.get(userId) || new Set();

    if (
      userDevices.size >= this.MAX_DEVICES_PER_USER &&
      !userDevices.has(deviceFingerprint)
    ) {
      this.logger.warn(`User ${userId} exceeded max device limit`);
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
      60 * 60 * 1000,
    ); // 1 hour

    this.logger.log("🔐 Advanced JWT Service initialized successfully");
  }
}
