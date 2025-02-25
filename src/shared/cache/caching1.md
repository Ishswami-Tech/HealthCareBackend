# Redis Caching System Documentation

## Table of Contents
1. [Overview](#overview)
2. [Setup](#setup)
3. [Basic Usage](#basic-usage)
4. [Advanced Features](#advanced-features)
5. [Monitoring](#monitoring)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)
8. [Examples](#examples)
9. [Testing](#testing)

## Overview
A Redis caching system for NestJS applications that provides automatic caching of API responses with configurable TTL and key management.

### Key Features
- Automatic caching using decorators
- Configurable TTL (Time To Live)
- Custom key generation
- Cache invalidation
- Monitoring and statistics
- Error handling

## Setup

### 1. Dependencies
```bash
npm install @nestjs/common ioredis
```

### 2. Environment Variables
Create a `.env` file with the following:
```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=yourpassword
```

### 3. Redis Module Configuration
```typescript
// src/shared/cache/redis/redis.module.ts
@Module({
  imports: [ConfigModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
```

## Basic Usage

### 1. Simple Caching
Cache the entire method response:
```typescript
@RedisCache()
async getAllUsers() {
  return this.usersRepository.find();
}
```

### 2. Caching with TTL
Cache with a specific TTL:
```typescript
@RedisCache({ ttl: 3600 })
async getUserById(id: string) {
  return this.usersRepository.findUnique({ where: { id } });
}

@RedisCache({ ttl: 1800 }) // 30 minutes
async getUser(id: string) {
  return this.usersRepository.findOne(id);
}
```

### 3. Prefixed Caching
```typescript
@RedisCache({ prefix: "users", ttl: 3600 })
async getUserProfile(id: string) {
  return this.profileRepository.findOne(id);
}
```

## Advanced Features

### 1. Custom Key Generation
```typescript
@RedisCache({
  keyGenerator: (category: string, price: number) => `products:${category}:${price}`
})
async getProducts(category: string, price: number) {
  return this.productsRepository.find({ category, price });
}
```

### 2. Cache Invalidation
```typescript
async updateUser(id: string, data: UpdateUserDto) {
  const user = await this.repository.update(id, data);
  await this.redis.del(`users:${id}`);
  return user;
}
```

### 3. Bulk Operations
```typescript
async bulkUpdate(ids: string[]) {
  await this.repository.bulkUpdate(ids);
  const keys = await this.redis.keys("users:");
  await this.redis.del(...keys);
}
```

## Monitoring

### 1. Cache Statistics
```typescript
// src/shared/cache/controllers/cache.controller.ts
// GET /cache/stats
{
  hits: number;
  misses: number;
  hitRate: number;
  timestamp: string;
}
```

### 2. Debug Information
```typescript
// GET /cache/debug
{
  totalKeys: number;
  keys: Array<{
    key: string;
    ttl: number;
    size: number;
  }>;
}
```

## Best Practices

### 1. TTL Guidelines
- **Real-time data:** 0 seconds (no cache)
- **Frequently changing:** 300-900 seconds (5-15 minutes)
- **Semi-static:** 1800-3600 seconds (30-60 minutes)
- **Static:** 86400 seconds (24 hours)

### 2. Key Naming Conventions
```typescript
// Entity-based
users:${id}
products:${category}:${id}

// Action-based
search:${query}:${page}
filter:${category}:${price}
```

### 3. Error Handling
```typescript
try {
  const cached = await this.redis.get(key);
  if (cached) return JSON.parse(cached);
  
  const data = await this.repository.find();
  await this.redis.set(key, JSON.stringify(data));
  return data;
} catch (error) {
  this.logger.error('Cache error:', error);
  return this.repository.find();
}
```

## Troubleshooting

### Common Issues

1. **Cache Not Working:**
   - Check Redis connection
   - Verify TTL values
   - Check key generation

2. **Memory Issues:**
   - Monitor Redis memory usage
   - Implement proper TTL
   - Use selective caching

3. **Stale Data:**
   - Implement cache invalidation
   - Use appropriate TTL
   - Add cache clearing endpoints

### Debugging Tools

1. **Redis CLI Commands**
```bash
redis-cli monitor         # Monitor cache
redis-cli keys ""         # Check keys
redis-cli ttl "key"      # Check TTL
```

2. **API Endpoints**
```bash
# Get cache stats
curl http://localhost:3000/cache/stats

# Debug cache
curl http://localhost:3000/cache/debug

# Clear cache
curl -X DELETE http://localhost:3000/cache/clear
```

## Examples

### Complete Service Example
```typescript
@Injectable()
export class UserService {
  constructor(
    private repository: Repository,
    private redis: RedisService
  ) {}

  @RedisCache({ prefix: "users", ttl: 3600 })
  async findAll() {
    return this.repository.find();
  }

  @RedisCache({ prefix: "users", ttl: 1800 })
  async findOne(id: string) {
    return this.repository.findOne(id);
  }

  async update(id: string, data: any) {
    const result = await this.repository.update(id, data);
    await this.redis.del(`users:${id}`);
    return result;
  }
}
```

## Testing

### Unit Tests
```typescript
describe('CacheService', () => {
  it('should cache data', async () => {
    const data = { id: 1 };
    await service.findOne(1);
    const cached = await redis.get('users:1');
    expect(JSON.parse(cached)).toEqual(data);
  });
});
```

### Integration Tests
```typescript
describe('Cache Integration', () => {
  it('should handle cache failures', async () => {
    jest.spyOn(redis, 'get').mockRejectedValue(new Error());
    const result = await service.findOne(1);
    expect(result).toBeDefined();
  });
});
```

---


