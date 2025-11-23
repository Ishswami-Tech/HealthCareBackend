# Database Robust Refactoring - Unified Enterprise Plan (10M+ Concurrent Users)

> **Note**: This is the consolidated plan that merges all database refactoring plans. It includes:
> - Layered architecture with zero circular dependencies
> - All enterprise features for 10M+ concurrent users
> - SOLID, DRY, KISS principles
> - Incremental integration and testing strategy
> - Proper folder structure with database.module.ts and database.service.ts in root

## Architecture Overview

**Layered Architecture (Bottom-Up) - Zero Circular Dependencies:**

```
Layer 1: Foundation Services (External - Reusable)
  └─ PrismaService (from PrismaModule)
  └─ CacheService (from @infrastructure/cache)
  └─ LoggingService (from @infrastructure/logging)
  └─ CircuitBreakerService (from @core/resilience)
  └─ GracefulShutdownService (from @core/resilience)
  └─ ConfigService (from @config)
  
Layer 2: Internal Services (Independent - Single Responsibility)
  └─ Each depends ONLY on Layer 1 services
  └─ No dependencies on each other (SOLID: Dependency Inversion)
  └─ Services: QueryOptimizer, DataMasking, SQLInjectionPrevention, RetryService, etc.
  
Layer 3: DatabaseService (Orchestrator - Facade Pattern)
  └─ Depends on PrismaService + all Layer 2 services
  └─ Orchestrates all functionality (SOLID: Single Responsibility)
  └─ Single public interface for external services (SOLID: Interface Segregation)
  
Layer 4: Repositories (Optional - Used by DatabaseService)
  └─ Depends on PrismaService, LoggingService, CacheService
  └─ Used by DatabaseService, not the other way around (SOLID: Dependency Inversion)
```

## Target Folder Structure (Following Cache Module Pattern)

```
src/libs/infrastructure/database/
├── config/
│   └── healthcare.config.ts (exists - healthcare-specific config)
├── internal/ (NEW - all internal services, NOT exported publicly - like cache/services/)
│   ├── clinic-isolation.service.ts (move & refactor)
│   ├── clinic-rate-limiter.service.ts (CREATE)
│   ├── connection-leak-detector.service.ts (CREATE)
│   ├── data-masking.service.ts (CREATE)
│   ├── database-alert.service.ts (CREATE)
│   ├── database-health-monitor.service.ts (CREATE)
│   ├── database-metrics.service.ts (move & refactor)
│   ├── query-cache.service.ts (CREATE)
│   ├── query-optimizer.service.ts (move & refactor)
│   ├── read-replica-router.service.ts (CREATE)
│   ├── retry.service.ts (CREATE)
│   ├── row-level-security.service.ts (CREATE)
│   ├── sql-injection-prevention.service.ts (CREATE)
│   └── index.ts (internal exports only)
├── prisma/ (exists - Prisma ORM)
│   ├── prisma.service.ts
│   ├── prisma.module.ts
│   └── schema.prisma
├── query/
│   ├── repositories/ (NEW - repository pattern - like cache/repositories/)
│   │   ├── base.repository.ts (move & refactor - remove DatabaseService dependency)
│   │   ├── simple-patient.repository.ts (move & refactor)
│   │   ├── user.repository.ts (move & refactor)
│   │   └── index.ts
│   ├── strategies/ (NEW - strategy pattern - like cache/strategies/)
│   │   ├── base-query.strategy.ts (CREATE)
│   │   ├── read-query.strategy.ts (CREATE - optimized read, cached read, replica read)
│   │   ├── write-query.strategy.ts (CREATE - audit write, critical write, batch write)
│   │   ├── transaction-query.strategy.ts (CREATE - optimistic, pessimistic, read-only)
│   │   ├── query-strategy.manager.ts (CREATE - like CacheStrategyManager)
│   │   └── index.ts
│   ├── middleware/ (NEW - middleware chain - like cache/middleware/)
│   │   ├── base-query.middleware.ts (CREATE)
│   │   ├── query-middleware.interface.ts (CREATE)
│   │   ├── validation-query.middleware.ts (CREATE - query validation)
│   │   ├── metrics-query.middleware.ts (CREATE - query metrics)
│   │   ├── security-query.middleware.ts (CREATE - SQL injection check, RLS enforcement)
│   │   ├── optimization-query.middleware.ts (CREATE - query optimization)
│   │   ├── query-middleware.chain.ts (CREATE - like CacheMiddlewareChain)
│   │   └── index.ts
│   ├── builders/ (NEW - builder pattern - like cache/builders/)
│   │   ├── query-options.builder.ts (CREATE - like CacheOptionsBuilder)
│   │   ├── transaction-options.builder.ts (CREATE)
│   │   └── index.ts
│   ├── factories/ (NEW - factory pattern - like cache/factories/)
│   │   ├── query-key.factory.ts (CREATE - like CacheKeyFactory for query cache keys)
│   │   └── index.ts
│   └── scripts/ (NEW - database utility scripts)
│       ├── connection-pool.manager.ts (move & refactor - remove cross-dependencies)
│       ├── init-db.ts (exists - keep)
│       └── index.ts
├── controllers/ (NEW - optional - like cache/controllers/)
│   ├── database.controller.ts (CREATE - health checks, metrics, admin operations)
│   └── index.ts
├── database.module.ts (ROOT - refactor - remove forwardRef)
├── database.service.ts (ROOT - NEW - main public service - like cache.service.ts)
├── index.ts (ROOT - public exports: DatabaseService, DatabaseModule only)
└── README.md (architecture documentation)
```

