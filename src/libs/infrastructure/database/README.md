# Database Service

**Purpose:** Unified database service with Prisma, multi-tenant isolation, and
HIPAA compliance **Location:** `src/libs/infrastructure/database` **Status:** ✅
Production-ready

---

## Quick Start

###Installation

```bash
# No separate installation - part of main project
pnpm install

# Generate Prisma client
pnpm prisma:generate

# Run migrations
pnpm prisma:migrate:dev
```

### Basic Usage

```typescript
import { DatabaseService } from '@infrastructure/database';

@Injectable()
export class MyService {
  constructor(private readonly databaseService: DatabaseService) {}

  async example() {
    // Execute read query with multi-tenant isolation
    const result = await this.databaseService.executeHealthcareRead(
      async client => {
        return await client.user.findMany({
          where: { clinicId: 'clinic-123' },
        });
      }
    );

    // Execute write query with transaction
    await this.databaseService.executeHealthcareWrite(
      async client => {
        return await client.user.create({
          data: { email: 'user@example.com', clinicId: 'clinic-123' },
        });
      },
      {
        userId: 'user-id',
        action: 'CREATE',
        resourceType: 'User',
      }
    );
  }
}
```

---

## Key Features

- ✅ **Multi-Tenant Isolation** - Automatic clinic-based data isolation
- ✅ **Read Replicas** - Automatic read/write splitting for performance
- ✅ **Transaction Management** - ACID-compliant transactions
- ✅ **Query Optimization** - Built-in query performance monitoring
- ✅ **HIPAA Compliance** - Audit logging and data encryption
- ✅ **Connection Pooling** - Efficient connection management (500 max
  connections)
- ✅ **Health Monitoring** - Database health checks
- ✅ **Clinic Isolation Service** - Multi-tenant context management

---

## Architecture

```
DatabaseModule
├── database.service.ts           # Main service (single entry point)
├── database.module.ts
├── internal/
│   ├── clinic-isolation.service.ts  # Multi-tenant isolation
│   └── query-optimizer.ts
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── generated/client/
├── types/
│   └── database.types.ts
└── mappers/
    └── *.mapper.ts               # DB <-> Domain type mappers
```

