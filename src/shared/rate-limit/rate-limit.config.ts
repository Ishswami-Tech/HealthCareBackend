import { Injectable } from '@nestjs/common';

export interface RateLimitRule {
  maxRequests: number;
  windowMs: number;
}

@Injectable()
export class RateLimitConfig {
  private readonly defaultLimits: RateLimitRule = {
    maxRequests: 100,
    windowMs: 60000, // 1 minute
  };

  private readonly limits: Record<string, RateLimitRule> = {
    api: this.defaultLimits,
    auth: {
      maxRequests: 5,
      windowMs: 60000, // 1 minute
    },
    // Add more rate limit types as needed
  };

  getLimits(type: string): RateLimitRule {
    return this.limits[type] || this.defaultLimits;
  }

  addLimitType(type: string, rule: RateLimitRule): void {
    this.limits[type] = rule;
  }
} 