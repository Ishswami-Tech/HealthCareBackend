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
@Module({
  imports: [ConfigModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
```

## Basic Usage

### Example 1: Basic Caching

Caches the entire response with default TTL (3600s):

```typescript
@RedisCache()
async basicExample() {
  return this.repository.findAll();
}
```

### Example 2: Caching with TTL

```typescript
@RedisCache({ ttl: 1800 }) // 30 minutes
async ttlExample() {
  return this.repository.find();
}
```

### Example 3: Prefixed Caching

```typescript
@RedisCache({ prefix: "users", ttl: 3600 })
async prefixExample(id: string) {
  return this.repository.findOne(id);
}
```

### Example 4: Disable Caching

```typescript
@RedisCache({ ttl: 0 })
async noCacheExample() {
  return this.repository.getRealTimeData();
}
```

### Example 5: Custom Key Generation

```typescript
@RedisCache({
  ttl: 3600,
  keyGenerator: (id: string, type: string) => `custom:${type}:${id}`
})
async customKeyExample(id: string, type: string) {
  return this.repository.getCustomData(id, type);
}
```

## Monitoring

### 1. Cache Statistics

```typescript
interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  timestamp: string;
}
```

### 2. Debug Information

```typescript
interface CacheDebug {
  totalKeys: number;
  keys: Array<{
    key: string;
    ttl: number;
    size: number;
    preview: string;
  }>;
}
```

## Best Practices

### TTL Guidelines

- **Frequently changing data:** 300-900 seconds (5-15 minutes)
- **Semi-static data:** 1800-3600 seconds (30-60 minutes)
- **Static data:** 86400 seconds (24 hours)

### Cache Invalidation Patterns

```typescript
// Single key invalidation
async invalidateSingle(key: string) {
  await this.redis.del(key);
}

// Pattern invalidation
async invalidatePattern(pattern: string) {
  const keys = await this.redis.keys(pattern);
  if (keys.length) await this.redis.del(...keys);
}

// Bulk invalidation
async invalidateBulk(keys: string[]) {
  await this.redis.del(...keys);
}
```

## Testing

### Unit Test Example

```typescript
describe('CacheService', () => {
  it('should cache and return data', async () => {
    const data = { test: 'data' };
    await service.setCacheData('test-key', data);
    const cached = await service.getCacheData('test-key');
    expect(cached).toEqual(data);
  });
});
```

---


