/**
 * Rate limiting decorators for API protection
 *
 * This module provides decorators for implementing rate limiting
 * on route handlers to prevent abuse and ensure fair usage.
 *
 * @module RateLimitDecorators
 */

import { SetMetadata } from "@nestjs/common";

/**
 * Rate limit metadata key
 */
export const RATE_LIMIT_KEY = "rateLimit" as const;

/**
 * Rate limit options interface
 */
export interface RateLimitOptions {
  /** Maximum number of requests allowed */
  readonly max: number;
  /** Time window in seconds */
  readonly windowMs: number;
  /** Custom error message */
  readonly message?: string;
  /** Whether to skip rate limiting for certain conditions */
  readonly skipIf?: (req: unknown) => boolean;
  /** Custom key generator function */
  readonly keyGenerator?: (req: unknown) => string;
  /** Whether to skip successful requests */
  readonly skipSuccessfulRequests?: boolean;
  /** Whether to skip failed requests */
  readonly skipFailedRequests?: boolean;
}

/**
 * Rate limit decorator for implementing rate limiting on routes
 *
 * This decorator applies rate limiting to route handlers to prevent
 * abuse and ensure fair usage of API resources.
 *
 * @param options - Rate limiting options
 * @returns Decorator function that sets rate limit metadata
 *
 * @example
 * ```typescript
 * @Controller('auth')
 * export class AuthController {
 *   @Post('login')
 *   @RateLimit({ max: 5, windowMs: 60000 }) // 5 requests per minute
 *   async login(@Body() loginDto: LoginDto) {
 *     return this.authService.login(loginDto);
 *   }
 *
 *   @Post('register')
 *   @RateLimit({ max: 3, windowMs: 300000 }) // 3 requests per 5 minutes
 *   async register(@Body() registerDto: RegisterDto) {
 *     return this.authService.register(registerDto);
 *   }
 * }
 * ```
 */
export const RateLimit = (options: RateLimitOptions): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);

/**
 * Strict rate limit decorator for high-security endpoints
 *
 * This decorator applies strict rate limiting suitable for
 * high-security endpoints like password reset or account creation.
 *
 * @param max - Maximum number of requests (default: 3)
 * @param windowMs - Time window in milliseconds (default: 15 minutes)
 * @returns Decorator function that sets strict rate limit metadata
 *
 * @example
 * ```typescript
 * @Controller('auth')
 * export class AuthController {
 *   @Post('reset-password')
 *   @StrictRateLimit() // 3 requests per 15 minutes
 *   async resetPassword(@Body() resetDto: ResetPasswordDto) {
 *     return this.authService.resetPassword(resetDto);
 *   }
 * }
 * ```
 */
export const StrictRateLimit = (
  max: number = 3,
  windowMs: number = 15 * 60 * 1000, // 15 minutes
): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, {
    max,
    windowMs,
    message: "Too many requests, please try again later",
  });

/**
 * Lenient rate limit decorator for general endpoints
 *
 * This decorator applies lenient rate limiting suitable for
 * general API endpoints that don't require strict protection.
 *
 * @param max - Maximum number of requests (default: 100)
 * @param windowMs - Time window in milliseconds (default: 1 minute)
 * @returns Decorator function that sets lenient rate limit metadata
 *
 * @example
 * ```typescript
 * @Controller('appointments')
 * export class AppointmentsController {
 *   @Get()
 *   @LenientRateLimit() // 100 requests per minute
 *   async getAppointments() {
 *     return this.appointmentsService.findAll();
 *   }
 * }
 * ```
 */
export const LenientRateLimit = (
  max: number = 100,
  windowMs: number = 60 * 1000, // 1 minute
): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, {
    max,
    windowMs,
    message: "Rate limit exceeded, please slow down your requests",
  });

/**
 * Custom rate limit decorator with key generator
 *
 * This decorator allows custom rate limiting with a custom key generator
 * function, useful for implementing user-specific or IP-specific limits.
 *
 * @param options - Rate limiting options with custom key generator
 * @returns Decorator function that sets custom rate limit metadata
 *
 * @example
 * ```typescript
 * @Controller('reports')
 * export class ReportsController {
 *   @Get('generate')
 *   @CustomRateLimit({
 *     max: 10,
 *     windowMs: 3600000, // 1 hour
 *     keyGenerator: (req) => `user:${req.user.id}` // Per-user rate limiting
 *   })
 *   async generateReport(@Req() req: Request) {
 *     return this.reportsService.generate(req.user.id);
 *   }
 * }
 * ```
 */
export const CustomRateLimit = (options: RateLimitOptions): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);
