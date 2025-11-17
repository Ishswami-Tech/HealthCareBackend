/**
 * Standard Cache Strategy
 * @class StandardCacheStrategy
 * @description Standard caching without SWR
 */

import { Injectable } from '@nestjs/common';
import { BaseCacheStrategy } from '@infrastructure/cache/strategies/base-cache.strategy';
import type { CacheOperationOptions } from '@core/types';
import type { ICacheProvider } from '@core/types';

/**
 * Standard cache strategy - simple get/set without SWR
 */
@Injectable()
export class StandardCacheStrategy extends BaseCacheStrategy {
  readonly name = 'Standard';

  constructor(cacheProvider: ICacheProvider) {
    super(cacheProvider);
  }

  shouldUse(options: CacheOperationOptions): boolean {
    return options.enableSwr === false || options.emergencyData === true;
  }

  async execute<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions
  ): Promise<T> {
    // Force refresh bypasses cache
    if (options.forceRefresh) {
      const data = await fetchFn();
      const ttl = this.calculateTTL(options);
      await this.setCached(key, data, ttl);
      return data;
    }

    // Try to get from cache
    const cached = await this.getCached<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - fetch and cache
    const data = await fetchFn();
    const ttl = this.calculateTTL(options);
    await this.setCached(key, data, ttl);
    return data;
  }
}
