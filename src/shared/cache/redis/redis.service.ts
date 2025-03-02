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

    return nodeEnv !== 'production' || 
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
      });

      this.client.on('connect', () => {
        this.logger.log('Successfully connected to Redis');
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

  // Make retryOperation public for rate limiting service
  public async retryOperation<T>(operation: () => Promise<T>): Promise<T> {
    let lastError;
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        this.logger.warn(`Redis operation failed, attempt ${i + 1}/${this.maxRetries}`);
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

  async clearAllCache(): Promise<void> {
    this.logger.warn('Clearing all cache');
    await this.retryOperation(async () => {
      // Get all keys
      const keys = await this.client.keys('*');
      if (keys.length > 0) {
        // Delete all keys except stats and security events
        const keysToDelete = keys.filter(key => 
          !key.startsWith('cache:stats') && 
          !key.startsWith('security:events')
        );
        if (keysToDelete.length > 0) {
          await this.client.del(...keysToDelete);
        }
      }
    });
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
}
