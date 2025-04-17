import { Logger } from '@nestjs/common';
import { RedisService } from "../redis/redis.service";

/**
 * Cache options for the RedisCache decorator
 * 
 * @property ttl - Time to live in seconds (0 means no caching, default: 3600)
 * @property prefix - Cache key prefix for namespacing
 * @property keyGenerator - Custom function to generate cache keys
 * @property useSwr - Whether to use Stale-While-Revalidate strategy (default: true)
 * @property staleTime - How long data is considered fresh before revalidation (in seconds)
 * @property forceRefresh - Force data refresh regardless of cache status
 * @property tags - Cache tags for grouped invalidation
 * @property compress - Whether to compress large cache entries
 * @property priority - Processing priority for cache operations
 */
export interface CacheOptions {
  ttl?: number;        
  prefix?: string;     
  keyGenerator?: (...args: any[]) => string;  
  useSwr?: boolean;    
  staleTime?: number;  
  forceRefresh?: boolean;
  tags?: string[];
  compress?: boolean;
  priority?: 'high' | 'low';
}

/**
 * Redis cache decorator with Stale-While-Revalidate (SWR) support
 * 
 * This decorator enables automatic caching of method results in Redis with SWR strategy:
 * - Returns stale data immediately while fetching fresh data in the background
 * - Improves perceived performance while maintaining data freshness
 * - Reduces load on backend services during traffic spikes
 * - Supports tag-based cache invalidation
 * 
 * @param options - Cache configuration options
 * @returns Method decorator
 * 
 * @example
 * // Basic usage with default options
 * @RedisCache()
 * async getUsers() {
 *   // Method implementation
 * }
 * 
 * @example
 * // Custom configuration with tags for invalidation
 * @RedisCache({
 *   ttl: 300,               // 5 minutes cache TTL
 *   prefix: 'api:users',    // Cache key prefix
 *   staleTime: 60,          // Becomes stale after 60 seconds
 *   tags: ['users', 'api']  // Tags for grouped invalidation
 * })
 * async getUsers() {
 *   // Method implementation
 * }
 */
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
        const cacheKey = generateCacheKey(target, propertyKey, args, options);
        
        // Get the query params from args to check for force refresh
        const forceRefresh = getForceRefreshFromArgs(args) || options.forceRefresh || false;

        // Define the data fetch function
        const fetchFn = () => originalMethod.apply(this, args);
        
        // Use the unified cache mechanism
        return await redisService.cache(cacheKey, fetchFn, {
          ttl: options.ttl,
          staleTime: options.staleTime,
          forceRefresh,
          enableSwr: options.useSwr,
          compress: options.compress,
          priority: options.priority,
          tags: options.tags
        });
      } catch (error) {
        logger.error(`Cache error in ${propertyKey}:`, error);
        return await originalMethod.apply(this, args);
      }
    };

    return descriptor;
  };
}

/**
 * Generates a consistent cache key based on method and arguments
 * 
 * @param target - The decorated class
 * @param propertyKey - The decorated method name
 * @param args - Method arguments
 * @param options - Cache options
 * @returns A unique cache key string
 */
function generateCacheKey(target: any, propertyKey: string, args: any[], options: CacheOptions): string {
  if (options.keyGenerator) {
    return options.keyGenerator(...args);
  }
  
  // Create a stable JSON representation of arguments
  const argsKey = args.map(arg => {
    // Handle query objects, parameters, and other complex types
    if (arg && typeof arg === 'object') {
      // Filter out undefined and function values that can't be serialized
      const filteredObj = Object.entries(arg).reduce((acc, [key, value]) => {
        if (value !== undefined && typeof value !== 'function') {
          acc[key] = value;
        }
        return acc;
      }, {});
      
      // Skip forceRefresh in the cache key if present
      if ('forceRefresh' in filteredObj) {
        delete filteredObj['forceRefresh'];
      }
      
      return JSON.stringify(filteredObj);
    }
    return String(arg);
  }).join(':');
  
  return options.prefix 
    ? `${options.prefix}:${argsKey}`
    : `${target.constructor.name}:${propertyKey}:${argsKey}`;
}

/**
 * Extracts forceRefresh parameter from method arguments
 * 
 * @param args - Method arguments to analyze
 * @returns Boolean indicating if refresh is forced, or undefined if not specified
 */
function getForceRefreshFromArgs(args: any[]): boolean | undefined {
  for (const arg of args) {
    // Look for forceRefresh in query parameters or body
    if (arg && typeof arg === 'object') {
      if ('forceRefresh' in arg) {
        const value = arg.forceRefresh;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') return value.toLowerCase() === 'true';
      }
    }
  }
  return undefined;
}
