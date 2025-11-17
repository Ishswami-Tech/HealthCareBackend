/**
 * SWR Cache Strategy
 * @class SWRCacheStrategy
 * @description Stale-While-Revalidate caching strategy
 */

import { Injectable } from '@nestjs/common';
import { BaseCacheStrategy } from '@infrastructure/cache/strategies/base-cache.strategy';
import type { CacheOperationOptions } from '@core/types';
import type { ICacheProvider } from '@core/types';

/**
 * SWR (Stale-While-Revalidate) cache strategy
 * Returns stale data immediately while refreshing in background
 */
@Injectable()
export class SWRCacheStrategy extends BaseCacheStrategy {
  readonly name = 'SWR';

  constructor(cacheProvider: ICacheProvider) {
    super(cacheProvider);
  }

  shouldUse(options: CacheOperationOptions): boolean {
    return options.enableSwr !== false && !options.emergencyData;
  }

  async execute<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions
  ): Promise<T> {
    const ttl = this.calculateTTL(options);
    const staleTime = options.staleTime ?? Math.floor(ttl / 2);
    const revalidationKey = `${key}:revalidating`;

    // Check if revalidation is in progress
    const isRevalidating = await this.cacheProvider.exists(revalidationKey);

    // Try to get cached value
    const cached = await this.getCached<{ data: T; timestamp: number }>(key);

    if (cached) {
      const age = (Date.now() - cached.timestamp) / 1000; // Age in seconds

      // If data is fresh, return immediately
      if (age < staleTime) {
        return cached.data;
      }

      // If data is stale but not expired, return stale data and revalidate in background
      if (age < ttl && !isRevalidating) {
        // Trigger background revalidation (don't await)
        void this.revalidate(key, revalidationKey, fetchFn, ttl);
        return cached.data;
      }
    }

    // Cache miss or expired - fetch fresh data
    if (isRevalidating) {
      // Wait a bit for revalidation to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      const revalidated = await this.getCached<{ data: T; timestamp: number }>(key);
      if (revalidated) {
        return revalidated.data;
      }
    }

    return this.fetchAndCache(key, fetchFn, ttl);
  }

  /**
   * Revalidate cache in background
   */
  private async revalidate<T>(
    key: string,
    revalidationKey: string,
    fetchFn: () => Promise<T>,
    ttl: number
  ): Promise<void> {
    try {
      // Set revalidation lock (expires in 30 seconds)
      await this.cacheProvider.set(revalidationKey, true, 30);

      // Fetch fresh data
      const data = await fetchFn();

      // Update cache
      await this.setCached(key, { data, timestamp: Date.now() }, ttl);

      // Remove revalidation lock
      await this.cacheProvider.del(revalidationKey);
    } catch {
      // Remove revalidation lock on error
      await this.cacheProvider.del(revalidationKey);
    }
  }

  /**
   * Fetch data and cache it
   */
  private async fetchAndCache<T>(key: string, fetchFn: () => Promise<T>, ttl: number): Promise<T> {
    const data = await fetchFn();
    await this.setCached(key, { data, timestamp: Date.now() }, ttl);
    return data;
  }
}
