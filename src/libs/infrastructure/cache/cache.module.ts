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

import { Module, Global, forwardRef, DynamicModule, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule } from '@config';
import { EventsModule } from '@infrastructure/events';
import { ResilienceModule } from '@core/resilience';
import { DatabaseModule } from '@infrastructure/database';
// CacheErrorHandler is provided by global ErrorsModule (imported in app.module.ts)
// LoggingModule is @Global() and already available - LoggingService can be injected

// Controllers
import { CacheController } from '@infrastructure/cache/controllers/cache.controller';

// Services
import { CacheService } from '@infrastructure/cache/cache.service';
import { CacheMetricsService } from '@infrastructure/cache/services/cache-metrics.service';
import { FeatureFlagsService } from '@infrastructure/cache/services/feature-flags.service';
import { CacheVersioningService } from '@infrastructure/cache/services/cache-versioning.service';
import { CacheHealthMonitorService } from '@infrastructure/cache/services/cache-health-monitor.service';
import { CacheWarmingService } from '@infrastructure/cache/services/cache-warming.service';
// CacheErrorHandler is now provided by global ErrorsModule

// Multi-Layer Cache Services (L1)
import { InMemoryCacheService } from '@infrastructure/cache/layers/in-memory-cache.service';
import { MultiLayerCacheService } from '@infrastructure/cache/layers/multi-layer-cache.service';

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
// Schedule Module for cron jobs (only needed for CacheWarmingService, not in worker)
import { ScheduleModule } from '@nestjs/schedule';
// Queue Module for cache warming jobs (QueueService is @Global() from QueueModule)

/**
 * Cache Module with SOLID architecture and provider-agnostic design
 *
 * Note: Both RedisModule and DragonflyModule are imported because:
 * - RedisCacheProvider depends on RedisService
 * - DragonflyCacheProvider depends on DragonflyService
 * When using one provider, the other module still needs to be available but won't be used.
 * This is acceptable as both providers can coexist.
 *
 * IMPORTANT: CacheWarmingService uses @Cron decorators and requires ScheduleModule.
 * This should only run in the API service, not in the worker service.
 * Worker service only needs CacheService for queue processing.
 */
@Global()
@Module({})
export class CacheModule {
  static forRoot(): DynamicModule {
    // Check if this is a worker service - workers don't need CacheWarmingService or ScheduleModule
    const serviceName = process.env['SERVICE_NAME'] || 'clinic';
    const isWorker = serviceName === 'worker';

    const baseImports = [
      forwardRef(() => ConfigModule),
      EventEmitterModule,
      forwardRef(() => EventsModule),
      RedisModule, // Required for RedisCacheProvider (even if using Dragonfly)
      DragonflyModule, // Required for DragonflyCacheProvider (even if using Redis)
      ResilienceModule, // Provides CircuitBreakerService
      // QueueModule is @Global() and already available - QueueService can be injected
      // LoggingModule is @Global() and already available - no need to import
      // DatabaseModule is @Global() but needs forwardRef due to circular dependency with ConfigModule
      forwardRef(() => DatabaseModule),
    ];

    // Only include ScheduleModule and CacheWarmingService in non-worker services
    if (!isWorker) {
      baseImports.push(ScheduleModule); // For cron jobs in CacheWarmingService
    }

    const baseProviders: Provider[] = [
      // Core Services
      CacheService,

      // Multi-Layer Cache Services (L1)
      InMemoryCacheService, // L1: In-memory cache
      MultiLayerCacheService, // Multi-layer orchestrator

      // Infrastructure Services
      // CircuitBreakerService is now provided by ResilienceModule
      CacheMetricsService,
      FeatureFlagsService,
      CacheVersioningService,
      CacheHealthMonitorService,
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
      } as Provider,
    ];

    // Only include CacheWarmingService in non-worker services (it uses @Cron decorators)
    if (!isWorker) {
      baseProviders.push(CacheWarmingService); // Comprehensive cache warming with cron jobs
    }

    const baseExports: Array<
      typeof CacheService | typeof MultiLayerCacheService | typeof CacheKeyFactory | typeof CacheHealthMonitorService | typeof CacheWarmingService
    > = [
      // Only export CacheService as single entry point (L2: Distributed cache)
      CacheService,
      // Export MultiLayerCacheService for advanced multi-layer usage
      MultiLayerCacheService,
      // Export key factory for convenience
      CacheKeyFactory,
      // Export health monitor for HealthService
      CacheHealthMonitorService,
    ];

    // Only export CacheWarmingService in non-worker services
    if (!isWorker) {
      baseExports.push(CacheWarmingService); // Export cache warming service for manual warming
    }

    return {
      module: CacheModule,
      global: true,
      imports: baseImports,
      controllers: [CacheController],
      providers: baseProviders,
      exports: baseExports,
    };
  }
}
