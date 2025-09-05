import { Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';
import { RedisModule } from '../../infrastructure/cache/redis/redis.module';
import { LoggingServiceModule } from "../../infrastructure/logging"

@Module({
  imports: [
    RedisModule,
    LoggingServiceModule,
  ],
  providers: [
    RateLimitService,
  ],
  exports: [
    RateLimitService,
  ],
})
export class RateLimitModule {}