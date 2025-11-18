/**
 * Query Cache Service
 * @class QueryCacheService
 * @description Caches query results for improved performance
 * Follows Single Responsibility Principle - only handles query result caching
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

export interface QueryCacheOptions {
  ttl?: number;
  key?: string;
  tags?: string[];
  forceRefresh?: boolean;
}

@Injectable()
export class QueryCacheService {
  private readonly serviceName = 'QueryCacheService';
  private readonly DEFAULT_TTL = 300; // 5 minutes

  constructor(
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Cache query result
   */
  async cacheQueryResult<T>(
    query: string,
    fetchFn: () => Promise<T>,
    options: QueryCacheOptions = {}
  ): Promise<T> {
    const cacheKey = options.key || this.generateCacheKey(query);
    const ttl = options.ttl || this.DEFAULT_TTL;

    try {
      return await this.cacheService.cache(cacheKey, fetchFn, {
        ttl,
        tags: options.tags || ['database', 'query'],
        ...(options.forceRefresh !== undefined && { forceRefresh: options.forceRefresh }),
      });
    } catch (error) {
      // If caching fails, still execute the query
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.WARN,
        'Query cache operation failed, executing query directly',
        this.serviceName,
        { error: error instanceof Error ? error.message : String(error) }
      );
      return fetchFn();
    }
  }

  /**
   * Invalidate query cache
   */
  async invalidateQueryCache(pattern: string): Promise<number> {
    try {
      return await this.cacheService.invalidateCacheByPattern(pattern);
    } catch (error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.WARN,
        'Query cache invalidation failed',
        this.serviceName,
        { error: error instanceof Error ? error.message : String(error) }
      );
      return 0;
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    try {
      let total = 0;
      for (const tag of tags) {
        total += await this.cacheService.invalidateCacheByTag(tag);
      }
      return total;
    } catch (error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.WARN,
        'Query cache invalidation by tags failed',
        this.serviceName,
        { error: error instanceof Error ? error.message : String(error) }
      );
      return 0;
    }
  }

  /**
   * Generate cache key from query
   */
  private generateCacheKey(query: string): string {
    // Simple hash of query string
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `db:query:${Math.abs(hash)}`;
  }
}
