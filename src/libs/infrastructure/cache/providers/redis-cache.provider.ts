/**
 * Redis Cache Provider
 * @class RedisCacheProvider
 * @description Adapter for RedisService to implement IAdvancedCacheProvider
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import type {
  IAdvancedCacheProvider,
  CacheMetrics,
  CacheStats,
  RateLimitResult,
  CacheRateLimitConfig,
  RateLimitOptions,
} from '@core/types';
import { RedisService } from '../redis/redis.service';

/**
 * Redis cache provider adapter - implements full IAdvancedCacheProvider interface
 */
@Injectable()
export class RedisCacheProvider implements IAdvancedCacheProvider {
  constructor(
    @Inject(forwardRef(() => RedisService))
    private readonly redisService: RedisService
  ) {
    // RedisService injected via forwardRef to handle circular dependencies
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redisService.get(key);
    if (value === null) {
      return null;
    }
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await this.redisService.set(key, serialized, ttl);
  }

  async del(key: string): Promise<number> {
    // Check if key exists before deletion to return accurate count
    const existed = await this.redisService.exists(key);
    await this.redisService.del(key);
    return existed ? 1 : 0;
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.redisService.exists(key);
    return result > 0;
  }

  async ttl(key: string): Promise<number> {
    return this.redisService.ttl(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.redisService.expire(key, seconds);
  }

  async delMultiple(keys: readonly string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    // Count how many keys exist before deletion
    let existingCount = 0;
    for (const key of keys) {
      const exists = await this.redisService.exists(key);
      if (exists) {
        existingCount++;
      }
    }
    await this.redisService.del(...keys);
    return existingCount;
  }

  async getMultiple<T>(keys: readonly string[]): Promise<Map<string, T | null>> {
    if (keys.length === 0) {
      return new Map<string, T | null>();
    }

    // Use pipeline for better performance
    const results = await this.redisService.multi(
      keys.map(key => ({ command: 'get', args: [key] }))
    );

    const result = new Map<string, T | null>();
    keys.forEach((key, index) => {
      const [error, value] = results[index] || [null, null];
      if (error || value === null) {
        result.set(key, null);
      } else {
        try {
          result.set(key, JSON.parse(value as string) as T);
        } catch {
          result.set(key, value as T);
        }
      }
    });

    return result;
  }

  async setMultiple<T>(
    entries: ReadonlyArray<{ key: string; value: T; ttl?: number }>
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    // Use pipeline for better performance
    const commands: Array<{ command: string; args: unknown[] }> = [];
    for (const entry of entries) {
      const serialized =
        typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
      if (entry.ttl) {
        commands.push({ command: 'setex', args: [entry.key, entry.ttl, serialized] });
      } else {
        commands.push({ command: 'set', args: [entry.key, serialized] });
      }
    }

    await this.redisService.multi(commands);
  }

  async clearByPattern(pattern: string): Promise<number> {
    return this.redisService.clearCache(pattern);
  }

  async ping(): Promise<string> {
    return this.redisService.ping();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.ping();
      return true;
    } catch {
      return false;
    }
  }

  // ===== ADVANCED IAdvancedCacheProvider METHODS =====

  async getCacheMetrics(): Promise<CacheMetrics> {
    return this.redisService.getCacheMetrics();
  }

  async getCacheStats(): Promise<CacheStats> {
    return this.redisService.getCacheStats();
  }

  async getHealthStatus(): Promise<[boolean, number]> {
    return this.redisService.getHealthStatus();
  }

  async getCacheDebug(): Promise<Record<string, unknown>> {
    return this.redisService.getCacheDebug();
  }

  async clearAllCache(): Promise<number> {
    return this.redisService.clearAllCache();
  }

  async resetCacheStats(): Promise<void> {
    return this.redisService.resetCacheStats();
  }

  async isRateLimited(
    key: string,
    limit?: number,
    windowSeconds?: number,
    options?: RateLimitOptions
  ): Promise<boolean> {
    return this.redisService.isRateLimited(key, limit, windowSeconds, options || {});
  }

  async getRateLimit(
    key: string,
    limit?: number,
    windowSeconds?: number
  ): Promise<RateLimitResult> {
    return this.redisService.getRateLimit(key, limit, windowSeconds);
  }

  async clearRateLimit(key: string): Promise<void> {
    return this.redisService.clearRateLimit(key);
  }

  updateRateLimits(type: string, config: CacheRateLimitConfig): Promise<void> {
    return this.redisService.updateRateLimits(type, config);
  }

  getRateLimitConfig(type?: string): CacheRateLimitConfig | Record<string, CacheRateLimitConfig> {
    return this.redisService.getRateLimitConfig(type);
  }

  async trackSecurityEvent(identifier: string, eventType: string, details: unknown): Promise<void> {
    return this.redisService.trackSecurityEvent(identifier, eventType, details);
  }

  async getSecurityEvents(identifier: string, limit?: number): Promise<unknown[]> {
    return this.redisService.getSecurityEvents(identifier, limit);
  }

  async clearSecurityEvents(identifier: string): Promise<void> {
    return this.redisService.clearSecurityEvents(identifier);
  }

  // Hash operations
  async hSet(key: string, field: string, value: string): Promise<number> {
    return this.redisService.hSet(key, field, value);
  }

  async hGet(key: string, field: string): Promise<string | null> {
    return this.redisService.hGet(key, field);
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return this.redisService.hGetAll(key);
  }

  async hDel(key: string, field: string): Promise<number> {
    return this.redisService.hDel(key, field);
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.redisService.hincrby(key, field, increment);
  }

  // List operations
  async rPush(key: string, value: string): Promise<number> {
    return this.redisService.rPush(key, value);
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    return this.redisService.lRange(key, start, stop);
  }

  async lLen(key: string): Promise<number> {
    return this.redisService.lLen(key);
  }

  async lTrim(key: string, start: number, stop: number): Promise<string> {
    return this.redisService.lTrim(key, start, stop);
  }

  // Set operations
  async sAdd(key: string, ...members: string[]): Promise<number> {
    return this.redisService.sAdd(key, ...members);
  }

  async sMembers(key: string): Promise<string[]> {
    return this.redisService.sMembers(key);
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    return this.redisService.sRem(key, ...members);
  }

  async sCard(key: string): Promise<number> {
    return this.redisService.sCard(key);
  }

  // Sorted Set operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.redisService.zadd(key, score, member);
  }

  async zcard(key: string): Promise<number> {
    return this.redisService.zcard(key);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.redisService.zrevrange(key, start, stop);
  }

  async zrangebyscore(key: string, min: string | number, max: string | number): Promise<string[]> {
    return this.redisService.zrangebyscore(key, min, max);
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    return this.redisService.zremrangebyscore(key, min, max);
  }

  // Pub/Sub operations
  async publish(channel: string, message: string): Promise<number> {
    return this.redisService.publish(channel, message);
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    return this.redisService.subscribe(channel, callback);
  }

  // Utility operations
  async expireAt(key: string, timestamp: number): Promise<number> {
    return this.redisService.expireAt(key, timestamp);
  }

  async incr(key: string): Promise<number> {
    return this.redisService.incr(key);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.redisService.keys(pattern);
  }

  async multi(
    commands: Array<{ command: string; args: unknown[] }>
  ): Promise<Array<[Error | null, unknown]>> {
    return this.redisService.multi(commands);
  }

  async retryOperation<T>(operation: () => Promise<T>): Promise<T> {
    return this.redisService.retryOperation(operation);
  }
}
