import { RedisService } from '../redis/redis.service';

export function RedisCache(keyPrefix: string, ttl: number = 3600) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const redisService = this.redis as RedisService;
      const cacheKey = `${keyPrefix}:${args.join(':')}`;

      const cachedData = await redisService.get(cacheKey);
      if (cachedData) {
        return JSON.parse(cachedData);
      }

      const result = await originalMethod.apply(this, args);
      if (result) {
        await redisService.set(cacheKey, JSON.stringify(result), ttl);
      }

      return result;
    };

    return descriptor;
  };
}
