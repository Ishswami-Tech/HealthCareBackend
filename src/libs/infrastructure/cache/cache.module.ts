import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheController } from './controllers/cache.controller';
import { CacheService } from './cache.service';
import { RedisService } from './redis/redis.service';
import { HealthcareCacheInterceptor } from './interceptors/healthcare-cache.interceptor';

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
    ConfigModule,
    EventEmitterModule.forRoot({
      // Enterprise-grade event emitter configuration
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 1000,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    }),
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