## Key Principles (SOLID, DRY, KISS)

### SOLID Principles

- **Single Responsibility**: Each service has one clear purpose
- **Open/Closed**: Services are open for extension, closed for modification
- **Liskov Substitution**: Services can be replaced with implementations
- **Interface Segregation**: Clean, focused interfaces
- **Dependency Inversion**: Depend on abstractions (Layer 1 services), not concretions

### DRY (Don't Repeat Yourself)

- Reuse existing services: CacheService, LoggingService, CircuitBreakerService
- Shared utilities and patterns
- No duplicate code across services

### KISS (Keep It Simple, Stupid)

- Simple, clear implementations
- No over-engineering
- Easy to understand and maintain

## Enterprise Features for 10M+ Concurrent Users

### Performance & Scalability

- ✅ Connection pooling (500 max connections, auto-scaling)
- ✅ Read replica routing for read scaling
- ✅ Query optimization and caching
- ✅ Batch operations with concurrency control (50 concurrent by default)
- ✅ Connection leak detection and prevention
- ✅ Circuit breakers (using CircuitBreakerService from @core/resilience)
- ✅ Query result caching with intelligent invalidation
- ✅ Connection pool auto-scaling based on load
- ✅ Query strategies (read/write/transaction strategies)
- ✅ Query middleware chain (validation, metrics, security, optimization)

### Security & Compliance

- ✅ SQL injection prevention
- ✅ Row-level security for multi-tenant isolation
- ✅ Data masking for HIPAA compliance
- ✅ Audit logging for all operations
- ✅ Rate limiting per clinic
- ✅ Input validation and sanitization
- ✅ PHI (Protected Health Information) protection
- ✅ Security middleware (SQL injection check, RLS enforcement)

### Reliability & Monitoring

- ✅ Health monitoring with auto-recovery
- ✅ Alert system for critical issues
- ✅ Retry logic with exponential backoff
- ✅ Comprehensive metrics tracking
- ✅ Error caching and deduplication
- ✅ Graceful shutdown (using GracefulShutdownService from @core/resilience)
- ✅ Connection pool health checks
- ✅ Query performance monitoring
- ✅ Metrics middleware for query tracking

### Developer Experience & Patterns

- ✅ Builder pattern (QueryOptionsBuilder, TransactionOptionsBuilder)
- ✅ Factory pattern (QueryKeyFactory for cache keys)
- ✅ Strategy pattern (Read/Write/Transaction strategies)
- ✅ Middleware pattern (Chain of Responsibility)
- ✅ Repository pattern (Base + specialized repositories)
- ✅ Interceptor support (HealthcareDatabaseInterceptor - optional)
- ✅ Controller for admin operations (optional)

## Implementation Strategy: Incremental Integration & Testing

**CRITICAL WORKFLOW**: After creating EACH new file:

1. **Create** the service file with implementation
2. **Add** service to `database.module.ts` providers array
3. **Export** service from `internal/index.ts` (if applicable)
4. **Update** imports in files that reference moved services
5. **Test**: Verify application starts without errors
6. **Test**: Verify auth endpoints work correctly
7. **Only proceed** to next file after all tests pass

