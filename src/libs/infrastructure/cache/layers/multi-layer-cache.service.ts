/**
 * Multi-Layer Cache Service
 * @class MultiLayerCacheService
 * @description Orchestrates multi-layer cache architecture (L1 → L2 → L3)
 *
 * Cache Layers:
 * - L1: In-Memory Cache (fastest, process-local, limited size)
 * - L2: Distributed Cache (Redis/Dragonfly - shared across instances)
 * - L3: Database (PostgreSQL - persistent storage)
 *
 * Flow:
 * 1. Check L1 (in-memory) - if hit, return immediately
 * 2. Check L2 (distributed) - if hit, populate L1 and return
 * 3. Fetch from L3 (database) - populate both L1 and L2, then return
 *
 * @see https://docs.nestjs.com - NestJS patterns
 */

import { Injectable, Inject, forwardRef, Optional } from '@nestjs/common';
import { ConfigService } from '@config';
import { LoggingService } from '@infrastructure/logging';
import { CacheService } from '@infrastructure/cache/cache.service';
import { InMemoryCacheService } from './in-memory-cache.service';
import type { CacheOperationOptions } from '@core/types';
import { LogType, LogLevel } from '@core/types';

/**
 * Multi-layer cache service
 * Orchestrates cache operations across L1 (in-memory), L2 (distributed), and L3 (database)
 */
