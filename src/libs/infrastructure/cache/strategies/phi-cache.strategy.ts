import { nowIso } from '@utils/date-time.util';
/**
 * PHI Cache Strategy
 * @class PHICacheStrategy
 * @description Special handling for Protected Health Information
 */

import { Injectable } from '@nestjs/common';
import { BaseCacheStrategy } from '@infrastructure/cache/strategies/base-cache.strategy';
import type { CacheOperationOptions } from '@core/types';
import type { ICacheProvider } from '@core/types';
import { LogType, LogLevel } from '@core/types';
import type { LoggerLike } from '@core/types';

/**
 * PHI cache strategy - enhanced security and audit logging
 * Uses SWR pattern but with PHI-specific handling
 */
@Injectable()
export class PHICacheStrategy extends BaseCacheStrategy {
  readonly name = 'PHI';

  constructor(
    cacheProvider: ICacheProvider,
    private readonly loggingService: LoggerLike
  ) {
    super(cacheProvider);
  }

  shouldUse(options: CacheOperationOptions): boolean {
    return options.containsPHI === true;
  }

  async execute<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions
  ): Promise<T> {
    // Log PHI access
    await this.logPHIAccess(key, 'cache_access');

    // SWR pattern: Try to get cached value first
    const cached = await this.getCached<T>(key);
    if (cached !== null) {
      // Return cached value immediately (stale is OK for PHI)
      // Revalidate in background (fire and forget)
      void this.revalidateInBackground(key, fetchFn, options);
      await this.logPHIAccess(key, 'cache_hit');
      return cached;
    }

    // Cache miss - fetch fresh data
    const fresh = await fetchFn();
    const ttl = this.calculateTTL(options);
    await this.setCached(key, fresh, ttl);
    await this.logPHIAccess(key, 'cache_miss');
    return fresh;
  }

  /**
   * Revalidate cache in background (SWR pattern)
   */
  private async revalidateInBackground<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions
  ): Promise<void> {
    try {
      const fresh = await fetchFn();
      const ttl = this.calculateTTL(options);
      await this.setCached(key, fresh, ttl);
    } catch {
      // Fail silently - background revalidation should not break the app
    }
  }

  protected calculateTTL(options: CacheOperationOptions): number {
    // This override was silently ignoring every explicit `ttl` passed to
    // @PatientCache/@Cache with containsPHI:true - since PHICacheStrategy is
    // selected ahead of SWR whenever containsPHI is set (see
    // CacheStrategyManager's priority order), any caller that set `ttl`
    // expecting the base class's `if (options.ttl) return options.ttl`
    // contract got the complianceLevel-based default instead. Confirmed live:
    // dashboard-summary's configured 180s and users/profile's configured 30s
    // (later 300s) both actually ran at the default-case 3600s the whole
    // time. Respecting an explicit ttl first restores the base contract while
    // keeping the compliance-level fallback for callers that don't set one.
    if (options.ttl) {
      return options.ttl;
    }

    // PHI data has shorter TTL based on compliance level
    switch (options.complianceLevel) {
      case 'restricted':
        return 900; // 15 minutes
      case 'sensitive':
        return 1800; // 30 minutes
      case 'standard':
      default:
        return 3600; // 1 hour
    }
  }

  /**
   * Log PHI access for compliance
   */
  private async logPHIAccess(key: string, operation: string): Promise<void> {
    try {
      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        `PHI cache access: ${operation}`,
        'PHICacheStrategy',
        {
          key,
          operation,
          timestamp: nowIso(),
        }
      );
    } catch {
      // Fail silently - logging should not break cache operations
    }
  }
}
