/**
 * Dragonfly Cache Provider
 * @class DragonflyCacheProvider
 * @description Adapter for DragonflyService to implement IAdvancedCacheProvider
 * Dragonfly is a drop-in Redis replacement with 26x better performance
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
import { DragonflyService } from '../dragonfly/dragonfly.service';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

/**
 * Dragonfly cache provider adapter - implements full IAdvancedCacheProvider interface
 * Wraps DragonflyService to provide a consistent interface
 */
@Injectable()
export class DragonflyCacheProvider implements IAdvancedCacheProvider {
  private readonly SECURITY_EVENT_RETENTION = 30 * 24 * 60 * 60; // 30 days
  private readonly STATS_KEY = 'cache:stats';

  // Rate limiting configuration
  private readonly defaultRateLimits: Record<string, { limit: number; window: number }> = {
    api: { limit: 100, window: 60 },
    auth: { limit: 5, window: 60 },
    heavy: { limit: 10, window: 300 },
  };

  constructor(
    @Inject(forwardRef(() => DragonflyService))
    private readonly dragonflyService: DragonflyService
  ) {
    // DragonflyService injected via forwardRef to handle circular dependencies
  }

  // ===== BASIC ICacheProvider METHODS =====

  async get<T>(key: string): Promise<T | null> {
    try {
      const result = await this.dragonflyService.get(key);
      if (result === null) return null;

      try {
        return JSON.parse(result) as T;
      } catch {
        return result as T;
      }
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      await this.dragonflyService.set(key, serialized, ttl);
    } catch {
      // Fail silently - cache is not critical
    }
  }

  async del(key: string): Promise<number> {
    try {
      return await this.dragonflyService.del(key);
    } catch {
      return 0;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.dragonflyService.exists(key);
      return result > 0;
    } catch {
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.dragonflyService.ttl(key);
    } catch {
      return -1;
    }
  }

  async expire(key: string, seconds: number): Promise<number> {
    try {
      return await this.dragonflyService.expire(key, seconds);
    } catch {
      return 0;
    }
  }

  async delMultiple(keys: readonly string[]): Promise<number> {
    if (keys.length === 0) return 0;
    try {
      let deleted = 0;
      for (const key of keys) {
        deleted += await this.dragonflyService.del(key);
      }
      return deleted;
    } catch {
      return 0;
    }
  }

  async getMultiple<T>(keys: readonly string[]): Promise<Map<string, T | null>> {
    if (keys.length === 0) {
      return new Map<string, T | null>();
    }

    try {
      // Use pipeline for better performance (same as Redis provider)
      const results = await this.multi(keys.map(key => ({ command: 'get', args: [key] })));

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
    } catch {
      const result = new Map<string, T | null>();
      keys.forEach(key => result.set(key, null));
      return result;
    }
  }

  async setMultiple<T>(
    entries: ReadonlyArray<{ key: string; value: T; ttl?: number }>
  ): Promise<void> {
    if (entries.length === 0) return;

    try {
      const pipeline = this.dragonflyService.pipeline();
      for (const entry of entries) {
        const serialized =
          typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
        if (entry.ttl) {
          pipeline.setex(entry.key, entry.ttl, serialized);
        } else {
          pipeline.set(entry.key, serialized);
        }
      }
      await pipeline.exec();
    } catch {
      // Fail silently
    }
  }

  async clearByPattern(pattern: string): Promise<number> {
    try {
      return await this.dragonflyService.clearCache(pattern);
    } catch {
      return 0;
    }
  }

  async ping(): Promise<string> {
    try {
      return await this.dragonflyService.ping();
    } catch {
      throw new Error('Dragonfly client not ready');
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const pingResult = await this.ping();
      return pingResult === 'PONG';
    } catch {
      return false;
    }
  }

  // ===== ADVANCED IAdvancedCacheProvider METHODS =====

