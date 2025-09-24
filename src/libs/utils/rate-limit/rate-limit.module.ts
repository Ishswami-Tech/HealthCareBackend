import { Module } from "@nestjs/common";
import { RateLimitService } from "./rate-limit.service";
import { RateLimitConfig } from "./rate-limit.config";

@Module({
  imports: [],
  providers: [RateLimitService, RateLimitConfig],
  exports: [RateLimitService, RateLimitConfig],
})
export class RateLimitModule {}
