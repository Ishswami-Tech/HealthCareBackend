/**
 * Cache Provider Factory
 * @class CacheProviderFactory
 * @description Factory for creating cache providers based on configuration
 * Supports multiple providers: Redis, Dragonfly, Memcached, In-Memory
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService, isCacheEnabled, getCacheProvider } from '@config';
import type { IAdvancedCacheProvider, ICacheProvider } from '@core/types';
import { RedisCacheProvider } from './redis-cache.provider';
import { DragonflyCacheProvider } from './dragonfly-cache.provider';

/**
 * Supported cache provider types
 */
export type CacheProviderType = 'redis' | 'dragonfly' | 'memcached' | 'memory';

/**
 * Cache provider factory
 */
@Injectable()
export class CacheProviderFactory {
  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    private readonly redisProvider: RedisCacheProvider,
    private readonly dragonflyProvider: DragonflyCacheProvider
  ) {}

  /**
   * Get the configured cache provider
   * Returns a no-op provider if cache is disabled
   */
  getProvider(): IAdvancedCacheProvider {
    // Check if cache is enabled using single source of truth
    if (!isCacheEnabled()) {
      // Return a no-op provider that does nothing (graceful degradation)
      return this.getNoOpProvider();
    }

    const providerType = getCacheProvider();

    switch (providerType) {
      case 'redis':
        return this.redisProvider;
      case 'dragonfly':
      default:
        return this.dragonflyProvider; // Default to Dragonfly
    }
  }

  /**
   * Get basic cache provider (for strategies that only need basic operations)
   */
  getBasicProvider(): ICacheProvider {
    return this.getProvider();
  }

  /**
   * Get a no-op provider that does nothing when cache is disabled
   * This allows the app to work without cache gracefully
   */
  private getNoOpProvider(): IAdvancedCacheProvider {
    // Return a no-op implementation that does nothing
    // This allows the app to work without cache
    return {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(undefined),
      del: () => Promise.resolve(0),
      exists: () => Promise.resolve(false),
      ttl: () => Promise.resolve(-1),
      expire: () => Promise.resolve(0),
      delMultiple: () => Promise.resolve(0),
      getMultiple: () => Promise.resolve(new Map()),
      setMultiple: () => Promise.resolve(undefined),
      clearByPattern: () => Promise.resolve(0),
      ping: () => Promise.resolve('PONG'),
      isHealthy: () => Promise.resolve(true),
      getCacheMetrics: () =>
        Promise.resolve({
          keys: 0,
          hitRate: 0,
          memory: { used: 0, peak: 0, fragmentation: 0 },
          operations: { hits: 0, misses: 0 },
        }),
      getCacheStats: () => Promise.resolve({ hits: 0, misses: 0 }),
      getHealthStatus: () => Promise.resolve([true, 0]),
      getCacheDebug: () => Promise.resolve({ status: 'disabled', provider: 'memory' }),
      clearAllCache: () => Promise.resolve(0),
      resetCacheStats: () => Promise.resolve(undefined),
      isRateLimited: () => Promise.resolve(false),
      getRateLimit: () => Promise.resolve({ remaining: 999999, reset: 0, total: 999999, used: 0 }),
      clearRateLimit: () => Promise.resolve(undefined),
      updateRateLimits: () => Promise.resolve(undefined),
      getRateLimitConfig: () => ({ limit: 999999, window: 60 }),
      trackSecurityEvent: () => Promise.resolve(undefined),
      getSecurityEvents: () => Promise.resolve([]),
      clearSecurityEvents: () => Promise.resolve(undefined),
      hSet: () => Promise.resolve(0),
      hGet: () => Promise.resolve(null),
      hGetAll: () => Promise.resolve({}),
      hDel: () => Promise.resolve(0),
      hincrby: () => Promise.resolve(0),
      rPush: () => Promise.resolve(0),
      lRange: () => Promise.resolve([]),
      lLen: () => Promise.resolve(0),
      lTrim: () => Promise.resolve('OK'),
      sAdd: () => Promise.resolve(0),
      sMembers: () => Promise.resolve([]),
      sRem: () => Promise.resolve(0),
      sCard: () => Promise.resolve(0),
      zadd: () => Promise.resolve(0),
      zcard: () => Promise.resolve(0),
      zrevrange: () => Promise.resolve([]),
      zrangebyscore: () => Promise.resolve([]),
      zremrangebyscore: () => Promise.resolve(0),
      publish: () => Promise.resolve(0),
      subscribe: () => Promise.resolve(undefined),
      expireAt: () => Promise.resolve(0),
      incr: () => Promise.resolve(0),
      keys: () => Promise.resolve([]),
      multi: () => Promise.resolve([]),
      retryOperation: <T>(operation: () => Promise<T>) => operation(),
    } as IAdvancedCacheProvider;
  }

  /**
   * Check if provider supports advanced features
   */
  supportsAdvancedFeatures(provider: ICacheProvider): provider is IAdvancedCacheProvider {
    return 'getCacheMetrics' in provider && typeof provider.getCacheMetrics === 'function';
  }
}
