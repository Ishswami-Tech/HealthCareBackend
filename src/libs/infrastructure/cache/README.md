# Cache Service

**Purpose:** Multi-provider cache service with multi-layer caching (Memory + Redis/Dragonfly)
**Location:** `src/libs/infrastructure/cache`
**Status:** ✅ Production-ready

---

## Quick Start

### Basic Usage

```typescript
import { CacheService } from '@cache';

@Injectable()
export class MyService {
  constructor(private readonly cacheService: CacheService) {}

  async getUser(userId: string) {
    // Cache-aside pattern with automatic population
    return await this.cacheService.cache(
      `user:${userId}`,           // Cache key
      async () => {                // Fetch function if cache miss
        return await this.db.user.findUnique({ where: { id: userId } });
      },
      { ttl: 3600 }               // 1 hour TTL
    );
  }

  // Manual cache operations
  async example() {
    // Set cache
    await this.cacheService.set('key', 'value', 3600);

    // Get cache
    const value = await this.cacheService.get<string>('key');

    // Delete cache
    await this.cacheService.delete('key');

    // Invalidate by tags
    await this.cacheService.invalidateCacheByTag(['user', 'clinic-123']);
  }
}
```

---

## Key Features

- ✅ **Multi-Layer Caching** - L1 (in-memory) + L2 (Redis/Dragonfly)
- ✅ **Multi-Provider Support** - Redis, Dragonfly, Memory
- ✅ **SWR Pattern** - Stale-While-Revalidate for high availability
- ✅ **PHI-Compliant Caching** - Patient data isolation and encryption
- ✅ **Tag-Based Invalidation** - Invalidate related cache entries
- ✅ **Cache Versioning** - Automatic version management
- ✅ **Health Monitoring** - Cache health checks
- ✅ **Performance Metrics** - Hit/miss rates, latency tracking

---

## Architecture

```
CacheModule
├── cache.service.ts           # Main service
├── cache.module.ts
├── providers/
│   ├── redis.provider.ts
│   ├── dragonfly.provider.ts
│   └── memory.provider.ts
├── decorators/
│   ├── cache.decorator.ts
│   ├── patient-cache.decorator.ts
│   └── invalidate-cache.decorator.ts
└── controllers/
    └── cache.controller.ts    # Admin endpoints
```

