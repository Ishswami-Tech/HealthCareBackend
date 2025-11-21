import { Module } from '@nestjs/common';

// Internal imports - Infrastructure
// CacheModule is @Global() - no need to import it explicitly
// LoggingModule is @Global() - no need to import it explicitly

import { RateLimitService } from './rate-limit.service';

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
 *
 * NOTE: ClinicRateLimiterService is provided by DatabaseModule to avoid circular dependency
 * (DatabaseModule imports RateLimitModule, so RateLimitModule cannot provide services from DatabaseModule)
 */
@Module({
  // CacheModule and LoggingModule are @Global() - no need to import them
  // RateLimitService injects CacheService and LoggingService with forwardRef in constructor
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
