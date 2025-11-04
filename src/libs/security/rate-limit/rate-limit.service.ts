import { Injectable } from '@nestjs/common';

// Internal imports - Infrastructure
import { RedisService } from '@infrastructure/cache/redis/redis.service';
import { LoggingService } from '@infrastructure/logging';

// Internal imports - Core
import { LogType, LogLevel } from '@core/types';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (req: unknown) => string;
  skipIf?: (req: unknown) => boolean;
  message?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  total: number;
}

/**
 * Rate Limiting Service for Healthcare Applications
 *
 * Provides comprehensive rate limiting capabilities with Redis-based storage,
 * configurable windows, and multiple key generation strategies for healthcare
 * applications. Supports user-based, IP-based, and custom rate limiting.
 *
 * @class RateLimitService
 * @description Enterprise-grade rate limiting service with Redis persistence
 *
 * @example
 * ```typescript
 * // Inject the service
 * constructor(private readonly rateLimitService: RateLimitService) {}
 *
 * // Check rate limit
 * const result = await this.rateLimitService.checkRateLimit(
 *   'user:12345',
 *   { windowMs: 60000, max: 100 }
 * );
 *
 * if (!result.allowed) {
 *   throw new HealthcareError(ErrorCode.RATE_LIMIT_EXCEEDED, 'Rate limit exceeded');
 * }
 * ```
 *
 * @features
 * - Redis-based rate limiting with sliding windows
 * - Multiple key generation strategies
 * - Configurable rate limit windows and limits
 * - Automatic rate limit reset functionality
 * - Comprehensive logging and monitoring
 * - HIPAA-compliant rate limiting for healthcare data
 */
@Injectable()
export class RateLimitService {
  constructor(
    private readonly redis: RedisService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Checks if a request is within the rate limit for the given key
   *
   * @param key - Unique identifier for the rate limit (e.g., user ID, IP address)
   * @param options - Rate limiting configuration options
   * @returns Promise resolving to rate limit result with allowance status and metadata
   *
   * @description Implements sliding window rate limiting using Redis for persistence.
   * Tracks request counts within the specified time window and determines if the
   * request should be allowed based on the configured limits.
   *
   * @example
   * ```typescript
   * const result = await this.rateLimitService.checkRateLimit(
   *   'user:12345',
   *   {
   *     windowMs: 60000,  // 1 minute window
   *     max: 100,         // 100 requests per minute
   *     keyGenerator: (req) => `user:${req.user.id}`
   *   }
   * );
   *
   * if (result.allowed) {
   *   // Process request
   * } else {
   *   // Rate limit exceeded - handle appropriately
   * }
   * ```
   *
   * @throws {Error} When Redis operations fail or invalid options are provided
   */
  async checkRateLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
    try {
      const now = Date.now();
      const window = Math.floor(now / options.windowMs);
      const redisKey = `rate_limit:${key}:${window}`;

      // Get current count
      const current = (await this.redis.get<number>(redisKey)) || 0;

      if (current >= options.max) {
        // Rate limit exceeded
        const resetTime = new Date((window + 1) * options.windowMs);

        void this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Rate limit exceeded',
          'RateLimitService',
          { key, current, max: options.max, window }
        );

        return {
          allowed: false,
          remaining: 0,
          resetTime,
          total: options.max,
        };
      }

      // Increment counter
      const newCount = await this.redis.incr(redisKey);

      // Set expiration on first increment
      if (newCount === 1) {
        await this.redis.expire(redisKey, Math.ceil(options.windowMs / 1000));
      }

      const resetTime = new Date((window + 1) * options.windowMs);
      const remaining = Math.max(0, options.max - newCount);

      return {
        allowed: true,
        remaining,
        resetTime,
        total: options.max,
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.ERROR,
        `Rate limit check failed for key: ${key}`,
        'RateLimitService',
        {
          key,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );

      // Fail open - allow request if Redis is down
      return {
        allowed: true,
        remaining: options.max - 1,
        resetTime: new Date(Date.now() + options.windowMs),
        total: options.max,
      };
    }
  }

  async resetRateLimit(key: string): Promise<void> {
    try {
      const pattern = `rate_limit:${key}:*`;
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);

        void this.loggingService.log(
          LogType.SECURITY,
          LogLevel.INFO,
          'Rate limit reset',
          'RateLimitService',
          { key, keysCleared: keys.length }
        );
      }
    } catch (_error) {
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.ERROR,
        `Failed to reset rate limit for key: ${key}`,
        'RateLimitService',
        {
          key,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
    }
  }

  /**
   * Generates a default rate limit key based on IP address
   *
   * @param req - HTTP request object
   * @returns Rate limit key string based on client IP address
   *
   * @description Creates a rate limit key using the client's IP address as the
   * primary identifier. Falls back to 'unknown' if IP cannot be determined.
   *
   * @example
   * ```typescript
   * const key = this.rateLimitService.generateDefaultKey(request);
   * // Returns: "ip:192.168.1.100" or "ip:unknown"
   * ```
   */
  generateDefaultKey(req: unknown): string {
    const request = req as Record<string, unknown>;
    return (
      (request['ip'] as string) ||
      ((request['connection'] as Record<string, unknown>)?.['remoteAddress'] as string) ||
      'unknown'
    );
  }

  /**
   * Generates a rate limit key based on authenticated user ID
   *
   * @param req - HTTP request object containing user information
   * @returns Rate limit key string based on user ID, or default key if no user
   *
   * @description Creates a rate limit key using the authenticated user's ID.
   * Falls back to default IP-based key if no user is authenticated or user ID
   * is not available.
   *
   * @example
   * ```typescript
   * const key = this.rateLimitService.generateUserKey(request);
   * // Returns: "user:12345" or falls back to IP-based key
   * ```
   */
  generateUserKey(req: unknown): string {
    const request = req as Record<string, unknown>;
    const user = request['user'] as Record<string, unknown>;
    const userId = user?.['id'] || user?.['userId'];
    if (userId && typeof userId === 'string') {
      return `user:${userId}`;
    }
    return this.generateDefaultKey(req);
  }

  /**
   * Generates a rate limit key for authentication endpoints
   *
   * @param req - HTTP request object containing authentication data
   * @returns Rate limit key string based on authentication identifier
   *
   * @description Creates a rate limit key using email, phone, or username from
   * the request body. This is typically used for login/authentication endpoints
   * to prevent brute force attacks.
   *
   * @example
   * ```typescript
   * const key = this.rateLimitService.generateAuthKey(request);
   * // Returns: "auth:user@example.com" or falls back to default key
   * ```
   */
  generateAuthKey(req: unknown): string {
    const request = req as Record<string, unknown>;
    const body = request['body'] as Record<string, unknown>;
    const identifier = body?.['email'] || body?.['phone'] || body?.['username'];
    if (identifier && typeof identifier === 'string') {
      return `auth:${identifier}`;
    }
    return this.generateDefaultKey(req);
  }
}
