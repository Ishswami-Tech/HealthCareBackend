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
    // Temporary diagnostic: logPHIAccess() below never surfaced in any prior
    // check despite this class confirmed being the writer (raw, unwrapped
    // stored shape only matches this strategy's setCached call, not SWR's
    // {data,timestamp} wrapper) - meaning either logPHIAccess() itself is
    // silently failing every time (it has its own swallow-all catch), or
    // getCached() is returning null/a mismatched value right after a
    // confirmed-successful write moments earlier. This line uses a distinct
    // message so it's identifiable even if logPHIAccess is the broken one.
    void this.loggingService.log(
      LogType.CACHE,
      LogLevel.WARN,
      `[PHICacheStrategy] getCached returned ${cached === null ? 'null' : `non-null (${typeof cached})`} for key "${key}"`,
      'PHICacheStrategy.execute',
      { key, isNull: cached === null, valueType: typeof cached }
    );
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
