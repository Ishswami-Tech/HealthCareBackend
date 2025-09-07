# Enterprise Redis Caching System with SWR

A high-performance, robust, and scalable Redis caching implementation with Stale-While-Revalidate support for NestJS applications, designed to handle 10+ million users with enterprise-grade features.

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Setup](#setup)
4. [Basic Usage](#basic-usage)
5. [Advanced Features](#advanced-features)
6. [Healthcare-Specific Features](#healthcare-specific-features)
7. [Enterprise Features](#enterprise-features)
8. [API Reference](#api-reference)
9. [Monitoring](#monitoring)
10. [Best Practices](#best-practices)
11. [Troubleshooting](#troubleshooting)
12. [Examples](#examples)
13. [Testing](#testing)

## Overview

This Redis caching system provides automatic caching of API responses with configurable TTL, SWR (Stale-While-Revalidate) support, and enterprise-grade features for healthcare applications. It's designed to handle high-scale operations with 10+ million users while maintaining HIPAA compliance and data security.

### Key Features

- **SWR (Stale-While-Revalidate)** - Returns stale data immediately while updating in the background
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

## Features

### Core Caching Features
- Automatic caching using decorators
- Configurable TTL (Time To Live)
- Custom key generation
- Cache invalidation
- Monitoring and statistics
- Error handling

### Enterprise Features
- **Connection Pooling** - Optimized Redis connections for high throughput
- **Sharding** - Distribute cache across multiple Redis instances
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
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=yourpassword
REDIS_DB=0

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

```typescript
// src/libs/infrastructure/cache/cache.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheService } from './cache.service';
import { RedisService } from './redis/redis.service';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule.forRoot(),
    RedisModule
  ],
  providers: [CacheService, RedisService],
  exports: [CacheService],
})
export class CacheModule {}
```

## Basic Usage

### 1. Simple Caching

Cache the entire method response with default TTL (3600s):

```typescript
import { Cache } from '../decorators/cache.decorator';

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

### 3. Prefixed Caching

```typescript
@Cache({ 
  keyTemplate: 'users:profile:{id}', 
  ttl: 3600 
})
async getUserProfile(@Param('id') id: string) {
  return this.profileRepository.findOne(id);
}
```

### 4. Disable Caching

```typescript
@Cache({ ttl: 0 })
async getRealTimeData() {
  return this.repository.getRealTimeData();
}
```

### 5. Custom Key Generation

```typescript
@Cache({
  ttl: 3600,
  keyGenerator: (id: string, type: string) => `custom:${type}:${id}`
})
async getCustomData(id: string, type: string) {
  return this.repository.getCustomData(id, type);
}
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

### 2. Healthcare-Specific Caching

```typescript
@PatientCache({
  keyTemplate: 'patient:records:{patientId}:{clinicId}',
  ttl: 1800,
  containsPHI: true,
  compress: true,
  tags: ['patient_records', 'phi_data']
})
async getPatientRecords(@Param('patientId') patientId: string, @Param('clinicId') clinicId: string) {
  return this.patientService.getRecords(patientId, clinicId);
}

@InvalidatePatientCache({
  patterns: ['patient:records:{patientId}:*', 'patient:{patientId}:*'],
  tags: ['patient_records', 'phi_data']
})
async updatePatientRecord(@Param('patientId') patientId: string, @Body() data: UpdateRecordDto) {
  return this.patientService.updateRecord(patientId, data);
}
```

### 3. Service-Level Caching

```typescript
import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class ProductsService {
  constructor(private readonly cacheService: CacheService) {}
  
  async getProductDetails(id: string, options = {}) {
    const cacheKey = `products:${id}:details`;
    
    return this.cacheService.cache(
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
    await this.cacheService.invalidateCache(`products:${id}:details`);
    
    // Or invalidate all caches for this product
    await this.cacheService.invalidateCacheByTag(`product:${id}`);
    
    return result;
  }
}
```

### 4. Batch Operations

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

### 4. Prescription Caching

```typescript
async getPrescriptions(patientId: string, clinicId: string) {
  return this.cacheService.cachePrescriptions(
    patientId,
    clinicId,
    async () => this.prescriptionRepository.getActive(patientId, clinicId),
    {
      includeHistory: true,
      activeOnly: true
    }
  );
}
```

### 5. Cache Invalidation for Healthcare Data

```typescript
// Invalidate patient-related cache when patient data changes
async updatePatient(patientId: string, data: any) {
  const result = await this.patientRepository.update(patientId, data);
  
  // Invalidate all patient-related cache
  await this.cacheService.invalidatePatientCache(patientId, data.clinicId);
  
  return result;
}

// Invalidate doctor-related cache when doctor data changes
async updateDoctor(doctorId: string, data: any) {
  const result = await this.doctorRepository.update(doctorId, data);
  
  // Invalidate all doctor-related cache
  await this.cacheService.invalidateDoctorCache(doctorId, data.clinicId);
  
  return result;
}

// Invalidate appointment-related cache
async updateAppointment(appointmentId: string, data: any) {
  const result = await this.appointmentRepository.update(appointmentId, data);
  
  // Invalidate appointment cache
  await this.cacheService.invalidateAppointmentCache(
    appointmentId, 
    data.patientId, 
    data.doctorId, 
    data.clinicId
  );
  
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

```typescript
// The system automatically handles connection pooling and sharding
// Configuration is done through environment variables

// Check cache health
async getCacheHealth() {
  const health = await this.cacheService.getCacheHealth();
  return {
    status: health.status,
    memoryUsage: health.memoryUsage,
    hitRate: health.hitRate,
    connectionStatus: health.connectionStatus,
    lastHealthCheck: health.lastHealthCheck
  };
}
```

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
    p95ResponseTime: metrics.p95ResponseTime,
    p99ResponseTime: metrics.p99ResponseTime,
    cacheHitRate: metrics.cacheHitRate,
    memoryUsage: metrics.memoryUsage,
    connectionPoolUtilization: metrics.connectionPoolUtilization,
    throughput: metrics.throughput,
    errorRate: metrics.errorRate
  };
}
```

### 3. Circuit Breaker and Retry Logic

```typescript
// The system automatically handles circuit breaking and retries
// Configuration is done through environment variables

// Check circuit breaker status
async getCircuitBreakerStatus() {
  // This would be exposed through a monitoring endpoint
  return {
    isOpen: false,
    failureCount: 0,
    lastFailureTime: null,
    nextAttemptTime: null
  };
}
```

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

### 4. Debug Information

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

### 5. Health Status

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
@PatientCache({
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
   - Check Redis connection
   - Verify TTL values
   - Check key generation
   - Ensure decorators are properly applied

2. **Memory Issues:**
   - Monitor Redis memory usage
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

1. **Redis CLI Commands**
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
curl http://localhost:3000/cache

# Get cache health
curl http://localhost:3000/cache/health

# Get detailed metrics
curl http://localhost:3000/cache/metrics

# Debug cache
curl http://localhost:3000/cache/debug

# Clear cache by pattern
curl -X DELETE "http://localhost:3000/cache?pattern=users:*"

# Clear all PHI data
curl -X DELETE http://localhost:3000/cache/phi

# Warm cache
curl -X POST http://localhost:3000/cache/warm
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

  @InvalidateCache({
    patterns: ['users:one:{id}', 'users:all:*', 'user:{id}:*'],
    tags: ['users', 'user_details', 'user_lists']
  })
  async update(id: string, data: any) {
    const result = await this.repository.update(id, data);
    return result;
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

### Controller Example

```typescript
@Controller('patients')
export class PatientsController {
  constructor(private patientService: PatientService) {}

  @Get(':id')
  @PatientCache({
    keyTemplate: 'patient:profile:{id}',
    ttl: 3600,
    tags: ['patient_profiles', 'phi_data'],
    priority: 'high',
    enableSWR: true,
    containsPHI: true,
    compress: true
  })
  async getPatient(@Param('id') id: string) {
    return this.patientService.getPatientProfile(id);
  }

  @Get(':id/medical-history')
  @PatientCache({
    keyTemplate: 'patient:medical:{id}:{clinicId}',
    ttl: 7200,
    tags: ['medical_history', 'phi_data'],
    priority: 'high',
    enableSWR: true,
    containsPHI: true,
    compress: true
  })
  async getMedicalHistory(@Param('id') id: string, @Query('clinicId') clinicId: string) {
    return this.patientService.getPatientMedicalHistory(id, clinicId);
  }

  @Put(':id')
  @InvalidatePatientCache({
    patterns: ['patient:profile:{id}', 'patient:medical:{id}:*', 'patient:{id}:*'],
    tags: ['patient_profiles', 'medical_history', 'phi_data']
  })
  async updatePatient(@Param('id') id: string, @Body() data: UpdatePatientDto) {
    return this.patientService.updatePatientRecord(id, data.clinicId, data);
  }

  @Get(':id/emergency-contacts')
  @PatientCache({
    keyTemplate: 'patient:emergency:{id}',
    ttl: 300, // 5 minutes for emergency data
    tags: ['emergency_data', 'phi_data'],
    priority: 'critical',
    enableSWR: false, // No SWR for emergency data
    containsPHI: true,
    compress: false // No compression for emergency data
  })
  async getEmergencyContacts(@Param('id') id: string) {
    return this.patientService.getEmergencyContacts(id);
  }
}
```

## Testing

### Unit Test Example

```typescript
describe('CacheService', () => {
  let service: CacheService;
  let redisService: RedisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        {
          provide: RedisService,
          useValue: {
            cache: jest.fn(),
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
    redisService = module.get<RedisService>(RedisService);
  });

  it('should cache and return data', async () => {
    const data = { test: 'data' };
    const fetchFn = jest.fn().mockResolvedValue(data);
    
    jest.spyOn(redisService, 'cache').mockResolvedValue(data);
    
    const result = await service.cache('test-key', fetchFn, { ttl: 3600 });
    
    expect(result).toEqual(data);
    expect(redisService.cache).toHaveBeenCalledWith('test-key', fetchFn, { ttl: 3600 });
  });

  it('should invalidate patient cache', async () => {
    jest.spyOn(redisService, 'invalidateCacheByPattern').mockResolvedValue(5);
    jest.spyOn(redisService, 'invalidateCacheByTag').mockResolvedValue(3);
    
    await service.invalidatePatientCache('patient123', 'clinic456');
    
    expect(redisService.invalidateCacheByPattern).toHaveBeenCalledWith('patient:patient123:*');
    expect(redisService.invalidateCacheByTag).toHaveBeenCalledWith('patient:patient123');
  });
});
```

### Integration Test Example

```typescript
describe('Cache Integration', () => {
  it('should handle cache failures gracefully', async () => {
    jest.spyOn(redisService, 'get').mockRejectedValue(new Error('Redis connection failed'));
    
    const result = await service.get('test-key');
    
    expect(result).toBeNull();
  });

  it('should handle healthcare cache operations', async () => {
    const patientData = { id: 'patient123', name: 'John Doe' };
    const fetchFn = jest.fn().mockResolvedValue(patientData);
    
    jest.spyOn(redisService, 'cache').mockResolvedValue(patientData);
    
    const result = await service.cachePatientRecords(
      'patient123',
      'clinic456',
      fetchFn,
      { includeHistory: true }
    );
    
    expect(result).toEqual(patientData);
    expect(redisService.cache).toHaveBeenCalledWith(
      'patient:patient123:clinic:clinic456:records',
      fetchFn,
      expect.objectContaining({
        ttl: expect.any(Number),
        tags: expect.arrayContaining(['patient:patient123', 'clinic:clinic456']),
        compress: true,
        priority: 'high',
        enableSwr: true
      })
    );
  });
});
```

### Performance Test Example

```typescript
describe('Cache Performance', () => {
  it('should handle high load', async () => {
    const startTime = Date.now();
    const promises = [];
    
    // Simulate 1000 concurrent cache operations
    for (let i = 0; i < 1000; i++) {
      promises.push(
        service.cache(`test-key-${i}`, async () => ({ id: i }), { ttl: 3600 })
      );
    }
    
    await Promise.all(promises);
    const endTime = Date.now();
    
    expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
  });
});
```

---

## Summary

This comprehensive caching system provides:

- **Enterprise-grade performance** for 10+ million users
- **Healthcare compliance** with HIPAA and PHI protection
- **Advanced features** like SWR, circuit breakers, and adaptive caching
- **Comprehensive monitoring** and debugging tools
- **Flexible configuration** for different use cases
- **Robust error handling** and fallback mechanisms
- **Easy integration** with NestJS applications

The system is designed to scale horizontally, handle high loads gracefully, and maintain data consistency while providing excellent performance for healthcare applications.
