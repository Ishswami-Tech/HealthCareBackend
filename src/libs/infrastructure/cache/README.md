# Redis Caching System with SWR

A high-performance, robust, and scalable Redis caching implementation with Stale-While-Revalidate support for NestJS applications.

## Features

- **SWR (Stale-While-Revalidate)** - Returns stale data immediately while updating in the background
- **Consolidated API** - Single service method that handles all caching operations
- **Tag-based Invalidation** - Group related cache entries for easier invalidation
- **Pattern-based Invalidation** - Clear cache by key patterns
- **Adaptive Caching** - Adjusts behavior based on system load
- **Memory Optimization** - Optional compression for large cache entries
- **Prioritization** - Supports high and low priority cache operations
- **Batch Processing** - Efficient handling of bulk operations
- **Distributed Locking** - Prevents cache stampedes and race conditions
- **Auto-balancing** - Scales back operations during high load
- **Circuit Breaking** - Prevents cascading failures during outages

## Usage

### Basic Decorator Usage

```typescript
import { RedisCache } from '../decorators/redis-cache.decorator';

@Controller('users')
export class UsersController {
  
  @Get(':id')
  @RedisCache({
    ttl: 300,             // 5 minutes cache TTL
    prefix: 'users',      // Cache key prefix
    staleTime: 60,        // Data becomes stale after 60 seconds
    tags: ['users']       // Tag for grouped invalidation
  })
  async getUser(@Param('id') id: string) {
    // Expensive database operation
    return this.usersService.findById(id);
  }
}
```

### Advanced Service Usage

```typescript
import { Injectable } from '@nestjs/common';
import { RedisService } from '../cache/redis/redis.service';

@Injectable()
export class ProductsService {
  constructor(private readonly redis: RedisService) {}
  
  async getProductDetails(id: string, options = {}) {
    const cacheKey = `products:${id}:details`;
    
    return this.redis.cache(
      cacheKey,
      // Data fetch function
      async () => this.fetchProductFromDatabase(id), 
      {
        ttl: 600,                // 10 minutes TTL
        staleTime: 120,          // 2 minutes stale time
        compress: true,          // Compress data if large
        priority: options.priority || 'high',
        tags: ['products', `product:${id}`] // Tags for invalidation
      }
    );
  }
  
  // Invalidate product cache when updated
  async updateProduct(id: string, data: any) {
    const result = await this.updateProductInDatabase(id, data);
    
    // Invalidate specific product cache
    await this.redis.invalidateCache(`products:${id}:details`);
    
    // Or invalidate all caches for this product
    await this.redis.invalidateCacheByTag(`product:${id}`);
    
    return result;
  }
  
  // Invalidate all products when catalog changes
  async refreshProductCatalog() {
    await this.rebuildCatalogInDatabase();
    
    // Invalidate all product caches at once
    await this.redis.invalidateCacheByTag('products');
    
    return { success: true };
  }
}
```

## API Reference

### Cache Controller Endpoints

- `GET /cache` - Get consolidated cache information including metrics and stats
- `DELETE /cache?pattern=users:*` - Clear cache entries matching pattern
- `POST /cache/config` - Update cache configuration settings
- `GET /cache/benchmark` - Run performance tests on the cache system

### RedisCache Decorator Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| ttl | number | 3600 | Cache time-to-live in seconds |
| prefix | string | Class+Method | Cache key prefix |
| useSwr | boolean | true | Whether to use SWR caching |
| staleTime | number | ttl/2 | When data becomes stale and needs refresh |
| forceRefresh | boolean | false | Whether to bypass cache and force fetch |
| tags | string[] | [] | Tags for grouped invalidation |
| compress | boolean | false | Whether to compress large data |
| priority | 'high'\|'low' | 'high' | Processing priority |

### Unified Cache Method Options

```typescript
// All cache operations use a single method with consistent options
redis.cache(
  'cache-key',
  () => fetchData(),    // Data fetching function
  {
    ttl: 3600,          // Cache time-to-live (seconds)
    staleTime: 300,     // When data becomes stale
    forceRefresh: false,// Force fresh data fetch
    enableSwr: true,    // Enable Stale-While-Revalidate
    compress: false,    // Compress large cache entries
    priority: 'high',   // Processing priority
    tags: ['tag1', 'tag2'] // Tags for grouped invalidation
  }
);
```

### Cache Invalidation

```typescript
// Invalidate a specific cache key
await redis.invalidateCache('users:123');

// Invalidate by pattern (e.g., all users)
await redis.invalidateCacheByPattern('users:*');

// Invalidate by tag (all cache entries tagged with 'users')
await redis.invalidateCacheByTag('users');
```

## Performance Considerations

- **Memory Usage**: Large cache entries are automatically compressed
- **High Load**: Low priority operations are throttled during high system load
- **Batch Processing**: Operations are performed in batches to prevent blocking
- **Connection Pooling**: Optimized Redis connections for high throughput
- **Redis Pipelining**: Reduces network round trips for better performance

## Error Handling

- **Circuit Breaking**: Prevents cascading failures during outages
- **Fallback Mechanisms**: Multiple layers of error recovery
- **Graceful Degradation**: Extends TTL during errors to prevent cache stampedes
- **Detailed Logging**: Comprehensive error logs for debugging

## Monitoring

Use the cache controller to monitor the health and performance of your Redis cache:

```
GET /cache?includeDebug=true
```

This returns detailed metrics about your cache usage, hit rates, memory consumption, and more. 