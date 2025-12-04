/**
 * Cache Repository
 * @class CacheRepository
 * @description Repository pattern implementation for cache operations
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import type { ICacheRepository, ICacheProvider, CacheOperationOptions } from '@core/types';
import { CacheStrategyManager } from '@infrastructure/cache/strategies/cache-strategy.manager';
import { CacheMiddlewareChain } from '@infrastructure/cache/middleware/cache-middleware.chain';
import { CacheVersioningService } from '@infrastructure/cache/services/cache-versioning.service';
import { CacheKeyFactory } from '@infrastructure/cache/factories/cache-key.factory';
import { CacheProviderFactory } from '@infrastructure/cache/providers/cache-provider.factory';

/**
 * Cache repository implementation
 */
@Injectable()
export class CacheRepository implements ICacheRepository {
  private cacheProvider: ICacheProvider | undefined;

  constructor(
    @Inject(forwardRef(() => CacheProviderFactory))
    private readonly providerFactory: CacheProviderFactory,
    @Inject(CacheStrategyManager)
    private readonly strategyManager: CacheStrategyManager,
    @Inject(CacheMiddlewareChain)
    private readonly middlewareChain: CacheMiddlewareChain,
    @Inject(CacheVersioningService)
    private readonly versioningService: CacheVersioningService,
    @Inject(CacheKeyFactory)
    private readonly keyFactory: CacheKeyFactory
  ) {
    // Don't initialize provider in constructor - lazy load on first use
    // This prevents initialization errors when providers aren't ready yet
  }

  /**
   * Get or initialize cache provider (lazy loading)
   * This ensures provider is initialized when first needed, not during constructor
   */
  private getCacheProvider(): ICacheProvider {
    if (!this.cacheProvider || typeof this.cacheProvider.set !== 'function') {
      // Defensive check: ensure providerFactory is available
      if (!this.providerFactory || typeof this.providerFactory.getBasicProvider !== 'function') {
        throw new Error(
          'CacheProviderFactory is not initialized. Cannot get cache provider. This may indicate cache service initialization failure.'
        );
      }
      // Get provider from factory (provider-agnostic)
      const provider = this.providerFactory.getBasicProvider();
      if (!provider || typeof provider.set !== 'function') {
        throw new Error(
          'CacheProviderFactory.getBasicProvider() returned undefined or invalid provider. Cache may not be properly initialized.'
        );
      }
      this.cacheProvider = provider;
    }
    return this.cacheProvider;
  }

  /**
   * Cache data with automatic fetch on miss
   */
  async cache<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions = {}
  ): Promise<T> {
    // Version the key
    const versionedKey = this.versioningService.versionKey(key);

    // Execute middleware before
    const context = await this.middlewareChain.executeBefore({
      key: versionedKey,
      options,
    });

    try {
      // Execute cache strategy
      const result = await this.strategyManager.execute(context.key, fetchFn, context.options);

      // Execute middleware after
      return await this.middlewareChain.executeAfter(context, result);
    } catch (error) {
      // Execute middleware on error
      const processedError = await this.middlewareChain.executeError(
        context,
        error instanceof Error ? error : new Error(String(error))
      );
      throw processedError;
    }
  }

  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    const versionedKey = this.versioningService.versionKey(key);
    const provider = this.getCacheProvider();
    return provider.get<T>(versionedKey);
  }

  /**
   * Set cached value
   */
  async set<T>(key: string, value: T, options: CacheOperationOptions = {}): Promise<void> {
    const versionedKey = this.versioningService.versionKey(key);
    const ttl = this.calculateTTL(options);
    const provider = this.getCacheProvider();
    await provider.set(versionedKey, value, ttl);
  }

  /**
   * Delete cached value
   */
  async delete(key: string): Promise<boolean> {
    const versionedKey = this.versioningService.versionKey(key);
    const provider = this.getCacheProvider();
    const deleted = await provider.del(versionedKey);
    return deleted > 0;
  }

  /**
   * Delete multiple keys
   */
  async deleteMultiple(keys: readonly string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    const versionedKeys = keys.map(key => this.versioningService.versionKey(key));
    const provider = this.getCacheProvider();
    return provider.delMultiple(versionedKeys);
  }

  /**
   * Get multiple values
   */
  async getMultiple<T>(keys: readonly string[]): Promise<Map<string, T | null>> {
    if (keys.length === 0) {
      return new Map<string, T | null>();
    }
    const versionedKeys = keys.map(key => this.versioningService.versionKey(key));
    const provider = this.getCacheProvider();
    const result = await provider.getMultiple<T>(versionedKeys);
    // Map back to original keys
    const mapped = new Map<string, T | null>();
    keys.forEach((key, index) => {
      const versionedKey = versionedKeys[index];
      if (versionedKey) {
        mapped.set(key, result.get(versionedKey) ?? null);
      } else {
        mapped.set(key, null);
      }
    });
    return mapped;
  }

  /**
   * Set multiple values
   */
  async setMultiple<T>(
    entries: ReadonlyArray<{ key: string; value: T; ttl?: number }>
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    const versionedEntries = entries.map(entry => ({
      key: this.versioningService.versionKey(entry.key),
      value: entry.value,
      ...(entry.ttl !== undefined && { ttl: entry.ttl }),
    }));
    const provider = this.getCacheProvider();
    await provider.setMultiple(versionedEntries);
  }

  /**
   * Invalidate by pattern
   */
  async invalidateByPattern(pattern: string): Promise<number> {
    // Version the pattern
    const versionedPattern = `${pattern}:v*`;
    const provider = this.getCacheProvider();
    return provider.clearByPattern(versionedPattern);
  }

  /**
   * Invalidate by tags
   */
  async invalidateByTags(tags: readonly string[]): Promise<number> {
    // This would require tag tracking - simplified for now
    let total = 0;
    const provider = this.getCacheProvider();
    for (const tag of tags) {
      const pattern = `*:tag:${tag}:*`;
      total += await provider.clearByPattern(pattern);
    }
    return total;
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    const versionedKey = this.versioningService.versionKey(key);
    const provider = this.getCacheProvider();
    return provider.exists(versionedKey);
  }

  /**
   * Get TTL for key
   */
  async getTTL(key: string): Promise<number> {
    const versionedKey = this.versioningService.versionKey(key);
    const provider = this.getCacheProvider();
    return provider.ttl(versionedKey);
  }

  /**
   * Calculate TTL from options
   */
  private calculateTTL(options: CacheOperationOptions): number {
    if (options.ttl) {
      return options.ttl;
    }

    if (options.emergencyData) return 300;
    if (options.containsPHI) return 1800;
    if (options.patientSpecific) return 3600;
    if (options.doctorSpecific) return 7200;
    if (options.clinicSpecific) return 14400;

    switch (options.complianceLevel) {
      case 'restricted':
        return 900;
      case 'sensitive':
        return 1800;
      default:
        return 3600;
    }
  }
}
