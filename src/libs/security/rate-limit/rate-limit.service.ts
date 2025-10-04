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
  keyGenerator?: (req: unknown) => string;
  skipIf?: (req: unknown) => boolean;
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
    } catch (_error) {
      this.logger.error(
        `Rate limit check failed for key: ${key}`,
        _error instanceof Error ? _error.stack : undefined,
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
    } catch (_error) {
      this.logger.error(
        `Failed to reset rate limit for key: ${key}`,
        _error instanceof Error ? _error.stack : undefined,
      );
    }
  }

  generateDefaultKey(req: unknown): string {
    const request = req as Record<string, unknown>;
    return (
      (request.ip as string) ||
      ((request.connection as Record<string, unknown>)
        ?.remoteAddress as string) ||
      "unknown"
    );
  }

  generateUserKey(req: unknown): string {
    const request = req as Record<string, unknown>;
    const user = request.user as Record<string, unknown>;
    const userId = user?.id || user?.userId;
    if (userId) {
      return `user:${userId}`;
    }
    return this.generateDefaultKey(req);
  }

  generateAuthKey(req: unknown): string {
    const request = req as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;
    const identifier = body?.email || body?.phone || body?.username;
    if (identifier) {
      return `auth:${identifier}`;
    }
    return this.generateDefaultKey(req);
  }
}