This prevents issues from compounding and ensures each service is properly integrated.

## Implementation Phases

### Phase 1: Create Internal Directory and Move Existing Services

**Goal**: Create internal/ directory and move existing services with dependency cleanup

**Tasks** (one at a time, test after each):

1. **1.1 Create `database/internal/` directory**

2. **1.2 Move clinic-isolation.service.ts**

   - Move: `clinic-isolation.service.ts` → `internal/clinic-isolation.service.ts`
   - Refactor: Remove any cross-dependencies
   - Dependencies: Only PrismaService, ConfigService, LoggingService
   - Update: database.module.ts imports
   - Update: internal/index.ts exports
   - **Test**: App starts, auth endpoints work

3. **1.3 Move database-metrics.service.ts**

   - Move: `database-metrics.service.ts` → `internal/database-metrics.service.ts`
   - Refactor: Remove dependencies on DatabaseAlertService, ClinicIsolationService, HealthcareQueryOptimizerService
   - Dependencies: Only PrismaService, ConfigService, LoggingService
   - Update: database.module.ts imports
   - Update: internal/index.ts exports
   - **Test**: App starts, auth endpoints work

4. **1.4 Move query-optimizer.service.ts**

   - Move: `query-optimizer.service.ts` → `internal/query-optimizer.service.ts`
   - Refactor: Remove any cross-dependencies
   - Dependencies: Only PrismaService, LoggingService, ConfigService
   - Update: database.module.ts imports
   - Update: internal/index.ts exports
   - **Test**: App starts, auth endpoints work

5. **1.5 Create internal/index.ts**

   - Export all moved services (for internal use only)
   - **Test**: App starts, auth endpoints work

### Phase 2: Create Missing Internal Services (One by One with Integration & Testing)

**Goal**: Create all 10 missing services, one at a time with integration and testing after each

**For EACH service, follow this exact process:**

1. Create the service file with enterprise-grade implementation
2. Add service to `database.module.ts` providers array (in correct order)
3. Export service from `internal/index.ts`
4. Update any imports if needed
5. **Test**: Verify application starts without errors
6. **Test**: Verify auth endpoints work correctly
7. Only proceed to next service after all tests pass

**Internal Services to create (in order of complexity - simplest first):**

**2.1 RetryService** (Simplest - LoggingService only)

- **File**: `internal/retry.service.ts`
- **Dependencies**: LoggingService only
- **Features**: 
  - Exponential backoff retry logic
  - Configurable retry attempts and delays
  - Retry on specific error types
  - Logging of retry attempts
- **Integration**: Add to module, export, test

**2.2 ConnectionLeakDetectorService** (LoggingService only)

- **File**: `internal/connection-leak-detector.service.ts`
- **Dependencies**: LoggingService only
- **Features**:
  - Monitor connection pool usage
  - Detect leaked connections
  - Alert on connection leaks
  - Automatic connection cleanup
- **Integration**: Add to module, export, test

**2.3 DatabaseAlertService** (LoggingService only)

- **File**: `internal/database-alert.service.ts`
- **Dependencies**: LoggingService only
- **Features**:
  - Alert on critical database issues
  - Alert on connection pool exhaustion
  - Alert on slow queries
  - Alert on error rate spikes
- **Integration**: Add to module, export, test

**2.4 SQLInjectionPreventionService** (ConfigService, LoggingService)

- **File**: `internal/sql-injection-prevention.service.ts`
- **Dependencies**: ConfigService, LoggingService
- **Features**:
  - SQL injection pattern detection
  - Query sanitization
  - Parameterized query enforcement
  - Security event logging
- **Integration**: Add to module, export, test

**2.5 DataMaskingService** (ConfigService, LoggingService)

- **File**: `internal/data-masking.service.ts`
- **Dependencies**: ConfigService, LoggingService
- **Features**:
  - HIPAA-compliant data masking
  - PHI field masking
  - Configurable masking rules
  - Audit logging of masked data access
- **Integration**: Add to module, export, test

**2.6 QueryCacheService** (CacheService, LoggingService)

- **File**: `internal/query-cache.service.ts`
- **Dependencies**: CacheService, LoggingService
- **Features**:
  - Query result caching
  - Intelligent cache invalidation
  - Cache key generation
  - Cache hit/miss metrics
