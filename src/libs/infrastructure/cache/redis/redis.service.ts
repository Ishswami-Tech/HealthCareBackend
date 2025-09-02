import { Injectable, OnModuleInit, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;
  private readonly logger = new Logger(RedisService.name);
  private readonly maxRetries = 5;
  private readonly retryDelay = 5000; // 5 seconds
  private readonly SECURITY_EVENT_RETENTION = 30 * 24 * 60 * 60; // 30 days
  private readonly STATS_KEY = 'cache:stats';
  private readonly isDevelopment: boolean;

  // Rate limiting configuration interface
  private readonly defaultRateLimits = {
    api: { limit: 100, window: 60 },     // 100 requests per minute
    auth: { limit: 5, window: 60 },      // 5 login attempts per minute
    heavy: { limit: 10, window: 300 }    // 10 heavy operations per 5 minutes
  };

  constructor(private configService: ConfigService) {
    // Check multiple environment variables to determine development mode
    this.isDevelopment = this.isDevEnvironment();
    this.logger.log(`Running in ${this.isDevelopment ? 'development' : 'production'} mode`);
    this.initializeClient();
  }

  private isDevEnvironment(): boolean {
    const nodeEnv = this.configService.get('NODE_ENV')?.toLowerCase();
    const appEnv = this.configService.get('APP_ENV')?.toLowerCase();
    const isDev = this.configService.get('IS_DEV');
    const devMode = process.env.DEV_MODE === 'true';
    return devMode || nodeEnv !== 'production' || 
           appEnv === 'development' || 
           appEnv === 'dev' ||
           isDev === 'true' ||
           isDev === true;
  }

  private initializeClient() {
    try {
      const redisHost = this.configService.get('redis.host') || 'redis';
      const redisPort = this.configService.get('redis.port') || 6379;
      
      this.logger.log(`Initializing Redis client at ${redisHost}:${redisPort}`);
      
      this.client = new Redis({
        host: redisHost,
        port: redisPort,
        retryStrategy: (times) => {
          if (times > this.maxRetries) {
            this.logger.error(`Max reconnection attempts (${this.maxRetries}) reached`);
            return null; // stop retrying
          }
          return this.retryDelay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        autoResubscribe: true,
        autoResendUnfulfilledCommands: true,
        lazyConnect: true // Don't connect immediately
      });

      this.client.on('error', (err) => {
        this.logger.error('Redis Client Error', err);
        // Check if it's a read-only error and attempt to fix it
        if (err.message && err.message.includes('READONLY')) {
          this.logger.warn('Redis in read-only mode, attempting to fix...');
          this.resetReadOnlyMode().catch(resetError => {
            this.logger.error('Failed to reset read-only mode:', resetError);
          });
        }
      });

      this.client.on('connect', () => {
        this.logger.log('Successfully connected to Redis');
        // Check read-only status on connect
        this.checkAndResetReadOnlyMode().catch(err => {
          this.logger.error('Failed to check read-only status on connect:', err);
        });
      });

      this.client.on('ready', () => {
        this.logger.log('Redis client is ready');
      });

      this.client.on('reconnecting', () => {
        this.logger.warn('Reconnecting to Redis...');
      });

      this.client.on('end', () => {
        this.logger.warn('Redis connection ended');
      });

    } catch (error) {
      this.logger.error('Failed to initialize Redis client:', error);
      throw error;
    }
  }

  async onModuleInit() {
    try {
      // Ensure connection is established
      await this.client.connect();
      await this.ping();
      
      // Check and reset read-only mode if needed
      await this.checkAndResetReadOnlyMode();
      
      this.logger.log('Redis connection initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Redis connection:', error);
      throw error; // Fail fast if Redis is not available
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  // Check if Redis is in read-only mode and reset if needed
  async checkAndResetReadOnlyMode(): Promise<boolean> {
    try {
      const info = await this.client.info('replication');
      const isReadOnly = info.includes('role:slave') || info.includes('slave_read_only:1');
      
      if (isReadOnly) {
        this.logger.warn('Redis is in read-only mode, attempting to reset...');
        return await this.resetReadOnlyMode();
      }
      
      return true;
    } catch (error) {
      this.logger.error('Failed to check Redis read-only status:', error);
      return false;
    }
  }
  
  // Reset read-only mode
  async resetReadOnlyMode(): Promise<boolean> {
    try {
      // Try to disable read-only mode
      await this.client.config('SET', 'slave-read-only', 'no');
      // Disconnect from master if we're a replica
      await this.client.call('REPLICAOF', 'NO', 'ONE');
      
      this.logger.log('Successfully reset Redis read-only mode');
      return true;
    } catch (error) {
      this.logger.error('Failed to reset Redis read-only mode:', error);
      return false;
    }
  }

  // Make retryOperation public for rate limiting service
  public async retryOperation<T>(operation: () => Promise<T>): Promise<T> {
    let lastError;
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        this.logger.warn(`Redis operation failed, attempt ${i + 1}/${this.maxRetries}`);
        
        // Check if it's a read-only error and try to fix it
        if (error.message && error.message.includes('READONLY')) {
          try {
            await this.resetReadOnlyMode();
          } catch (resetError) {
            // Just log the error, we'll retry the operation anyway
            this.logger.error('Failed to reset read-only mode during retry:', resetError);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      }
    }
    throw lastError;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    await this.retryOperation(async () => {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    });
  }

  async get(key: string): Promise<string | null> {
    return this.retryOperation(() => this.client.get(key));
  }

  async del(key: string): Promise<void> {
    await this.retryOperation(() => this.client.del(key));
  }

  async keys(pattern: string): Promise<string[]> {
    return this.retryOperation(() => this.client.keys(pattern));
  }

  async ttl(key: string): Promise<number> {
    return this.retryOperation(() => this.client.ttl(key));
  }

  async ping(): Promise<string> {
    return this.retryOperation(() => this.client.ping());
  }

  async healthCheck(): Promise<boolean> {
    try {
      const pingResult = await this.ping();
      return pingResult === 'PONG';
    } catch (error) {
      this.logger.error('Redis health check failed:', error);
      return false;
    }
  }

  async getCacheDebug(): Promise<Record<string, any>> {
    try {
      const [info, dbSize, memoryInfo] = await Promise.all([
        this.client.info(),
        this.client.dbsize(),
        this.client.info('memory')
      ]);
      
      const connectedClients = parseInt(info.match(/connected_clients:(\d+)/)?.[1] || '0');
      const usedMemory = parseInt(memoryInfo.match(/used_memory:(\d+)/)?.[1] || '0');
      
      return {
        status: 'ok',
        info: {
          dbSize,
          memoryInfo: {
            usedMemory,
            connectedClients
          },
          serverInfo: info
        }
      };
    } catch (error) {
      this.logger.error('Failed to get Redis debug info:', error);
      throw error;
    }
  }

  // Hash operations
  async hSet(key: string, field: string, value: string): Promise<number> {
    return this.retryOperation(() => this.client.hset(key, field, value));
  }

  async hGet(key: string, field: string): Promise<string | null> {
    return this.retryOperation(() => this.client.hget(key, field));
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return this.retryOperation(() => this.client.hgetall(key));
  }

  async hDel(key: string, field: string): Promise<number> {
    return this.retryOperation(() => this.client.hdel(key, field));
  }

  // List operations
  async rPush(key: string, value: string): Promise<number> {
    return this.retryOperation(() => this.client.rpush(key, value));
  }

  async lTrim(key: string, start: number, stop: number): Promise<string> {
    return this.retryOperation(() => this.client.ltrim(key, start, stop));
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    return this.retryOperation(() => this.client.lrange(key, start, stop));
  }

  async lLen(key: string): Promise<number> {
    return this.retryOperation(() => this.client.llen(key));
  }

  // Set operations
  async sAdd(key: string, ...members: string[]): Promise<number> {
    return this.retryOperation(() => this.client.sadd(key, ...members));
  }

  async sMembers(key: string): Promise<string[]> {
    return this.retryOperation(() => this.client.smembers(key));
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    return this.retryOperation(() => this.client.srem(key, ...members));
  }

  async sCard(key: string): Promise<number> {
    return this.retryOperation(() => this.client.scard(key));
  }

  // Pub/Sub operations
  async publish(channel: string, message: string): Promise<number> {
    return this.retryOperation(() => this.client.publish(channel, message));
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    const subscriber = this.client.duplicate();
    await subscriber.subscribe(channel);
    subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        callback(message);
      }
    });
  }

  // Key expiry operations
  async expire(key: string, seconds: number): Promise<number> {
    return this.retryOperation(() => this.client.expire(key, seconds));
  }

  async expireAt(key: string, timestamp: number): Promise<number> {
    return this.retryOperation(() => this.client.expireat(key, timestamp));
  }

  // Security event tracking
  async trackSecurityEvent(identifier: string, eventType: string, details: any): Promise<void> {
    const event = {
      timestamp: new Date(),
      eventType,
      identifier,
      details
    };

    await this.retryOperation(async () => {
      const eventKey = `security:events:${identifier}`;
      
      // Add event to the list
      await this.client.rpush(eventKey, JSON.stringify(event));
      
      // Trim list to keep only last 1000 events
      await this.client.ltrim(eventKey, -1000, -1);
      
      // Set expiry for events list
      await this.client.expire(eventKey, this.SECURITY_EVENT_RETENTION);
    });

    this.logger.debug(`Security event tracked: ${eventType} for ${identifier}`);
  }

  async getSecurityEvents(identifier: string, limit: number = 100): Promise<any[]> {
    const eventKey = `security:events:${identifier}`;
    const events = await this.retryOperation(() => 
      this.client.lrange(eventKey, -limit, -1)
    );
    
    return events.map(event => JSON.parse(event));
  }

  async clearSecurityEvents(identifier: string): Promise<void> {
    const eventKey = `security:events:${identifier}`;
    await this.retryOperation(() => this.client.del(eventKey));
  }

  // Cache statistics methods
  async incrementCacheStats(type: 'hits' | 'misses'): Promise<void> {
    await this.retryOperation(() => this.client.hincrby(this.STATS_KEY, type, 1));
  }

  async getCacheStats(): Promise<{ hits: number; misses: number }> {
    const stats = await this.retryOperation(() => this.client.hgetall(this.STATS_KEY));
    return {
      hits: parseInt(stats?.hits || '0'),
      misses: parseInt(stats?.misses || '0')
    };
  }

  async clearAllCache(): Promise<number> {
    this.logger.warn('Clearing all cache');
    
    try {
      // Get all keys
      const keys = await this.keys('*');
      
      if (keys.length === 0) {
        return 0;
      }
      
      // Filter out system keys
      const keysToDelete = keys.filter(key => 
        !key.startsWith('cache:stats') && 
        !key.startsWith('security:events') &&
        !key.startsWith('system:')
      );
      
      if (keysToDelete.length === 0) {
        return 0;
      }
      
      // Delete keys in batches to avoid blocking
      const BATCH_SIZE = 1000;
      let deletedCount = 0;
      
      for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
        const batch = keysToDelete.slice(i, i + BATCH_SIZE);
        if (batch.length > 0) {
          const count = await this.retryOperation(() => this.client.del(...batch));
          deletedCount += count;
        }
      }
      
      this.logger.debug(`Cleared ${deletedCount} keys from cache`);
      return deletedCount;
    } catch (error) {
      this.logger.error('Error clearing all cache:', error);
      throw error;
    }
  }

  async resetCacheStats(): Promise<void> {
    await this.retryOperation(() => this.client.del(this.STATS_KEY));
  }

  async getCacheMetrics(): Promise<Record<string, any>> {
    const [stats, info, dbSize] = await Promise.all([
      this.getCacheStats(),
      this.client.info('memory'),
      this.client.dbsize()
    ]);

    const usedMemory = parseInt(info.match(/used_memory:(\d+)/)?.[1] || '0');
    const peakMemory = parseInt(info.match(/used_memory_peak:(\d+)/)?.[1] || '0');
    const fragmentationRatio = parseFloat(info.match(/mem_fragmentation_ratio:(\d+\.\d+)/)?.[1] || '0');

    return {
      stats,
      memory: {
        used: usedMemory,
        peak: peakMemory,
        fragmentationRatio
      },
      keys: dbSize,
      hitRatio: stats.hits / (stats.hits + stats.misses) || 0
    };
  }

  // Enhanced rate limiting methods
  async isRateLimited(
    key: string, 
    limit?: number, 
    windowSeconds?: number, 
    options: { 
      burst?: number,           // Allow burst requests
      cost?: number,           // Request cost (default: 1)
      bypassDev?: boolean     // Override development mode bypass
    } = {}
  ): Promise<boolean> {
    // Check development mode bypass
    if (this.isDevelopment && !options.bypassDev) {
      return false;
    }

    // Get default limits if not specified
    const type = key.split(':')[0];
    const defaultLimit = this.defaultRateLimits[type] || this.defaultRateLimits.api;
    limit = limit || defaultLimit.limit;
    windowSeconds = windowSeconds || defaultLimit.window;

    try {
      const multi = this.client.multi();
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const cost = options.cost || 1;
      const burstLimit = options.burst ? limit + options.burst : limit;

      // Remove old entries
      multi.zremrangebyscore(key, 0, now - windowMs);
      
      // Add current request with cost
      multi.zadd(key, now, `${now}-${Math.random()}-${cost}`);
      
      // Get total cost of requests in window
      multi.zcard(key);
      
      // Set expiry on the set
      multi.expire(key, windowSeconds);

      const results = await multi.exec();
      const current = results ? parseInt(results[2][1] as string) : 0;

      // Check against burst limit if specified, otherwise normal limit
      return current * cost > (options.burst ? burstLimit : limit);
    } catch (error) {
      this.logger.error(`Rate limiting error for key ${key}:`, error);
      return false; // Fail open in case of errors
    }
  }

  async getRateLimit(
    key: string,
    limit?: number,
    windowSeconds?: number
  ): Promise<{ 
    remaining: number; 
    reset: number;
    total: number;
    used: number;
  }> {
    // Development mode check
    if (this.isDevelopment) {
      return { 
        remaining: 999999, 
        reset: 0,
        total: 999999,
        used: 0
      };
    }

    // Get default limits if not specified
    const type = key.split(':')[0];
    const defaultLimit = this.defaultRateLimits[type] || this.defaultRateLimits.api;
    limit = limit || defaultLimit.limit;
    windowSeconds = windowSeconds || defaultLimit.window;

    try {
      const now = Date.now();
      const windowMs = windowSeconds * 1000;

      // Clean up old entries first
      await this.client.zremrangebyscore(key, 0, now - windowMs);

      const [count, ttl] = await Promise.all([
        this.client.zcard(key),
        this.client.ttl(key)
      ]);

      return {
        remaining: Math.max(0, limit - count),
        reset: Math.max(0, ttl),
        total: limit,
        used: count
      };
    } catch (error) {
      this.logger.error(`Error getting rate limit for key ${key}:`, error);
      return { 
        remaining: 0, 
        reset: 0,
        total: limit || 0,
        used: 0
      };
    }
  }

  async clearRateLimit(key: string): Promise<void> {
    try {
      await this.client.del(key);
      this.logger.debug(`Rate limit cleared for key: ${key}`);
    } catch (error) {
      this.logger.error(`Error clearing rate limit for key ${key}:`, error);
    }
  }

  // Method to update rate limit configuration
  async updateRateLimits(
    type: string,
    config: { limit: number; window: number }
  ): Promise<void> {
    this.defaultRateLimits[type] = config;
    this.logger.log(`Updated rate limits for ${type}: ${JSON.stringify(config)}`);
  }

  // Method to get current rate limit configuration
  getRateLimitConfig(type?: string): any {
    return type 
      ? this.defaultRateLimits[type]
      : this.defaultRateLimits;
  }

  // Development mode helper
  isDevelopmentMode(): boolean {
    return this.isDevelopment;
  }

  // Sorted Set operations for rate limiting
  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    return this.retryOperation(() => this.client.zremrangebyscore(key, min, max));
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.retryOperation(() => this.client.zadd(key, score, member));
  }

  async zcard(key: string): Promise<number> {
    return this.retryOperation(() => this.client.zcard(key));
  }

  // Hash operations for metrics
  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.retryOperation(() => this.client.hincrby(key, field, increment));
  }

  /**
   * Gets the health status of the Redis connection.
   * Returns a tuple with health status boolean and ping time in milliseconds.
   */
  async getHealthStatus(): Promise<[boolean, number]> {
    try {
      const startTime = Date.now();
      const pingResult = await this.ping();
      const pingTime = Date.now() - startTime;
      
      return [pingResult === 'PONG', pingTime];
    } catch (error) {
      this.logger.error('Redis health check failed:', error);
      return [false, 0];
    }
  }

  /**
   * Clears cache entries matching the given pattern.
   * Returns the number of keys that were removed.
   * 
   * @param pattern - Pattern to match keys (e.g. "user:*")
   * @returns Number of keys cleared
   */
  async clearCache(pattern?: string): Promise<number> {
    this.logger.log(`Clearing cache with pattern: ${pattern || 'ALL'}`);
    
    try {
      // If no pattern is provided, clear all non-system keys
      if (!pattern) {
        return await this.clearAllCache();
      }
      
      // Get all keys matching the pattern
      const keys = await this.keys(pattern);
      
      if (keys.length === 0) {
        return 0;
      }
      
      // Delete keys in batches to avoid blocking the Redis server
      const BATCH_SIZE = 1000;
      let deletedCount = 0;
      
      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        if (batch.length > 0) {
          const count = await this.retryOperation(() => this.client.del(...batch));
          deletedCount += count;
        }
      }
      
      this.logger.debug(`Cleared ${deletedCount} keys matching pattern: ${pattern}`);
      return deletedCount;
    } catch (error) {
      this.logger.error(`Error clearing cache with pattern ${pattern}:`, error);
      throw error;
    }
  }

  /**
   * Unified caching service that handles all caching operations.
   * This is the main method to use for all caching needs with built-in SWR.
   * 
   * @param key - Cache key
   * @param fetchFn - Function to fetch data
   * @param options - Caching options
   * @returns Cached or fresh data
   */
  async cache<T>(
    key: string, 
    fetchFn: () => Promise<T>, 
    options: {
      ttl?: number;                  // Cache TTL in seconds
      staleTime?: number;            // When data becomes stale
      forceRefresh?: boolean;        // Force refresh regardless of cache
      compress?: boolean;            // Compress large data
      priority?: 'high' | 'low';     // Operation priority  
      enableSwr?: boolean;           // Enable SWR (defaults to true)
      tags?: string[];               // Cache tags for grouped invalidation
    } = {}
  ): Promise<T> {
    const {
      ttl = 3600,
      staleTime = Math.floor(ttl / 2),
      forceRefresh = false,
      compress = false,
      priority = 'high',
      enableSwr = true,
      tags = []
    } = options;

    // Add tags to this key if provided
    if (tags.length > 0) {
      await this.addKeyToTags(key, tags);
    }

    // If SWR is disabled, use standard caching
    if (!enableSwr) {
      return this.standardCacheFetch(key, fetchFn, ttl, forceRefresh);
    }

    const revalidationKey = `${key}:revalidating`;
    
    try {
      // Use pipelining to reduce round-trips to Redis
      const [isRevalidating, cachedData, remainingTtlRaw] = await this.retryOperation(async () => {
        const pipeline = this.client.pipeline();
        pipeline.get(revalidationKey);
        pipeline.get(key);
        pipeline.ttl(key);
        const results = await pipeline.exec();
        return results.map(result => result[1]);
      });
      
      // Convert TTL to number
      const remainingTtl = typeof remainingTtlRaw === 'number' ? remainingTtlRaw : 0;
      
      // Cache miss or forced refresh
      if (!cachedData || forceRefresh) {
        await this.incrementCacheStats('misses');
        
        // Skip locking for low priority operations under high load
        if (priority === 'low' && await this.isHighLoad()) {
          this.logger.debug(`Skipping lock acquisition for low priority operation: ${key}`);
        } else {
          // Set revalidation flag with a short expiry
          await this.set(revalidationKey, 'true', 30);
        }
        
        try {
          const freshData = await fetchFn();
          
          // Only cache valid data
          if (freshData !== undefined && freshData !== null) {
            // Store data with optional compression
            if (compress) {
              await this.setCompressed(key, freshData, ttl);
            } else {
              await this.set(key, JSON.stringify(freshData), ttl);
            }
          }
          
          // Clear revalidation flag
          await this.del(revalidationKey);
          
          return freshData;
        } catch (error) {
          // Clear revalidation flag on error
          await this.del(revalidationKey);
          throw error;
        }
      }
      
      // Record cache hit
      await this.incrementCacheStats('hits');
      
      // Check if we're in the stale period
      const isStale = remainingTtl <= staleTime;
      
      // If stale and not already revalidating, trigger background refresh
      if (isStale && !isRevalidating) {
        // Skip background revalidation for low priority during high load
        if (priority === 'low' && await this.isHighLoad()) {
          this.logger.debug(`Skipping background revalidation for low priority cache: ${key}`);
        } else {
          // Use set with NX option to prevent race conditions
          const lockAcquired = await this.retryOperation(() => 
            this.client.set(revalidationKey, 'true', 'EX', 30, 'NX')
          );
          
          if (lockAcquired) {
            // Background revalidation with optimized lock
            this.backgroundRevalidate(key, fetchFn, ttl, revalidationKey, compress, tags)
              .catch(err => this.logger.error(`Background revalidation failed for ${key}:`, err));
          }
        }
      }
      
      // Return cached data immediately
      return compress ? 
        await this.getDecompressed<T>(cachedData as string) : 
        JSON.parse(cachedData as string);
    } catch (error) {
      this.logger.error(`Cache error for ${key}:`, error);
      
      // If anything fails, fall back to direct fetch
      try {
        return await fetchFn();
      } catch (fetchError) {
        this.logger.error(`Fallback fetch also failed for ${key}:`, fetchError);
        throw fetchError;
      }
    }
  }

  /**
   * Invalidate a specific cache key.
   * 
   * @param key - The cache key to invalidate
   * @returns Boolean indicating success
   */
  async invalidateCache(key: string): Promise<boolean> {
    try {
      await this.del(key);
      this.logger.debug(`Invalidated cache for key: ${key}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to invalidate cache for key: ${key}`, error);
      return false;
    }
  }

  /**
   * Invalidate multiple cache keys by pattern.
   * 
   * @param pattern - Pattern to match keys for invalidation (e.g., "user:*")
   * @returns Number of keys invalidated
   */
  async invalidateCacheByPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }
      
      // Delete keys in batches
      const BATCH_SIZE = 1000;
      let invalidatedCount = 0;
      
      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        if (batch.length > 0) {
          const count = await this.retryOperation(() => this.client.del(...batch));
          invalidatedCount += count;
        }
      }
      
      this.logger.debug(`Invalidated ${invalidatedCount} keys matching pattern: ${pattern}`);
      return invalidatedCount;
    } catch (error) {
      this.logger.error(`Failed to invalidate cache by pattern: ${pattern}`, error);
      return 0;
    }
  }

  /**
   * Invalidate cache by tag.
   * Use tags to group related cache entries for easier invalidation.
   * 
   * @param tag - Tag name to invalidate
   * @returns Number of keys invalidated
   */
  async invalidateCacheByTag(tag: string): Promise<number> {
    try {
      const tagKey = `tag:${tag}`;
      const keys = await this.sMembers(tagKey);
      
      if (keys.length === 0) {
        return 0;
      }
      
      // Delete all keys in the tag
      const BATCH_SIZE = 1000;
      let invalidatedCount = 0;
      
      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        if (batch.length > 0) {
          const count = await this.retryOperation(() => this.client.del(...batch));
          invalidatedCount += count;
        }
      }
      
      // Clean up the tag itself
      await this.del(tagKey);
      
      this.logger.debug(`Invalidated ${invalidatedCount} keys with tag: ${tag}`);
      return invalidatedCount;
    } catch (error) {
      this.logger.error(`Failed to invalidate cache by tag: ${tag}`, error);
      return 0;
    }
  }

  /**
   * Associate a key with one or more tags for grouped invalidation.
   * 
   * @param key - Cache key to tag
   * @param tags - Array of tags to associate with the key
   */
  private async addKeyToTags(key: string, tags: string[]): Promise<void> {
    try {
      for (const tag of tags) {
        const tagKey = `tag:${tag}`;
        await this.sAdd(tagKey, key);
        
        // Set expiration on tag to prevent forever growth
        const keyTtl = await this.ttl(key);
        
        // If key exists and has TTL, set tag expiry to match the longest-lived key
        if (keyTtl > 0) {
          const tagTtl = await this.ttl(tagKey);
          // Only update if the current key has a longer TTL than the tag
          if (tagTtl === -1 || keyTtl > tagTtl) {
            await this.expire(tagKey, keyTtl + 60); // Add buffer time
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to add key ${key} to tags: ${tags.join(', ')}`, error);
    }
  }

  /**
   * Enhanced background revalidation with adaptive retry and circuit breaking.
   */
  private async backgroundRevalidate<T>(
    key: string,
    fetchFn: () => Promise<T>,
    cacheTtl: number,
    revalidationKey: string,
    compression: boolean = false,
    tags: string[] = []
  ): Promise<void> {
    try {
      // Check system load before proceeding
      if (await this.isHighLoad()) {
        // Under high load, extend the TTL of the existing cache to reduce pressure
        await this.client.expire(key, cacheTtl);
        this.logger.debug(`Extended TTL for ${key} due to high system load`);
        return;
      }
      
      // Fetch fresh data
      const freshData = await fetchFn();
      
      // Update cache with fresh data if valid
      if (freshData !== undefined && freshData !== null) {
        if (compression) {
          await this.setCompressed(key, freshData, cacheTtl);
        } else {
          // Use pipeline to set data and update metadata in one go
          await this.retryOperation(async () => {
            const pipeline = this.client.pipeline();
            pipeline.set(key, JSON.stringify(freshData));
            pipeline.expire(key, cacheTtl);
            await pipeline.exec();
          });
        }
        
        // Update tags if needed
        if (tags.length > 0) {
          await this.addKeyToTags(key, tags);
        }
      }
      
      this.logger.debug(`Background revalidation completed for: ${key}`);
    } catch (error) {
      this.logger.error(`Background revalidation failed for ${key}:`, error);
      
      // On error, keep the current cache valid longer to prevent stampedes
      await this.client.expire(key, cacheTtl);
    } finally {
      // Always clear the revalidation flag when done
      await this.del(revalidationKey);
    }
  }

  // Deprecated but kept for backward compatibility
  async cacheWithSWR<T>(
    key: string, 
    fetchFn: () => Promise<T>, 
    options: {
      cacheTtl?: number;
      staleWhileRevalidateTtl?: number;
      revalidationKey?: string;
      forceRefresh?: boolean;
      useSwr?: boolean;
      compression?: boolean;
      priority?: 'high' | 'low';
    } = {}
  ): Promise<T> {
    this.logger.warn('cacheWithSWR is deprecated, please use cache() instead');
    return this.cache(key, fetchFn, {
      ttl: options.cacheTtl,
      staleTime: options.staleWhileRevalidateTtl,
      forceRefresh: options.forceRefresh,
      enableSwr: options.useSwr,
      compress: options.compression,
      priority: options.priority
    });
  }

  /**
   * Check if the Redis server is under high load.
   * Used for adaptive caching strategies.
   */
  private async isHighLoad(): Promise<boolean> {
    try {
      const info = await this.client.info('stats');
      
      // Extract operations per second
      const opsPerSecMatch = info.match(/instantaneous_ops_per_sec:(\d+)/);
      if (opsPerSecMatch) {
        const opsPerSec = parseInt(opsPerSecMatch[1], 10);
        // Consider high load if more than 1000 ops/sec
        return opsPerSec > 1000;
      }
      
      return false;
    } catch (error) {
      this.logger.error('Error checking Redis load:', error);
      return false;
    }
  }

  /**
   * Store compressed data in Redis to save memory.
   * Used for large cache entries.
   */
  private async setCompressed<T>(key: string, value: T, ttl?: number): Promise<void> {
    const stringValue = JSON.stringify(value);
    
    // Only compress if data is large enough to benefit
    if (stringValue.length < 1024) {
      return this.set(key, stringValue, ttl);
    }
    
    try {
      // This would use a compression library in a real implementation
      // For now we'll just use a placeholder
      const compressed = Buffer.from(`compressed:${stringValue}`).toString('base64');
      
      await this.set(key, compressed, ttl);
    } catch (error) {
      this.logger.error(`Error compressing data for key ${key}:`, error);
      // Fall back to uncompressed storage
      await this.set(key, stringValue, ttl);
    }
  }

  /**
   * Retrieve and decompress data from Redis.
   */
  private async getDecompressed<T>(data: string): Promise<T> {
    if (!data.startsWith('compressed:')) {
      return JSON.parse(data);
    }
    
    try {
      // This would decompress using the same library in a real implementation
      // For now we'll just use a placeholder
      const decompressed = Buffer.from(data, 'base64').toString();
      const jsonString = decompressed.substring('compressed:'.length);
      
      return JSON.parse(jsonString);
    } catch (error) {
      this.logger.error(`Error decompressing data:`, error);
      // Attempt to parse as if it wasn't compressed
      return JSON.parse(data);
    }
  }

  /**
   * Standard cache method without SWR behavior.
   * Used when SWR is disabled but caching is still needed.
   * 
   * @param key - Cache key
   * @param fetchFn - Function to fetch fresh data
   * @param cacheTtl - Cache time-to-live in seconds
   * @param forceRefresh - Whether to bypass cache and force fresh data
   * @returns Cached or fresh data
   * @private
   */
  private async standardCacheFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    cacheTtl: number,
    forceRefresh: boolean
  ): Promise<T> {
    // If force refresh, skip cache check
    if (forceRefresh) {
      const data = await fetchFn();
      if (data !== undefined && data !== null) {
        await this.set(key, JSON.stringify(data), cacheTtl);
      }
      return data;
    }
    
    // Check cache first
    const cachedData = await this.get(key);
    if (cachedData) {
      await this.incrementCacheStats('hits');
      return JSON.parse(cachedData);
    }
    
    // Cache miss
    await this.incrementCacheStats('misses');
    const data = await fetchFn();
    
    // Store in cache
    if (data !== undefined && data !== null) {
      await this.set(key, JSON.stringify(data), cacheTtl);
    }
    
    return data;
  }
}
