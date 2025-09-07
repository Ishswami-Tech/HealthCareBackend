import { SetMetadata, applyDecorators } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  keyGenerator?: string;
  message?: string;
}

export const RateLimit = (config: RateLimitConfig) =>
  SetMetadata(RATE_LIMIT_KEY, config);

// Common rate limit decorators
export const RateLimitAPI = () =>
  RateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: 'Too many API requests',
  });

export const RateLimitAuth = () =>
  RateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 auth attempts per 15 minutes
    keyGenerator: 'auth',
    message: 'Too many authentication attempts',
  });

export const RateLimitPasswordReset = () =>
  RateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 password reset attempts per hour
    keyGenerator: 'auth',
    message: 'Too many password reset attempts',
  });

export const RateLimitOTP = () =>
  RateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 3, // 3 OTP attempts per 5 minutes
    keyGenerator: 'auth',
    message: 'Too many OTP requests',
  });

export const RateLimitStrict = () =>
  RateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    message: 'Rate limit exceeded',
  });

export const RateLimitGenerous = () =>
  RateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 1000, // 1000 requests per minute
    message: 'Rate limit exceeded',
  });

