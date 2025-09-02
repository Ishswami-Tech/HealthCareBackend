import { Injectable } from '@nestjs/common';

export interface RateLimitRule {
  maxRequests: number;
  windowMs: number;
  blockDuration?: number;
}

@Injectable()
export class RateLimitConfig {
  private readonly defaultLimits: RateLimitRule = {
    maxRequests: 100,
    windowMs: 60000, // 1 minute
  };

  private readonly limits: Record<string, RateLimitRule> = {
    api: this.defaultLimits,
    
    // Login attempts
    'auth/login': {
      maxRequests: 5,
      windowMs: 60000, // 1 minute
      blockDuration: 300000 // 5 minutes block after limit exceeded
    },
    
    // Password reset requests
    'auth/password-reset': {
      maxRequests: 3,
      windowMs: 3600000, // 1 hour
      blockDuration: 3600000 // 1 hour block
    },
    
    // OTP verification
    'auth/verify-otp': {
      maxRequests: 5,
      windowMs: 300000, // 5 minutes
      blockDuration: 900000 // 15 minutes block
    },
    
    // Token refresh
    'auth/refresh': {
      maxRequests: 10,
      windowMs: 300000, // 5 minutes
      blockDuration: 600000 // 10 minutes block
    },
    
    // Social login
    'auth/social': {
      maxRequests: 5,
      windowMs: 60000, // 1 minute
      blockDuration: 300000 // 5 minutes block
    },
    
    // Magic link requests
    'auth/magic-link': {
      maxRequests: 3,
      windowMs: 3600000, // 1 hour
      blockDuration: 7200000 // 2 hours block
    }
  };

  getLimits(type: string): RateLimitRule {
    if (process.env.DEV_MODE === 'true') {
      return {
        maxRequests: 10000,
        windowMs: 60000, // 1 minute
        blockDuration: 1000 // 1 second block
      };
    }
    return this.limits[type] || this.defaultLimits;
  }

  addLimitType(type: string, rule: RateLimitRule): void {
    this.limits[type] = rule;
  }

  /**
   * Get progressive rate limit based on consecutive failures
   */
  getProgressiveLimit(type: string, consecutiveFailures: number): RateLimitRule {
    const baseLimit = this.getLimits(type);
    
    // Exponentially increase block duration based on consecutive failures
    const blockMultiplier = Math.min(Math.pow(2, consecutiveFailures - 1), 24); // Cap at 24x
    
    return {
      ...baseLimit,
      blockDuration: (baseLimit.blockDuration || 300000) * blockMultiplier
    };
  }
} 