  async getCacheMetrics(): Promise<CacheMetrics> {
    try {
      const [stats, info, dbSize] = await Promise.all([
        this.getCacheStats(),
        this.dragonflyService.info('memory'),
        this.dragonflyService.dbsize(),
      ]);

      const usedMemory = parseInt(info.match(/used_memory:(\d+)/)?.[1] || '0');
      const peakMemory = parseInt(info.match(/used_memory_peak:(\d+)/)?.[1] || '0');
      const fragmentationRatio = parseFloat(
        info.match(/mem_fragmentation_ratio:(\d+\.\d+)/)?.[1] || '0'
      );

      const hitRate =
        stats.hits + stats.misses > 0 ? (stats.hits / (stats.hits + stats.misses)) * 100 : 0;

      return {
        keys: dbSize,
        hitRate,
        memory: {
          used: usedMemory,
          peak: peakMemory,
          fragmentation: fragmentationRatio,
        },
        operations: {
          hits: stats.hits,
          misses: stats.misses,
        },
      };
    } catch (error) {
      throw new HealthcareError(
        ErrorCode.CACHE_OPERATION_FAILED,
        'Failed to get cache metrics',
        undefined,
        { error: error instanceof Error ? error.message : String(error) },
        'DragonflyCacheProvider.getCacheMetrics'
      );
    }
  }

  async getCacheStats(): Promise<CacheStats> {
    try {
      const stats = await this.dragonflyService.hGetAll(this.STATS_KEY);
      return {
        hits: parseInt(stats?.['hits'] || '0'),
        misses: parseInt(stats?.['misses'] || '0'),
      };
    } catch {
      return { hits: 0, misses: 0 };
    }
  }

  async getHealthStatus(): Promise<[boolean, number]> {
    try {
      const startTime = Date.now();
      const pingResult = await this.ping();
      const pingTime = Date.now() - startTime;
      return [pingResult === 'PONG', pingTime];
    } catch {
      return [false, 0];
    }
  }

  async getCacheDebug(): Promise<Record<string, unknown>> {
    try {
      const [info, dbSize, memoryInfo] = await Promise.all([
        this.dragonflyService.info(),
        this.dragonflyService.dbsize(),
        this.dragonflyService.info('memory'),
      ]);

      const connectedClients = parseInt(info.match(/connected_clients:(\d+)/)?.[1] || '0');
      const usedMemory = parseInt(memoryInfo.match(/used_memory:(\d+)/)?.[1] || '0');

      return {
        status: 'ok',
        provider: 'dragonfly',
        info: {
          dbSize,
          memoryInfo: {
            usedMemory,
            connectedClients,
          },
          serverInfo: info,
        },
      };
    } catch (error) {
      throw new HealthcareError(
        ErrorCode.CACHE_OPERATION_FAILED,
        'Failed to get cache debug info',
        undefined,
        { error: error instanceof Error ? error.message : String(error) },
        'DragonflyCacheProvider.getCacheDebug'
      );
    }
  }

