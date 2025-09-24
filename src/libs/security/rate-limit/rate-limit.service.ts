import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../infrastructure/cache/redis/redis.service";
import {
  LoggingService,
  LogType,
  LogLevel,
} from "../../infrastructure/logging/logging.service";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (req: any) => string;
  skipIf?: (req: any) => boolean;
  message?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  total: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly logging: LoggingService,
  ) {}

  async checkRateLimit(
    key: string,
    options: RateLimitOptions,
  ): Promise<RateLimitResult> {
    try {
      const now = Date.now();
      const window = Math.floor(now / options.windowMs);
      const redisKey = `rate_limit:${key}:${window}`;

      // Get current count
      const current = (await this.redis.get<number>(redisKey)) || 0;

      if (current >= options.max) {
        // Rate limit exceeded
        const resetTime = new Date((window + 1) * options.windowMs);

        await this.logging.log(
          LogType.SECURITY,
          LogLevel.WARN,
          "Rate limit exceeded",
          "RateLimitService",
          { key, current, max: options.max, window },
        );

        return {
          allowed: false,
          remaining: 0,
          resetTime,
          total: options.max,
        };
      }

      // Increment counter
      const newCount = await this.redis.incr(redisKey);

      // Set expiration on first increment
      if (newCount === 1) {
        await this.redis.expire(redisKey, Math.ceil(options.windowMs / 1000));
      }

      const resetTime = new Date((window + 1) * options.windowMs);
      const remaining = Math.max(0, options.max - newCount);

      return {
        allowed: true,
        remaining,
        resetTime,
        total: options.max,
      };
    } catch (error) {
      this.logger.error(
        `Rate limit check failed for key: ${key}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Fail open - allow request if Redis is down
      return {
        allowed: true,
        remaining: options.max - 1,
        resetTime: new Date(Date.now() + options.windowMs),
        total: options.max,
      };
    }
  }

  async resetRateLimit(key: string): Promise<void> {
    try {
      const pattern = `rate_limit:${key}:*`;
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);

        await this.logging.log(
          LogType.SECURITY,
          LogLevel.INFO,
          "Rate limit reset",
          "RateLimitService",
          { key, keysCleared: keys.length },
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to reset rate limit for key: ${key}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  generateDefaultKey(req: any): string {
    return req.ip || req.connection?.remoteAddress || "unknown";
  }

  generateUserKey(req: any): string {
    const userId = req.user?.id || req.user?.userId;
    if (userId) {
      return `user:${userId}`;
    }
    return this.generateDefaultKey(req);
  }

  generateAuthKey(req: any): string {
    const identifier = req.body?.email || req.body?.phone || req.body?.username;
    if (identifier) {
      return `auth:${identifier}`;
    }
    return this.generateDefaultKey(req);
  }
}