- **Integration**: Add to module, export, test

**2.7 RowLevelSecurityService** (PrismaService, ConfigService, LoggingService)

- **File**: `internal/row-level-security.service.ts`
- **Dependencies**: PrismaService, ConfigService, LoggingService
- **Features**:
  - Row-level security enforcement
  - Multi-tenant data isolation
  - Clinic-based access control
  - Security policy enforcement
- **Integration**: Add to module, export, test

**2.8 ReadReplicaRouterService** (PrismaService, ConfigService, LoggingService)

- **File**: `internal/read-replica-router.service.ts`
- **Dependencies**: PrismaService, ConfigService, LoggingService
- **Features**:
  - Intelligent read replica routing
  - Load balancing across replicas
  - Replica health monitoring
  - Automatic failover
- **Integration**: Add to module, export, test

**2.9 DatabaseHealthMonitorService** (PrismaService, ConfigService, LoggingService)

- **File**: `internal/database-health-monitor.service.ts`
- **Dependencies**: PrismaService, ConfigService, LoggingService
- **Features**:
  - Continuous health monitoring
  - Connection pool health checks
  - Query performance monitoring
  - Auto-recovery mechanisms
- **Integration**: Add to module, export, test

**2.10 ClinicRateLimiterService** (CacheService, ConfigService, LoggingService)

- **File**: `internal/clinic-rate-limiter.service.ts`
- **Dependencies**: CacheService (for rate limiting), ConfigService, LoggingService
- **Features**:
  - Rate limiting per clinic
  - Configurable rate limits
  - Burst protection
  - Rate limit violation logging
- **Integration**: Add to module, export, test

### Phase 3: Reorganize Query Directory

**Goal**: Move repositories and scripts to `database/query/` structure

**Tasks** (one at a time, test after each):

1. **3.1 Create directories**

   - Create `query/repositories/` directory (if not exists)
   - Create `query/scripts/` directory (if not exists)

2. **3.2 Move base.repository.ts**

   - Move: `repositories/base.repository.ts` → `query/repositories/base.repository.ts`
   - Update: All imports referencing base.repository
   - **Test**: App starts, auth endpoints work

3. **3.3 Move user.repository.ts**

   - Move: `repositories/user.repository.ts` → `query/repositories/user.repository.ts`
   - Update: All imports referencing user.repository
   - **Test**: App starts, auth endpoints work

4. **3.4 Move simple-patient.repository.ts**

   - Move: `repositories/simple-patient.repository.ts` → `query/repositories/simple-patient.repository.ts`
   - Update: All imports referencing simple-patient.repository
   - **Test**: App starts, auth endpoints work

5. **3.5 Move connection-pool.manager.ts**

   - Move: `connection-pool.manager.ts` → `query/scripts/connection-pool.manager.ts`
   - Update: All imports referencing connection-pool.manager
   - **Test**: App starts, auth endpoints work

6. **3.6 Create index files**

   - Create `query/repositories/index.ts` (export all repositories)
   - Create `query/scripts/index.ts` (export connection-pool.manager)
   - **Test**: App starts, auth endpoints work

### Phase 4: Refactor Connection Pool Manager

**Goal**: Remove cross-dependencies, use only Layer 1 services

**Tasks**:

1. **4.1 Refactor connection-pool.manager.ts**

   - Remove dependency on HealthcareQueryOptimizerService
   - Remove dependency on EventService
   - Dependencies: Only PrismaService, ConfigService, LoggingService
   - Query optimization will be called by DatabaseService before passing to pool manager
   - **Test**: App starts, auth endpoints work

### Phase 5: Refactor Repositories

**Goal**: Remove dependencies on DatabaseService, use only Layer 1 services

**Tasks** (one at a time, test after each):

1. **5.1 Refactor base.repository.ts**

   - Remove dependency on HealthcareDatabaseClient (DatabaseService)
   - Dependencies: Only PrismaService, LoggingService, CacheService (optional)
   - All repository methods use PrismaService directly
   - DatabaseService will use repositories, not the other way around
   - **Test**: App starts, auth endpoints work

2. **5.2 Refactor user.repository.ts**

   - Remove dependency on DatabaseService via ModuleRef
   - Dependencies: Only PrismaService, LoggingService, CacheService (optional)
   - Use PrismaService directly for all operations
   - **Test**: App starts, auth endpoints work

