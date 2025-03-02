import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit {
  private readonly redis: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.get('REDIS_HOST', 'redis'),
      port: parseInt(this.configService.get('REDIS_PORT', '6379')),
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });
  }

  async onModuleInit() {
    try {
      await this.redis.ping();
      this.logger.log('Successfully connected to Redis');
    } catch (error) {
      this.logger.error('Failed to connect to Redis:', error);
    }
  }

  // Basic Redis operations
  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<'OK'> {
    if (ttl) {
      return this.redis.setex(key, ttl, value);
    }
    return this.redis.set(key, value);
  }

  async del(key: string): Promise<number> {
    return this.redis.del(key);
  }

  // Additional Redis operations needed by controllers
  async keys(pattern: string): Promise<string[]> {
    return this.redis.keys(pattern);
  }

  async type(key: string): Promise<string> {
    return this.redis.type(key);
  }

  async ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }

  // Cache statistics
  async incrementCacheStats(type: 'hits' | 'misses'): Promise<void> {
    await this.redis.incr(`cache:${type}:total`);
  }

  async clearAllCache(): Promise<void> {
    const keys = await this.redis.keys('*');
    if (keys.length) {
      await this.redis.del(...keys);
    }
    this.logger.log(`Cleared ${keys.length} cache entries`);
  }

  async getCacheStats(): Promise<any> {
    const [hits, misses] = await Promise.all([
      this.redis.get('cache:hits:total'),
      this.redis.get('cache:misses:total'),
    ]);

    return {
      hits: parseInt(hits || '0'),
      misses: parseInt(misses || '0'),
      hitRate: hits && misses 
        ? (parseInt(hits) / (parseInt(hits) + parseInt(misses))) * 100 
        : 0,
    };
  }

  async getCacheDebug(): Promise<any> {
    const keys = await this.redis.keys('*');
    const debug = await Promise.all(
      keys.map(async (key) => {
        const ttl = await this.redis.ttl(key);
        const value = await this.redis.get(key);
        return {
          key,
          ttl,
          size: value ? value.length : 0,
          preview: value 
            ? value.substring(0, 100) + (value.length > 100 ? '...' : '') 
            : '',
        };
      })
    );

    return {
      totalKeys: keys.length,
      keys: debug,
    };
  }

  async ping(): Promise<string> {
    return await this.redis.ping();
  }

  getClient(): Redis {
    return this.redis;
  }
}
