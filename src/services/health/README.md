# Health Service

**Purpose:** System health monitoring and diagnostics **Location:**
`src/services/health` **Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { HealthService } from '@services/health';

@Injectable()
export class MyService {
  constructor(private readonly healthService: HealthService) {}

  async checkHealth() {
    return await this.healthService.check();
  }
}
```

---

## Key Features

- ✅ **5 Health Indicators** - Database, Cache, Queue, Logging, Video
- ✅ **Metrics Collection** - CPU, memory, disk usage
- ✅ **Service Status** - Real-time service health
- ✅ **Public Endpoints** - For load balancers/monitoring
- ⚠️ **Note:** Communication and email health checks are clinic-specific and
  should be handled at the clinic level, not in system health checks

---

## Health Indicators (5)

1. **DatabaseHealthIndicator** - Database connection status
2. **CacheHealthIndicator** - Redis/cache health
3. **QueueHealthIndicator** - BullMQ queue status
4. **LoggingHealthIndicator** - Logging service health
5. **VideoHealthIndicator** - Video service health

**Note:** Communication and email health checks are removed from system health
monitoring as they are clinic-specific configurations. Each clinic may have
different communication service providers and configurations, so these should be
monitored at the clinic level.

---

## Configuration

### Health Indicators Status

All health indicators are properly registered in `HealthModule` and connected to
their respective services:

#### 1. **DatabaseHealthIndicator** ✅

- **Service**: `DatabaseService` (from `DatabaseModule`)
- **Method**: `databaseService.getHealthStatus()`
- **Status**: ✅ Connected
- **Module**: `DatabaseModule` exports `DatabaseService` (global)
- **Health Monitor**: Uses internal `DatabaseHealthMonitorService` via
  `DatabaseService`

#### 2. **CacheHealthIndicator** ✅

- **Service**: `CacheHealthMonitorService` (from `CacheModule`)
- **Method**: `cacheHealthMonitor.getHealthStatus()`
- **Status**: ✅ Connected
- **Module**: `CacheModule` exports `CacheHealthMonitorService` (global)
- **Dependencies**: `CacheService` (injected with `forwardRef`)

#### 3. **QueueHealthIndicator** ✅

- **Service**: `QueueHealthMonitorService` (from `QueueModule`)
- **Method**: `queueHealthMonitor.getHealthStatus()`
- **Status**: ✅ Connected
- **Module**: `QueueModule` exports `QueueHealthMonitorService` (global)

#### 4. **LoggingHealthIndicator** ✅

- **Service**: `LoggingHealthMonitorService` (from `LoggingModule`)
- **Method**: `loggingHealthMonitor.getHealthStatus()`
- **Status**: ✅ Connected
- **Module**: `LoggingModule` exports `LoggingHealthMonitorService` (global)

#### 5. **VideoHealthIndicator** ✅

- **Service**: `VideoService` (from `VideoModule`)
- **Method**: `videoService.getHealthStatus()`
- **Status**: ✅ Connected
- **Module**: `VideoModule` exports `VideoService` (with `forwardRef` to break
  circular dependency)

### Module Dependencies

All required modules are properly imported in `HealthModule`:

```typescript
@Module({
  imports: [
    ConfigModule,              // ✅ Global - ConfigService available
    HttpModule,                // ✅ HTTP client for health checks
    DatabaseModule,            // ✅ Global - DatabaseService available (forwardRef)
    CacheModule,               // ✅ Global - CacheHealthMonitorService available
    QueueModule,               // ✅ Global - QueueHealthMonitorService available
    LoggingModule,             // ✅ Global - LoggingHealthMonitorService available
    SocketModule,              // ✅ Socket.IO for realtime health
    ErrorsModule,              // ✅ Error handling
    VideoModule,               // ✅ VideoService available (forwardRef)
  ],
  providers: [
    HealthService,             // ✅ Main health service
    DatabaseHealthIndicator,   // ✅ Registered
    CacheHealthIndicator,      // ✅ Registered
    QueueHealthIndicator,      // ✅ Registered
    LoggingHealthIndicator,    // ✅ Registered
    VideoHealthIndicator,      // ✅ Registered
    // ... realtime health services
  ],
})
```

### Health Service Injection

All health indicators are properly injected in `HealthService`:

```typescript
constructor(
  @Optional() private readonly databaseHealthIndicator?: DatabaseHealthIndicator,
  @Optional() private readonly cacheHealthIndicator?: CacheHealthIndicator,
  @Optional() private readonly queueHealthIndicator?: QueueHealthIndicator,
  @Optional() private readonly loggingHealthIndicator?: LoggingHealthIndicator,
  @Optional() private readonly videoHealthIndicator?: VideoHealthIndicator,
  // ... other services
) {}
```

### Health Check Flow

1. **HealthService.getHealth()** is called
2. **performHealthCheck()** runs all health indicators:
   - Checks cache for fresh status (15s TTL)
   - Runs health checks for services without fresh cache
   - Uses `Promise.allSettled()` to run checks in parallel
   - Processes results and logs through `LoggingService`
3. **Video health** is checked separately (optional service)
4. **Results** are aggregated and returned

### Logging Integration

✅ **All logging uses centralized LoggingService**:

- Health check failures → `LoggingService.log(LogType.ERROR, ...)`
- Status changes → `LoggingService.log(LogType.SYSTEM, ...)`
- Video failures (optional) →
  `LoggingService.log(LogType.SYSTEM, LogLevel.WARN, ...)`
- No `console.error` calls - all logs go through `LoggingService`

### Terminus Removal

✅ **All Terminus dependencies removed**:

- `TerminusModule` removed from `HealthModule`
- `TerminusModule` removed from `VideoModule`
- `TerminusModule` removed from `CommunicationModule`
- `HealthCheckService` removed from `HealthService`
- `HealthCheckService` removed from `VideoController`
- Custom types created: `HealthIndicatorResult`, `HealthCheckError`
- Custom `BaseHealthIndicator` (no Terminus dependency)

### Configuration Verification Checklist

- [x] All health indicators registered in `HealthModule`
- [x] All health indicators injected in `HealthService`
- [x] All required modules imported in `HealthModule`
- [x] All health monitor services exported from their modules
- [x] All health checks use `LoggingService` for logging
- [x] No Terminus dependencies remaining
- [x] Health checks run in parallel with `Promise.allSettled()`
- [x] Video health checked separately (optional service)
- [x] Caching implemented (15s TTL for fresh status)
- [x] Error handling with graceful degradation

### Configuration Summary

✅ **All services are properly configured and connected for health checks.**

The health system:

- Uses only `LoggingService` (per `.ai-rules/` coding standards)
- Has zero Terminus dependencies
- Runs health checks in parallel for performance
- Caches results to reduce load
- Handles optional services (video) gracefully
- Logs all events through centralized `LoggingService`

---

## Logging Verification

### ✅ All Health Checks Use LoggingService (No Terminus)

**Status:** ✅ **COMPLETE** - All health check logging uses centralized
`LoggingService` (per `.ai-rules/` coding standards)

### LoggingService Usage in Health Service

#### HealthService (`health.service.ts`)

✅ **47 instances** of `LoggingService` usage found:

- Health check failures → `LoggingService.log(LogType.ERROR, ...)`
- Status changes → `LoggingService.log(LogType.SYSTEM, ...)`
- Video failures (optional) →
  `LoggingService.log(LogType.SYSTEM, LogLevel.WARN, ...)`
- Background monitoring → `LoggingService.log(...)`
- Error handling → `LoggingService.log(...)`

**Examples:**

```typescript
// Health check failed
void this.loggingService?.log(
  LogType.SYSTEM,
  LogLevel.ERROR,
  `Health check failed for ${serviceKey}`,
  'HealthService',
  { service: serviceKey, error: errorMessage }
);

