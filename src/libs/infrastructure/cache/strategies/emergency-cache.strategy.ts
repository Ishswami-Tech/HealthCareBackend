/**
 * Emergency Cache Strategy
 * @class EmergencyCacheStrategy
 * @description Minimal caching for emergency data
 */

import { Injectable } from '@nestjs/common';
import { BaseCacheStrategy } from '@infrastructure/cache/strategies/base-cache.strategy';
import type { CacheOperationOptions } from '@core/types';
import type { ICacheProvider } from '@core/types';

/**
 * Emergency cache strategy - minimal TTL, no SWR, always fresh
 */
@Injectable()
export class EmergencyCacheStrategy extends BaseCacheStrategy {
  readonly name = 'Emergency';

  constructor(cacheProvider: ICacheProvider) {
    super(cacheProvider);
  }

  shouldUse(options: CacheOperationOptions): boolean {
    return options.emergencyData === true;
  }

  async execute<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions
  ): Promise<T> {
    // Emergency data - always fetch fresh, cache with minimal TTL
    const data = await fetchFn();
    const ttl = Math.min(options.ttl ?? 300, 300); // Max 5 minutes
    await this.setCached(key, data, ttl);
    return data;
  }

  protected calculateTTL(_options: CacheOperationOptions): number {
    return 300; // Always 5 minutes for emergency data
  }
}
