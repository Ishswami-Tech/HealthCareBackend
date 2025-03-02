import { Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';
import { RateLimitConfig } from './rate-limit.config';
import { RedisModule } from '../cache/redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [RateLimitService, RateLimitConfig],
  exports: [RateLimitService, RateLimitConfig],
})
export class RateLimitModule {} 