3. **5.3 Refactor simple-patient.repository.ts**

   - Remove dependency on DatabaseService via ModuleRef
   - Remove dependency on ClinicIsolationService
   - Dependencies: Only PrismaService, LoggingService, CacheService (optional)
   - Use PrismaService directly for all operations
   - **Test**: App starts, auth endpoints work

### Phase 6: Create Query Patterns (Strategies, Middleware, Builders, Factories)

**Goal**: Implement design patterns following cache module structure

**6.1 Create Query Strategies** (Strategy Pattern - like cache/strategies/)
- Create `query/strategies/` directory
- Create `base-query.strategy.ts` - base strategy interface
- Create `read-query.strategy.ts` - read strategies (optimized, cached, replica)
- Create `write-query.strategy.ts` - write strategies (audit, critical, batch)
- Create `transaction-query.strategy.ts` - transaction strategies (optimistic, pessimistic)
- Create `query-strategy.manager.ts` - strategy manager (like CacheStrategyManager)
- Add to module, test after each

**6.2 Create Query Middleware** (Middleware Pattern - like cache/middleware/)
- Create `query/middleware/` directory
- Create `base-query.middleware.ts` - base middleware interface
- Create `query-middleware.interface.ts` - middleware interface
- Create `validation-query.middleware.ts` - query validation
- Create `metrics-query.middleware.ts` - query metrics tracking
- Create `security-query.middleware.ts` - SQL injection check, RLS enforcement
- Create `optimization-query.middleware.ts` - query optimization
- Create `query-middleware.chain.ts` - middleware chain (like CacheMiddlewareChain)
- Add to module, test after each

**6.3 Create Query Builders** (Builder Pattern - like cache/builders/)
- Create `query/builders/` directory
- Create `query-options.builder.ts` - query options builder (like CacheOptionsBuilder)
- Create `transaction-options.builder.ts` - transaction options builder
- Add to module, test

**6.4 Create Query Factories** (Factory Pattern - like cache/factories/)
- Create `query/factories/` directory
- Create `query-key.factory.ts` - query cache key factory (like CacheKeyFactory)
- Add to module, test

**6.5 Create Database Controller** (Optional - like cache/controllers/)
- Create `controllers/` directory
- Create `database.controller.ts` - health checks, metrics, admin operations
- Add to module, test

### Phase 7: Create New DatabaseService

**Goal**: Create DatabaseService that orchestrates ALL internal services and patterns

**Tasks**:

1. **7.1 Create database.service.ts**

   - File: `database.service.ts` (ROOT - same level as database.module.ts)
   - This is the NEW main public service (replaces HealthcareDatabaseClient)
   - Follows same pattern as CacheService

2. **7.2 Design DatabaseService interface**

   - Simple, clean API built directly on Prisma
   - Wraps Prisma operations with healthcare-specific features
   - Uses ALL internal services + strategies + middleware + builders
   - Follows SOLID principles

3. **7.3 Implement core methods**

   - `executeRead<T>(operation)` - uses ReadQueryStrategy, middleware chain, query optimization, caching
   - `executeWrite<T>(operation, auditInfo)` - uses WriteQueryStrategy, audit logging, data masking, RLS
   - `executeTransaction<T>(operation)` - uses TransactionQueryStrategy, retry logic, circuit breaker
   - `executeWithClinicContext<T>(clinicId, operation)` - uses clinic isolation, rate limiting
   - `executeBatch<T, U>(items, operation, options)` - uses batch strategy, concurrency control
   - `executeCritical<T>(operation, priority)` - uses critical write strategy for emergency operations

4. **7.4 Integrate ALL services and patterns**

   - Use CircuitBreakerService from @core/resilience
   - Use CacheService from @infrastructure/cache
   - Use LoggingService from @infrastructure/logging
   - Use GracefulShutdownService from @core/resilience
   - Use all internal services (query-optimizer, data-masking, RLS, etc.)
   - Use QueryStrategyManager for strategy selection
   - Use QueryMiddlewareChain for middleware execution
   - Use QueryOptionsBuilder for building query options
   - Use QueryKeyFactory for cache key generation
   - Use ConnectionPoolManager

5. **7.5 Ensure no circular dependencies**

   - DatabaseService depends on all services
   - No service depends on DatabaseService
   - Clean dependency graph

6. **Test**: App starts, auth endpoints work

