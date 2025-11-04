import { SetMetadata } from '@nestjs/common';

/**
 * Rate Limiting Decorators and Configuration
 *
 * Provides decorators for applying rate limiting to controllers and methods
 * in healthcare applications. Supports various rate limiting strategies and
 * configurations for different endpoint types.
 *
 * @fileoverview Rate limiting decorators and configuration interfaces
 * @description Enterprise-grade rate limiting decorators with healthcare-specific configurations
 * @version 1.0.0
 * @author Healthcare Backend Team
 * @since 2024
 */

export const RATE_LIMIT_KEY = 'rate_limit';

/**
 * Configuration interface for rate limiting
 *
 * @interface RateLimitConfig
 * @description Defines the configuration options for rate limiting decorators
 */
export interface RateLimitConfig {
  windowMs: number;
  max: number;
  keyGenerator?: string;
  message?: string;
}

/**
 * Creates a rate limiting decorator with the specified configuration
 *
 * @param config - Rate limiting configuration options
 * @returns Decorator function that applies rate limiting metadata
 *
 * @description Creates a custom rate limiting decorator with the provided
 * configuration. This decorator sets metadata that can be read by rate
 * limiting guards or interceptors.
 *
 * @example
 * ```typescript
 * @RateLimit({
 *   windowMs: 60000,  // 1 minute
 *   max: 100,         // 100 requests per minute
 *   message: 'Too many requests'
 * })
 * @Get('/api/data')
 * getData() {
 *   return this.dataService.getData();
 * }
 * ```
 */
export const RateLimit = (config: RateLimitConfig) => SetMetadata(RATE_LIMIT_KEY, config);

/**
 * Standard API rate limiting decorator
 *
 * @description Applies moderate rate limiting suitable for general API endpoints.
 * Allows 100 requests per minute.
 *
 * @example
 * ```typescript
 * @RateLimitAPI()
 * @Get('/api/users')
 * getUsers() {
 *   return this.userService.findAll();
 * }
 * ```
 */
export const RateLimitAPI = () =>
  RateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: 'Too many API requests',
  });

/**
 * Authentication endpoint rate limiting decorator
 *
 * @description Applies strict rate limiting for authentication endpoints to
 * prevent brute force attacks. Allows 5 attempts per 15-minute window.
 *
 * @example
 * ```typescript
 * @RateLimitAuth()
 * @Post('/auth/login')
 * login(@Body() credentials: LoginDto) {
 *   return this.authService.login(credentials);
 * }
 * ```
 */
export const RateLimitAuth = () =>
  RateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 auth attempts per 15 minutes
    keyGenerator: 'auth',
    message: 'Too many authentication attempts',
  });

/**
 * Password reset rate limiting decorator
 *
 * @description Applies strict rate limiting for password reset endpoints.
 * Allows 3 attempts per hour to prevent abuse.
 *
 * @example
 * ```typescript
 * @RateLimitPasswordReset()
 * @Post('/auth/reset-password')
 * resetPassword(@Body() resetDto: ResetPasswordDto) {
 *   return this.authService.resetPassword(resetDto);
 * }
 * ```
 */
export const RateLimitPasswordReset = () =>
  RateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 password reset attempts per hour
    keyGenerator: 'auth',
    message: 'Too many password reset attempts',
  });

/**
 * OTP (One-Time Password) rate limiting decorator
 *
 * @description Applies rate limiting for OTP generation and verification.
 * Allows 3 OTP requests per 5-minute window.
 *
 * @example
 * ```typescript
 * @RateLimitOTP()
 * @Post('/auth/send-otp')
 * sendOTP(@Body() otpDto: SendOTPDto) {
 *   return this.authService.sendOTP(otpDto);
 * }
 * ```
 */
export const RateLimitOTP = () =>
  RateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 3, // 3 OTP attempts per 5 minutes
    keyGenerator: 'auth',
    message: 'Too many OTP requests',
  });

/**
 * Strict rate limiting decorator
 *
 * @description Applies very strict rate limiting for sensitive endpoints.
 * Allows only 10 requests per minute.
 *
 * @example
 * ```typescript
 * @RateLimitStrict()
 * @Post('/admin/sensitive-operation')
 * performSensitiveOperation() {
 *   return this.adminService.performOperation();
 * }
 * ```
 */
export const RateLimitStrict = () =>
  RateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    message: 'Rate limit exceeded',
  });

/**
 * Generous rate limiting decorator
 *
 * @description Applies lenient rate limiting for high-traffic endpoints.
 * Allows 1000 requests per minute.
 *
 * @example
 * ```typescript
 * @RateLimitGenerous()
 * @Get('/public/data')
 * getPublicData() {
 *   return this.publicService.getData();
 * }
 * ```
 */
export const RateLimitGenerous = () =>
  RateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 1000, // 1000 requests per minute
    message: 'Rate limit exceeded',
  });