@Injectable()
export class MultiLayerCacheService {
  private readonly enableL1: boolean;
  private readonly l1TTL: number;

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => CacheService))
    private readonly l2CacheService: CacheService, // L2: Distributed cache (existing CacheService)
    @Optional()
    @Inject(forwardRef(() => InMemoryCacheService))
    private readonly l1CacheService: InMemoryCacheService | null, // L1: In-memory cache
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    // Load configuration
    this.enableL1 = this.configService.getEnvBoolean('L1_CACHE_ENABLED', true);
    this.l1TTL = this.configService.getEnvNumber('L1_CACHE_DEFAULT_TTL', 30); // 30 seconds default
  }

  /**
   * Get value from multi-layer cache
   * Checks L1 → L2 → L3 (database via fetchFn)
   *
   * @param key - Cache key
   * @param fetchFn - Function to fetch from L3 (database) if not in cache
   * @param options - Cache options
   * @returns Cached or fetched value
   */
  async get<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions = {}
  ): Promise<T> {
    // L1: Check in-memory cache first (fastest)
    if (this.enableL1 && this.l1CacheService) {
      const l1Value = this.l1CacheService.get<T>(key);
      if (l1Value !== null) {
        // L1 hit - return immediately
        return l1Value;
      }
    }

    // L2: Check distributed cache (Redis/Dragonfly)
    // Use existing CacheService which handles L2 operations
    try {
      const l2Value = await this.l2CacheService.get<T>(key);
      if (l2Value !== null) {
        // L2 hit - populate L1 for faster next access
        if (this.enableL1 && this.l1CacheService) {
          // Use shorter TTL for L1 (typically 30s) vs L2 (longer TTL)
          const l1TTL = options.ttl ? Math.min(options.ttl, this.l1TTL) : this.l1TTL;
          this.l1CacheService.set(key, l2Value, l1TTL);
        }
        return l2Value;
      }
    } catch (l2Error) {
      // L2 error - log but continue to L3
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.WARN,
        'L2 cache error, falling back to L3',
        'MultiLayerCacheService',
        {
          key,
          error: l2Error instanceof Error ? l2Error.message : String(l2Error),
        }
      );
    }

    // L3: Fetch from database (via fetchFn)
    const data = await fetchFn();

    // Populate both L1 and L2 after fetching from L3
    try {
      // Populate L2 (distributed cache) with longer TTL
      // Use CacheService.set which accepts ttl as number
      const l2TTL = options.ttl || 3600; // Default 1 hour for L2
      await this.l2CacheService.set(key, data, l2TTL);

      // Populate L1 (in-memory) with shorter TTL
      if (this.enableL1 && this.l1CacheService) {
        const l1TTL = options.ttl ? Math.min(options.ttl, this.l1TTL) : this.l1TTL;
        this.l1CacheService.set(key, data, l1TTL);
      }
    } catch (populateError) {
      // Log but don't fail - data is already fetched
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.WARN,
        'Failed to populate cache layers, data still returned',
        'MultiLayerCacheService',
        {
          key,
          error: populateError instanceof Error ? populateError.message : String(populateError),
        }
      );
    }

    return data;
  }

  /**
   * Cache data with automatic multi-layer population
   * This is the main method that should be used instead of direct cache calls
   *
   * @param key - Cache key
   * @param fetchFn - Function to fetch from L3 (database) if not in cache
   * @param options - Cache options
   * @returns Cached or fetched value
   */
  async cache<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions = {}
  ): Promise<T> {
    // Use the unified get method which handles all layers
    return this.get(key, fetchFn, options);
  }

  /**
   * Set value in all cache layers
   *
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Time to live in seconds (for L2)
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    // Set in L2 (distributed cache)
    await this.l2CacheService.set(key, value, ttl);

    // Set in L1 (in-memory cache) with shorter TTL
    if (this.enableL1 && this.l1CacheService) {
      const l1TTL = ttl ? Math.min(ttl, this.l1TTL) : this.l1TTL;
      this.l1CacheService.set(key, value, l1TTL);
    }
  }

  /**
   * Delete value from all cache layers
   *
   * @param key - Cache key
   */
  async delete(key: string): Promise<boolean> {
    let deleted = false;

    // Delete from L2
    const l2Deleted = await this.l2CacheService.delete(key);
    deleted = deleted || l2Deleted;

    // Delete from L1
    if (this.enableL1 && this.l1CacheService) {
      const l1Deleted = this.l1CacheService.delete(key);
      deleted = deleted || l1Deleted;
    }

    return deleted;
  }

  /**
   * Invalidate cache by pattern across all layers
   *
   * @param pattern - Cache key pattern
   */
  async invalidateByPattern(pattern: string): Promise<void> {
    // Invalidate L2
    await this.l2CacheService.invalidateCacheByPattern(pattern);

    // L1 doesn't support pattern matching, so we clear it entirely
    // This is acceptable since L1 is small and fast to rebuild
    if (this.enableL1 && this.l1CacheService) {
      this.l1CacheService.clear();
    }
  }

  /**
   * Invalidate cache by tag across all layers
   *
   * @param tag - Cache tag
   */
  async invalidateByTag(tag: string): Promise<void> {
    // Invalidate L2
    await this.l2CacheService.invalidateCacheByTag(tag);

    // L1 doesn't support tags, so we clear it entirely
    if (this.enableL1 && this.l1CacheService) {
      this.l1CacheService.clear();
    }
  }

  /**
   * Get statistics from all cache layers
   */
  getStats(): {
    l1?: {
      size: number;
      maxSize: number;
      hitCount: number;
      missCount: number;
      hitRate: number;
      estimatedMemoryMB: number;
    };
    l2: {
      totalRequests: number;
      successfulRequests: number;
      failedRequests: number;
      cacheHitRate: number;
      averageResponseTime: number;
    };
  } {
    const l2Stats = this.l2CacheService.getCacheMetrics();

    const stats: {
      l1?: {
        size: number;
        maxSize: number;
        hitCount: number;
        missCount: number;
        hitRate: number;
        estimatedMemoryMB: number;
      };
      l2: {
        totalRequests: number;
        successfulRequests: number;
        failedRequests: number;
        cacheHitRate: number;
        averageResponseTime: number;
      };
    } = {
      l2: {
        totalRequests: l2Stats.totalRequests,
        successfulRequests: l2Stats.successfulRequests,
        failedRequests: l2Stats.failedRequests,
        cacheHitRate: l2Stats.cacheHitRate,
        averageResponseTime: l2Stats.averageResponseTime,
      },
    };

    if (this.enableL1 && this.l1CacheService) {
      const l1Stats = this.l1CacheService.getStats();
      stats.l1 = {
        size: l1Stats.size,
        maxSize: l1Stats.maxSize,
        hitCount: l1Stats.hitCount,
        missCount: l1Stats.missCount,
        hitRate: l1Stats.hitRate,
        estimatedMemoryMB: l1Stats.estimatedMemoryMB,
      };
    }

    return stats;
  }
}
