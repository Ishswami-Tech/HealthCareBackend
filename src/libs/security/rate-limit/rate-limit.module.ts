import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { RateLimitService } from './rate-limit.service';
import { RateLimitConfig } from './rate-limit.config';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule
  ],
  providers: [RateLimitService, RateLimitConfig],
  exports: [RateLimitService, RateLimitConfig],
})
export class RateLimitModule {}