// Status change detection
void this.loggingService?.log(
  isOptionalServiceError ? LogType.SYSTEM : LogType.ERROR,
  isOptionalServiceError ? LogLevel.WARN : LogLevel.ERROR,
  isOptionalServiceError
    ? `Health check: Optional service (video) unavailable. Core services are healthy.`
    : `Health check failed: ${errorMessage}`,
  'HealthService',
  { error: errorMessage, stack: errorStack, ... }
);
```

### Realtime Health Services

- **HealthAggregatorService** ✅ Uses `LoggingService` for aggregation errors
- **HealthSchedulerService** ✅ Uses `LoggingService` for scheduling errors (7
  instances)
- **HealthCacheService** ✅ Uses `LoggingService` for cache errors (4 instances)
- **HealthBroadcasterService** ✅ Uses `LoggingService` for broadcast errors (3
  instances)

### Health Checkers

✅ All checkers use `LoggingService`:

- `SocketHealthChecker` → `LoggingService`
- `SystemHealthChecker` → `LoggingService`
- `DatabaseHealthChecker` → `LoggingService`
- `QueueHealthChecker` → `LoggingService`
- `CacheHealthChecker` → `LoggingService`

- **ChangeDetectorService** ✅ Uses `LoggingService` for change detection

### Health Indicators Architecture

Health indicators **do not log directly**. Instead:

1. Health indicators throw `HealthCheckError` when unhealthy
2. `HealthService` catches these errors
3. `HealthService` logs through `LoggingService`

This is the **correct architecture** because:

- ✅ Centralized logging control
- ✅ Consistent log format
- ✅ Single source of truth for health logging
- ✅ Follows `.ai-rules/` coding standards

### Health Indicators (No Direct Logging)

- `DatabaseHealthIndicator` - Throws errors, logged by `HealthService`
- `CacheHealthIndicator` - Throws errors, logged by `HealthService`
- `QueueHealthIndicator` - Throws errors, logged by `HealthService`
- `LoggingHealthIndicator` - Throws errors, logged by `HealthService`
- `VideoHealthIndicator` - Throws errors, logged by `HealthService` (optional
  service)

### Console Usage

#### Backend Code

✅ **Zero `console.log` or `console.error` calls** in health service code

#### Frontend Documentation

⚠️ `FRONTEND_INTEGRATION.md` contains `console.log` examples - **This is
intentional**:

- These are **frontend code examples** for developers
- Frontend applications use `console.log` for debugging
- Backend uses `LoggingService` (as verified above)

### Terminus Removal

✅ **All Terminus dependencies removed:**

- `TerminusModule` removed from all modules
- `HealthCheckService` removed from all services
- Custom types created (`HealthIndicatorResult`, `HealthCheckError`)
- Custom `BaseHealthIndicator` (no Terminus dependency)
- All logging uses `LoggingService`

### Verification Checklist

- [x] All health check logging uses `LoggingService`
- [x] Zero `console.log`/`console.error` in backend code
- [x] Health indicators throw errors (logged by `HealthService`)
- [x] All realtime health services use `LoggingService`
- [x] All health checkers use `LoggingService`
- [x] Zero Terminus dependencies
- [x] Documentation updated (README.md)
- [x] Architecture follows `.ai-rules/` coding standards

### Summary

✅ **All health checks use `LoggingService` instead of Terminus.**

The health system:

- Uses **only** `LoggingService` for all logging (per `.ai-rules/` coding
  standards)
- Has **zero** Terminus dependencies
- Has **zero** `console.log`/`console.error` calls in backend code
- Follows centralized logging architecture
- All errors are logged through `LoggingService` with proper log types and
  levels

**Status:** ✅ **VERIFIED** - All health check logging uses `LoggingService`

---

## API Endpoints

| Endpoint                      | Method    | Role   | Description                                                                               |
| ----------------------------- | --------- | ------ | ----------------------------------------------------------------------------------------- |
| `/health`                     | GET       | Public | Basic health check (HealthService-based, includes realtime status)                        |
| `/health?detailed=true`       | GET       | Public | Detailed health check with system metrics (HealthService-based, includes realtime status) |
| Socket.IO `/health` namespace | WebSocket | Public | Real-time health updates via push (recommended for dashboards)                            |

**Note:** All REST endpoints and Socket.IO realtime health monitoring use
`HealthService` which uses health indicators with LoggingService (no Terminus
dependency). The `HealthService` is the single source of truth for health status
throughout the application.

## Architecture

```
┌─────────────────────────────────────────┐
│         HealthController                │
│  (Uses HealthService)                   │
│  - GET /health                          │
│  - GET /health?detailed=true           │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         HealthService                    │
│  (Uses LoggingService - no Terminus)     │
│  - getHealth() → includes realtime      │
│  - getDetailedHealth() → includes realtime│
└──────────────┬──────────────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌──────────────┐  ┌──────────────┐
│   Health     │  │ HealthCache  │
│   Indicators │  │ Service      │
│   (Logging)  │  │ (Realtime)   │
└──────────────┘  └──────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│    RealtimeHealthGateway (Socket.IO)    │
│  (Uses HealthService via Aggregator)    │
│  - Socket.IO /health namespace         │
└─────────────────────────────────────────┘
```

---

## Usage Examples

```typescript
// Basic health check
const health = await this.healthService.check();
// Returns: { status: 'ok', info: {}, error: {} }

// Detailed health check
const detailed = await this.healthService.checkDetailed();
// Returns: {
//   status: 'ok',
//   info: {
//     database: { status: 'up', ... },
//     cache: { status: 'up', ... },
//     ...
//   }
// }
```

---

## Related Documentation

- [Frontend Integration Guide](./FRONTEND_INTEGRATION.md) - Complete guide for
  integrating Socket.IO realtime health monitoring in frontend applications
- [System Architecture](../../docs/architecture/SYSTEM_ARCHITECTURE.md)

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
