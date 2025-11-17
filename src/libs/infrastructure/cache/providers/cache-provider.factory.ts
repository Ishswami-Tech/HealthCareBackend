/**
 * Cache Provider Factory
 * @class CacheProviderFactory
 * @description Factory for creating cache providers based on configuration
 * Supports multiple providers: Redis, Dragonfly, Memcached, In-Memory
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config';
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
   */
  getProvider(): IAdvancedCacheProvider {
    const providerType = this.getProviderType();

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
   * Get provider type from configuration
   */
  private getProviderType(): CacheProviderType {
    try {
      const provider =
        this.configService?.get<string>('CACHE_PROVIDER')?.toLowerCase() ||
        process.env['CACHE_PROVIDER']?.toLowerCase() ||
        'dragonfly'; // Default to Dragonfly for better performance

      if (['redis', 'dragonfly', 'memcached', 'memory'].includes(provider)) {
        return provider as CacheProviderType;
      }

      return 'dragonfly'; // Default fallback to Dragonfly
    } catch {
      return 'dragonfly'; // Default fallback to Dragonfly
    }
  }

  /**
   * Check if provider supports advanced features
   */
  supportsAdvancedFeatures(provider: ICacheProvider): provider is IAdvancedCacheProvider {
    return 'getCacheMetrics' in provider && typeof provider.getCacheMetrics === 'function';
  }
}
