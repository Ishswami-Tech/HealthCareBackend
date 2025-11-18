# 🗄️ Database Infrastructure Module

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Scalability (10M+ Users)](#scalability-10m-users)
4. [Integration](#integration)
5. [Components](#components)
6. [Usage](#usage)
7. [Performance Optimization](#performance-optimization)
8. [HIPAA Compliance](#hipaa-compliance)
9. [Best Practices](#best-practices)
10. [Documentation](#documentation)

---

## 🎯 Overview

The Database Infrastructure Module provides a **single unified database service** for the entire healthcare application, optimized for **10 million+ users** with enterprise-grade patterns and HIPAA compliance.

### Key Features

- ✅ **Single Entry Point**: Only `DatabaseService` is the public interface
- ✅ **Connection Pooling**: Optimized for 10M+ users (500 max connections)
- ✅ **Query Optimization**: Automatic query analysis and optimization
- ✅ **Caching**: Redis-based caching with SWR (Stale-While-Revalidate)
- ✅ **Multi-Tenant Isolation**: Clinic-based data isolation
- ✅ **HIPAA Compliance**: Audit logging, encryption, access controls
- ✅ **Metrics & Monitoring**: Real-time performance tracking
- ✅ **Circuit Breakers**: Resilience patterns for reliability
- ✅ **Read Replicas**: Support for read scaling
- ✅ **Transaction Support**: ACID-compliant transactions with retry logic

---

## 🏗️ Architecture

### Module Structure

```
database/
├── clients/
│   └── healthcare-database.client.ts    # Main database client (internal)
├── prisma/
│   ├── prisma.service.ts                # Prisma ORM wrapper with optimizations
│   ├── prisma.module.ts                 # Prisma NestJS module
│   └── schema.prisma                    # Database schema
├── internal/                            # All internal services (SRP)
│   ├── read-replica-router.service.ts   # Read replica routing
│   ├── retry.service.ts                 # Retry logic with exponential backoff
│   ├── database-metrics.service.ts      # Metrics & monitoring
│   ├── clinic-isolation.service.ts      # Multi-tenant isolation
│   ├── query-optimizer.service.ts       # Query optimization
│   ├── query-cache.service.ts           # Query result caching
│   ├── database-health-monitor.service.ts # Health monitoring
│   ├── connection-leak-detector.service.ts # Leak detection
│   ├── database-alert.service.ts        # Alert generation
│   └── index.ts                         # Internal service exports
├── repositories/
│   ├── base.repository.ts               # Base repository (internal)
│   ├── user.repository.ts               # User repository (internal)
│   └── simple-patient.repository.ts     # Patient repository (internal)
├── config/
│   └── healthcare.config.ts             # Database configuration
├── query/
│   └── query.utils.ts                   # Query utility functions
├── connection-pool.manager.ts           # Legacy pool manager (backward compatibility)
├── database.module.ts                   # NestJS module
└── index.ts                             # Public exports (DatabaseService ONLY)
```

### Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│              External Services (Public API)              │
│  import { DatabaseService } from "@infrastructure/database" │
│  ✅ SINGLE ENTRY POINT - Only DatabaseService exported  │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│         DatabaseService (Public Interface)              │
│    (alias for HealthcareDatabaseClient)                 │
│    ✅ All optimization layers automatically applied      │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│      HealthcareDatabaseClient (Internal)                │
│  - executeHealthcareRead/Write                          │
│  - Transaction management                               │
│  - Cache integration                                    │
│  - All services integrated & wired                      │
└──────┬───────────────────────────────┬──────────────────┘
       │                               │
┌──────▼──────────┐        ┌──────────▼──────────────────┐
│ PrismaService   │        │ Optimization Layer          │
│ (ORM Wrapper)   │        │ ✅ ReadReplicaRouterService │
│ - Connection    │        │ ✅ ConnectionPoolManager    │
│   Pooling       │        │ ✅ DatabaseHealthMonitor    │
│ - Circuit       │        │ ✅ QueryCacheService        │
│   Breaker       │        │ ✅ DatabaseMetricsService   │
│ - Query Timeout │        │ ✅ ClinicIsolationService   │
│ - Type-Safe     │        │ ✅ QueryOptimizerService    │
│   Delegates     │        │ ✅ RetryService             │
└──────┬──────────┘        │ ✅ DatabaseErrorHandler     │
       │                   │ ✅ ConnectionLeakDetector   │
       │                   │ ✅ DatabaseAlertService     │
       │                   │ ✅ ConnectionPoolManager    │
       │                   └─────────────────────────────┘
       │
┌──────▼──────────┐
│   PostgreSQL    │
│   Database      │
│   (Primary +    │
│    Read Replicas)│
└─────────────────┘
```

### ✅ Single Entry Point Architecture

**CRITICAL:** This module provides **ONLY ONE** public database service:

```typescript
// ✅ CORRECT - ONLY way to use database
import { DatabaseService } from "@infrastructure/database";

// ❌ WRONG - Never import these directly
// import { HealthcareDatabaseClient } from "...";  // INTERNAL ONLY
// import { PrismaService } from "...";             // INTERNAL ONLY
// import { ConnectionPoolManager } from "...";     // INTERNAL ONLY
```

**All optimization layers are automatically applied through DatabaseService:**
- ✅ Connection pooling and read replicas
- ✅ Query caching and optimization
- ✅ Metrics tracking and monitoring
- ✅ HIPAA compliance and audit logging
- ✅ Multi-tenant clinic isolation
- ✅ Error handling and retry logic
- ✅ Circuit breaker protection
- ✅ Health monitoring

---

## 🚀 Scalability (10M+ Users)

### Connection Pooling

**Configuration** (optimized for 10M+ users):
- **Min Connections**: 50 (warm pool)
- **Max Connections**: 500 (scalable pool)
- **Connection Timeout**: 30 seconds
- **Query Timeout**: 15 seconds
- **Health Check Interval**: 30 seconds

**Auto-Scaling**:
- CPU threshold: 75%
- Connection threshold: 400 (80% of max)
- Scale-up cooldown: 5 minutes
- Scale-down cooldown: 30 minutes

### Read Replicas

Support for read replica routing:
- Automatic read/write splitting
- Round-robin load balancing
- Failover to primary on replica failure
- Configurable replica URLs

### Caching Strategy

**Multi-Level Caching**:
1. **Query Result Cache**: TTL-based caching (5-60 minutes)
2. **Clinic Data Cache**: 1 hour TTL
3. **Patient Data Cache**: 30 minutes TTL
4. **Appointment Data Cache**: 5 minutes TTL
5. **Emergency Data Cache**: 1 minute TTL

**Cache Configuration**:
- **Max Size**: 100,000 entries (10M+ users)
- **Strategy**: LRU (Least Recently Used)
- **SWR**: Stale-While-Revalidate enabled
- **Distributed**: Redis-based for horizontal scaling

### Query Optimization

**Automatic Optimizations**:
- Query pattern analysis
- Index recommendations
- SELECT * replacement
- WHERE clause optimization
- LIMIT clause addition
- Batch operation optimization

**Performance Thresholds**:
- Slow query: > 1 second
- Critical query: > 5 seconds
- Auto-optimization for queries > 1 second

### Batch Operations

**Optimized Concurrency**:
- Default concurrency: 50 operations
- Configurable per operation
- Automatic retry with exponential backoff
- Circuit breaker protection

---

## 🔌 Integration

### ✅ Single Entry Point - DatabaseService

**CRITICAL:** All external services MUST use ONLY `DatabaseService`:

```typescript
// ✅ CORRECT - Use DatabaseService
import { DatabaseService } from "@infrastructure/database";

@Injectable()
export class UserService {
  constructor(private readonly database: DatabaseService) {}
  
  async findUser(id: string) {
    return await this.database.executeHealthcareRead(async (client) => {
      return await client.user.findUnique({ where: { id } });
    });
  }
}
```

**❌ WRONG - Never import internal services:**
```typescript
// ❌ WRONG - Internal services not exported
import { HealthcareDatabaseClient } from "@infrastructure/database/clients/...";
import { PrismaService } from "@infrastructure/database/prisma/...";
import { ConnectionPoolService } from "@infrastructure/database/internal/...";
```

### NestJS Integration

The database module is a **@Global()** NestJS module, automatically available throughout the application:

```typescript
// app.module.ts
import { DatabaseModule } from '@infrastructure/database';

@Module({
  imports: [
    // ... other modules
    DatabaseModule, // Global module - available everywhere
  ],
})
export class AppModule {}
```

**Module Exports:**
- ✅ `HealthcareDatabaseClient` (exported as `DatabaseService` in index.ts)
- ✅ `ClinicIsolationService` (for GuardsModule circular dependency only)
- ❌ All other services are INTERNAL and NOT exported

### Fastify Integration

The database module is **framework-agnostic** and works seamlessly with Fastify through NestJS:

- No direct Fastify dependencies
- Uses NestJS dependency injection
- Compatible with Fastify's async nature
- Optimized for Fastify's high-performance routing

### Prisma Integration

**Prisma Service** (`prisma.service.ts`):
- Type-safe PrismaClient wrapper
- REQUEST scope for multi-tenant isolation
- Connection pool management
- Circuit breaker integration
- Query timeout handling

**Schema Management**:
- Single schema file: `schema.prisma`
- Automatic migrations
- Type generation: `prisma generate`
- Migration commands: `prisma migrate`

### PostgreSQL Integration

**Connection Configuration**:
- Connection string: `DATABASE_URL`
- SSL support: `DATABASE_SSL=true`
- Schema: `healthcare` (configurable)
- Connection validation: Enabled

**Performance Tuning**:
- Shared buffers: 512MB
- Effective cache size: 4GB
- Work memory: 8MB
- Maintenance work memory: 256MB
- Max connections: 500

---

## 🧩 Components

### 1. DatabaseService (Public Interface) - ✅ SINGLE ENTRY POINT

**Location**: `index.ts` (exported as alias for HealthcareDatabaseClient)

**✅ This is the ONLY public interface. All external services MUST use this.**

**Usage**:
```typescript
import { DatabaseService } from "@infrastructure/database";

@Injectable()
export class UserService {
  constructor(private readonly database: DatabaseService) {}

  async findUser(id: string) {
    return await this.database.executeHealthcareRead(async (client) => {
      return await client.user.findUnique({ where: { id } });
    });
  }
}
```

**Features** (All automatically applied):
- ✅ Connection pooling and read replicas
- ✅ Query caching and optimization
- ✅ Metrics tracking and monitoring
- ✅ HIPAA compliance and audit logging
- ✅ Multi-tenant clinic isolation
- ✅ Error handling and retry logic
- ✅ Circuit breaker protection
- ✅ Health monitoring

### 2. HealthcareDatabaseClient (Internal) - ❌ NOT FOR DIRECT USE

**Location**: `clients/healthcare-database.client.ts`

**⚠️ INTERNAL ONLY - Do NOT import directly. Use DatabaseService instead.**

**Integrated Services:**
- ✅ PrismaService - Core Prisma client
- ✅ ConnectionPoolManager - Connection pool management (consolidated: includes pool warming, metrics, health checks)
- ✅ ReadReplicaRouterService - Read replica routing
- ✅ DatabaseHealthMonitorService - Health monitoring
- ✅ QueryCacheService - Query caching
- ✅ DatabaseMetricsService - Metrics tracking
- ✅ ClinicIsolationService - Multi-tenant isolation
- ✅ HealthcareQueryOptimizerService - Query optimization
- ✅ ConnectionPoolManager - Legacy (backward compatibility)

### 3. PrismaService (Internal) - ❌ NOT FOR DIRECT USE

**Location**: `prisma/prisma.service.ts`

**Features**:
- Type-safe PrismaClient wrapper
- REQUEST scope for tenant isolation
- Connection pool management
- Circuit breaker integration
- Query timeout protection
- Production optimizations

**Methods:**
- `getClient()` - Returns PrismaClient
- `getRawPrismaClient()` - Returns raw PrismaClient
- All delegates initialized (user, appointment, clinic, etc.)

### 4. Internal Services (All in `internal/` folder) - ❌ NOT FOR DIRECT USE

**All services follow Single Responsibility Principle (SRP):**

#### ConnectionPoolManager (Consolidated)
**Location**: `connection-pool.manager.ts`
- **PRIMARY** connection pool manager with full feature set
- Connection pool management (consolidated from ConnectionPoolService)
- Circuit breaker integration
- Health monitoring
- Metrics tracking
- Pool warming on startup (consolidated from ConnectionPoolWarmingService)
- Batch operations, critical queries, auto-scaling

#### ReadReplicaRouterService
**Location**: `internal/read-replica-router.service.ts`
- Read replica routing
- Load balancing (round-robin, least-connections, latency-based)
- Health monitoring
- Automatic failover

#### DatabaseHealthMonitorService
**Location**: `internal/database-health-monitor.service.ts`
- Comprehensive health monitoring
- Primary/replica health checks
- Disk space monitoring
- Replication lag tracking
- Lock monitoring

#### QueryCacheService
**Location**: `internal/query-cache.service.ts`
- Query result caching
- TTL-based expiration
- Tag-based invalidation

#### DatabaseMetricsService
**Location**: `internal/database-metrics.service.ts`
- Real-time performance metrics
- Query performance tracking
- Connection pool metrics
- HIPAA compliance metrics
- Alert system integration

#### ClinicIsolationService
**Location**: `internal/clinic-isolation.service.ts`
- Multi-tenant data isolation
- Clinic context caching
- User-clinic mapping
- Location-clinic mapping

#### HealthcareQueryOptimizerService
**Location**: `internal/query-optimizer.service.ts`
- Query analysis
- Index recommendations
- Query rewriting
- Performance optimization

#### RetryService
**Location**: `internal/retry.service.ts`
- Retry logic with exponential backoff
- Configurable retry options
- Used by all database operations

#### DatabaseErrorHandler
**Location**: `@core/errors/database-error.handler.ts`
- Error classification
- Consistent error handling
- Graceful degradation

#### ConnectionLeakDetectorService
**Location**: `internal/connection-leak-detector.service.ts`
- Connection leak detection
- Leak tracking and alerts

#### DatabaseAlertService
**Location**: `internal/database-alert.service.ts`
- Alert generation
- Event emission
- Alert management


### 5. ConnectionPoolManager (Internal - PRIMARY Pool Manager)

**Location**: `connection-pool.manager.ts`

**Status**: PRIMARY connection pool manager with full feature set. This is the main service for connection pooling.

**Features**:
- Full connection pool management
- Batch operations (`executeBatch`)
- Critical query execution (`executeCriticalQuery`)
- Clinic-optimized queries (`executeClinicOptimizedQuery`)
- Auto-scaling (`autoScaleConnectionPool`)
- Health monitoring
- Circuit breaker
- Priority queue
- Detailed metrics (`getDetailedMetrics`)

**Note**: `ConnectionPoolService` and `ConnectionPoolWarmingService` have been consolidated into `ConnectionPoolManager` to reduce duplication and simplify the architecture. `ConnectionPoolManager` is now the single, unified connection pool manager with all features.

---

## 💻 Usage

### Basic Read Operation

```typescript
import { DatabaseService } from "@infrastructure/database";

@Injectable()
export class UserService {
  constructor(private readonly database: DatabaseService) {}

  async findUserById(id: string) {
    return await this.database.executeHealthcareRead(async (client) => {
      return await client.user.findUnique({
        where: { id },
        include: {
          doctor: true,
          patient: true,
        },
      });
    });
  }
}
```

### Basic Write Operation

```typescript
async createUser(userData: CreateUserInput) {
  return await this.database.executeHealthcareWrite(
    async (client) => {
      return await client.user.create({
        data: userData,
      });
    },
    {
      userId: 'system',
      action: 'CREATE_USER',
      resourceType: 'User',
    }
  );
}
```

### Transaction

```typescript
async createUserWithProfile(userData: CreateUserInput, profileData: CreateProfileInput) {
  return await this.database.executeInTransaction(async (tx) => {
    const user = await tx.user.create({ data: userData });
    const profile = await tx.profile.create({
      data: { ...profileData, userId: user.id },
    });
    return { user, profile };
  });
}
```

### Clinic Context

```typescript
async findClinicPatients(clinicId: string) {
  return await this.database.executeWithClinicContext(
    clinicId,
    async (client) => {
      return await client.patient.findMany({
        where: { clinicId },
      });
    }
  );
}
```

### Batch Operations

```typescript
async createMultipleUsers(usersData: CreateUserInput[]) {
  return await this.database.executeBatchOperations(
    usersData.map((data) => ({
      operation: async (client) => client.user.create({ data }),
      priority: 'normal' as const,
    })),
    {
      concurrency: 50, // Optimized for 10M+ users
      retries: 3,
    }
  );
}
```

---

## ⚡ Performance Optimization

### Query Optimization

**Automatic Optimizations**:
- SELECT * → Specific columns
- Missing LIMIT → Added automatically
- Complex WHERE → Simplified
- Index recommendations

**Manual Optimizations**:
```typescript
// Use select to limit fields
const users = await this.database.executeHealthcareRead(async (client) => {
  return await client.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      // Only select needed fields
    },
  });
});

// Use pagination
const users = await this.database.executeHealthcareRead(async (client) => {
  return await client.user.findMany({
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { createdAt: 'desc' },
  });
});
```

### Caching

**Automatic Caching**:
- Read operations are automatically cached
- TTL based on data type
- SWR for stale data

**Manual Cache Control**:
```typescript
// Cache with custom TTL
const user = await this.database.findUserByIdSafe(id); // Uses cache automatically

// Invalidate cache
await this.database.invalidateCache(['user', `user:${id}`]);
```

### Connection Pooling

**Configuration** (via environment variables):
```bash
DB_POOL_MIN=50
DB_POOL_MAX=500
DB_POOL_ACQUIRE_TIMEOUT=60000
DB_POOL_IDLE_TIMEOUT=300000
```

**Auto-Scaling**:
- Automatically scales based on connection utilization
- CPU threshold: 75%
- Connection threshold: 400 (80% of max)

---

## 🏥 HIPAA Compliance

### Audit Logging

**Automatic Audit Logging**:
- All write operations are logged
- Retention: 7 years (2555 days)
- Includes: user, action, resource, timestamp

**Audit Log Structure**:
```typescript
{
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}
```

### Data Encryption

**Encryption Levels**:
- **At Rest**: AES-256 encryption
- **In Transit**: SSL/TLS
- **Key Rotation**: 90 days

### Access Controls

**Multi-Level Access**:
- Role-based access (RBAC)
- Clinic-based access
- Location-based access
- Time-based access
- IP-based access
- Device-based access

### Data Retention

**Retention Periods**:
- Patient records: 30 years
- Medical history: Lifetime
- Audit logs: 10 years
- Appointments: 7 years
- Billing: 10 years
- Prescriptions: 10 years

---

## 📚 Best Practices

### ✅ DO

1. **Always use DatabaseService (ONLY public interface)**:
   ```typescript
   // ✅ CORRECT - Single entry point
   import { DatabaseService } from "@infrastructure/database";
   
   constructor(private readonly database: DatabaseService) {}
   ```

2. **Use executeHealthcareRead/Write for all operations**:
   ```typescript
   // ✅ CORRECT - All optimization layers applied
   await this.database.executeHealthcareRead(async (client) => {
     return await client.user.findUnique({ where: { id } });
   });
   
   await this.database.executeHealthcareWrite(async (client) => {
     return await client.user.create({ data: userData });
   }, auditInfo);
   ```

3. **Use transactions for related operations**:
   ```typescript
   // ✅ CORRECT - ACID compliance
   await this.database.executeInTransaction(async (tx) => {
     const user = await tx.user.create({ data: userData });
     const profile = await tx.profile.create({ data: profileData });
     return { user, profile };
   });
   ```

4. **Use clinic context for multi-tenant operations**:
   ```typescript
   // ✅ CORRECT - Automatic clinic isolation
   await this.database.executeWithClinicContext(clinicId, async (client) => {
     return await client.patient.findMany({ where: { clinicId } });
   });
   ```

5. **Use select to limit fields (10M+ users optimization)**:
   ```typescript
   // ✅ CORRECT - Reduces data transfer
   select: { id: true, name: true, email: true }
   ```

6. **Use pagination for large datasets**:
   ```typescript
   // ✅ CORRECT - Prevents loading millions of records
   skip: (page - 1) * limit,
   take: limit  // Max 1000 per query
   ```

### ❌ DON'T

1. **Don't import internal services directly**:
   ```typescript
   // ❌ WRONG - Internal services not exported
   import { HealthcareDatabaseClient } from "@infrastructure/database/clients/...";
   import { PrismaService } from "@infrastructure/database/prisma/...";
   import { ConnectionPoolManager } from "@infrastructure/database/connection-pool.manager"; // INTERNAL ONLY
   import { ReadReplicaRouterService } from "@infrastructure/database/internal/...";
   
   // ✅ CORRECT - Use public interface only
   import { DatabaseService } from "@infrastructure/database";
   ```

2. **Don't bypass optimization layers**:
   ```typescript
   // ❌ WRONG - Bypasses caching, metrics, read replicas, etc.
   const client = await this.database.getRawPrismaClient();
   await client.user.findMany();
   
   // ✅ CORRECT - Uses all optimization layers automatically
   await this.database.executeHealthcareRead(async (client) => {
     return await client.user.findMany();
   });
   ```

3. **Don't use SELECT * for large tables**:
   ```typescript
   // ❌ WRONG - Fetches all fields (wasteful for 10M+ users)
   select: {} // or no select clause
   
   // ✅ CORRECT - Only fetch needed fields
   select: { id: true, name: true, email: true }
   ```

4. **Don't ignore pagination**:
   ```typescript
   // ❌ WRONG - Fetches all records (dangerous for 10M+ users)
   await client.user.findMany();
   
   // ✅ CORRECT - Always use pagination
   await client.user.findMany({ 
     skip: (page - 1) * limit, 
     take: limit  // Max 1000
   });
   ```

5. **Don't access PrismaService directly**:
   ```typescript
   // ❌ WRONG - Bypasses all optimization layers
   constructor(private prisma: PrismaService) {}
   
   // ✅ CORRECT - Use DatabaseService
   constructor(private database: DatabaseService) {}
   ```

---

## 📖 Documentation

### Prisma Documentation

- **Official Docs**: https://www.prisma.io/docs
- **Schema Reference**: `src/libs/infrastructure/database/prisma/schema.prisma`
- **Migration Guide**: https://www.prisma.io/docs/guides/migrate

### PostgreSQL Documentation

- **Official Docs**: https://www.postgresql.org/docs/
- **Performance Tuning**: https://www.postgresql.org/docs/current/performance-tips.html
- **Connection Pooling**: https://www.postgresql.org/docs/current/runtime-config-connection.html

### NestJS Documentation

- **Official Docs**: https://docs.nestjs.com
- **Database Integration**: https://docs.nestjs.com/techniques/database
- **Dependency Injection**: https://docs.nestjs.com/providers

### Fastify Documentation

- **Official Docs**: https://www.fastify.io/docs/latest/
- **NestJS Integration**: https://docs.nestjs.com/techniques/performance

---

## 🔧 Configuration

### Environment Variables

```bash
# Database Connection
DATABASE_URL=postgresql://user:password@localhost:5432/healthcare
DATABASE_SSL=true

# Connection Pooling
DB_POOL_MIN=50
DB_POOL_MAX=500
DB_POOL_ACQUIRE_TIMEOUT=60000
DB_POOL_IDLE_TIMEOUT=300000

# Read Replicas
DB_READ_REPLICAS_ENABLED=true
READ_REPLICA_URLS=postgresql://replica1:5432,postgresql://replica2:5432

# Caching
CACHE_ENABLED=true
CACHE_TTL=300
CACHE_MAX_SIZE=100000

# Performance
SLOW_QUERY_THRESHOLD=1000
DB_BATCH_SIZE=2000
DB_PARALLEL_QUERIES=20

# Auto-Scaling
DB_AUTO_SCALING_ENABLED=true
DB_AUTO_SCALING_CPU_THRESHOLD=75
DB_AUTO_SCALING_CONNECTION_THRESHOLD=400

# HIPAA Compliance
AUDIT_RETENTION_DAYS=2555
ENCRYPTION_ENABLED=true
ENCRYPTION_ALGORITHM=AES-256-GCM
```

---

## 📊 Monitoring

### Metrics Available

- **Connection Pool Metrics**: Total, active, idle, waiting connections
- **Query Performance**: Average query time, slow queries, critical queries
- **Cache Metrics**: Hit rate, miss rate, eviction rate
- **HIPAA Metrics**: Audit log entries, encryption rate, access attempts
- **Clinic Metrics**: Per-clinic performance, isolation metrics

### Health Checks

**Multiple Health Check Methods Available:**

#### 1. Comprehensive Health Check (Recommended for periodic checks)
```typescript
// Get comprehensive database health status
// Uses lightweight SELECT 1 query with dedicated connection pool
// Cached for 5 seconds to avoid excessive queries
const health = await this.database.getHealthStatus();
```

**Features:**
- ✅ Uses dedicated health check connection pool (connection_limit=2)
- ✅ Lightweight `SELECT 1` query (fastest possible)
- ✅ Cached for 5 seconds (prevents excessive queries)
- ✅ Won't exhaust main connection pool
- ✅ Includes connection pool metrics, disk space, replication lag, locks

#### 2. Lightweight Health Check (For very frequent checks)
```typescript
// Get lightweight health status (no DB query, uses cached data)
// Use this for checks every second or more frequently
const lightweightHealth = this.database.getLightweightHealthStatus();
```

**Features:**
- ✅ No database query (uses cached data)
- ✅ Returns connection pool metrics only
- ✅ Perfect for very frequent checks (every 1-5 seconds)
- ✅ Zero overhead on database

#### 3. Connection Pool Metrics Only
```typescript
// Get connection pool metrics without health check query
const metrics = await this.database.getConnectionPoolMetrics();
```

**Features:**
- ✅ No database query
- ✅ Real-time connection pool status
- ✅ Fast and lightweight

### Health Check Architecture

**Dedicated Health Check Connection:**
- **Separate Connection Pool**: `connection_limit=2` (won't exhaust main pool)
- **Lightweight Query**: `SELECT 1` (fastest possible query)
- **Caching**: 5-second cache to prevent excessive queries
- **Frequency**: Health checks run every 10 seconds (configurable)

**Why This Approach:**
1. **Won't Exhaust Pool**: Dedicated connection pool separate from main pool
2. **Fast**: Uses `SELECT 1` instead of `SELECT version()` (10x faster)
3. **Efficient**: 5-second caching prevents duplicate queries
4. **Real-time**: Still provides accurate health status

### Alternative Health Check Methods

**Method 1: SELECT 1 (Current - Recommended)**
- ✅ Lightest possible query
- ✅ Just checks connectivity
- ✅ ~1-5ms response time
- ✅ Used by default

**Method 2: Connection Pool Metrics Only**
- ✅ No database query at all
- ✅ Uses internal metrics
- ✅ Instant response
- ✅ Use `getLightweightHealthStatus()`

**Method 3: Cached Status**
- ✅ Returns cached result if fresh (< 5 seconds)
- ✅ Reduces database load
- ✅ Automatic caching in `getHealthStatus()`

**Method 4: Periodic Comprehensive Check**
- ✅ Full health check every 30 seconds
- ✅ Lightweight checks every 10 seconds
- ✅ Best of both worlds

---

## 🚨 Troubleshooting

### Common Issues & Solutions

#### 1. Connection Pool Exhausted

**Symptoms**:
- High connection pool utilization (>95%)
- Queries waiting in queue
- "Connection pool exhausted" errors

**Automatic Solutions** (Implemented):
- ✅ **Auto-scaling**: Automatically scales pool up when utilization > 80%
- ✅ **Connection leak detection**: Alerts when connections stay high
- ✅ **Queue management**: Intelligent query queuing with priority
- ✅ **Health monitoring**: Continuous monitoring with 15-second intervals

**Manual Solutions**:
```bash
# Increase pool size
DB_POOL_MAX=500  # Default: 500, increase if needed

# Enable auto-scaling
DB_AUTO_SCALING_ENABLED=true

# Check for connection leaks
# Review application code for unclosed connections
# Check long-running transactions
# Review error handling paths
```

**Monitoring**:
- Check connection pool metrics via `getConnectionPoolMetrics()`
- Monitor alerts for "CONNECTION_POOL" type
- Review logs for "Connection pool near exhaustion" warnings

---

#### 2. Slow Queries

**Symptoms**:
- Queries taking > 1 second
- High average query time
- Performance degradation

**Automatic Solutions** (Implemented):
- ✅ **Slow query detection**: Automatically detects queries > 1 second
- ✅ **Query optimization recommendations**: Automatic analysis and suggestions
- ✅ **Index recommendations**: Suggests missing indexes
- ✅ **Query logging**: Detailed logging with recommendations
- ✅ **Critical query alerts**: Alerts for queries > 5 seconds

**Manual Solutions**:
```typescript
// Review slow query logs
// Check optimization recommendations in logs
// Add suggested indexes
// Rewrite complex queries
// Use query optimization service
```

**Optimization Recommendations**:
- Replace `SELECT *` with specific columns
- Add `LIMIT` clauses to prevent large result sets
- Simplify complex JOINs
- Add WHERE clauses with indexed columns
- Review query execution plans

**Monitoring**:
- Check `getPerformanceReport()` for slow queries
- Review alerts for "PERFORMANCE" type
- Monitor `averageQueryTime` metric

---

#### 3. Cache Misses

**Symptoms**:
- Low cache hit rate (<70%)
- Frequent database queries
- Increased database load

**Automatic Solutions** (Implemented):
- ✅ **Cache hit/miss tracking**: Automatic tracking of cache performance
- ✅ **Low hit rate alerts**: Alerts when hit rate < 70%
- ✅ **Cache optimization recommendations**: Automatic suggestions
- ✅ **TTL adjustment**: Dynamic TTL based on access patterns

**Manual Solutions**:
```bash
# Increase cache TTL
CACHE_TTL=600  # Default: 300 (5 minutes), increase for stable data

# Increase cache size
CACHE_MAX_SIZE=100000  # Default: 100000, increase if needed

# Review cache invalidation strategy
# Check cache key patterns
# Enable cache warming for frequently accessed data
```

**Cache Optimization**:
- Review cache TTL settings (may be too short)
- Check cache invalidation strategy (may be too aggressive)
- Optimize cache key patterns
- Enable cache warming for hot data
- Review Redis connection and performance

**Monitoring**:
- Check `cacheHitRate` in performance metrics
- Review alerts for "CACHE" type
- Monitor cache hit/miss ratios

---

#### 4. Circuit Breaker Open

**Symptoms**:
- "Circuit breaker is open" errors
- Database connection failures
- Service unavailable errors

**Automatic Solutions** (Implemented):
- ✅ **Automatic recovery**: Attempts recovery after timeout (30 seconds)
- ✅ **Half-open state**: Tests connection before fully reopening
- ✅ **Recovery notifications**: Logs and events when circuit closes
- ✅ **Health check integration**: Continuous health monitoring

**Manual Solutions**:
```typescript
// Reset circuit breaker manually (admin operation)
await databaseService.resetCircuitBreaker();

// Check database connectivity
// Review database error logs
// Verify network connectivity
// Check database server status
```

**Recovery Process**:
1. Circuit breaker opens after 5 consecutive failures
2. Waits 30 seconds (configurable via `CIRCUIT_BREAKER_TIMEOUT`)
3. Enters half-open state
4. Tests with 3 successful operations
5. Closes circuit breaker if successful
6. Emits recovery event

**Monitoring**:
- Check `getCircuitBreakerState()` for current state
- Review logs for "Circuit breaker opened/closed" messages
- Monitor `circuitBreakerTrips` metric
- Check database health status

**Prevention**:
- Monitor connection pool metrics
- Review slow queries
- Check database server performance
- Verify network stability
- Review error logs for patterns

---

## 📝 License

This module is part of the Healthcare Backend application and follows the same license terms.

---

**Last Updated**: December 2024
**Version**: 1.0.0
**Maintainer**: Healthcare Backend Team

