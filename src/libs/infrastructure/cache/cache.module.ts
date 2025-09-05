import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CacheController } from './controllers/cache.controller';
import { CacheServiceModule } from './cache-service.module';
import { HealthcareCacheInterceptor } from './interceptors/healthcare-cache.interceptor';

@Module({
  imports: [CacheServiceModule],
  controllers: [CacheController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: HealthcareCacheInterceptor,
    },
  ],
  exports: [CacheServiceModule],
})
export class CacheModule {} 