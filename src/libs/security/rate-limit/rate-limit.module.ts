import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

// Internal imports - Infrastructure
// CacheModule is @Global() - no need to import it explicitly
// LoggingModule is @Global() - no need to import it explicitly

import { RateLimitService } from './rate-limit.service';
import { RouteRateLimitGuard } from './route-rate-limit.guard';

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
  // RouteRateLimitGuard is registered as a GLOBAL guard (APP_GUARD is global regardless of the
  // module that declares it) so every @RateLimit*/@RateLimitAPI decorator is actually enforced,
  // including on @Public() routes such as OTP request/verify.
  providers: [
    RateLimitService,
    RouteRateLimitGuard,
    { provide: APP_GUARD, useExisting: RouteRateLimitGuard },
  ],
  exports: [RateLimitService, RouteRateLimitGuard],
})
export class RateLimitModule {}
