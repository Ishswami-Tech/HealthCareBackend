<!-- 6fd68e9b-513d-4e92-a1f6-21f797f0de4d 4ceee8cf-6a31-4764-a92c-c9eb3d8488b2 -->
# Refactor Database Architecture - Eliminate Circular Dependencies

## Architecture Overview

**Layered Architecture (Bottom-Up):**

```
Layer 1: PrismaService (Foundation)
  └─ No dependencies on other database services
  
Layer 2: Internal Services (Independent)
  └─ Each depends ONLY on PrismaService
  └─ No dependencies on each other
  └─ Services: QueryOptimizer, DataMasking, SQLInjectionPrevention, RetryService, etc.
  
Layer 3: DatabaseService (Orchestrator)
  └─ Depends on PrismaService + all Layer 2 services
  └─ Orchestrates all functionality
  └─ Single public interface for external services
```

## Implementation Plan

### Phase 1: Refactor Internal Services (Remove Cross-Dependencies)

**1.1 Query Optimizer Service**

- **File**: `src/libs/infrastructure/database/internal/query-optimizer.service.ts`
- **Changes**: Remove any dependencies on other internal services
- **Dependencies**: Only `PrismaService`, `LoggingService`, `ConfigService`

**1.2 Data Masking Service**

- **File**: `src/libs/infrastructure/database/internal/data-masking.service.ts`
- **Changes**: Already clean - only depends on `ConfigService`, `LoggingService`
- **No changes needed**

**1.3 SQL Injection Prevention Service**

- **File**: `src/libs/infrastructure/database/internal/sql-injection-prevention.service.ts`
- **Changes**: Already clean - only depends on `ConfigService`, `LoggingService`
- **No changes needed**

**1.4 Retry Service**

- **File**: `src/libs/infrastructure/database/internal/retry.service.ts`
- **Changes**: Already clean - only depends on `LoggingService`
- **No changes needed**

**1.5 Row Level Security Service**

- **File**: `src/libs/infrastructure/database/internal/row-level-security.service.ts`
- **Changes**: Already clean - only depends on `PrismaService`, `ConfigService`, `LoggingService`
- **No changes needed**

**1.6 Clinic Isolation Service**

- **File**: `src/libs/infrastructure/database/internal/clinic-isolation.service.ts`
- **Changes**: Already clean - only depends on `PrismaService`, `ConfigService`, `LoggingService`
- **No changes needed**

**1.7 Read Replica Router Service**

- **File**: `src/libs/infrastructure/database/internal/read-replica-router.service.ts`
- **Changes**: Already clean - only depends on `PrismaService`, `ConfigService`, `LoggingService`
- **No changes needed**

**1.8 Query Cache Service**

- **File**: `src/libs/infrastructure/database/internal/query-cache.service.ts`
- **Changes**: Already clean - only depends on `CacheService`, `LoggingService`
- **No changes needed**

**1.9 Database Health Monitor Service**

- **File**: `src/libs/infrastructure/database/internal/database-health-monitor.service.ts`
- **Changes**: Already clean - only depends on `PrismaService`, `ConfigService`, `LoggingService`
- **No changes needed**

**1.10 Connection Leak Detector Service**

- **File**: `src/libs/infrastructure/database/internal/connection-leak-detector.service.ts`
- **Changes**: Remove dependency on `EventService` - use direct logging only
- **Dependencies**: Only `LoggingService`

**1.11 Database Alert Service**

- **File**: `src/libs/infrastructure/database/internal/database-alert.service.ts`
- **Changes**: Remove dependency on `EventService` - use direct logging only
- **Dependencies**: Only `LoggingService`
- **Note**: Event emission will be handled by DatabaseService if needed

**1.12 Database Metrics Service**

- **File**: `src/libs/infrastructure/database/internal/database-metrics.service.ts`
- **Changes**: 
  - Remove dependencies on `DatabaseAlertService`, `ClinicIsolationService`, `HealthcareQueryOptimizerService`
  - Only depend on `PrismaService`, `ConfigService`, `LoggingService`
  - Metrics collection should be self-contained
  - Alert generation removed (handled by DatabaseService)

**1.13 Clinic Rate Limiter Service**

- **File**: `src/libs/infrastructure/database/internal/clinic-rate-limiter.service.ts`
- **Changes**: 
  - Remove dependency on `RateLimitService` via ModuleRef
  - Use direct rate limiting logic or inject `RateLimitService` directly (not via ModuleRef)
  - **Dependencies**: `RateLimitService` (from RateLimitModule), `ConfigService`, `LoggingService`

### Phase 2: Refactor Connection Pool Manager

**2.1 Connection Pool Manager**

- **File**: `src/libs/infrastructure/database/connection-pool.manager.ts`
- **Changes**:
  - Remove dependency on `HealthcareQueryOptimizerService` (use directly in DatabaseService)
  - Remove dependency on `EventService` (use direct logging)
  - **Dependencies**: Only `PrismaService`, `ConfigService`, `LoggingService`
  - Query optimization will be called by DatabaseService before passing to pool manager

