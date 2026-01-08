# Logging Service

**Purpose:** HIPAA-compliant structured logging with audit trails, pagination,
and enterprise-grade features  
**Location:** `src/libs/infrastructure/logging`  
**Status:** ✅ Production-ready with all improvements implemented

---

## Quick Start

```typescript
import { LoggingService, LogType, LogLevel } from '@logging';

@Injectable()
export class MyService {
  constructor(private readonly logger: LoggingService) {}

  async example() {
    // Simple logging
    await this.logger.log(
      LogType.AUDIT,
      LogLevel.INFO,
      'User logged in',
      'MyService',
      { userId: 'user123' }
    );

    // Get paginated logs
    const result = await this.logger.getLogs(
      LogType.AUDIT,
      new Date('2024-01-01'),
      new Date('2024-01-31'),
      LogLevel.INFO,
      1, // page
      50 // limit
    );
    console.log(result.logs); // Array of logs
    console.log(result.meta.total); // Total count
  }
}
```

---

## Key Features

- ✅ **HIPAA-Compliant** - PHI masking, audit trails, 30-day retention
- ✅ **Structured Logging** - JSON format with context
- ✅ **Multiple Log Types** - AUDIT, SECURITY, PERFORMANCE, PAYMENT, etc.
- ✅ **Log Levels** - DEBUG, INFO, WARN, ERROR, FATAL
- ✅ **Context Propagation** - Automatic request context injection
- ✅ **Health Monitoring** - Log volume tracking
- ✅ **Web Dashboard** - Real-time log viewing at `/logger`
- ✅ **Pagination Support** - Database-level pagination for scalability
- ✅ **Input Validation** - DTOs with class-validator
- ✅ **Rate Limiting** - 100 req/min for reads, 10 req/min for destructive ops
- ✅ **Type Safety** - Proper interfaces (LogEntry, EventEntry)
- ✅ **Error Tracking** - Internal error metrics and observability
- ✅ **Search Functionality** - Full-text search in messages
- ✅ **Multi-tenant** - Clinic filtering and isolation

---

## API Endpoints

### 1. Get Paginated Logs

```http
GET /logger/logs/data?type=ERROR&level=ERROR&page=1&limit=50&search=error
```

**Query Parameters:**

- `type` (optional): LogType enum (SYSTEM, SECURITY, AUDIT, etc.)
- `level` (optional): LogLevel enum (DEBUG, INFO, WARN, ERROR, FATAL)
- `startTime` (optional): ISO 8601 date string
- `endTime` (optional): ISO 8601 date string
- `page` (optional): Page number (default: 1, min: 1)
- `limit` (optional): Items per page (default: 100, min: 1, max: 1000)
- `search` (optional): Search term to filter by message content

**Response:**

```json
{
  "logs": [
    {
      "id": "log-123",
      "type": "ERROR",
      "level": "ERROR",
      "message": "Operation failed",
      "context": "MyService",
      "metadata": { "userId": "user123" },
      "timestamp": "2024-01-01T00:00:00Z",
      "clinicId": "CL0001",
      "userId": "user123"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  }
}
```

**Rate Limit:** 100 requests per minute

---

### 2. Get Paginated Events

```http
GET /logger/events/data?type=user.loggedIn&page=1&limit=50
```

**Query Parameters:**

- `type` (optional): Event type string
- `page` (optional): Page number (default: 1, min: 1)
- `limit` (optional): Items per page (default: 100, min: 1, max: 1000)

**Response:**

```json
{
  "events": [
    {
      "id": "event-123",
      "type": "user.loggedIn",
      "data": { "userId": "user123" },
      "timestamp": "2024-01-01T00:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 100,
    "totalPages": 2,
    "hasNext": true,
    "hasPrev": false
  }
}
```

**Rate Limit:** 100 requests per minute

---

### 3. Get Clinic-Filtered Logs

```http
GET /logger/logs/clinic/CL0001?type=ERROR&page=1&limit=50
```

**Path Parameters:**

