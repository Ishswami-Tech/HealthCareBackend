/**
 * Clinic Rate Limiter Service
 * @class ClinicRateLimiterService
 * @description Rate limiting per clinic to prevent abuse and ensure fairness
 * Uses existing RateLimitService from @libs/security/rate-limit
 *
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 * All methods are private/protected. Use HealthcareDatabaseClient instead.
 * @internal
 */

import { Injectable, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@config';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
// Import RateLimitResult as type only - RateLimitService will be resolved via ModuleRef at runtime
import type { RateLimitResult } from '@security/rate-limit';

/**
 * Rate limit tiers configuration
 */
interface RateLimitTier {
  name: string;
  queriesPerMinute: number;
  writesPerMinute: number;
}

/**
 * Clinic Rate Limiter Service
 * Provides rate limiting per clinic with configurable tiers
 */
@Injectable()
export class ClinicRateLimiterService implements OnModuleInit {
  private readonly serviceName = 'ClinicRateLimiterService';
  private readonly rateLimitTiers: Map<string, RateLimitTier> = new Map();

  private rateLimitService?: unknown; // Typed as unknown to avoid circular dependency - will be cast when used

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    // Initialize rate limit tiers
    this.initializeRateLimitTiers();
  }

  /**
   * Get RateLimitService lazily to break circular dependency
   * Uses dynamic import to avoid circular dependency at module initialization time
   */
  private async getRateLimitService(): Promise<unknown> {
    if (!this.rateLimitService) {
      // Use dynamic import to avoid circular dependency - only import when actually needed
      const { RateLimitService: RateLimitServiceClass } = await import('@security/rate-limit');
      this.rateLimitService = this.moduleRef.get(RateLimitServiceClass, { strict: false });
    }
    return this.rateLimitService;
  }

  onModuleInit(): void {
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Clinic rate limiter service initialized',
      this.serviceName
    );
  }

  /**
   * Initialize rate limit tiers from configuration
   */
  private initializeRateLimitTiers(): void {
    // Free Tier
    this.rateLimitTiers.set('free', {
      name: 'Free',
      queriesPerMinute: 100,
      writesPerMinute: 50,
    });

    // Standard Tier
    this.rateLimitTiers.set('standard', {
      name: 'Standard',
      queriesPerMinute: 1000,
      writesPerMinute: 500,
    });

    // Premium Tier
    this.rateLimitTiers.set('premium', {
      name: 'Premium',
      queriesPerMinute: 10000,
      writesPerMinute: 5000,
    });

    // Enterprise Tier (unlimited but monitored)
    this.rateLimitTiers.set('enterprise', {
      name: 'Enterprise',
      queriesPerMinute: 100000, // Very high limit, effectively unlimited
      writesPerMinute: 50000,
    });

    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.DEBUG,
      `Initialized ${this.rateLimitTiers.size} rate limit tiers`,
      this.serviceName
    );
  }

  /**
   * Check rate limit for clinic operation
   * @param clinicId - Clinic ID
   * @param operation - Operation type ('read' | 'write')
   * @param tier - Clinic tier (default: 'standard')
   * @returns Rate limit result
   * @internal
   */
  async checkRateLimit(
    clinicId: string,
    operation: 'read' | 'write',
    tier: string = 'standard'
  ): Promise<RateLimitResult> {
    const tierConfig = this.rateLimitTiers.get(tier) || this.rateLimitTiers.get('standard')!;
    const limit = operation === 'read' ? tierConfig.queriesPerMinute : tierConfig.writesPerMinute;
    const key = `clinic_rate_limit:${clinicId}:${operation}`;

    try {
      const rateLimitService = await this.getRateLimitService();
      // Type assertion needed because dynamic import returns unknown
      const result = await (
        rateLimitService as {
          checkRateLimit: (
            key: string,
            options: { windowMs: number; max: number }
          ) => Promise<RateLimitResult>;
        }
      ).checkRateLimit(key, {
        windowMs: 60000, // 1 minute window
        max: limit,
      });

      if (!result.allowed) {
        void this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          `Rate limit exceeded for clinic ${clinicId} (${operation}, tier: ${tier})`,
          this.serviceName,
          {
            clinicId,
            operation,
            tier,
            limit,
            used: result.total - result.remaining,
          }
        );

        throw new HealthcareError(
          ErrorCode.RATE_LIMIT_EXCEEDED,
          `Rate limit exceeded for clinic ${clinicId}. ${operation} limit: ${limit}/minute. Try again in ${Math.round(
            (result.resetTime.getTime() - Date.now()) / 1000
          )} seconds.`,
          undefined,
          {
            clinicId,
            operation,
            tier,
            limit,
            resetTime: result.resetTime,
          },
          this.serviceName
        );
      }

      return result;
    } catch (error) {
      if (error instanceof HealthcareError && error.code === ErrorCode.RATE_LIMIT_EXCEEDED) {
        throw error;
      }

      // Log error but don't block operation (fail open for resilience)
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Rate limit check failed for clinic ${clinicId}: ${error instanceof Error ? error.message : String(error)}`,
        this.serviceName,
        { clinicId, operation, tier }
      );

      // Fail open - allow operation if rate limit check fails
      return {
        allowed: true,
        remaining: limit,
        resetTime: new Date(Date.now() + 60000),
        total: limit,
      };
    }
  }

  /**
   * Get rate limit tier configuration
   */
  getTierConfig(tier: string): RateLimitTier | undefined {
    return this.rateLimitTiers.get(tier);
  }

  /**
   * Get all available tiers
   */
  getAvailableTiers(): string[] {
    return Array.from(this.rateLimitTiers.keys());
  }
}