**Consolidated Documentation:**
📖 [Complete Infrastructure Documentation](../../../INFRASTRUCTURE_DOCUMENTATION.md#cache-system) - Architecture, design decisions

---

## Usage Examples

### Example 1: Cache-Aside Pattern

```typescript
async getPatient(patientId: string, clinicId: string) {
  return await this.cacheService.cache(
    `patient:${clinicId}:${patientId}`,  // Clinic-isolated key
    async () => {
      return await this.db.patient.findUnique({
        where: { id: patientId, clinicId },
      });
    },
    {
      ttl: 1800,                // 30 minutes
      tags: ['patient', `clinic:${clinicId}`],
    }
  );
}
```

### Example 2: Tag-Based Invalidation

```typescript
async updatePatient(patientId: string, clinicId: string, data: any) {
  const patient = await this.db.patient.update({
    where: { id: patientId },
    data,
  });

  // Invalidate all patient and clinic caches
  await this.cacheService.invalidateCacheByTag([
    'patient',
    `clinic:${clinicId}`,
    `patient:${patientId}`,
  ]);

  return patient;
}
```

### Example 3: Using Decorators

```typescript
import { Cache, PatientCache, InvalidateCache } from '@cache/decorators';

@Controller('patients')
export class PatientsController {
  @Get(':id')
  @PatientCache()  // Automatic PHI-compliant caching
  async getPatient(@Param('id') id: string) {
    return await this.patientService.findOne(id);
  }

  @Put(':id')
  @InvalidateCache(['patient', 'clinic'])  // Auto invalidation
  async updatePatient(@Param('id') id: string, @Body() data: any) {
    return await this.patientService.update(id, data);
  }
}
```

---

## Configuration

### Environment Variables

```env
# Cache Provider (redis, dragonfly, memory)
CACHE_PROVIDER=dragonfly

# Redis/Dragonfly Configuration
CACHE_HOST=localhost
CACHE_PORT=6379
CACHE_PASSWORD=your-password
CACHE_DB=0

# Cache Settings
CACHE_TTL_DEFAULT=3600           # 1 hour
CACHE_MAX_MEMORY=1GB
CACHE_EVICTION_POLICY=allkeys-lru

# Multi-Layer Cache
CACHE_L1_ENABLED=true           # In-memory cache
CACHE_L1_MAX_SIZE=100MB
CACHE_L1_TTL=300                # 5 minutes
```

[Full environment variables guide](../../../docs/ENVIRONMENT_VARIABLES.md)

---

## Cache Patterns

### 1. Cache-Aside (Lazy Loading)

```typescript
// Most common pattern
const data = await cacheService.cache(key, fetchFn, { ttl });
```

### 2. Write-Through

```typescript
// Write to DB and cache simultaneously
const data = await db.create(data);
await cacheService.set(key, data, ttl);
```

### 3. Write-Behind

```typescript
// Write to cache immediately, async DB update
await cacheService.set(key, data, ttl);
queue.add('db-update', { key, data });  // Async
```

### 4. Refresh-Ahead (SWR)

```typescript
// Return stale data while revalidating in background
const data = await cacheService.cache(key, fetchFn, {
  ttl: 3600,
  staleWhileRevalidate: true,  // Return stale, refresh async
});
```

---

## PHI-Compliant Caching

For patient health information (PHI), use `@PatientCache` decorator:

```typescript
@Get('medical-records/:id')
@PatientCache({ ttl: 1800 })  // 30 minutes, encrypted
async getMedicalRecord(@Param('id') id: string) {
  return await this.ehrService.findRecord(id);
}
```

**Features:**
- Automatic encryption of cached data
- Patient ID isolation in cache keys
- Audit logging of cache access
- Automatic expiration for compliance

---

## Cache Invalidation Strategies

### 1. Time-Based (TTL)

```typescript
await cacheService.set('key', value, 3600);  // Auto-expire after 1 hour
```

### 2. Tag-Based

```typescript
await cacheService.invalidateCacheByTag(['user', 'clinic-123']);
```

### 3. Pattern-Based

```typescript
await cacheService.deletePattern('user:*');  // Delete all user: keys
```

### 4. Event-Driven

```typescript
@OnEvent('user.updated')
async handleUserUpdated(payload: any) {
  await cacheService.invalidateCacheByTag([`user:${payload.userId}`]);
}
```

---

## Health Monitoring

```typescript
const health = await cacheService.getHealthStatus();
// Returns: {
//   status: 'healthy' | 'degraded' | 'down',
//   provider: 'redis' | 'dragonfly' | 'memory',
//   hitRate: 0.85,
//   missRate: 0.15,
//   l1Size: '50MB',
//   l2Size: '500MB',
//   latency: { p50: 1ms, p95: 5ms, p99: 10ms }
// }
```

---

## Testing

```bash
# Run cache service tests
pnpm test infrastructure/cache

# Test with different providers
CACHE_PROVIDER=memory pnpm test infrastructure/cache
CACHE_PROVIDER=redis pnpm test infrastructure/cache
```

---

## Dependencies

### Required
- IoRedis (for Redis/Dragonfly)
- CacheManager (for multi-layer caching)

### Optional
- EventService (for cache invalidation events)
- LoggingService (for cache metrics)

---

## Related Documentation

- [Complete Infrastructure Documentation](../../../INFRASTRUCTURE_DOCUMENTATION.md#cache-system)
- [Performance Optimization](../../../docs/architecture/10M_USER_SCALE_OPTIMIZATIONS.md)
- [System Architecture](../../../docs/architecture/SYSTEM_ARCHITECTURE.md)

---

## Troubleshooting

**Issue 1: Low Cache Hit Rate**
- **Solution:** Increase TTL, check key naming consistency, review cache warming strategy

**Issue 2: Memory Pressure**
- **Solution:** Reduce `CACHE_L1_MAX_SIZE`, enable LRU eviction, increase L2 capacity

**Issue 3: Stale Data**
- **Solution:** Review TTL values, implement proper cache invalidation, use event-driven invalidation

**Issue 4: Connection Errors**
- **Solution:** Check `CACHE_HOST` and `CACHE_PORT`, verify Redis/Dragonfly is running

---

## Contributing

See main [README.md](../../../../README.md) for contribution guidelines.