  async clearAllCache(): Promise<number> {
    try {
      const keys = await this.dragonflyService.keys('*');
      const keysToDelete = keys.filter(
        key =>
          !key.startsWith('cache:stats') &&
          !key.startsWith('security:events') &&
          !key.startsWith('system:')
      );

      if (keysToDelete.length === 0) return 0;

      const BATCH_SIZE = 1000;
      let deletedCount = 0;

      for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
        const batch = keysToDelete.slice(i, i + BATCH_SIZE);
        if (batch.length > 0) {
          for (const key of batch) {
            deletedCount += await this.dragonflyService.del(key);
          }
        }
      }

      return deletedCount;
    } catch {
      return 0;
    }
  }

  async resetCacheStats(): Promise<void> {
    try {
      await this.dragonflyService.del(this.STATS_KEY);
    } catch {
      // Fail silently
    }
  }

  async isRateLimited(
    key: string,
    limit?: number,
    windowSeconds?: number,
    options: RateLimitOptions = {}
  ): Promise<boolean> {
    // Check if in development mode
    const isDevelopment = process.env['NODE_ENV'] !== 'production';
    if (isDevelopment && !options.bypassDev) {
      return false;
    }

    const type = key.split(':')[0] || 'api';
    const defaultLimit = this.defaultRateLimits[type] || this.defaultRateLimits['api'];
    if (defaultLimit) {
      limit = limit || defaultLimit.limit;
      windowSeconds = windowSeconds || defaultLimit.window;
    }

    if (!limit || !windowSeconds) {
      return false;
    }

    try {
      const client = this.dragonflyService.getClient();
      if (!client) {
        return false;
      }

      const multi = client.multi();
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const cost = options.cost || 1;
      const burstLimit = options.burst ? limit + options.burst : limit;

      multi.zremrangebyscore(key, 0, now - windowMs);
      multi.zadd(key, now, `${now}-${Math.random()}-${cost}`);
      multi.zcard(key);
      multi.expire(key, windowSeconds);

      const results = await multi.exec();
      const resultValue = results?.[2]?.[1];
      const current =
        resultValue !== undefined && resultValue !== null
          ? parseInt(
              typeof resultValue === 'string' || typeof resultValue === 'number'
                ? String(resultValue)
                : '0',
              10
            )
          : 0;

      return current * cost > (options.burst ? burstLimit : limit);
    } catch {
      return false; // Fail open
    }
  }

  async getRateLimit(
    key: string,
    limit?: number,
    windowSeconds?: number
  ): Promise<RateLimitResult> {
    const isDevelopment = process.env['NODE_ENV'] !== 'production';
    if (isDevelopment) {
      return {
        remaining: 999999,
        reset: 0,
        total: 999999,
        used: 0,
      };
    }

    const type = key.split(':')[0] || 'api';
    const defaultLimit = this.defaultRateLimits[type] || this.defaultRateLimits['api'];
    if (defaultLimit) {
      limit = limit || defaultLimit.limit;
      windowSeconds = windowSeconds || defaultLimit.window;
    }

    if (!limit || !windowSeconds) {
      return {
        remaining: 0,
        reset: 0,
        total: limit || 0,
        used: 0,
      };
    }

    try {
      const now = Date.now();
      const windowMs = windowSeconds * 1000;

      await this.dragonflyService.zremrangebyscore(key, 0, now - windowMs);

      const [count, ttl] = await Promise.all([
        this.dragonflyService.zcard(key),
        this.dragonflyService.ttl(key),
      ]);

      return {
        remaining: Math.max(0, limit - count),
        reset: Math.max(0, ttl),
        total: limit,
        used: count,
      };
    } catch {
      return {
        remaining: 0,
        reset: 0,
        total: limit || 0,
        used: 0,
      };
    }
  }

  async clearRateLimit(key: string): Promise<void> {
    try {
      await this.dragonflyService.del(key);
    } catch {
      // Fail silently
    }
  }

  updateRateLimits(type: string, config: CacheRateLimitConfig): Promise<void> {
    this.defaultRateLimits[type] = { limit: config.limit, window: config.window };
    return Promise.resolve();
  }

  getRateLimitConfig(type?: string): CacheRateLimitConfig | Record<string, CacheRateLimitConfig> {
    if (type) {
      const config = this.defaultRateLimits[type];
      if (config) {
        return config;
      }
      const defaultConfig = this.defaultRateLimits['api'];
      if (!defaultConfig) {
        throw new HealthcareError(
          ErrorCode.CACHE_CONFIGURATION_ERROR,
          'Default rate limit configuration missing',
          undefined,
          { type },
          'DragonflyCacheProvider.getRateLimitConfig'
        );
      }
      return defaultConfig;
    }
    return this.defaultRateLimits;
  }

  async trackSecurityEvent(identifier: string, eventType: string, details: unknown): Promise<void> {
    try {
      const event = {
        timestamp: new Date(),
        eventType,
        identifier,
        details,
      };

      const eventKey = `security:events:${identifier}`;
      await this.dragonflyService.rPush(eventKey, JSON.stringify(event));
      await this.dragonflyService.lTrim(eventKey, -1000, -1);
      await this.dragonflyService.expire(eventKey, this.SECURITY_EVENT_RETENTION);
    } catch {
      // Fail silently
    }
  }

  async getSecurityEvents(identifier: string, limit: number = 100): Promise<unknown[]> {
    try {
      const eventKey = `security:events:${identifier}`;
      const events = await this.dragonflyService.lRange(eventKey, -limit, -1);
      return events.map((event: string) => JSON.parse(event) as unknown);
    } catch {
      return [];
    }
  }

  async clearSecurityEvents(identifier: string): Promise<void> {
    try {
      const eventKey = `security:events:${identifier}`;
      await this.dragonflyService.del(eventKey);
    } catch {
      // Fail silently
    }
  }

  // Hash operations
  async hSet(key: string, field: string, value: string): Promise<number> {
    try {
      return await this.dragonflyService.hSet(key, field, value);
    } catch {
      return 0;
    }
  }

  async hGet(key: string, field: string): Promise<string | null> {
    try {
      return await this.dragonflyService.hGet(key, field);
    } catch {
      return null;
    }
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    try {
      return await this.dragonflyService.hGetAll(key);
    } catch {
      return {};
    }
  }

  async hDel(key: string, field: string): Promise<number> {
    try {
      return await this.dragonflyService.hDel(key, field);
    } catch {
      return 0;
    }
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    try {
      return await this.dragonflyService.hincrby(key, field, increment);
    } catch {
      return 0;
    }
  }

  // List operations
  async rPush(key: string, value: string): Promise<number> {
    try {
      return await this.dragonflyService.rPush(key, value);
    } catch {
      return 0;
    }
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.dragonflyService.lRange(key, start, stop);
    } catch {
      return [];
    }
  }

  async lLen(key: string): Promise<number> {
    try {
      return await this.dragonflyService.lLen(key);
    } catch {
      return 0;
    }
  }

  async lTrim(key: string, start: number, stop: number): Promise<string> {
    try {
      await this.dragonflyService.lTrim(key, start, stop);
      return 'OK';
    } catch {
      return 'OK';
    }
  }

  // Set operations
  async sAdd(key: string, ...members: string[]): Promise<number> {
    try {
      return await this.dragonflyService.sAdd(key, ...members);
    } catch {
      return 0;
    }
  }

  async sMembers(key: string): Promise<string[]> {
    try {
      return await this.dragonflyService.sMembers(key);
    } catch {
      return [];
    }
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    try {
      return await this.dragonflyService.sRem(key, ...members);
    } catch {
      return 0;
    }
  }

  async sCard(key: string): Promise<number> {
    try {
      return await this.dragonflyService.sCard(key);
    } catch {
      return 0;
    }
  }

  // Sorted Set operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    try {
      return await this.dragonflyService.zadd(key, score, member);
    } catch {
      return 0;
    }
  }

  async zcard(key: string): Promise<number> {
    try {
      return await this.dragonflyService.zcard(key);
    } catch {
      return 0;
    }
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.dragonflyService.zrevrange(key, start, stop);
    } catch {
      return [];
    }
  }

  async zrangebyscore(key: string, min: string | number, max: string | number): Promise<string[]> {
    try {
      return await this.dragonflyService.zrangebyscore(key, min as number, max as number);
    } catch {
      return [];
    }
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    try {
      return await this.dragonflyService.zremrangebyscore(key, min, max);
    } catch {
      return 0;
    }
  }

  // Pub/Sub operations
  async publish(channel: string, message: string): Promise<number> {
    try {
      return await this.dragonflyService.publish(channel, message);
    } catch {
      return 0;
    }
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    try {
      const subscriber = this.dragonflyService.duplicate();
      await subscriber.subscribe(channel);
      subscriber.on('message', (ch, msg) => {
        if (ch === channel) {
          callback(msg);
        }
      });
    } catch {
      // Fail silently
    }
  }

  // Utility operations
  async expireAt(key: string, timestamp: number): Promise<number> {
    try {
      return await this.dragonflyService.expireAt(key, timestamp);
    } catch {
      return 0;
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.dragonflyService.incr(key);
    } catch {
      return 0;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      return await this.dragonflyService.keys(pattern);
    } catch {
      return [];
    }
  }

  async multi(
    commands: Array<{ command: string; args: unknown[] }>
  ): Promise<Array<[Error | null, unknown]>> {
    try {
      return await this.dragonflyService.multi(commands);
    } catch {
      return commands.map(() => [null, null] as [Error | null, unknown]);
    }
  }

  async retryOperation<T>(operation: () => Promise<T>): Promise<T> {
    const maxRetries = 5;
    const retryDelay = 5000;
    let lastError: Error | undefined;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * (i + 1)));
        }
      }
    }
    throw lastError || new Error('Operation failed after retries');
  }
}
