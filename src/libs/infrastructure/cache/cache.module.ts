/**
 * Cache Module
 * @module CacheModule
 * @description Provider-agnostic cache module with SOLID architecture
 *
 * Supports multiple cache providers:
 * - Dragonfly (default - 26x faster than Redis)
 * - Redis (fallback/alternative)
 * - Future: Memcached, In-Memory, etc.
 *
 * Provider selection via CACHE_PROVIDER environment variable:
 * - CACHE_PROVIDER=dragonfly (default)
 * - CACHE_PROVIDER=redis
 */

import { Module, Global, forwardRef } from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule } from '@config';
import { EventsModule } from '@infrastructure/events';
import { ResilienceModule } from '@core/resilience';
// CacheErrorHandler is provided by global ErrorsModule (imported in app.module.ts)
// LoggingModule is @Global() and already available - LoggingService can be injected

// Controllers
import { CacheController } from '@infrastructure/cache/controllers/cache.controller';

// Services
import { CacheService } from '@infrastructure/cache/cache.service';
import { CacheMetricsService } from '@infrastructure/cache/services/cache-metrics.service';
import { FeatureFlagsService } from '@infrastructure/cache/services/feature-flags.service';
import { CacheVersioningService } from '@infrastructure/cache/services/cache-versioning.service';
// CacheErrorHandler is now provided by global ErrorsModule

// Factories
import { CacheKeyFactory } from '@infrastructure/cache/factories/cache-key.factory';

// Repositories
import { CacheRepository } from '@infrastructure/cache/repositories/cache.repository';

// Providers
import { RedisCacheProvider } from '@infrastructure/cache/providers/redis-cache.provider';
import { DragonflyCacheProvider } from '@infrastructure/cache/providers/dragonfly-cache.provider';
import { CacheProviderFactory } from '@infrastructure/cache/providers/cache-provider.factory';

// Strategies
import { CacheStrategyManager } from '@infrastructure/cache/strategies/cache-strategy.manager';
// Note: Individual strategies (SWRCacheStrategy, StandardCacheStrategy, etc.) are instantiated
// manually in CacheStrategyManager, so they don't need to be imported here

// Middleware
import { CacheMiddlewareChain } from '@infrastructure/cache/middleware/cache-middleware.chain';
import { ValidationCacheMiddleware } from '@infrastructure/cache/middleware/validation-cache.middleware';
import { MetricsCacheMiddleware } from '@infrastructure/cache/middleware/metrics-cache.middleware';

// Interceptors - Centralized
import { HealthcareCacheInterceptor } from '@core/interceptors';

// Redis Module
import { RedisModule } from '@infrastructure/cache/redis/redis.module';
// Dragonfly Module
import { DragonflyModule } from '@infrastructure/cache/dragonfly/dragonfly.module';
import { LoggingService } from '@infrastructure/logging';

/**
 * Cache Module with SOLID architecture and provider-agnostic design
 *
 * Note: Both RedisModule and DragonflyModule are imported because:
 * - RedisCacheProvider depends on RedisService
 * - DragonflyCacheProvider depends on DragonflyService
 * When using one provider, the other module still needs to be available but won't be used.
 * This is acceptable as both providers can coexist.
 */
@Global()
@Module({
  imports: [
    forwardRef(() => ConfigModule),
    EventEmitterModule,
    forwardRef(() => EventsModule),
    RedisModule, // Required for RedisCacheProvider (even if using Dragonfly)
    DragonflyModule, // Required for DragonflyCacheProvider (even if using Redis)
    ResilienceModule, // Provides CircuitBreakerService
    // LoggingModule is @Global() and already available - no need to import
  ],
  controllers: [CacheController],
  providers: [
    // Core Services
    CacheService,

    // Infrastructure Services
    // CircuitBreakerService is now provided by ResilienceModule
    CacheMetricsService,
    FeatureFlagsService,
    CacheVersioningService,
    // CacheErrorHandler is provided by global ErrorsModule (imported in app.module.ts)

    // Factories
    CacheKeyFactory,

    // Providers (adapters) - Provider-agnostic architecture
    RedisCacheProvider,
    DragonflyCacheProvider,
    CacheProviderFactory,

    // Strategies
    // Note: Individual strategies are instantiated manually in CacheStrategyManager
    // They don't need to be providers since they're created with dependencies in the manager
    CacheStrategyManager,

    // Middleware
    ValidationCacheMiddleware,
    MetricsCacheMiddleware,
    CacheMiddlewareChain,

    // Repository
    CacheRepository,

    // Global Interceptor - useClass with proper dependency injection
    // CacheService and LoggingService are available via @Global() modules
    {
      provide: APP_INTERCEPTOR,
      useClass: HealthcareCacheInterceptor,
    },
  ],
  exports: [
    // Only export CacheService as single entry point
    CacheService,
    // Export key factory for convenience
    CacheKeyFactory,
  ],
})
export class CacheModule {}
