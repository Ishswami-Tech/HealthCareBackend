import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RateLimitConfig, RateLimitRule } from './rate-limit.config';

export interface RateLimitCoordinationEvent {
  identifier: string;
  type: string;
  service: string;
  action: 'limit_reached' | 'limit_cleared' | 'sync_request';
  timestamp: Date;
  metadata?: {
    requestCount?: number;
    limit?: number;
    windowMs?: number;
  };
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(
    private readonly config: RateLimitConfig,
    private readonly eventEmitter?: EventEmitter2
  ) {
    this.setupRateLimitCoordination();
  }

  private setupRateLimitCoordination(): void {
    if (this.eventEmitter) {
      this.eventEmitter.on('rate_limit.coordination', (event: RateLimitCoordinationEvent) => {
        this.logger.log(`Rate limit coordination event: ${event.action} for ${event.identifier}`);
      });
    }
  }

  async checkRateLimit(
    identifier: string,
    type: string = 'api',
  ): Promise<{ limited: boolean; remaining: number; resetTime?: number }> {
    // For now, return a simple check - in production this would integrate with Redis
    const limits = this.config.getLimits(type);
    const now = Date.now();
    
    // This is a simplified version - in production you'd use Redis for actual rate limiting
    // For development/testing purposes, we'll simulate rate limiting
    if (process.env.NODE_ENV === 'development') {
      return { limited: false, remaining: Number.MAX_SAFE_INTEGER };
    }

    // Simulate rate limiting logic
    const key = `rate_limit:${type}:${identifier}`;
    const windowMs = limits.windowMs;
    const windowStart = now - windowMs;

    try {
      // In production, this would use Redis operations
      // For now, we'll return a mock response
      const mockRequestCount = Math.floor(Math.random() * 10); // Simulate request count
      const limit = limits.maxRequests;
      const remaining = Math.max(0, limit - mockRequestCount);
      const limited = mockRequestCount >= limit;

      if (limited && this.eventEmitter) {
        this.eventEmitter.emit('rate_limit.coordination', {
          identifier,
          type,
          service: 'healthcare-backend',
          action: 'limit_reached',
          timestamp: new Date(),
          metadata: {
            requestCount: mockRequestCount,
            limit,
            windowMs
          }
        });
      }

      return { 
        limited, 
        remaining,
        resetTime: now + windowMs
      };
    } catch (error) {
      this.logger.error(`Rate limit check failed for ${identifier}:`, error);
      return { limited: false, remaining: Number.MAX_SAFE_INTEGER };
    }
  }

  async trackMetrics(type: string, wasLimited: boolean): Promise<void> {
    try {
      // In production, this would send metrics to your monitoring system
      this.logger.log(`Rate limit metrics - Type: ${type}, Limited: ${wasLimited}`);
    } catch (error) {
      this.logger.error('Failed to track rate limit metrics:', error);
    }
  }

  async getRateLimitInfo(identifier: string, type: string = 'api'): Promise<{
    current: number;
    limit: number;
    remaining: number;
    resetTime: number;
    windowMs: number;
  }> {
    const limits = this.config.getLimits(type);
    const now = Date.now();
    const windowMs = limits.windowMs;
    const windowStart = now - windowMs;

    // Mock implementation - in production this would query Redis
    const mockCurrent = Math.floor(Math.random() * limits.maxRequests);
    const remaining = Math.max(0, limits.maxRequests - mockCurrent);
    const resetTime = now + windowMs;

    return {
      current: mockCurrent,
      limit: limits.maxRequests,
      remaining,
      resetTime,
      windowMs
    };
  }

  async clearRateLimit(identifier: string, type: string = 'api'): Promise<boolean> {
    try {
      // In production, this would clear the rate limit in Redis
      this.logger.log(`Cleared rate limit for ${identifier} (${type})`);
      
      if (this.eventEmitter) {
        this.eventEmitter.emit('rate_limit.coordination', {
          identifier,
          type,
          service: 'healthcare-backend',
          action: 'limit_cleared',
          timestamp: new Date()
        });
      }
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to clear rate limit for ${identifier}:`, error);
      return false;
    }
  }

  async getProgressiveRateLimit(
    identifier: string, 
    type: string, 
    consecutiveFailures: number
  ): Promise<RateLimitRule> {
    return this.config.getProgressiveLimit(type, consecutiveFailures);
  }

  async isBlocked(identifier: string, type: string = 'api'): Promise<boolean> {
    try {
      // In production, this would check Redis for blocked status
      const limits = this.config.getLimits(type);
      if (!limits.blockDuration) {
        return false;
      }

      // Mock implementation - in production you'd check Redis
      return false;
    } catch (error) {
      this.logger.error(`Failed to check blocked status for ${identifier}:`, error);
      return false;
    }
  }
}
