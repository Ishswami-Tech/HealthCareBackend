import { Module } from "@nestjs/common";
import { RateLimitService } from "./rate-limit.service";
import { RedisModule } from "../../infrastructure/cache/redis/redis.module";
import { LoggingModule } from "../../infrastructure/logging/logging.module";

/**
 * Rate Limiting Module for Healthcare Applications
 *
 * Provides rate limiting services and decorators for healthcare applications.
 * Includes Redis-based rate limiting with configurable windows and limits.
 *
 * @module RateLimitModule
 * @description Enterprise-grade rate limiting module with healthcare-specific configurations
 *
 * @example
 * ```typescript
 * // Import in your app module
 * import { RateLimitModule } from './security/rate-limit/rate-limit.module';
 *
 * @Module({
 *   imports: [RateLimitModule],
 * })
 * export class AppModule {}
 * ```
 *
 * @features
 * - Redis-based rate limiting with sliding windows
 * - Multiple key generation strategies
 * - Configurable rate limit windows and limits
 * - Healthcare-specific rate limiting decorators
 * - Comprehensive logging and monitoring
 * - HIPAA-compliant rate limiting for healthcare data
 */
@Module({
  imports: [RedisModule, LoggingModule],
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
