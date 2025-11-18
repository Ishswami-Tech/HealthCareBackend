# Enterprise Cache Module Documentation

A high-performance, robust, and scalable caching implementation with Stale-While-Revalidate support for NestJS applications, designed to handle 10+ million users with enterprise-grade features. The module follows SOLID, DRY, and KISS principles with a provider-agnostic architecture supporting Redis and Dragonfly.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Features](#features)
4. [Setup](#setup)
5. [Basic Usage](#basic-usage)
6. [Advanced Features](#advanced-features)
7. [Healthcare-Specific Features](#healthcare-specific-features)
8. [Enterprise Features](#enterprise-features)
9. [API Reference](#api-reference)
10. [Monitoring](#monitoring)
11. [Best Practices](#best-practices)
12. [Troubleshooting](#troubleshooting)
13. [Examples](#examples)
14. [Testing](#testing)
15. [Migration Guide](#migration-guide)

## Overview

This caching system provides automatic caching of API responses with configurable TTL, SWR (Stale-While-Revalidate) support, and enterprise-grade features for healthcare applications. It's designed to handle high-scale operations with 10+ million users while maintaining HIPAA compliance and data security.

### Key Features

- **SWR (Stale-While-Revalidate)** - Returns stale data immediately while updating in the background
- **Provider-Agnostic** - Supports Redis and Dragonfly (26x faster than Redis)
- **Consolidated API** - Single service method that handles all caching operations
- **Tag-based Invalidation** - Group related cache entries for easier invalidation
- **Pattern-based Invalidation** - Clear cache by key patterns
- **Adaptive Caching** - Adjusts behavior based on system load
- **Memory Optimization** - Optional compression for large cache entries
- **Prioritization** - Supports critical, high, normal, and low priority cache operations
- **Batch Processing** - Efficient handling of bulk operations
- **Distributed Locking** - Prevents cache stampedes and race conditions
- **Auto-balancing** - Scales back operations during high load
- **Circuit Breaking** - Prevents cascading failures during outages
- **Healthcare Compliance** - HIPAA-compliant caching with PHI protection
- **Enterprise Scalability** - Connection pooling, sharding, load balancing
- **Performance Monitoring** - Real-time metrics and health monitoring
- **Audit Logging** - Comprehensive audit trails for compliance

## Architecture

The cache module follows SOLID principles with a clean, maintainable architecture:

### 1. Interfaces (Dependency Inversion Principle)

- `ICacheProvider` - Abstraction for cache storage operations
- `ICacheStrategy` - Strategy pattern for different cache behaviors
- `ICacheRepository` - High-level cache operations
- `ICacheKeyFactory` - Factory for generating cache keys

### 2. Services (Single Responsibility Principle)

- `CacheService` - Main entry point (facade)
- `CircuitBreakerService` - Circuit breaker pattern
- `CacheMetricsService` - Performance metrics tracking
- `FeatureFlagsService` - Feature flag management
- `CacheVersioningService` - Cache versioning for schema changes
- `CacheErrorHandler` - Comprehensive error handling

### 3. Strategies (Open/Closed Principle)

- `SWRCacheStrategy` - Stale-While-Revalidate caching
- `StandardCacheStrategy` - Standard caching
- `EmergencyCacheStrategy` - Emergency data caching
- `PHICacheStrategy` - Protected Health Information caching
- `CacheStrategyManager` - Strategy selection and execution

### 4. Factories (DRY Principle)

- `CacheKeyFactory` - Centralized key generation

### 5. Builders

- `CacheOptionsBuilder` - Builder pattern for cache options

### 6. Middleware (Chain of Responsibility)

- `ValidationCacheMiddleware` - Validates cache operations
- `MetricsCacheMiddleware` - Tracks metrics
- `CacheMiddlewareChain` - Manages middleware chain

### 7. Repositories

- `CacheRepository` - Repository pattern implementation

### 8. Providers (Adapters)

- `RedisCacheProvider` - Redis adapter implementing ICacheProvider
- `DragonflyCacheProvider` - Dragonfly adapter implementing ICacheProvider

### File Structure

```
cache/
├── providers/              # Adapters (DIP)
│   ├── cache-provider.factory.ts
│   ├── redis-cache.provider.ts
│   └── dragonfly-cache.provider.ts
├── services/               # Split services (SRP)
│   ├── cache-metrics.service.ts
│   ├── cache-versioning.service.ts
│   └── feature-flags.service.ts
├── strategies/             # Strategy pattern (OCP)
│   ├── base-cache.strategy.ts
│   ├── swr-cache.strategy.ts
│   ├── standard-cache.strategy.ts
│   ├── emergency-cache.strategy.ts
│   ├── phi-cache.strategy.ts
│   └── cache-strategy.manager.ts
├── factories/              # Factory pattern (DRY)
│   └── cache-key.factory.ts
├── builders/               # Builder pattern
│   └── cache-options.builder.ts
├── middleware/             # Chain of Responsibility
│   ├── cache-middleware.interface.ts
│   ├── base-cache.middleware.ts
│   ├── validation-cache.middleware.ts
│   ├── metrics-cache.middleware.ts
│   └── cache-middleware.chain.ts
├── repositories/           # Repository pattern
│   └── cache.repository.ts
├── redis/                  # Redis implementation
│   ├── redis.service.ts
│   └── redis.module.ts
├── dragonfly/              # Dragonfly implementation
│   ├── dragonfly.service.ts
│   └── dragonfly.module.ts
├── cache.service.ts        # Main service (facade)
└── cache.module.ts         # Module configuration
```

### Architecture Benefits

1. **SOLID Principles** ✅
   - **Single Responsibility** - Each service has one clear purpose
   - **Open/Closed** - New strategies can be added without modifying existing code
   - **Liskov Substitution** - All strategies implement ICacheStrategy
   - **Interface Segregation** - Small, focused interfaces
   - **Dependency Inversion** - Depend on abstractions (interfaces)

2. **DRY Principle** ✅
   - Centralized key generation (CacheKeyFactory)
   - Shared TTL calculation logic
   - Common error handling patterns
   - Reusable middleware components

3. **KISS Principle** ✅
   - Simple, focused services
   - Clear separation of concerns
   - Easy to understand and maintain

## Features

### Core Caching Features
- Automatic caching using decorators
- Configurable TTL (Time To Live)
- Custom key generation
- Cache invalidation
- Monitoring and statistics
- Error handling

### Enterprise Features
- **Connection Pooling** - Optimized Redis/Dragonfly connections for high throughput
- **Sharding** - Distribute cache across multiple instances
- **Load Balancing** - Intelligent request distribution
- **Circuit Breakers** - Prevent cascading failures
- **Adaptive Caching** - Dynamic TTL adjustment based on access patterns
- **Predictive Caching** - Pre-warm frequently accessed data
- **Performance Monitoring** - Real-time metrics and alerts
- **Audit Logging** - Comprehensive operation tracking
- **Compression** - Reduce memory usage for large data
- **Encryption** - Secure sensitive data in cache

### Healthcare-Specific Features
- **PHI Protection** - Special handling for Protected Health Information
- **Compliance Levels** - Standard, sensitive, and restricted data handling
- **Emergency Data** - Critical data with minimal TTL
- **Patient-Specific Caching** - Isolated cache for patient data
- **Doctor-Specific Caching** - Optimized for medical professional workflows
- **Clinic-Specific Caching** - Multi-tenant cache isolation
- **Medical Record Caching** - Specialized for healthcare data structures
- **Prescription Caching** - Pharmacy integration support
- **Appointment Caching** - Real-time scheduling data
- **Lab Results Caching** - Medical test result optimization

## Setup

### 1. Dependencies

```bash
npm install @nestjs/common @nestjs/config @nestjs/event-emitter ioredis
```

### 2. Environment Variables

Create a `.env` file with the following:

```env
# Cache Provider Selection
CACHE_PROVIDER=dragonfly  # Options: dragonfly (default), redis

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=yourpassword
REDIS_DB=0

# Dragonfly Configuration
DRAGONFLY_HOST=localhost
DRAGONFLY_PORT=6379
DRAGONFLY_PASSWORD=yourpassword

# Cache Configuration
CACHE_PATIENT_RECORDS_TTL=3600
CACHE_APPOINTMENTS_TTL=1800
CACHE_DOCTOR_PROFILES_TTL=7200
CACHE_CLINIC_DATA_TTL=14400
CACHE_MEDICAL_HISTORY_TTL=7200
CACHE_PRESCRIPTIONS_TTL=1800
CACHE_EMERGENCY_DATA_TTL=300
CACHE_ENABLE_COMPRESSION=true
CACHE_ENABLE_METRICS=true
CACHE_DEFAULT_TTL=3600
CACHE_MAX_SIZE_MB=1024
CACHE_ENABLE_BATCH=true
CACHE_COMPRESSION_THRESHOLD=1024

# Enterprise Configuration
CACHE_CONNECTION_POOL_SIZE=100
CACHE_MAX_CONNECTIONS=1000
CACHE_CONNECTION_TIMEOUT=5000
CACHE_COMMAND_TIMEOUT=3000
CACHE_RETRY_ATTEMPTS=3
CACHE_RETRY_DELAY=1000
CACHE_CIRCUIT_BREAKER_THRESHOLD=10
CACHE_CIRCUIT_BREAKER_TIMEOUT=30000
CACHE_ADAPTIVE_ENABLED=true
CACHE_LOAD_BALANCING_ENABLED=true
CACHE_SHARDING_ENABLED=true
CACHE_REPLICATION_ENABLED=true
CACHE_MEMORY_OPTIMIZATION_ENABLED=true
CACHE_PERFORMANCE_MONITORING_ENABLED=true
CACHE_AUTO_SCALING_ENABLED=true
CACHE_WARMING_ENABLED=true
CACHE_PREDICTIVE_ENABLED=true
CACHE_COMPRESSION_LEVEL=6
CACHE_ENCRYPTION_ENABLED=true
CACHE_AUDIT_LOGGING_ENABLED=true

# Sharding Configuration (optional)
CACHE_SHARDS=[{"host":"redis1.example.com","port":6379,"weight":1},{"host":"redis2.example.com","port":6379,"weight":1}]
```

### 3. Module Configuration

The `CacheModule` is already configured as a `@Global()` module and automatically imports both `RedisModule` and `DragonflyModule`. The provider is selected based on the `CACHE_PROVIDER` environment variable.

## Basic Usage

### 1. Simple Caching

Cache the entire method response with default TTL (3600s):

```typescript
import { Cache } from '@core/decorators';

@Controller('users')
export class UsersController {
  
  @Get()
  @Cache()
  async getAllUsers() {
    return this.usersRepository.find();
  }
}
```

### 2. Caching with TTL

```typescript
@Cache({ ttl: 1800 }) // 30 minutes
async getUserById(id: string) {
  return this.usersRepository.findUnique({ where: { id } });
}

@Cache({ ttl: 3600 }) // 1 hour
async getUser(id: string) {
  return this.usersRepository.findOne(id);
}
```

### 3. Service-Level Caching

```typescript
import { Injectable } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';

@Injectable()
export class ProductsService {
  constructor(private readonly cacheService: CacheService) {}
  
  async getProductDetails(id: string, options = {}) {
    const cacheKey = `products:${id}:details`;
    
    return this.cacheService.cache(
      cacheKey,
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
}
```

### 4. Using Options Builder

```typescript
import { CacheOptionsBuilder } from '@infrastructure/cache';

const options = CacheOptionsBuilder
  .forPatient()
  .ttl(1800)
  .tags(['patient_data', 'phi_data'])
  .build();

await cacheService.cache(key, fetchFn, options);
```

### 5. Using Key Factory

```typescript
const keyFactory = cacheService.getKeyFactory();
const key = keyFactory.patient('patient-123', 'clinic-456', 'records');
```

## Advanced Features

### 1. SWR (Stale-While-Revalidate) Caching

```typescript
@Cache({
  ttl: 300,             // 5 minutes cache TTL
  keyTemplate: 'users:{id}',
  staleTime: 60,        // Data becomes stale after 60 seconds
  tags: ['users']       // Tag for grouped invalidation
})
async getUser(@Param('id') id: string) {
  // Expensive database operation
  return this.usersService.findById(id);
}
```

### 2. Batch Operations

```typescript
// Batch get operations
const keys = ['user:1', 'user:2', 'user:3'];
const results = await this.cacheService.batchGet(keys);

// Batch set operations
const keyValuePairs = [
  { key: 'user:1', value: user1Data, ttl: 3600 },
  { key: 'user:2', value: user2Data, ttl: 3600 },
  { key: 'user:3', value: user3Data, ttl: 3600 }
];
await this.cacheService.batchSet(keyValuePairs);

// Batch delete operations
const deletedCount = await this.cacheService.batchDelete(keys);
```

## Healthcare-Specific Features

### 1. Patient Record Caching

```typescript
async getPatientRecords(patientId: string, clinicId: string) {
  return this.cacheService.cachePatientRecords(
    patientId,
    clinicId,
    async () => this.patientRepository.getRecords(patientId, clinicId),
    {
      includeHistory: true,
      includePrescriptions: true,
      includeVitals: true
    }
  );
}
```

### 2. Medical History Caching

```typescript
async getMedicalHistory(patientId: string, clinicId: string) {
  return this.cacheService.cacheMedicalHistory(
    patientId,
    clinicId,
    async () => this.medicalRepository.getHistory(patientId, clinicId),
    {
      timeRange: { start: new Date('2023-01-01'), end: new Date() },
      includeTests: true,
      includeImages: true
    }
  );
}
```

### 3. Emergency Data Caching

```typescript
async getEmergencyContacts(patientId: string) {
  return this.cacheService.cacheEmergencyData(
    patientId,
    async () => this.emergencyRepository.getContacts(patientId)
  );
}
```

### 4. Cache Invalidation for Healthcare Data

```typescript
// Invalidate patient-related cache when patient data changes
async updatePatient(patientId: string, data: any) {
  const result = await this.patientRepository.update(patientId, data);
  
  // Invalidate all patient-related cache
  await this.cacheService.invalidatePatientCache(patientId, data.clinicId);
  
  return result;
}

// Clear all PHI data for compliance
async clearPHIData() {
  const clearedCount = await this.cacheService.clearPHICache();
  this.logger.log(`Cleared ${clearedCount} PHI cache entries for compliance`);
  return { clearedCount };
}
```

## Enterprise Features

### 1. Connection Pooling and Sharding

The system automatically handles connection pooling and sharding. Configuration is done through environment variables.

### 2. Performance Monitoring

```typescript
// Get comprehensive cache metrics
async getCacheMetrics() {
  const metrics = await this.cacheService.getCacheMetrics();
  return {
    totalRequests: metrics.totalRequests,
    successfulRequests: metrics.successfulRequests,
    failedRequests: metrics.failedRequests,
    averageResponseTime: metrics.averageResponseTime,
    cacheHitRate: metrics.cacheHitRate,
    memoryUsage: metrics.memoryUsage,
    connectionPoolUtilization: metrics.connectionPoolUtilization,
    throughput: metrics.throughput,
    errorRate: metrics.errorRate
  };
}
```

### 3. Circuit Breaker and Retry Logic

The system automatically handles circuit breaking and retries. Configuration is done through environment variables.

### 4. Cache Warming

```typescript
// Warm cache with frequently accessed data
async warmCache(clinicId: string) {
  await this.cacheService.warmClinicCache(clinicId);
  await this.cacheService.warmHealthcareCache(clinicId);
  return { success: true, message: 'Cache warming completed' };
}
```

## API Reference

### Cache Controller Endpoints

- `GET /cache` - Get consolidated cache information including metrics and stats
- `DELETE /cache?pattern=users:*` - Clear cache entries matching pattern
- `POST /cache/config` - Update cache configuration settings
- `GET /cache/benchmark` - Run performance tests on the cache system
- `GET /cache/health` - Get cache health status
- `GET /cache/metrics` - Get detailed performance metrics
- `POST /cache/warm` - Warm cache with frequently accessed data
- `DELETE /cache/phi` - Clear all PHI data for compliance

### Cache Decorator Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| ttl | number | 3600 | Cache time-to-live in seconds |
| keyTemplate | string | Class+Method | Cache key template with placeholders |
| useSwr | boolean | true | Whether to use SWR caching |
| staleTime | number | ttl/2 | When data becomes stale and needs refresh |
| forceRefresh | boolean | false | Whether to bypass cache and force fetch |
| tags | string[] | [] | Tags for grouped invalidation |
| compress | boolean | false | Whether to compress large data |
| priority | 'critical'\|'high'\|'normal'\|'low' | 'high' | Processing priority |
| containsPHI | boolean | false | Contains Protected Health Information |
| complianceLevel | 'standard'\|'sensitive'\|'restricted' | 'standard' | Compliance level |
| emergencyData | boolean | false | Emergency data flag |
| patientSpecific | boolean | false | Patient-specific data |
| doctorSpecific | boolean | false | Doctor-specific data |
| clinicSpecific | boolean | false | Clinic-specific data |

### Unified Cache Method Options

```typescript
// All cache operations use a single method with consistent options
cacheService.cache(
  'cache-key',
  () => fetchData(),    // Data fetching function
  {
    ttl: 3600,          // Cache time-to-live (seconds)
    staleTime: 300,     // When data becomes stale
    forceRefresh: false,// Force fresh data fetch
    enableSwr: true,    // Enable Stale-While-Revalidate
    compress: false,    // Compress large cache entries
    priority: 'high',   // Processing priority
    tags: ['tag1', 'tag2'], // Tags for grouped invalidation
    containsPHI: false, // Contains Protected Health Information
    complianceLevel: 'standard', // Compliance level
    emergencyData: false, // Emergency data flag
    patientSpecific: false, // Patient-specific data
    doctorSpecific: false, // Doctor-specific data
    clinicSpecific: false  // Clinic-specific data
  }
);
```

### Cache Invalidation

```typescript
// Invalidate a specific cache key
await cacheService.invalidateCache('users:123');

// Invalidate by pattern (e.g., all users)
await cacheService.invalidateCacheByPattern('users:*');

// Invalidate by tag (all cache entries tagged with 'users')
await cacheService.invalidateCacheByTag('users');

// Healthcare-specific invalidation
await cacheService.invalidatePatientCache('patient123', 'clinic456');
await cacheService.invalidateDoctorCache('doctor789', 'clinic456');
await cacheService.invalidateAppointmentCache('appointment101', 'patient123', 'doctor789', 'clinic456');
await cacheService.invalidateClinicCache('clinic456');

// Clear all PHI data
await cacheService.clearPHICache();
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

### 2. Healthcare Cache Metrics

```typescript
interface HealthcareCacheMetrics {
  patientCacheHits: number;
  appointmentCacheHits: number;
  doctorCacheHits: number;
  emergencyCacheHits: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
}
```

### 3. Performance Metrics

```typescript
interface PerformanceMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  cacheHitRate: number;
  memoryUsage: number;
  connectionPoolUtilization: number;
  throughput: number;
  errorRate: number;
  timestamp: Date;
}
```

### 4. Health Status

```typescript
interface CacheHealth {
  status: 'healthy' | 'warning' | 'critical';
  memoryUsage: number;
  hitRate: number;
  connectionStatus: boolean;
  lastHealthCheck: Date;
}
```

## Best Practices

### 1. TTL Guidelines

- **Real-time data:** 0 seconds (no cache)
- **Emergency data:** 300 seconds (5 minutes)
- **Frequently changing data:** 300-900 seconds (5-15 minutes)
- **Semi-static data:** 1800-3600 seconds (30-60 minutes)
- **Static data:** 86400 seconds (24 hours)
- **Patient records:** 3600 seconds (1 hour)
- **Appointments:** 1800 seconds (30 minutes)
- **Doctor profiles:** 7200 seconds (2 hours)
- **Clinic data:** 14400 seconds (4 hours)
- **Medical history:** 7200 seconds (2 hours)
- **Prescriptions:** 1800 seconds (30 minutes)

### 2. Key Naming Conventions

```typescript
// Entity-based
users:${id}
products:${category}:${id}
patient:${patientId}:clinic:${clinicId}:records

// Action-based
search:${query}:${page}
filter:${category}:${price}
appointment:${appointmentId}:details

// Healthcare-specific
patient:${patientId}:profile
doctor:${doctorId}:schedule:${date}
clinic:${clinicId}:doctors
medical:${patientId}:clinic:${clinicId}:history
prescriptions:${patientId}:clinic:${clinicId}
```

### 3. Tag Usage

```typescript
// Use descriptive tags for easy invalidation
tags: ['users', 'user_profiles', 'clinic_data']
tags: ['patient_records', 'phi_data', 'clinic:123']
tags: ['appointments', 'doctor:456', 'clinic:123']
tags: ['medical_history', 'patient:789', 'phi_data']
```

### 4. Error Handling

```typescript
try {
  const cached = await this.cacheService.get(key);
  if (cached) return JSON.parse(cached);
  
  const data = await this.repository.find();
  await this.cacheService.set(key, JSON.stringify(data));
  return data;
} catch (error) {
  this.logger.error('Cache error:', error);
  // Fallback to database
  return this.repository.find();
}
```

### 5. Healthcare Compliance

```typescript
// Always mark PHI data
@Cache({
  containsPHI: true,
  complianceLevel: 'sensitive',
  tags: ['phi_data', 'patient_records']
})

// Use appropriate TTL for sensitive data
@Cache({
  ttl: 1800, // Shorter TTL for sensitive data
  containsPHI: true,
  compress: true // Compress to reduce memory footprint
})

// Invalidate PHI data when patient requests data deletion
async deletePatientData(patientId: string) {
  await this.patientRepository.delete(patientId);
  await this.cacheService.invalidatePatientCache(patientId);
  await this.cacheService.clearPHICache(); // Clear all PHI if needed
}
```

## Troubleshooting

### Common Issues

1. **Cache Not Working:**
   - Check Redis/Dragonfly connection
   - Verify TTL values
   - Check key generation
   - Ensure decorators are properly applied

2. **Memory Issues:**
   - Monitor Redis/Dragonfly memory usage
   - Implement proper TTL
   - Use selective caching
   - Enable compression for large data

3. **Stale Data:**
   - Implement cache invalidation
   - Use appropriate TTL
   - Add cache clearing endpoints
   - Check SWR configuration

4. **Performance Issues:**
   - Monitor cache hit rates
   - Check connection pool utilization
   - Review circuit breaker status
   - Optimize TTL values

5. **Healthcare Compliance Issues:**
   - Ensure PHI data is properly marked
   - Use appropriate compliance levels
   - Implement proper data retention policies
   - Regular PHI data cleanup

### Debugging Tools

1. **Redis/Dragonfly CLI Commands**
```bash
redis-cli monitor         # Monitor cache operations
redis-cli keys "*"        # Check all keys
redis-cli ttl "key"       # Check TTL
redis-cli memory usage    # Check memory usage
redis-cli info memory     # Detailed memory info
```

2. **API Endpoints**
```bash
# Get cache stats
curl http://localhost:8088/cache

# Get cache health
curl http://localhost:8088/cache/health

# Get detailed metrics
curl http://localhost:8088/cache/metrics

# Clear cache by pattern
curl -X DELETE "http://localhost:8088/cache?pattern=users:*"

# Clear all PHI data
curl -X DELETE http://localhost:8088/cache/phi

# Warm cache
curl -X POST http://localhost:8088/cache/warm
```

3. **Logging**
```typescript
// Enable debug logging
this.logger.debug('Cache operation:', { key, ttl, tags });
this.logger.warn('Cache miss for key:', key);
this.logger.error('Cache error:', error);
```

## Examples

### Complete Service Example

```typescript
@Injectable()
export class UserService {
  constructor(
    private repository: UserRepository,
    private cacheService: CacheService
  ) {}

  @Cache({ 
    keyTemplate: 'users:all:{role}',
    ttl: 1800,
    tags: ['users', 'user_lists'],
    priority: 'normal',
    enableSWR: true,
    containsPHI: true,
    compress: true
  })
  async findAll(role?: string) {
    return this.repository.find({ role });
  }

  @Cache({ 
    keyTemplate: 'users:one:{id}',
    ttl: 3600,
    tags: ['users', 'user_details'],
    priority: 'high',
    enableSWR: true,
    containsPHI: true,
    compress: true
  })
  async findOne(id: string) {
    return this.repository.findOne(id);
  }

  async delete(id: string) {
    const result = await this.repository.delete(id);
    // Invalidate all user-related cache
    await this.cacheService.invalidateCacheByPattern(`user:${id}:*`);
    await this.cacheService.invalidateCacheByTag(`user:${id}`);
    return result;
  }
}
```

### Healthcare Service Example

```typescript
@Injectable()
export class PatientService {
  constructor(
    private patientRepository: PatientRepository,
    private cacheService: CacheService
  ) {}

  async getPatientProfile(patientId: string) {
    return this.cacheService.cachePatientRecords(
      patientId,
      'default',
      async () => this.patientRepository.getProfile(patientId),
      {
        includeHistory: false,
        includePrescriptions: false,
        includeVitals: false
      }
    );
  }

  async getPatientMedicalHistory(patientId: string, clinicId: string) {
    return this.cacheService.cacheMedicalHistory(
      patientId,
      clinicId,
      async () => this.patientRepository.getMedicalHistory(patientId, clinicId),
      {
        timeRange: { start: new Date('2023-01-01'), end: new Date() },
        includeTests: true,
        includeImages: false
      }
    );
  }

  async updatePatientRecord(patientId: string, clinicId: string, data: any) {
    const result = await this.patientRepository.updateRecord(patientId, clinicId, data);
    
    // Invalidate all patient-related cache
    await this.cacheService.invalidatePatientCache(patientId, clinicId);
    
    return result;
  }

  async getEmergencyContacts(patientId: string) {
    return this.cacheService.cacheEmergencyData(
      patientId,
      async () => this.patientRepository.getEmergencyContacts(patientId)
    );
  }
}
```

## Testing

### Unit Test Example

```typescript
describe('CacheService', () => {
  let service: CacheService;
  let cacheProvider: ICacheProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        {
          provide: 'ICacheProvider',
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            invalidateCacheByPattern: jest.fn(),
            invalidateCacheByTag: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
    cacheProvider = module.get<ICacheProvider>('ICacheProvider');
  });

  it('should cache and return data', async () => {
    const data = { test: 'data' };
    const fetchFn = jest.fn().mockResolvedValue(data);
    
    jest.spyOn(cacheProvider, 'get').mockResolvedValue(null);
    jest.spyOn(cacheProvider, 'set').mockResolvedValue(undefined);
    
    const result = await service.cache('test-key', fetchFn, { ttl: 3600 });
    
    expect(result).toEqual(data);
    expect(fetchFn).toHaveBeenCalled();
  });
});
```

## Migration Guide

If you're migrating from direct `RedisService` usage or an older cache implementation:

1. **Replace direct provider usage** - Use `CacheService` instead of `RedisService` or `DragonflyService` directly. **All services should use `CacheService` as the single entry point for cache operations.**
2. **Use CacheKeyFactory** - Replace manual key generation with `CacheKeyFactory` for consistent naming
3. **Use CacheOptionsBuilder** - Replace manual option construction with `CacheOptionsBuilder` for complex options
4. **Use healthcare-specific methods** - Replace generic cache calls with healthcare-specific methods for patient/doctor/clinic data
5. **Update decorators** - Use the new `@Cache()` decorator from `@core/decorators` instead of old cache decorators

### Migration Example

**Before:**
```typescript
const key = `user:${userId}`;
const cached = await cacheService.get(key);
if (cached) return JSON.parse(cached);
const data = await this.repository.find(userId);
await cacheService.set(key, data, 3600);
return data;
```

**After:**
```typescript
return this.cacheService.cache(
  `user:${userId}`,
  () => this.repository.find(userId),
  { ttl: 3600 }
);
```

## Summary

This comprehensive caching system provides:

- **Enterprise-grade performance** for 10+ million users
- **Healthcare compliance** with HIPAA and PHI protection
- **Advanced features** like SWR, circuit breakers, and adaptive caching
- **Comprehensive monitoring** and debugging tools
- **Flexible configuration** for different use cases
- **Robust error handling** and fallback mechanisms
- **Easy integration** with NestJS applications
- **SOLID architecture** for maintainability and extensibility
- **Provider-agnostic design** supporting Redis and Dragonfly

The system is designed to scale horizontally, handle high loads gracefully, and maintain data consistency while providing excellent performance for healthcare applications.

