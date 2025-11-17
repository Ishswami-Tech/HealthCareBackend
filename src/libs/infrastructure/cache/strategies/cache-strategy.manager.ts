/**
 * Cache Strategy Manager
 * @class CacheStrategyManager
 * @description Manages and selects appropriate cache strategy
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import type { ICacheStrategy, ICacheProvider } from '@core/types';
import type { CacheOperationOptions } from '@core/types';
import { SWRCacheStrategy } from '@infrastructure/cache/strategies/swr-cache.strategy';
import { StandardCacheStrategy } from '@infrastructure/cache/strategies/standard-cache.strategy';
import { EmergencyCacheStrategy } from '@infrastructure/cache/strategies/emergency-cache.strategy';
import { PHICacheStrategy } from '@infrastructure/cache/strategies/phi-cache.strategy';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { CacheProviderFactory } from '@infrastructure/cache/providers/cache-provider.factory';

/**
 * Cache strategy manager - selects and executes appropriate strategy
 */
@Injectable()
export class CacheStrategyManager {
  private readonly strategies: ICacheStrategy[];
  private readonly cacheProvider: ICacheProvider;

  constructor(
    private readonly providerFactory: CacheProviderFactory,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    // Get provider from factory (provider-agnostic)
    this.cacheProvider = this.providerFactory.getBasicProvider();

    // Initialize strategies in priority order
    this.strategies = [
      new EmergencyCacheStrategy(this.cacheProvider),
      new PHICacheStrategy(this.cacheProvider, loggingService),
      new SWRCacheStrategy(this.cacheProvider),
      new StandardCacheStrategy(this.cacheProvider), // Fallback
    ];
  }

  /**
   * Get appropriate strategy for given options
   */
  getStrategy(options: CacheOperationOptions): ICacheStrategy {
    // Find first strategy that should be used
    const strategy = this.strategies.find(s => s.shouldUse(options));

    if (!strategy) {
      // Fallback to standard strategy (always exists as last element)
      const fallback = this.strategies[this.strategies.length - 1];
      if (!fallback) {
        throw new Error('No cache strategy available');
      }
      return fallback;
    }

    return strategy;
  }

  /**
   * Execute cache operation with appropriate strategy
   */
  async execute<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions
  ): Promise<T> {
    const strategy = this.getStrategy(options);
    return strategy.execute(key, fetchFn, options);
  }
}
