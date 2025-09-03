import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RedisService } from './redis/redis.service';
import { CacheController } from './controllers/cache.controller';
import { HealthcareCacheService } from './healthcare-cache.service';
import { HealthcareCacheInterceptor } from './interceptors/healthcare-cache.interceptor';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [CacheController],
  providers: [
    RedisService,
    HealthcareCacheService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HealthcareCacheInterceptor,
    },
  ],
  exports: [
    RedisService, 
    HealthcareCacheService
  ],
})
export class CacheModule {} 