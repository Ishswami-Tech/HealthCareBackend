/**
 * Health Cache Service
 * Multi-level caching for health status
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { AggregatedHealthStatus, ServiceHealthStatus } from '@core/types';

@Injectable()
export class HealthCacheService {
  // L1: In-memory cache (fastest)
  private readonly memoryCache = new Map<string, { data: unknown; timestamp: number }>();
  private readonly MEMORY_TTL_MS = 10000; // 10 seconds

  // Cache keys
  private readonly CACHE_KEY_PREFIX = 'health:status:';
  private readonly OVERALL_KEY = 'health:status:overall';
  private readonly SERVICE_KEY_PREFIX = 'health:status:service:';

  constructor(
    @Optional()
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService?: CacheService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  /**
   * Get cached health status (L1: memory, L2: distributed cache)
   */
  async getCachedStatus(): Promise<AggregatedHealthStatus | null> {
    try {
      // L1: Check memory cache first
      const memoryCached = this.memoryCache.get(this.OVERALL_KEY);
      if (memoryCached && Date.now() - memoryCached.timestamp < this.MEMORY_TTL_MS) {
        return memoryCached.data as AggregatedHealthStatus;
      }

      // L2: Check distributed cache
      if (this.cacheService) {
        const cached = await this.cacheService.get<AggregatedHealthStatus>(this.OVERALL_KEY);
        if (cached) {
          // Update memory cache
          this.memoryCache.set(this.OVERALL_KEY, {
            data: cached,
            timestamp: Date.now(),
          });
          return cached;
        }
      }

      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to get cached health status: ${errorMessage}`,
        'HealthCacheService',
        { error: errorMessage }
      );

      return null;
    }
  }

  /**
   * Cache health status (L1: memory, L2: distributed cache)
   */
  async cacheStatus(status: AggregatedHealthStatus): Promise<void> {
    try {
      // L1: Update memory cache
      this.memoryCache.set(this.OVERALL_KEY, {
        data: status,
        timestamp: Date.now(),
      });

      // L2: Update distributed cache (30 second TTL)
      if (this.cacheService) {
        await this.cacheService.set(this.OVERALL_KEY, status, 30);
      }

      // Cache individual services
      for (const [serviceName, serviceStatus] of Object.entries(status.services)) {
        const serviceKey = `${this.SERVICE_KEY_PREFIX}${serviceName}`;
        this.memoryCache.set(serviceKey, {
          data: serviceStatus,
          timestamp: Date.now(),
        });

        if (this.cacheService) {
          await this.cacheService.set(serviceKey, serviceStatus, 30);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to cache health status: ${errorMessage}`,
        'HealthCacheService',
        { error: errorMessage }
      );
    }
  }

  /**
   * Get cached service status
   */
  async getCachedServiceStatus(serviceName: string): Promise<ServiceHealthStatus | null> {
    try {
      const serviceKey = `${this.SERVICE_KEY_PREFIX}${serviceName}`;

      // L1: Check memory cache
      const memoryCached = this.memoryCache.get(serviceKey);
      if (memoryCached && Date.now() - memoryCached.timestamp < this.MEMORY_TTL_MS) {
        return memoryCached.data as ServiceHealthStatus;
      }

      // L2: Check distributed cache
      if (this.cacheService) {
        const cached = await this.cacheService.get<ServiceHealthStatus>(serviceKey);
        if (cached) {
          this.memoryCache.set(serviceKey, {
            data: cached,
            timestamp: Date.now(),
          });
          return cached;
        }
      }

      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to get cached service status: ${errorMessage}`,
        'HealthCacheService',
        { serviceName, error: errorMessage }
      );

      return null;
    }
  }

  /**
   * Invalidate cache
   */
  invalidateCache(): void {
    try {
      // Clear memory cache
      this.memoryCache.clear();

      // Clear distributed cache (optional - let TTL handle it)
      if (this.cacheService) {
        // Could implement pattern-based deletion if needed
        // For now, let TTL handle expiration
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to invalidate cache: ${errorMessage}`,
        'HealthCacheService',
        { error: errorMessage }
      );
    }
  }

  /**
   * Clean up expired memory cache entries
   */
  cleanupMemoryCache(): void {
    const now = Date.now();
    for (const [key, value] of this.memoryCache.entries()) {
      if (now - value.timestamp > this.MEMORY_TTL_MS * 2) {
        // Remove entries older than 2x TTL
        this.memoryCache.delete(key);
      }
    }
  }
}
