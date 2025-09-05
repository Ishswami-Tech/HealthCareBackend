import { Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';
import { RateLimitConfig } from './rate-limit.config';
import { CacheServiceModule } from '../../infrastructure/cache/cache-service.module';

@Module({
  imports: [CacheServiceModule],
  providers: [RateLimitService, RateLimitConfig],
  exports: [RateLimitService, RateLimitConfig],
})
export class RateLimitModule {} 