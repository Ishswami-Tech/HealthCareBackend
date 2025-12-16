/**
 * Query Cache Service
 * @class QueryCacheService
 * @description Caches database query results for improved performance
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
// Use direct imports to avoid TDZ issues with barrel exports
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';

export interface QueryCacheOptions {
  ttl?: number;
  tags?: string[];
  containsPHI?: boolean;
  priority?: 'low' | 'normal' | 'high';
}

/**
 * Query cache service
 * @internal
 */
@Injectable()
export class QueryCacheService {
  private readonly serviceName = 'QueryCacheService';
  private readonly defaultTTL = 300; // 5 minutes
  private readonly defaultPHITTL = 60; // 1 minute for PHI data

  constructor(
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Generate cache key for query
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  generateCacheKey(operation: string, params?: Record<string, unknown>): string {
    const paramsHash = params ? JSON.stringify(params) : '';
    const key = `db:query:${operation}:${paramsHash}`;
    return key;
  }

  /**
   * Get cached query result
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  async getCached<T>(cacheKey: string): Promise<T | null> {
    try {
      const cached = await this.cacheService.get<T>(cacheKey);
      if (cached) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.DEBUG,
          `Cache hit for query: ${cacheKey.substring(0, 100)}`,
          this.serviceName
        );
      }
      return cached;
    } catch (error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.WARN,
        `Cache get failed: ${error instanceof Error ? error.message : String(error)}`,
        this.serviceName,
        { error: error instanceof Error ? error.stack : String(error) }
      );
      return null;
    }
  }

  /**
   * Cache query result
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  async setCached<T>(cacheKey: string, data: T, options: QueryCacheOptions = {}): Promise<void> {
    try {
      const ttl = options.containsPHI
        ? (options.ttl ?? this.defaultPHITTL)
        : (options.ttl ?? this.defaultTTL);

      // Use cache() method which accepts CacheOperationOptions
      await this.cacheService.cache(cacheKey, () => Promise.resolve(data), {
        ttl,
        tags: options.tags ?? ['database', 'query'],
        priority: options.priority ?? 'normal',
        containsPHI: options.containsPHI ?? false,
      });

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Cached query result: ${cacheKey.substring(0, 100)}`,
        this.serviceName,
        { ttl, containsPHI: options.containsPHI }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.WARN,
        `Cache set failed: ${error instanceof Error ? error.message : String(error)}`,
        this.serviceName,
        { error: error instanceof Error ? error.stack : String(error) }
      );
    }
  }

  /**
   * Invalidate query cache
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  async invalidateCache(pattern?: string, tags?: string[]): Promise<void> {
    try {
      if (pattern) {
        await this.cacheService.invalidateByPattern(pattern);
      }
      if (tags && tags.length > 0) {
        // Invalidate each tag individually
        for (const tag of tags) {
          await this.cacheService.invalidateCacheByTag(tag);
        }
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.WARN,
        `Cache invalidation failed: ${error instanceof Error ? error.message : String(error)}`,
        this.serviceName,
        { error: error instanceof Error ? error.stack : String(error) }
      );
    }
  }
}