### Phase 8: Update Database Module

**Goal**: Remove forwardRef, clean dependency injection, add all patterns

**Tasks**:

1. **8.1 Update database.module.ts**

   - Remove all `forwardRef()` wrappers (no longer needed)
   - Provider order (critical for dependency injection):

     1. PrismaService (from PrismaModule)
     2. All Layer 2 internal services (independent, no cross-deps):

        - RetryService
        - ConnectionLeakDetectorService
        - DatabaseAlertService
        - SQLInjectionPreventionService
        - DataMaskingService
        - QueryCacheService
        - RowLevelSecurityService
        - ReadReplicaRouterService
        - DatabaseHealthMonitorService
        - ClinicRateLimiterService
        - ClinicIsolationService
        - DatabaseMetricsService
        - QueryOptimizerService

     3. Query patterns (strategies, middleware, builders, factories):
        - QueryStrategyManager
        - QueryMiddlewareChain
        - QueryOptionsBuilder
        - QueryKeyFactory
        - Individual strategies (ReadQueryStrategy, WriteQueryStrategy, TransactionQueryStrategy)
        - Individual middleware (ValidationQueryMiddleware, MetricsQueryMiddleware, SecurityQueryMiddleware, OptimizationQueryMiddleware)

     4. ConnectionPoolManager
     5. DatabaseService - depends on everything above
     6. DatabaseController (optional - for admin endpoints)

   - No ModuleRef lazy injection needed
   - Clean, straightforward dependency injection
   - Follows same pattern as CacheModule

2. **Test**: App starts, auth endpoints work

### Phase 9: Update All Service Dependencies

**Goal**: Update all services to use new DatabaseService

**Tasks**:

1. **9.1 Find all services using DatabaseService/HealthcareDatabaseClient**

   - Search codebase for imports
   - List all affected files

2. **9.2 Update imports**

   - Update imports to use new DatabaseService from `@infrastructure/database`
   - Verify API compatibility (new service should have same public interface)

3. **9.3 Update any direct HealthcareDatabaseClient imports**

   - Replace with DatabaseService

4. **Test**: All auth endpoints work

### Phase 10: Remove HealthcareDatabaseClient

**Goal**: Remove old HealthcareDatabaseClient completely

**Tasks**:

1. **10.1 Remove clients/healthcare-database.client.ts**

   - Delete the file

2. **10.2 Remove clients/ directory**

   - Delete if empty

3. **10.3 Update database.module.ts**

   - Remove HealthcareDatabaseClient provider

4. **10.4 Update index.ts**

   - Remove HealthcareDatabaseClient export
   - Only export DatabaseService and DatabaseModule (like cache exports CacheService)

5. **10.5 Clean up any remaining references**

   - Search for any remaining references

6. **Test**: Full integration test of auth endpoints

### Phase 11: Final Cleanup and Documentation

**Goal**: Ensure everything is properly organized and documented

**Tasks**:

1. **11.1 Update README.md**

   - File: `README.md` (ROOT - same level as database.module.ts)
   - Document new architecture
   - Explain layered architecture
   - Document all services, strategies, middleware, builders, factories
   - Document design patterns used (Strategy, Middleware, Builder, Factory, Repository)

2. **11.2 Verify exports**

   - Verify all internal files are NOT exported in `index.ts`
   - Verify all query/strategies, query/middleware, query/builders, query/factories are NOT exported
   - Ensure only DatabaseService and DatabaseModule are exported publicly (like cache exports CacheService)

3. **11.3 Add JSDoc comments**

   - Add comprehensive JSDoc comments explaining the architecture
   - Document all public methods
   - Document design patterns

4. **11.4 Verify no circular dependencies**

   - Run dependency analysis
   - Verify clean dependency graph

5. **Test**: Complete test suite including auth endpoints

## Service Dependencies Summary

### Layer 2 Services (Internal) - Each Independent:

- **RetryService**: LoggingService
- **ConnectionLeakDetectorService**: LoggingService
- **DatabaseAlertService**: LoggingService
- **SQLInjectionPreventionService**: ConfigService, LoggingService
- **DataMaskingService**: ConfigService, LoggingService
- **QueryCacheService**: CacheService, LoggingService
- **RowLevelSecurityService**: PrismaService, ConfigService, LoggingService
- **ReadReplicaRouterService**: PrismaService, ConfigService, LoggingService
- **DatabaseHealthMonitorService**: PrismaService, ConfigService, LoggingService
- **ClinicRateLimiterService**: CacheService, ConfigService, LoggingService
- **ClinicIsolationService**: PrismaService, ConfigService, LoggingService
- **DatabaseMetricsService**: PrismaService, ConfigService, LoggingService
- **QueryOptimizerService**: PrismaService, LoggingService, ConfigService

