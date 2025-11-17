/**
 * Cache Module Exports
 *
 * @module Cache
 * @description Provider-agnostic caching service for healthcare applications
 *
 * Supports multiple cache providers:
 * - Redis (default)
 * - Dragonfly (high-performance alternative)
 * - Future: Memcached, In-Memory, etc.
 *
 * Usage:
 * - Set CACHE_PROVIDER environment variable to select provider
 * - Use CacheService as the single entry point for all cache operations
 *
 * Note: HealthcareCacheInterceptor is now exported from @core/interceptors
 */
export { CacheService } from './cache.service';
export { CacheModule } from './cache.module';
export * from './controllers/cache.controller';
export { CacheOptionsBuilder } from './builders/cache-options.builder';
export { CacheKeyFactory } from './factories/cache-key.factory';

// Providers (for advanced usage)
export { CacheProviderFactory } from './providers/cache-provider.factory';
export { RedisCacheProvider } from './providers/redis-cache.provider';
export { DragonflyCacheProvider } from './providers/dragonfly-cache.provider';
