import { Logger } from '@nestjs/common';
import { RedisService } from "../redis/redis.service";

export interface CacheOptions {
  ttl?: number;        // Time to live in seconds (0 means no caching)
  prefix?: string;     // Cache key prefix
  keyGenerator?: (...args: any[]) => string;  // Custom key generator
}

export function RedisCache(options: CacheOptions = {}) {
  const logger = new Logger('RedisCache');

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      try {
        const redisService = this.redis as RedisService;
        
        // If TTL is 0, skip caching
        if (options.ttl === 0) {
          return await originalMethod.apply(this, args);
        }

        // Generate cache key based on method and arguments
        const cacheKey = options.prefix 
          ? `${options.prefix}:${args.join(":")}`
          : `${target.constructor.name}:${propertyKey}:${args.join(":")}`;

        // Try to get from cache
        const cachedData = await redisService.get(cacheKey);
        if (cachedData) {
          await redisService.incrementCacheStats('hits');
          logger.debug(`Cache hit: ${cacheKey}`);
          return JSON.parse(cachedData);
        }

        await redisService.incrementCacheStats('misses');
        logger.debug(`Cache miss: ${cacheKey}`);

        // Execute the original method
        const result = await originalMethod.apply(this, args);

        // Store in cache if result exists
        if (result !== undefined && result !== null) {
          await redisService.set(
            cacheKey, 
            JSON.stringify(result), 
            options.ttl || 3600
          );
        }

        return result;
      } catch (error) {
        logger.error(`Cache error in ${propertyKey}:`, error);
        return await originalMethod.apply(this, args);
      }
    };

    return descriptor;
  };
}
