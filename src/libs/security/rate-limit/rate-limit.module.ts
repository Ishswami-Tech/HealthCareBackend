import { Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';
import { RedisModule } from '../../infrastructure/cache/redis/redis.module';
import { LoggingModule } from '../../infrastructure/logging/logging.module';

@Module({
  imports: [
    RedisModule,
    LoggingModule,
  ],
  providers: [
    RateLimitService,
  ],
  exports: [
    RateLimitService,
  ],
})
export class RateLimitModule {}