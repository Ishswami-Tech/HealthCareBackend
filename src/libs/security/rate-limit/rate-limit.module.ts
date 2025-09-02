import { Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';
import { RateLimitConfig } from './rate-limit.config';
import { RateLimitInterceptor } from './rate-limit.interceptor';

@Module({
  providers: [RateLimitService, RateLimitConfig, RateLimitInterceptor],
  exports: [RateLimitService, RateLimitConfig, RateLimitInterceptor],
})
export class RateLimitModule {}
