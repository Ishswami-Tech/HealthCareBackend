import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from './redis/redis.service';
import { CacheService } from './cache.service';

@Module({
  imports: [ConfigModule],
  providers: [
    RedisService,
    CacheService,
  ],
  exports: [
    RedisService, 
    CacheService
  ],
})
export class CacheServiceModule {}