import { RedisService } from "../redis/redis.service";

export function RedisCache(prefix: string, ttl: number = 3600) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      try {
        const redisService = this.redis as RedisService;
        const cacheKey =
          args.length > 0 ? `${prefix}:${args.join(":")}` : prefix;

        // Try to get from cache
        const cachedData = await redisService.get(cacheKey);
        if (cachedData) {
          await redisService.set(
            "cache:hits:total",
            String(
              parseInt((await redisService.get("cache:hits:total")) || "0") + 1
            )
          );
          console.log(`Cache hit: ${cacheKey}`);
          return JSON.parse(cachedData);
        }

        await redisService.set(
          "cache:misses:total",
          String(
            parseInt((await redisService.get("cache:misses:total")) || "0") + 1
          )
        );
        console.log(`Cache miss: ${cacheKey}`);
        // Execute the original method
        const result = await originalMethod.apply(this, args);

        // Store in cache if result exists
        if (result) {
          await redisService.set(cacheKey, JSON.stringify(result), ttl);
        }

        return result;
      } catch (error) {
        console.error(`Cache error in ${propertyKey}:`, error);
        // If cache fails, execute the original method
        return await originalMethod.apply(this, args);
      }
    };

    return descriptor;
  };
}
