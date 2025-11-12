// External imports
import { Module, Global, forwardRef } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule } from '@config';
import { EventsModule } from '@infrastructure/events';

// Internal imports - Infrastructure
// LoggingModule is @Global() - no need to import it
import { CacheController } from '@infrastructure/cache/controllers/cache.controller';
import { CacheService } from '@infrastructure/cache/cache.service';
import { RedisService } from '@infrastructure/cache/redis/redis.service';
import { HealthcareCacheInterceptor } from '@infrastructure/cache/interceptors/healthcare-cache.interceptor';

/**
 * Enterprise Cache Module for 10M+ Users
 *
 * Single unified module providing:
 * - Global cache service with single entry point
 * - Healthcare-specific caching with HIPAA compliance
 * - Circuit breaker pattern for fault tolerance
 * - Adaptive caching with predictive algorithms
 * - Connection pooling and load balancing
 * - Performance monitoring and metrics
 * - Audit logging for compliance
 * - Auto-scaling and sharding support
 * - Compression and encryption
 * - Cache warming and invalidation strategies
 */
@Global()
@Module({
  imports: [
    // ConfigModule is @Global() but we need to import it with forwardRef to handle circular dependency
    forwardRef(() => ConfigModule),
    // LoggingModule is @Global() - no need to import it explicitly
    // EventEmitterModule is already configured in AppModule with forRoot()
    // We just need to import it here for @OnEvent decorators
    EventEmitterModule,
    // Central event system - must be imported for EventService
    forwardRef(() => EventsModule),
  ],
  controllers: [CacheController],
  providers: [
    // Core services
    RedisService,
    CacheService,

    // Global interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: HealthcareCacheInterceptor,
    },
  ],
  exports: [CacheService], // Only export CacheService as single entry point
})
export class CacheModule {}