### Layer 3: DatabaseService

- Depends on: PrismaService + ALL Layer 2 services + ConnectionPoolManager + CircuitBreakerService + CacheService + LoggingService + ConfigService + GracefulShutdownService

### Layer 4: Repositories

- Depends on: PrismaService, LoggingService, CacheService (optional)
- Used by: DatabaseService (not the other way around)

## Testing Strategy

After each phase and each file creation:

1. **Application Startup Test**: Verify application starts without errors
2. **TypeScript Compilation**: Verify no TypeScript errors
3. **Circular Dependency Check**: Verify no circular dependency warnings
4. **Import Resolution**: Check that all imports resolve correctly
5. **Auth Endpoint Test**: Verify auth endpoints work correctly
6. **Integration Test**: Run full integration test suite

## Benefits

- **No Circular Dependencies**: Clean dependency graph
- **Easier Testing**: Each service can be tested independently
- **Better Maintainability**: Clear architecture, easy to understand
- **No NestJS Workarounds**: No need for forwardRef, ModuleRef lazy injection
- **Proper Layering**: Follows standard software architecture principles
- **Enterprise-Grade**: Production-ready, scalable, maintainable
- **10M+ Users**: All services designed for high concurrency
- **SOLID Principles**: Follows all SOLID principles
- **DRY**: Reuses existing services, no duplicate code
- **KISS**: Simple, clear implementations

## Additional Patterns & Features (Beyond Folder Structure)

Following the cache module pattern, we can implement:

### 1. Strategy Pattern (query/strategies/)
- **ReadQueryStrategy**: Optimized read, cached read, replica read strategies
- **WriteQueryStrategy**: Audit write, critical write, batch write strategies
- **TransactionQueryStrategy**: Optimistic, pessimistic, read-only transaction strategies
- **QueryStrategyManager**: Manages and selects appropriate strategy (like CacheStrategyManager)

### 2. Middleware Pattern (query/middleware/)
- **ValidationQueryMiddleware**: Query validation before execution
- **MetricsQueryMiddleware**: Query metrics tracking
- **SecurityQueryMiddleware**: SQL injection check, RLS enforcement
- **OptimizationQueryMiddleware**: Query optimization
- **QueryMiddlewareChain**: Chain of Responsibility pattern (like CacheMiddlewareChain)

### 3. Builder Pattern (query/builders/)
- **QueryOptionsBuilder**: Build query options (like CacheOptionsBuilder)
  - Methods: forRead(), forWrite(), forTransaction(), forPHI(), forEmergency()
- **TransactionOptionsBuilder**: Build transaction options
  - Methods: optimistic(), pessimistic(), readOnly(), isolationLevel()

### 4. Factory Pattern (query/factories/)
- **QueryKeyFactory**: Generate cache keys for queries (like CacheKeyFactory)
  - Methods: forUser(), forPatient(), forAppointment(), forClinic()

### 5. Interceptor (Optional - in @core/interceptors/)
- **HealthcareDatabaseInterceptor**: Automatic query optimization, caching, metrics
  - Similar to HealthcareCacheInterceptor

### 6. Controller (Optional - controllers/)
- **DatabaseController**: Admin endpoints for health checks, metrics, management
  - Similar to CacheController

## Migration Strategy

1. Start with services that have no dependencies (already clean)
2. Create missing internal services one by one with integration and testing
3. Create query patterns (strategies, middleware, builders, factories) one by one
4. Refactor services with dependencies one by one
5. Update ConnectionPoolManager
6. Update Repositories
7. Create new DatabaseService to orchestrate everything (including patterns)
8. Update DatabaseModule to remove forwardRef and add all patterns
9. Update all service dependencies
10. Remove old HealthcareDatabaseClient
11. Final cleanup and documentation

This architecture ensures no circular dependencies, follows proper software engineering principles, uses proven design patterns (like cache module), and is optimized for 10M+ concurrent users with enterprise-grade features.