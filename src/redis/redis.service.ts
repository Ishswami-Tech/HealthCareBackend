import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(private configService: ConfigService) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });

    this.redis.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    this.redis.on('connect', () => {
      console.log('Successfully connected to Redis');
    });
  }

  getConnectionStatus(): string {
    return this.redis.status;
  }

  async get(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.redis.set(key, value, "EX", ttl);
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async keys(pattern: string): Promise<string[]> {
    return await this.redis.keys(pattern);
  }

  async type(key: string): Promise<string> {
    return await this.redis.type(key);
  }

  async ttl(key: string): Promise<number> {
    return await this.redis.ttl(key);
  }

  async getStatus(): Promise<any> {
    try {
      const info = await this.redis.info();
      const keys = await this.keys("*");
      const memory = await this.redis.info("memory");

      return {
        isConnected: this.redis.status === "ready",
        keys: keys.length,
        keysList: keys,
        info,
        memory,
        configuration: {
          host: this.configService.get<string>("REDIS_HOST") ?? "localhost",
          port: parseInt(
            this.configService.get<string>("REDIS_PORT") ?? "6379",
            10
          ),
        },
      };
    } catch (error) {
      return {
        isConnected: false,
        error: error.message,
      };
    }
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  getClient(): Redis {
    return this.redis;
  }
}