**Consolidated Documentation:** 📖
[Complete Infrastructure Documentation](../../../INFRASTRUCTURE_DOCUMENTATION.md#database-infrastructure) -
Architecture, design decisions, cross-service patterns

### Database access rules

- **Single PrismaService:** There is one `PrismaService` (in
  `prisma/prisma.service.ts`). It is **internal** to this module and not
  exported.
- **Single public entry point:** All application code (services, controllers,
  health, video, users, appointments, etc.) must use **only** `DatabaseService`
  from `@infrastructure/database`.
- **Do not** import or inject `PrismaService` outside this database module.
  Health and readiness are obtained via `DatabaseService.getHealthStatus()`
  (used by `DatabaseHealthIndicator`).

---

## Usage Examples

### Example 1: Read Query with Multi-Tenant Isolation

```typescript
import { DatabaseService } from '@infrastructure/database';

async getUserData(userId: string, clinicId: string) {
  return await this.databaseService.executeHealthcareRead(
    async (client) => {
      // Automatically scoped to clinicId
      return await client.user.findUnique({
        where: {
          id: userId,
          clinicId, // Multi-tenant isolation
        },
        include: {
          appointments: true,
        },
      });
    }
  );
}
```

### Example 2: Write Query with Transaction

```typescript
async createUserWithProfile(userData: UserData, profileData: ProfileData) {
  return await this.databaseService.executeHealthcareWrite(
    async (client) => {
      // Transaction - both succeed or both fail
      return await client.$transaction(async (tx) => {
        const user = await tx.user.create({ data: userData });
        const profile = await tx.profile.create({
          data: { ...profileData, userId: user.id },
        });
        return { user, profile };
      });
    },
    {
      userId: 'system',
      action: 'CREATE',
      resourceType: 'User',
    }
  );
}
```

### Example 3: Read Replica for Analytics

```typescript
async getAnalytics(clinicId: string) {
  // Automatically uses read replica for read-only queries
  return await this.databaseService.executeHealthcareRead(
    async (client) => {
      return await client.appointment.groupBy({
        by: ['status'],
        where: { clinicId },
        _count: true,
      });
    }
  );
}
```

---

## Configuration

### Environment Variables

```env
# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/healthcare
DATABASE_READ_REPLICA_URL=postgresql://user:password@replica:5432/healthcare
DATABASE_POOL_SIZE=500
DATABASE_CONNECTION_TIMEOUT=5000
DATABASE_QUERY_TIMEOUT=30000

# Health Monitoring
DATABASE_HEALTH_CHECK_INTERVAL=60000
```

[Full environment variables guide](../../../docs/ENVIRONMENT_VARIABLES.md)

---

## Multi-Tenant Isolation

The DatabaseService automatically enforces multi-tenant isolation:

1. **Automatic Clinic Scoping**: All queries are scoped to the current clinic
   context
2. **Row-Level Security**: Database-level RLS policies (if enabled)
3. **Query Filtering**: Automatic `clinicId` filtering in queries
4. **Audit Logging**: All queries logged with clinic context

### How It Works

```typescript
// When you call executeHealthcareRead/Write, the service:
// 1. Extracts clinicId from context (ClinicGuard, request metadata)
// 2. Automatically adds clinicId filter to queries
// 3. Logs query with clinic context for audit
// 4. Uses read replica for read-only queries
```

---

## Transaction Management

### Simple Transaction

```typescript
await this.databaseService.executeHealthcareWrite(async client => {
  return await client.$transaction(async tx => {
    // All operations in transaction
    await tx.user.create({ data: userData });
    await tx.profile.create({ data: profileData });
  });
});
```

### Nested Transactions

```typescript
await this.databaseService.executeHealthcareWrite(async client => {
  return await client.$transaction(async tx => {
    // Outer transaction
    const user = await tx.user.create({ data: userData });

    await tx.$transaction(async innerTx => {
      // Nested transaction (savepoint)
      await innerTx.profile.create({
        data: { ...profileData, userId: user.id },
      });
    });

    return user;
  });
});
```

---

## Query Optimization

### Built-in Optimization

- **Connection Pooling**: Reuses connections efficiently (500 max)
- **Read Replicas**: Automatic read/write splitting
- **Query Timeout**: Prevents long-running queries (30s default)
- **Query Monitoring**: Tracks slow queries

### Best Practices

1. **Use Read Replicas**: Use `executeHealthcareRead` for read-only queries
2. **Batch Operations**: Group multiple operations in transactions
3. **Index Usage**: Ensure proper indexes on frequently queried fields
4. **Select Specific Fields**: Use `select` instead of `include` when possible

```typescript
// ✅ Good - Select specific fields
const user = await client.user.findUnique({
  where: { id },
  select: { id: true, name: true, email: true },
});

// ⚠️ Avoid - Include everything
const user = await client.user.findUnique({
  where: { id },
  include: { appointments: true, profile: true, sessions: true },
});
```

---

## Query Cache Tagging

`executeRead` results go through the normal cache layers (L1 in-memory -> L2
Dragonfly, L3 = the query itself) via `QueryCacheService` ->
`CacheService.cache()`. What decides how long an entry survives is its **tags**:

| Entry / event                                                                  | Tags                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read whose queries were all seen                                               | `read` + one `tbl:<table>` per table touched, incl. relations reached through `include` / `select` / `where` / `orderBy` / `_count` (e.g. `tbl:appointment`, `tbl:patient`) + `clinic:<id>` / `appointment:<id>` as before |
| Read that ran raw SQL, hit a nested cached read, or in which no query was seen | `read` + `database` (the old global tag)                                                                                                                                                                                   |
| `executeWrite` commit (and failure after a partial commit)                     | the tables it changed + `generateCacheTags(resourceType)` (which includes `database`)                                                                                                                                      |
| `executeTransaction` commit or failure                                         | the tables it changed + `database` (it used to invalidate nothing)                                                                                                                                                         |
| Service-opened `prisma.$transaction(...)`                                      | the tables it changed + `database`, once, after it commits                                                                                                                                                                 |
| Single write outside all of these (`db.prisma.<model>.create(...)`)            | the tables it changed + `database`                                                                                                                                                                                         |
| `delete` / `deleteMany` (also nested in `data`), raw SQL that writes           | `read` (empties the whole query cache): database cascades and raw SQL cannot be attributed to tables                                                                                                                       |
| `invalidateEntityCache(entity)`                                                | `generateCacheTags(entity)` + the entity's `tbl:` tag (any casing)                                                                                                                                                         |

Every write's invalidation runs again 2 s later ("double delete"), for reads
that were in flight in another process.

Table tags are `tbl:` + the snake_case model name (`HealthRecord` ->
`tbl:health_record`). The prefix keeps them apart from service-level entity tags
and out of the per-clinic collection-tag expansion. Raw SQL is classified by its
text (`$queryRaw` also runs `UPDATE ... RETURNING`): quoted text and
`FOR UPDATE` / `FOR SHARE` are ignored, and a statement that is only
`SELECT pg_advisory_xact_lock(...)` is not a write.

How the tables are known: `PrismaService` installs a Prisma query extension
(`internal/query-dependency-tracker.ts`) on the shared client and wraps
`$transaction`. Every Prisma operation reports its model and arguments;
`executeRead` / `executeWrite` / `executeTransaction` run the operation inside
an `AsyncLocalStorage` scope that collects them (nested scopes report to their
parents too). Relations are resolved with the generated client's DMMF; Json
fields are data and are not walked. The scope awaits the operation inside itself
because Prisma promises are lazy.

Safety rules:

- Anything that cannot be attributed to tables falls back to the global tags,
  never to no tags.
- A read does not store its result if one of its tables was invalidated while it
  was running - by this process or (via the `cache:invalidation` broadcast) by
  another one.
- Work that outlives its scope (fire-and-forget) is treated as outside it, so
  its writes are still invalidated.
- PHI entries (`hipaaCompliant`) live at most 60 s, whatever cache strategy the
  read asked for.
- Entries are stored in a type-preserving envelope (`QueryCacheService`
  encode/decode): an L2 (Dragonfly, JSON) hit returns real `Date` / `BigInt` /
  byte values, exactly as the query did, and a fresh object per hit. Entries
  without the envelope count as misses.
- `skipCacheInvalidation` skips all invalidation for that write, including its
  tables; use it only for tables that are never read through the cache.
- Each tag is invalidated once per pass, through
  `CacheService.invalidateCacheByTag` (L2 by tag, L1 cleared, cross-process
  broadcast). L1 does not track tags, so every write still clears the whole
  in-memory layer on every process; per-table tags help the L2 layer.

---

## Health Monitoring

### Health Check

```typescript
const health = await this.databaseService.getHealthStatus();
// Returns: { status: 'healthy' | 'degraded' | 'down', latency: number }
```

### Metrics

- Connection pool utilization
- Query latency (P50, P95, P99)
- Error rate
- Read replica lag

---

## Testing

```bash
# Run database service tests
pnpm test infrastructure/database

# Run with test database
DATABASE_URL=postgresql://localhost:5432/healthcare_test pnpm test

# Prisma Studio (database GUI)
pnpm prisma:studio
```

---

## Dependencies

### Required Services

- Prisma Client (generated from schema)
- LoggingService (for query logging)
- CacheService (for query result caching)

### Optional Services

- EventService (for database events)

---

## Events Emitted

| Event                                | Payload                         | Description                        |
| ------------------------------------ | ------------------------------- | ---------------------------------- |
| `database.query.slow`                | { query, duration, clinicId }   | When query exceeds threshold (30s) |
| `database.connection.pool.exhausted` | { poolSize, activeConnections } | When connection pool is full       |
| `database.health.degraded`           | { status, latency }             | When database health degrades      |

---

## Related Documentation

- [Complete Infrastructure Documentation](../../../INFRASTRUCTURE_DOCUMENTATION.md#database-infrastructure) -
  Architecture overview, design decisions
- [Database Guidelines](../../../.ai-rules/database.md) - Database best
  practices
- [Multi-Tenant Architecture](../../../.ai-rules/architecture.md) -
  Multi-tenancy patterns
- [System Architecture](../../../docs/architecture/SYSTEM_ARCHITECTURE.md) -
  Overall system design
- [Prisma Schema](./prisma/schema.prisma) - Database schema definition

---

## Troubleshooting

### Common Issues

**Issue 1: Connection Pool Exhausted**

- **Cause:** Too many concurrent connections
- **Solution:** Increase `DATABASE_POOL_SIZE` or optimize connection usage
  ```env
  DATABASE_POOL_SIZE=1000  # Increase from default 500
  ```

**Issue 2: Slow Queries**

- **Cause:** Missing indexes or inefficient queries
- **Solution:** Check query execution plan, add indexes, optimize query

  ```bash
  # Check slow query logs
  pnpm logs:slow-queries

  # Analyze query plan
  EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'test@example.com';
  ```

**Issue 3: Read Replica Lag**

- **Cause:** High write load or network latency
- **Solution:** Monitor replica lag, consider additional replicas
  ```bash
  # Check replica lag
  SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) AS lag_seconds;
  ```

**Issue 4: Multi-Tenant Isolation Not Working**

- **Cause:** Missing `clinicId` in context
- **Solution:** Ensure `ClinicGuard` is applied or `clinicId` is in request
  metadata
  ```typescript
  // Apply ClinicGuard to controller
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
  export class MyController {
    /* ... */
  }
  ```

**Issue 5: Prisma Client Not Generated**

- **Cause:** Prisma client not generated after schema changes
- **Solution:** Regenerate Prisma client
  ```bash
  pnpm prisma:generate
  ```

---

## Prisma Commands

```bash
# Generate Prisma client
pnpm prisma:generate

# Create migration
pnpm prisma:migrate:dev

# Apply migrations (production)
pnpm prisma:migrate

# Push schema changes (dev only)
pnpm prisma:db:push

# Open Prisma Studio
pnpm prisma:studio

# Format schema
pnpm prisma:format

# Seed database
pnpm seed:dev
```

---

## Contributing

See main [README.md](../../../../README.md) for contribution guidelines.
