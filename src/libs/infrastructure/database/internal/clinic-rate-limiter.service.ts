/**
 * Clinic Rate Limiter Service
 * @class ClinicRateLimiterService
 * @description Rate limits database operations per clinic to prevent abuse
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
// Use direct imports to avoid TDZ issues with barrel exports
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * Clinic rate limiter service
 * @internal
 */
@Injectable()
export class ClinicRateLimiterService {
  private readonly serviceName = 'ClinicRateLimiterService';
  private readonly enabled: boolean;
  private readonly defaultConfig: RateLimitConfig = {
    maxRequests: 1000, // 1000 requests per window
    windowMs: 60000, // 1 minute
  };

  constructor(
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    this.enabled = this.configService.get<boolean>('database.rateLimiting.enabled') ?? true;
  }

  /**
   * Check rate limit for clinic
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  async checkRateLimit(clinicId: string, config?: RateLimitConfig): Promise<RateLimitResult> {
    if (!this.enabled) {
      return {
        allowed: true,
        remaining: Infinity,
        resetAt: new Date(Date.now() + (config?.windowMs ?? this.defaultConfig.windowMs)),
      };
    }

    const rateLimitConfig = config ?? this.defaultConfig;
    const cacheKey = `rate_limit:clinic:${clinicId}`;
    const windowStart =
      Math.floor(Date.now() / rateLimitConfig.windowMs) * rateLimitConfig.windowMs;
    const resetAt = new Date(windowStart + rateLimitConfig.windowMs);

    try {
      // Get current count
      const currentCount = await this.cacheService.get<number>(cacheKey);
      const count = currentCount ?? 0;

      if (count >= rateLimitConfig.maxRequests) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Rate limit exceeded for clinic ${clinicId}: ${count}/${rateLimitConfig.maxRequests} requests`,
          this.serviceName,
          { clinicId, count, maxRequests: rateLimitConfig.maxRequests }
        );

        return {
          allowed: false,
          remaining: 0,
          resetAt,
        };
      }

      // Increment count
      const newCount = count + 1;
      await this.cacheService.set(cacheKey, newCount, Math.ceil(rateLimitConfig.windowMs / 1000));

      return {
        allowed: true,
        remaining: rateLimitConfig.maxRequests - newCount,
        resetAt,
      };
    } catch (error) {
      // On cache error, allow request but log warning
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.WARN,
        `Rate limit check failed for clinic ${clinicId}: ${error instanceof Error ? error.message : String(error)}`,
        this.serviceName,
        { error: error instanceof Error ? error.stack : String(error) }
      );

      return {
        allowed: true,
        remaining: rateLimitConfig.maxRequests,
        resetAt,
      };
    }
  }

  /**
   * Reset rate limit for clinic
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  async resetRateLimit(clinicId: string): Promise<void> {
    const cacheKey = `rate_limit:clinic:${clinicId}`;
    await this.cacheService.delete(cacheKey);
  }

  /**
   * Get rate limit status for clinic
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  async getRateLimitStatus(clinicId: string): Promise<{
    current: number;
    max: number;
    resetAt: Date;
  }> {
    const cacheKey = `rate_limit:clinic:${clinicId}`;
    const current = (await this.cacheService.get<number>(cacheKey)) ?? 0;
    const windowStart =
      Math.floor(Date.now() / this.defaultConfig.windowMs) * this.defaultConfig.windowMs;
    const resetAt = new Date(windowStart + this.defaultConfig.windowMs);

    return {
      current,
      max: this.defaultConfig.maxRequests,
      resetAt,
    };
  }
}
