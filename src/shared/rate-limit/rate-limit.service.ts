import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../cache/redis/redis.service';
import { RateLimitConfig, RateLimitRule } from './rate-limit.config';

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly config: RateLimitConfig
  ) {}

  // Redis operations wrapper methods
  private async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    return this.redisService.retryOperation(() => 
      this.redisService.zremrangebyscore(key, min, max)
    );
  }

  private async zadd(key: string, score: number, member: string): Promise<number> {
    return this.redisService.retryOperation(() => 
      this.redisService.zadd(key, score, member)
    );
  }

  private async zcard(key: string): Promise<number> {
    return this.redisService.retryOperation(() => 
      this.redisService.zcard(key)
    );
  }

  private async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.redisService.retryOperation(() => 
      this.redisService.hincrby(key, field, increment)
    );
  }

  async isRateLimited(
    identifier: string,
    type: string = 'api',
  ): Promise<{ limited: boolean; remaining: number }> {
    if (this.redisService.isDevelopmentMode) {
      return { limited: false, remaining: Number.MAX_SAFE_INTEGER };
    }

    const { maxRequests, windowMs } = this.config.getLimits(type);
    const key = `ratelimit:${type}:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Remove old entries outside the current window
      await this.redisService.zremrangebyscore(key, 0, windowStart);

      // Add current request
      await this.redisService.zadd(key, now, `${now}`);

      // Get current count in window
      const requestCount = await this.redisService.zcard(key);

      // Set expiry on the key
      await this.redisService.expire(key, Math.ceil(windowMs / 1000));

      // Track metrics
      await this.trackMetrics(type, requestCount > maxRequests);

      return {
        limited: requestCount > maxRequests,
        remaining: Math.max(0, maxRequests - requestCount),
      };
    } catch (error) {
      this.logger.error(`Rate limiting error: ${error.message}`, error.stack);
      return { limited: false, remaining: maxRequests }; // Fail open in case of Redis errors
    }
  }

  private async trackMetrics(type: string, wasLimited: boolean): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    const metricsKey = `ratelimit:metrics:${date}`;

    try {
      await this.redisService.hincrby(metricsKey, `${type}:total`, 1);
      if (wasLimited) {
        await this.redisService.hincrby(metricsKey, `${type}:limited`, 1);
      }
      await this.redisService.expire(metricsKey, 86400 * 7); // Keep metrics for 7 days
    } catch (error) {
      this.logger.warn(`Failed to track rate limit metrics: ${error.message}`);
    }
  }

  private buildRateKey(key: string, type: string, options: any): string {
    const parts = ['rate', type];
    
    if (options.userId) {
      parts.push(`user:${options.userId}`);
    }
    
    if (options.ip) {
      parts.push(`ip:${options.ip}`);
    }
    
    parts.push(key);
    
    return parts.join(':');
  }

  async getRateLimitMetrics(type: string, minutes: number = 5): Promise<{
    total: number;
    limited: number;
    limitedPercentage: number;
  }> {
    const now = Math.floor(Date.now() / 1000);
    const keys = [];
    
    for (let i = 0; i < minutes; i++) {
      const timestamp = now - (now % 60) - (i * 60);
      keys.push(`metrics:ratelimit:${type}:${timestamp}`);
    }

    try {
      const results = await Promise.all(
        keys.map(key => this.redisService.hGetAll(key))
      );

      const totals = results.reduce(
        (acc, curr) => ({
          total: acc.total + (parseInt(curr?.total) || 0),
          limited: acc.limited + (parseInt(curr?.limited) || 0)
        }),
        { total: 0, limited: 0 }
      );

      return {
        ...totals,
        limitedPercentage: totals.total ? (totals.limited / totals.total) * 100 : 0
      };
    } catch (error) {
      this.logger.error('Error getting rate limit metrics:', error);
      return { total: 0, limited: 0, limitedPercentage: 0 };
    }
  }

  getRule(type: string): RateLimitRule {
    return this.config.getLimits(type);
  }

  async clearRateLimit(key: string, type: string): Promise<void> {
    const rateKey = this.buildRateKey(key, type, {});
    await this.redisService.del(rateKey);
  }
} 