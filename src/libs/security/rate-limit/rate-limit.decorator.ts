import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  type?: string;
  identifier?: string;
  maxRequests?: number;
  windowMs?: number;
  blockDuration?: number;
}

export const RateLimit = (options: RateLimitOptions = {}) => 
  SetMetadata(RATE_LIMIT_KEY, options);

export const RateLimitAuth = () => RateLimit({ type: 'auth/login' });
export const RateLimitPasswordReset = () => RateLimit({ type: 'auth/password-reset' });
export const RateLimitOTP = () => RateLimit({ type: 'auth/verify-otp' });
export const RateLimitTokenRefresh = () => RateLimit({ type: 'auth/refresh' });
export const RateLimitSocial = () => RateLimit({ type: 'auth/social' });
export const RateLimitMagicLink = () => RateLimit({ type: 'auth/magic-link' });
export const RateLimitAPI = () => RateLimit({ type: 'api' });