### Phase 3: Refactor Repositories

**3.1 Base Repository**

- **File**: `src/libs/infrastructure/database/repositories/base.repository.ts`
- **Changes**:
  - Remove dependency on `HealthcareDatabaseClient` (DatabaseService)
  - **Dependencies**: Only `PrismaService`, `LoggingService`, `CacheService` (optional)
  - All repository methods use PrismaService directly
  - DatabaseService will use repositories, not the other way around

**3.2 User Repository**

- **File**: `src/libs/infrastructure/database/repositories/user.repository.ts`
- **Changes**:
  - Remove dependency on `DatabaseService` via ModuleRef
  - **Dependencies**: Only `PrismaService`, `LoggingService`, `CacheService` (optional)
  - Use PrismaService directly for all operations

**3.3 Simple Patient Repository**

- **File**: `src/libs/infrastructure/database/repositories/simple-patient.repository.ts`
- **Changes**:
  - Remove dependency on `DatabaseService` via ModuleRef
  - Remove dependency on `ClinicIsolationService` (use PrismaService directly)
  - **Dependencies**: Only `PrismaService`, `LoggingService`, `CacheService` (optional)

### Phase 4: Refactor DatabaseService (HealthcareDatabaseClient)

**4.1 Healthcare Database Client**

- **File**: `src/libs/infrastructure/database/clients/healthcare-database.client.ts`
- **Changes**:
  - This becomes the orchestrator that uses ALL internal services
  - **Dependencies**: 
    - `PrismaService` (foundation)
    - All Layer 2 services (QueryOptimizer, DataMasking, RLS, ClinicIsolation, etc.)
    - `ConnectionPoolManager`
    - `LoggingService`, `ConfigService`, `CacheService`, `EventService`
  - No circular dependencies - DatabaseService depends on everything, nothing depends on it
  - All cross-service coordination happens here
  - Repositories are instantiated internally if needed, or methods are inlined

### Phase 5: Update Database Module

**5.1 Database Module**

- **File**: `src/libs/infrastructure/database/database.module.ts`
- **Changes**:
  - Remove all `forwardRef()` wrappers (no longer needed)
  - Provider order:

    1. PrismaService (from PrismaModule)
    2. All Layer 2 services (independent, no cross-deps)
    3. ConnectionPoolManager
    4. DatabaseService (HealthcareDatabaseClient) - depends on everything above

  - No ModuleRef lazy injection needed
  - Clean, straightforward dependency injection

## Key Principles

1. **Single Direction of Dependencies**: 

   - PrismaService (Layer 1) → Internal Services (Layer 2) → HealthcareDatabaseClient (Layer 3)
   - No reverse dependencies - clean dependency graph

2. **No Circular Dependencies**: 

   - Each service only depends on services in lower layers
   - HealthcareDatabaseClient depends on everything, nothing depends on it

3. **Orchestration Pattern**: 

   - HealthcareDatabaseClient orchestrates all optimizations and robust patterns
   - Applies them in the correct order for each operation
   - Coordinates between services without them knowing about each other

4. **Clear Separation**: 

   - Each internal service has a single responsibility and is independent
   - Services don't know about each other
   - HealthcareDatabaseClient knows about all services and coordinates them

5. **Optimizations in Layer 3**: 

   - All optimizations (caching, pooling, query optimization, etc.) are orchestrated by HealthcareDatabaseClient
   - Layer 2 services provide the utilities
   - Layer 3 applies them in the right sequence

6. **Robust Patterns in Layer 3**: 

   - Circuit breaker, retry, rate limiting, health monitoring all orchestrated by HealthcareDatabaseClient
   - Layer 2 services provide the implementation
   - Layer 3 coordinates them

7. **Testability**: 

   - Each service can be tested independently with just PrismaService mock
   - HealthcareDatabaseClient can be tested with all service mocks

## Benefits

- **No Circular Dependencies**: Clean dependency graph
- **Easier Testing**: Each service can be tested independently
- **Better Maintainability**: Clear architecture, easy to understand
- **No NestJS Workarounds**: No need for forwardRef, ModuleRef lazy injection
- **Proper Layering**: Follows standard software architecture principles

## Migration Strategy

1. Start with services that have no dependencies (already clean)
2. Refactor services with dependencies one by one
3. Update ConnectionPoolManager
4. Update Repositories
5. Finally update DatabaseService to orchestrate everything
6. Update DatabaseModule to remove forwardRef

This architecture ensures no circular dependencies and follows proper software engineering principles.

### To-dos

- [ ] Refactor all internal services to depend only on PrismaService (remove cross-dependencies)
- [ ] Refactor ConnectionPoolManager to depend only on PrismaService
- [ ] Refactor repositories (BaseRepository, UserRepository, SimplePatientRepository) to depend only on PrismaService
- [ ] Refactor HealthcareDatabaseClient to orchestrate all services (no circular deps)
- [ ] Update DatabaseModule to remove forwardRef and ModuleRef workarounds
- [ ] Test application startup and verify no circular dependency errors