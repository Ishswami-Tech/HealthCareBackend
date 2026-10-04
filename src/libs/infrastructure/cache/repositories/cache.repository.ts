/**
 * Cache Repository
 * @class CacheRepository
 * @description Repository pattern implementation for cache operations
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import type {
  ICacheRepository,
  ICacheProvider,
  IAdvancedCacheProvider,
  CacheOperationOptions,
} from '@core/types';
import { LogType, LogLevel } from '@core/types';
import type { LoggerLike } from '@core/types';
import { CacheStrategyManager } from '@infrastructure/cache/strategies/cache-strategy.manager';
import { CacheMiddlewareChain } from '@infrastructure/cache/middleware/cache-middleware.chain';
import { CacheVersioningService } from '@infrastructure/cache/services/cache-versioning.service';
import { CacheKeyFactory } from '@infrastructure/cache/factories/cache-key.factory';
import { CacheProviderFactory } from '@infrastructure/cache/providers/cache-provider.factory';
import {
  canDeleteKeysStrictly,
  canExtendExpiry,
  isProtectedKey,
} from '@infrastructure/cache/utils/protected-keys.util';
import { DELETE_BATCH_SIZE } from '@infrastructure/cache/utils/pattern-delete.util';

/** Slack added to an entry's TTL so its tag-index set outlives the entry. */
const TAG_SET_TTL_PADDING_SECONDS = 60;

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
    @Inject(forwardRef(() => CacheVersioningService))
    private readonly versioningService: CacheVersioningService,
    @Inject(CacheKeyFactory)
    private readonly keyFactory: CacheKeyFactory,
    // String token (not LoggingService) to avoid circular-import issues in infra boot code
    @Inject('LOGGING_SERVICE')
    private readonly loggingService: LoggerLike
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
   * Tag indexes map logical cache tags to the versioned keys that were written with them.
   * This makes invalidateByTags() deterministic instead of relying on key naming conventions.
   */
  private getTagIndexKey(tag: string): string {
    return `cache:tag:${tag}`;
  }

  private getAdvancedCacheProvider(): IAdvancedCacheProvider {
    return this.getCacheProvider() as IAdvancedCacheProvider;
  }

  private async registerTags(
    versionedKey: string,
    tags: readonly string[] | undefined,
    ttl: number
  ): Promise<void> {
    if (!tags || tags.length === 0) {
      return;
    }

    const provider = this.getAdvancedCacheProvider();
    const uniqueTags = [...new Set(tags.filter(Boolean))];

    await Promise.all(
      uniqueTags.map(async tag => {
        try {
          const tagKey = this.getTagIndexKey(tag);
          await provider.sAdd(tagKey, versionedKey);
          await this.extendTagSetExpiry(provider, tagKey, ttl + TAG_SET_TTL_PADDING_SECONDS);
        } catch (error) {
          // Cache tag bookkeeping must never fail the source operation, but a missing index
          // entry means the entry cannot be invalidated by tag, so say so.
          this.logBookkeepingFailure('Failed to register cache tag', tag, error);
        }
      })
    );
  }

  /**
   * A tag set is shared by every entry registered under the tag, and those entries have
   * different TTLs. The set must live as long as its longest-lived member, so its expiry is only
   * ever raised: letting the last registration decide (the old `EXPIRE tagKey ttl+60`) let a
   * short-lived entry shrink the set and orphan the long-lived ones.
   */
  private async extendTagSetExpiry(
    provider: ICacheProvider,
    tagKey: string,
    seconds: number
  ): Promise<void> {
    if (canExtendExpiry(provider)) {
      await provider.extendExpiry(tagKey, seconds);
      return;
    }
    const current = await provider.ttl(tagKey);
    if (current === -1 || current < seconds) {
      await provider.expire(tagKey, seconds);
    }
  }

  private logBookkeepingFailure(message: string, tag: string, error: unknown): void {
    void this.loggingService.log(LogType.CACHE, LogLevel.WARN, message, 'CacheRepository', {
      tag,
      error: error instanceof Error ? error.message : String(error),
    });
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
      const processedResult = await this.middlewareChain.executeAfter(context, result);
      await this.registerTags(
        context.key,
        context.options.tags,
        this.calculateTTL(context.options)
      );
      return processedResult;
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
    await this.registerTags(versionedKey, options.tags, ttl);
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
   * Invalidate by tags.
   *
   * Members are deleted in bounded chunks and removed from the tag set only after their chunk was
   * deleted successfully, so a failure part-way leaves the undeleted keys indexed for the next
   * invalidation instead of orphaning them. Removing exactly the processed members (rather than
   * deleting the whole set) also keeps entries registered while we were deleting.
   *
   * There is deliberately no keyspace-scan fallback for tags without an index: nothing writes
   * tag-encoded key names any more, and a `*:tag:<tag>:*` scan per empty tag was both expensive
   * and able to match the index sets of tags named `<tag>:...`.
   */
  async invalidateByTags(tags: readonly string[]): Promise<number> {
    let total = 0;
    const provider = this.getAdvancedCacheProvider();
    for (const tag of new Set(tags)) {
      total += await this.invalidateTag(provider, tag);
    }
    return total;
  }

  private async invalidateTag(provider: IAdvancedCacheProvider, tag: string): Promise<number> {
    const tagKey = this.getTagIndexKey(tag);
    const members = await provider.sMembers(tagKey);
    const protectedMembers = members.filter(isProtectedKey);
    if (protectedMembers.length > 0) {
      // Never delete security state through a tag; drop the stale index entries instead.
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.WARN,
        'Cache tag invalidation skipped keys in protected namespaces',
        'CacheRepository',
        { tag, skipped: protectedMembers.length }
      );
      await provider.sRem(tagKey, ...protectedMembers);
    }

    const deletable = members.filter(member => !isProtectedKey(member));
    let deleted = 0;
    for (let index = 0; index < deletable.length; index += DELETE_BATCH_SIZE) {
      const chunk = deletable.slice(index, index + DELETE_BATCH_SIZE);
      deleted += await this.deleteTagMembers(provider, chunk);
      await provider.sRem(tagKey, ...chunk);
    }
    return deleted;
  }

  /** Throws when the delete fails (when the provider can tell), so the caller keeps the index. */
  private deleteTagMembers(
    provider: IAdvancedCacheProvider,
    keys: readonly string[]
  ): Promise<number> {
    return canDeleteKeysStrictly(provider)
      ? provider.deleteKeysStrict(keys)
      : provider.delMultiple(keys);
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
   * Optimized TTLs to improve cache hit rate (target: 70%+)
   */
  private calculateTTL(options: CacheOperationOptions): number {
    if (options.ttl) {
      return options.ttl;
    }

    // Optimized TTLs for better cache hit rates
    if (options.emergencyData) return 600; // Increased from 300 to 10 minutes
    if (options.containsPHI) return 3600; // Increased from 1800 to 1 hour (PHI data changes less frequently)
    if (options.patientSpecific) return 7200; // Increased from 3600 to 2 hours
    if (options.doctorSpecific) return 14400; // Increased from 7200 to 4 hours (doctor data is relatively static)
    if (options.clinicSpecific) return 28800; // Increased from 14400 to 8 hours (clinic data changes infrequently)

    switch (options.complianceLevel) {
      case 'restricted':
        return 1800; // Increased from 900 to 30 minutes
      case 'sensitive':
        return 3600; // Increased from 1800 to 1 hour
      default:
        return 7200; // Increased from 3600 to 2 hours (default TTL for better hit rates)
    }
  }
}