- `clinicId`: Clinic ID (UUID or CL#### format)

**Query Parameters:** Same as Get Paginated Logs

**Response:** Same format as Get Paginated Logs, filtered by clinic

**Rate Limit:** 100 requests per minute

---

### 4. Clear Logs

```http
POST /logger/logs/clear
Content-Type: application/json

{
  "clearDatabase": false
}
```

**Body Parameters:**

- `clearDatabase` (optional): Boolean, default: false
  - `false`: Clear cache only (preserves database audit trail)
  - `true`: Clear both cache and database (destructive operation)

**Response:**

```json
{
  "success": true,
  "message": "Logs cleared successfully from cache (database audit trail preserved)"
}
```

**Rate Limit:** 10 requests per minute (more restrictive for destructive
operation)

---

### 5. Clear Events

```http
POST /logger/events/clear
```

**Response:**

```json
{
  "success": true,
  "message": "Events cleared successfully"
}
```

---

## Log Types

```typescript
enum LogType {
  SYSTEM = 'SYSTEM',
  SECURITY = 'SECURITY',
  AUDIT = 'AUDIT',
  PERFORMANCE = 'PERFORMANCE',
  PAYMENT = 'PAYMENT',
  COMMUNICATION = 'COMMUNICATION',
  QUEUE = 'QUEUE',
  CACHE = 'CACHE',
  DATABASE = 'DATABASE',
  API = 'API',
  ERROR = 'ERROR',
  RESPONSE = 'RESPONSE',
  USER_ACTIVITY = 'USER_ACTIVITY',
  EMERGENCY = 'EMERGENCY',
}
```

---

## Usage Examples

### Example 1: Audit Logging

```typescript
await this.logger.log(
  LogType.AUDIT,
  LogLevel.INFO,
  'Patient record accessed',
  'EHRService',
  {
    userId: context.user.id,
    clinicId: context.clinicId,
    patientId: 'patient123',
    action: 'READ',
    timestamp: new Date().toISOString(),
  }
);
```

### Example 2: Error Logging

```typescript
try {
  await this.performOperation();
} catch (error) {
  await this.logger.log(
    LogType.ERROR,
    LogLevel.ERROR,
    'Operation failed',
    'MyService',
    {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { userId, clinicId },
    }
  );
  throw error;
}
```

### Example 3: Performance Logging

```typescript
const start = Date.now();
const result = await this.databaseService.query(/* ... */);
const duration = Date.now() - start;

if (duration > 1000) {
  await this.logger.log(
    LogType.PERFORMANCE,
    LogLevel.WARN,
    'Slow database query',
    'DatabaseService',
    { query, duration, threshold: 1000 }
  );
}
```

### Example 4: Get Paginated Logs with Search

```typescript
const result = await this.logger.getLogs(
  LogType.ERROR,
  new Date('2024-01-01'),
  new Date('2024-01-31'),
  LogLevel.ERROR,
  1, // page
  50, // limit
  'database' // search term
);

console.log(`Found ${result.meta.total} logs`);
console.log(`Page ${result.meta.page} of ${result.meta.totalPages}`);
result.logs.forEach(log => {
  console.log(log.message);
});
```

### Example 5: Get Clinic-Specific Logs

```typescript
const result = await this.logger.getLogsByClinic(
  'CL0001',
  LogType.AUDIT,
  new Date('2024-01-01'),
  new Date('2024-01-31'),
  LogLevel.INFO,
  1, // page
  50 // limit
);
```

---

## Configuration

```env
# Logging Configuration
LOG_LEVEL=info                    # debug, info, warn, error, fatal
LOG_RETENTION_DAYS=30
LOG_PHI_MASKING=true
LOG_MAX_SIZE=100MB
```

---

## PHI Masking

The logging service automatically masks sensitive PHI data:

```typescript
// Input
this.logger.log(LogType.AUDIT, LogLevel.INFO, 'User data', 'MyService', {
  email: 'patient@example.com',
  ssn: '123-45-6789',
  phone: '555-1234',
});

// Logged as
{
  email: 'p******@example.com',
  ssn: '***-**-****',
  phone: '***-****',
}
```

---

## Architecture

### Module Structure

**Two separate modules prevent duplicate controller registration:**

1. **`LoggingModule`** (`@Global()`)
   - Provides `LoggingService` and `LoggingHealthMonitorService`
   - Can be imported multiple times safely (services are singletons)
   - Used by 40+ modules across the application

2. **`LoggingControllersModule`** (Regular module)
   - Contains `LoggingController`
   - Imported only once in `AppModule`
   - Prevents duplicate route registration

**Why separate?** If `LoggingController` was in `LoggingModule`, it would be
registered 40+ times (once per import), causing duplicate routes and breaking
the application.

### Log Storage

**Dual Storage Architecture:**

1. **Redis Cache** (Primary - Fast Access)
   - Stores complete log entries with all metadata
   - Fast access for dashboard
   - Keeps last 5000 logs for performance
   - Used for real-time viewing

2. **PostgreSQL Database** (Persistence - Audit Trail)
   - Persistent storage for compliance
   - HIPAA-compliant audit trail
   - Long-term retention
   - Used for compliance reporting

**Log Retrieval:**

- Combines logs from both sources
- Deduplicates by ID
- Filters by type, level, time range, search
- Sorted by timestamp (newest first)
- Paginated for performance

---

## Type Safety

**Proper interfaces replace `unknown[]` - All types are centralized in
`@core/types`:**

```typescript
import {
  LogEntry,
  EventEntry,
  PaginatedLogsResult,
  PaginatedEventsResult,
} from '@core/types';
```

**Type Definitions:**

- `LogEntry` - Log entry interface (defined in `@core/types/logging.types.ts`)
- `EventEntry` - Event entry interface (defined in
  `@core/types/logging.types.ts`)
- `PaginatedLogsResult` - Paginated logs response (defined in
  `@core/types/logging.types.ts`)
- `PaginatedEventsResult` - Paginated events response (defined in
  `@core/types/logging.types.ts`)

All types follow `.ai-rules/` coding standards and are centralized for
consistency.

---

## Error Tracking

**Internal error observability:**

- Tracks error counts by key
- Records last error time
- Identifies critical error patterns (>10 occurrences in 1 minute)
- Used for debugging and monitoring

---

## Performance Optimizations

**Implemented for 1M+ users:**

- ✅ Database-level pagination (`skip`/`take`)
- ✅ Cache-level pagination with proper range queries
- ✅ Optimized cache keys including pagination and search
- ✅ Memory-efficient filtering
- ✅ Proper type safety

---

## Rate Limiting

**Protection against abuse:**

- `GET /logger/logs/data`: 100 requests/minute
- `GET /logger/events/data`: 100 requests/minute
- `GET /logger/logs/clinic/:clinicId`: 100 requests/minute
- `POST /logger/logs/clear`: 10 requests/minute (destructive operation)

---

## Input Validation

**DTOs with class-validator:**

- `type`: Must be valid `LogType` enum
- `level`: Must be valid `LogLevel` enum
- `startTime`/`endTime`: Must be valid ISO 8601 date strings
- `page`: Integer, minimum 1
- `limit`: Integer, minimum 1, maximum 1000
- `search`: String (optional)

**Benefits:**

- Type safety
- Better error messages
- Prevents invalid queries
- API documentation via Swagger

---

## Breaking Changes

⚠️ **API Response Format Changed:**

**Old:**

```typescript
const logs = await getLogs();
logs.forEach(log => { ... });
```

**New:**

```typescript
const result = await getLogs();
result.logs.forEach(log => { ... });
result.meta.total; // Total count
result.meta.page; // Current page
result.meta.hasNext; // Has next page
```

---

## Related Documentation

- [Complete Infrastructure Documentation](../../../INFRASTRUCTURE_DOCUMENTATION.md#logging)
- [HIPAA Compliance](../../../docs/DEVELOPER_GUIDE.md#hipaa-compliance)

---

## Troubleshooting

**Issue 1: Logs not appearing**

- Check `LOG_LEVEL` setting
- Verify LoggingModule is imported
- Check database connection

**Issue 2: Pagination not working**

- Verify `page` and `limit` parameters are valid
- Check database query performance
- Review cache configuration

**Issue 3: Rate limit exceeded**

- Reduce request frequency
- Use pagination to fetch data in batches
- Implement client-side caching

**Issue 4: Disk space issues**

- Adjust `LOG_RETENTION_DAYS`
- Implement log rotation
- Clear old logs using `/logger/logs/clear`

---

## Contributing

See main [README.md](../../../../README.md) for contribution guidelines.
