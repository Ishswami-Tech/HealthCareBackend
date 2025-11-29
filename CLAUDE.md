# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **production-ready HIPAA-compliant healthcare backend** built with NestJS 11.x, Fastify 5.x, TypeScript 5.x, PostgreSQL 14+, and Redis 6.x. The system is designed for **1M+ concurrent users** with multi-tenant clinic isolation and specialized Ayurvedic healthcare features.

**Framework**: NestJS with Fastify (NOT Express)
**Database**: PostgreSQL with Prisma ORM 7.x
**Caching**: Redis with distributed partitioning
**Package Manager**: pnpm 9.15.4
**Architecture**: Multi-tenant, plugin-based, event-driven

## Quick Start Summary

### Essential Services (Inject these in most services):
```typescript
constructor(
  private readonly database: DatabaseService,      // DB access (NOT PrismaService)
  private readonly logger: LoggingService,         // Logging (NOT NestJS Logger)
  private readonly eventService: EventService,     // Events (NOT EventEmitter2)
  private readonly cache: CacheService,            // Cache (NOT RedisService)
  private readonly config: ConfigService,          // Config (from @config)
) {}
```

### Most Common Pattern:
```typescript
async createEntity(data: CreateDto, context?: RequestContext): Promise<Entity> {
  try {
    // 1. RBAC check
    await this.rbac.checkPermission(context?.user?.id, 'CREATE_ENTITY');

    // 2. Database operation
    const entity = await this.database.executeHealthcareWrite(
      async (client) => client.entity.create({ data }),
      { userId: context?.user?.id, action: 'CREATE', resourceType: 'Entity' }
    );

    // 3. Event emission
    await this.eventService.emitEnterprise('entity.created', {
      eventId: `entity-${entity.id}`,
      eventType: 'entity.created',
      category: EventCategory.SYSTEM,
      priority: EventPriority.NORMAL,
      timestamp: new Date().toISOString(),
      source: 'EntityService',
      version: '1.0.0',
      payload: { entity }
    });

    // 4. Logging
    this.logger.info('Entity created', { entityId: entity.id });

    return entity;
  } catch (error) {
    this.logger.error('Failed to create entity', { error });
    throw new HealthcareError(ErrorCodes.OPERATION_FAILED, 'Failed to create');
  }
}
```

## Commands

### Development
```bash
pnpm start:dev              # Start with hot-reload (port 8088)
pnpm build                  # Production build
pnpm build:dev              # Development build
pnpm type-check             # TypeScript type checking
```

### Database (Prisma)
```bash
pnpm prisma:generate        # Generate Prisma client (auto-runs on postinstall)
pnpm prisma:migrate:dev     # Create and apply migration
pnpm prisma:migrate         # Apply migrations (production)
pnpm prisma:db:push         # Push schema changes (dev only)
pnpm prisma:studio          # Open Prisma Studio (port 5555)
pnpm prisma:format          # Format schema.prisma
pnpm seed:dev               # Seed database (development)
```

**Important**: Prisma schema is at `src/libs/infrastructure/database/prisma/schema.prisma`. Generated client outputs to `src/libs/infrastructure/database/prisma/generated/client`.

### Validation & Quality
```bash
pnpm validate:all           # Run all validations (type, lint, format, security, etc.)
pnpm lint                   # Fix linting issues
pnpm lint:check             # Check linting (max 0 warnings)
pnpm format                 # Format code with Prettier
pnpm format:check           # Check formatting
pnpm security:audit         # Security audit
```

**Pre-commit**: `pnpm pre-commit` runs `validate:all`
**Pre-push**: `pnpm pre-push` runs `validate:build`

### Docker & Deployment
```bash
pnpm docker:up              # Start Docker services (PostgreSQL, Redis)
pnpm docker:down            # Stop Docker services
pnpm docker:rebuild         # Rebuild and restart containers
pnpm k8s:deploy             # Deploy to local Kubernetes
pnpm k8s:status             # Check Kubernetes status
pnpm k8s:logs               # View pod logs
```

### Testing & Health
```bash
pnpm health:check           # Health check endpoint (curl localhost:8088/health)
```

## Architecture

### Layered Architecture (Zero Circular Dependencies)

```
┌─────────────────────────────────────────────────┐
│  Presentation Layer (Controllers, Gateways)     │
│  src/services/*/controllers/, */gateways/       │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│  Application Layer (Services)                   │
│  src/services/*/services/                       │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│  Infrastructure Layer (Database, Cache, Queue)  │
│  src/libs/infrastructure/                       │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│  Core Layer (Shared Types, Utils, Business)     │
│  src/libs/core/                                 │
└─────────────────────────────────────────────────┘
```

### Key Modules

**Services** (`src/services/`):
- `auth/` - Authentication (JWT, OTP, session management)
- `users/` - User management (15+ healthcare roles)
- `appointments/` - Appointment scheduling with plugin architecture
- `clinic/` - Multi-tenant clinic management
- `ehr/` - Electronic Health Records
- `billing/` - Billing and invoicing
- `notification/` - Multi-channel notifications
- `health/` - System health monitoring

**Infrastructure** (`src/libs/infrastructure/`):
- `database/` - DatabaseService (single entry point), Prisma, connection pooling
- `cache/` - Redis caching with SWR pattern
- `events/` - EventService (centralized event hub, NOT EventEmitter2)
- `queue/` - BullMQ with 19 specialized queues
- `logging/` - LoggingService (HIPAA-compliant, NOT NestJS Logger)

**Core** (`src/libs/core/`):
- `types/` - All shared domain types (single source of truth)
- `errors/` - HealthcareError, error codes
- `guards/` - JwtAuthGuard, RolesGuard, ClinicGuard
- `decorators/` - Custom decorators
- `rbac/` - Role-based access control
- `business-rules/` - Business rules engine

**Communication** (`src/libs/communication/`):
- `channels/email/` - Email service (SES, Mailtrap)
- `channels/whatsapp/` - WhatsApp Business API
- `channels/push/` - Push notifications (SNS)
- `channels/socket/` - WebSocket (Socket.IO)

### Path Aliases (MANDATORY)

**Always use path aliases, never relative imports**:

```typescript
// ✅ CORRECT
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@logging';
import { EventService } from '@infrastructure/events';
import { CacheService } from '@cache';
import { QueueService } from '@queue';
import { UserService } from '@services/users';
import { CreateUserDto } from '@dtos';
import type { RequestContext } from '@types';

// ❌ FORBIDDEN
import { UserService } from '../../../services/users/user.service';
```

**Available aliases** (see `tsconfig.json` paths):
- `@database/*` - Database infrastructure
- `@infrastructure/*` - All infrastructure
- `@services/*` - Domain services
- `@dtos/*` - Data transfer objects
- `@core/*` - Core utilities
- `@types/*` - Shared types (single source of truth)
- `@logging/*` - Logging service
- `@cache/*` - Cache service
- `@events/*` - Event service
- `@queue/*` - Queue service
- `@security/*` - Security utilities
- `@communication/*` - Communication channels
- `@config/*` - Configuration

## Critical Rules (ZERO TOLERANCE)

1. **NO `any` types** - Use proper interfaces/types from `@types/*`
2. **NO `unknown` types** - Use specific types or type guards
3. **NO relative imports** - Always use path aliases
4. **NO `console.log`** - Use `LoggingService` from `@logging`
5. **NO NestJS Logger** - Use custom `LoggingService`
6. **NO Express** - This is a Fastify application
7. **NO EventEmitter2 directly** - Use `EventService` (centralized event hub, single source of truth)
8. **NO missing error handling** - Always try-catch with `HealthcareError` from `@core/errors`
9. **NO missing input validation** - All DTOs must use class-validator
10. **NO missing RBAC checks** - All endpoints require guards
11. **NO RedisService directly** - Use `CacheService` (provider-agnostic: Redis/Dragonfly)
12. **NO @nestjs/config ConfigService** - Use enhanced `ConfigService` from `@config`
13. **NO PrismaService directly** - Use `DatabaseService` from `@infrastructure/database`
14. **NO ESLint rule disabling** - Fix issues properly, never use `eslint-disable`

## TypeScript Standards

- **Strict mode enabled**: All compiler strictness flags are ON
- **Explicit return types**: Every function must specify return type
- **Null safety**: Always handle null/undefined cases
- **Type imports**: Use `import type { ... }` for type-only imports

```typescript
// ✅ CORRECT
async function findUser(id: string): Promise<User | null> {
  if (!id) {
    throw new HealthcareError(ErrorCodes.INVALID_INPUT, 'User ID required');
  }

  const user = await this.database.executeHealthcareRead(async (client) => {
    return await client.user.findUnique({ where: { id } });
  });

  return user ?? null;
}

// ❌ FORBIDDEN
async function findUser(id) {  // Missing type annotations
  const user = await prisma.user.findUnique({ where: { id } }); // Direct Prisma usage
  return user; // No null handling
}
```

## Healthcare Roles (RBAC)

The system supports 12 healthcare-specific roles:
- `SUPER_ADMIN` - System administrator
- `CLINIC_ADMIN` - Clinic administrator
- `DOCTOR` - Medical doctor
- `PATIENT` - Patient
- `RECEPTIONIST` - Front desk staff
- `PHARMACIST` - Pharmacy staff
- `THERAPIST` - Therapy specialist
- `LAB_TECHNICIAN` - Laboratory technician
- `FINANCE_BILLING` - Billing department
- `SUPPORT_STAFF` - Support staff
- `NURSE` - Nursing staff
- `COUNSELOR` - Counseling staff

## Configuration Service (Enhanced)

**ALWAYS use enhanced `ConfigService` from `@config`, NOT from `@nestjs/config`**

```typescript
// ✅ CORRECT
import { ConfigService } from '@config';

@Injectable()
export class MyService {
  constructor(private readonly config: ConfigService) {}

  someMethod() {
    // Type-safe access with autocomplete
    const appConfig = this.config.getAppConfig();
    const port = appConfig.port; // TypeScript knows this is a number

    // Generic getter
    const redisHost = this.config.get<string>('redis.host');

    // Environment checks
    if (this.config.isDevelopment()) {
      // Dev-specific logic
    }
  }
}

// ❌ FORBIDDEN
import { ConfigService } from '@nestjs/config';
```

## Service Pattern (MANDATORY)

Every service must follow this pattern:

```typescript
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@logging';
import { EventService } from '@infrastructure/events';
import { CacheService } from '@cache';
import { HealthcareError } from '@core/errors';
import type { RequestContext } from '@types';

@Injectable()
export class UserService {
  constructor(
    private readonly database: DatabaseService,
    private readonly logger: LoggingService,
    private readonly eventService: EventService,
    private readonly cache: CacheService,
  ) {}

  async create(data: CreateUserDto, context?: RequestContext): Promise<User> {
    try {
      // 1. Validation (already done by class-validator)

      // 2. RBAC check (if context provided)
      if (context?.user) {
        await this.rbacService.checkPermission(context.user.id, 'CREATE_USER');
      }

      // 3. Business logic
      const user = await this.database.executeHealthcareWrite(
        async (client) => {
          return await client.user.create({
            data: {
              ...data,
              createdBy: context?.user?.id,
            },
          });
        },
        {
          userId: context?.user?.id ?? 'system',
          action: 'CREATE_USER',
          resourceType: 'User',
        }
      );

      // 4. Event emission
      await this.eventService.emitEnterprise('user.created', {
        eventId: `user-created-${user.id}`,
        eventType: 'user.created',
        category: EventCategory.USER_ACTIVITY,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: 'UserService',
        version: '1.0.0',
        userId: user.id,
        clinicId: context?.clinicId,
        payload: { user, context },
      });

      // 5. Logging
      this.logger.info('User created successfully', {
        userId: user.id,
        clinicId: context?.clinicId,
      });

      return user;
    } catch (error) {
      // 6. Error handling
      this.logger.error('Failed to create user', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        data,
        context,
      });
      throw error;
    }
  }
}
```

## Database Access (DatabaseService)

**ALWAYS use DatabaseService, never access Prisma directly**:

```typescript
// ✅ CORRECT - Use DatabaseService
import { DatabaseService } from '@infrastructure/database';

async findUser(id: string): Promise<User | null> {
  return await this.database.executeHealthcareRead(async (client) => {
    return await client.user.findUnique({ where: { id } });
  });
}

// ❌ FORBIDDEN - Direct Prisma access
import { PrismaService } from '@infrastructure/database/prisma';
const user = await this.prisma.user.findUnique({ where: { id } });
```

**Transaction pattern**:

```typescript
async createUserWithProfile(userData: CreateUserDto, profileData: CreateProfileDto) {
  return await this.database.executeInTransaction(async (tx) => {
    const user = await tx.user.create({ data: userData });
    const profile = await tx.profile.create({
      data: { ...profileData, userId: user.id },
    });
    return { user, profile };
  });
}
```

## Event System (EventService)

**ALWAYS use EventService, never EventEmitter2 directly**:

```typescript
// ✅ CORRECT - Use EventService
import { EventService } from '@infrastructure/events';

await this.eventService.emitEnterprise('user.created', {
  eventId: `user-created-${user.id}`,
  eventType: 'user.created',
  category: EventCategory.USER_ACTIVITY,
  priority: EventPriority.HIGH,
  timestamp: new Date().toISOString(),
  source: 'UserService',
  version: '1.0.0',
  payload: { user },
});

// ❌ FORBIDDEN - Direct EventEmitter2
import { EventEmitter2 } from '@nestjs/event-emitter';
this.eventEmitter.emit('user.created', { user });
```

## Logging (LoggingService)

**ALWAYS use LoggingService, never console.log or NestJS Logger**:

```typescript
// ✅ CORRECT
import { LoggingService, LogType, LogLevel } from '@logging';

this.logger.log(
  LogType.AUDIT,
  LogLevel.INFO,
  'User created',
  'UserService',
  { userId: user.id }
);

// ❌ FORBIDDEN
console.log('User created', user);
import { Logger } from '@nestjs/common'; // FORBIDDEN
```

## Error Handling

**ALWAYS use HealthcareError from `@core/errors`**:

```typescript
// ✅ CORRECT
import { HealthcareError } from '@core/errors/healthcare-error.class';
import { ErrorCodes } from '@core/errors/error-codes.enum';

throw new HealthcareError(
  ErrorCodes.USER_NOT_FOUND,
  'User not found',
  { userId: id }
);

// ❌ FORBIDDEN
throw new Error('User not found'); // Generic errors in business logic
```

## Controller Pattern

```typescript
import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, ClinicGuard } from '@core/guards';
import { Roles } from '@core/decorators';
import { Role } from '@types';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @Roles(Role.DOCTOR, Role.ADMIN)
  async create(
    @Body() createUserDto: CreateUserDto,
    @RequestContext() context: RequestContext,
  ): Promise<User> {
    return await this.userService.create(createUserDto, context);
  }
}
```

## DTO Pattern (Input Validation)

```typescript
import { IsString, IsEmail, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ description: 'User email address' })
  @IsEmail()
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;

  @ApiProperty({ description: 'User full name' })
  @IsString()
  @Length(2, 50)
  @Transform(({ value }) => value?.trim())
  @Matches(/^[a-zA-Z\s]+$/)
  name: string;

  @ApiProperty({ description: 'Strong password' })
  @IsString()
  @Length(8, 100)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
  password: string;
}
```

## Multi-Tenant Isolation

This is a **multi-tenant system** with clinic-based isolation. Always enforce clinic context:

```typescript
// Automatic isolation via ClinicGuard
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)

// Manual isolation
await this.database.executeWithClinicContext(
  clinicId,
  async (client) => {
    return await client.patient.findMany({
      where: { clinicId },
    });
  }
);
```

## HIPAA Compliance

- **Audit logging**: All write operations are automatically logged
- **Data encryption**: Sensitive fields must be encrypted
- **Access controls**: RBAC enforced on all endpoints
- **Session management**: Multi-device tracking with suspicious activity alerts
- **PHI protection**: Patient Health Information handling rules

## Queue System (BullMQ)

19 specialized queues for different operations:

```typescript
import { QueueService } from '@queue';

// Add job to queue
await this.queueService.addJob('email', {
  to: user.email,
  template: 'welcome',
  data: { name: user.name },
});

// Queue names: email, notification, reminder, appointment, payment, etc.
```

## Testing

When adding new features:
1. Write unit tests for services
2. Add integration tests for API endpoints
3. Ensure all tests pass before committing
4. Run `pnpm validate:all` before pushing

## Access Points (Development)

- API: http://localhost:8088
- Swagger Docs: http://localhost:8088/api
- Health Check: http://localhost:8088/health
- Queue Dashboard: http://localhost:8088/queue-dashboard
- Prisma Studio: http://localhost:5555

## Important Notes

1. **Fastify, not Express**: All HTTP configuration must be Fastify-specific
2. **Plugin Architecture**: Appointments use plugin architecture for extensibility
3. **Connection Pooling**: Optimized for 1M+ users (500 max connections)
4. **Caching Strategy**: Multi-level caching (memory + Redis) with SWR
5. **Circuit Breakers**: Resilience patterns for external services
6. **Read Replicas**: Support for read scaling (configured via env vars)

## Environment Variables

Key variables (see `.env.example` for complete list):
- `NODE_ENV` - development | staging | production
- `PORT` - 8088 (default)
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_HOST` / `REDIS_PORT` - Redis connection
- `JWT_SECRET` - JWT signing secret

## Centralized Types & Mappers (MANDATORY)

**Single Source of Truth**: All shared domain types live in `@types/*` (`src/libs/core/types`)

### Rules:
- Database-generated types (Prisma) stay in `@database/types`
- Business/domain types live in `@types` as the canonical contract
- Implement mappers between `@database/types` and `@types`
- **DTOs MUST import from `@types`, NEVER from `@database/types`**
- **Services/controllers depend on `@types`, NOT DB models**

### Example Mapper:
```typescript
// src/libs/infrastructure/database/mappers/user.mapper.ts
import type { User as DbUser } from '@database/types';
import type { User } from '@types';

export function mapDbUserToDomain(db: DbUser): User {
  return {
    id: db.id,
    name: db.name,
    email: db.email,
    clinicId: db.clinicId,
    role: db.role
  };
}

export function mapDomainUserToDb(domain: User): DbUser {
  // Reverse mapping
}
```

## Change Management Policy (MANDATORY)

1. **Prefer editing existing files** - Only create new files for genuinely new modules
2. **No code duplication** - Refactor/extend existing code instead of parallel implementations
3. **ESLint compliance required** - Fix issues properly until ESLint passes with zero warnings
4. **Preserve functionality** - Lint/type fixes and refactors MUST NOT change behavior
5. **Test behavior changes** - Any intended behavior change requires explicit tests
6. **API versioning** - Use semantic versioning (v1, v2) with deprecation headers
7. **No secrets in code** - All secrets in environment variables, validated on boot

## Scalability for 10M+ Users

### Architecture Patterns:
- **Horizontal scaling**: Stateless services, session in Redis with 16 partitions
- **Connection pooling**: 500 max DB connections, auto-scaling based on load
- **Caching**: Multi-level (memory + Redis/Dragonfly) with SWR pattern
- **Read replicas**: Database read/write splitting for heavy reads
- **Queue-based offloading**: 19 specialized BullMQ queues for async tasks
- **Circuit breakers**: Resilience patterns on all external calls
- **Rate limiting**: Per IP/user/tenant with sliding window algorithm

### Performance Budgets:
- API response time: p95 < 200ms, p99 < 500ms
- Database queries: No unindexed filters on large tables
- Cache hit rate: Target > 70%
- Uptime SLA: ≥ 99.95%

### Database Optimization:
- Migrations: Online, backward-compatible (expand-migrate-contract pattern)
- Partitioning: Per-tenant/clinic where feasible
- Indexing: Composite indexes for high-cardinality filters
- Batch operations: Batch writes with proper concurrency limits

## Security Best Practices

### Authentication & Authorization:
```typescript
// Controller with proper guards
@Controller('patients')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
export class PatientsController {
  @Get()
  @Roles(Role.DOCTOR, Role.NURSE, Role.RECEPTIONIST)
  async getPatients(@Req() request: Request) {
    // request.clinicId set by ClinicGuard
    // request.user set by JwtAuthGuard
    return this.patientService.findAll(request.clinicId);
  }
}
```

### Session Management:
- Maximum 5 sessions per user (auto-cleanup oldest)
- 16 Redis partitions for distributed session storage
- Progressive lockout: 10m → 25m → 45m → 1h → 6h
- Suspicious session detection every 30 minutes
- HIPAA-compliant audit logging

### Input Validation:
```typescript
export class CreatePatientDto {
  @ApiProperty()
  @IsString()
  @Length(2, 50)
  @Transform(({ value }) => value?.trim())
  @Matches(/^[a-zA-Z\s]+$/)
  name: string;

  @ApiProperty()
  @IsEmail()
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;
}
```

## Common Tasks

### Adding a new service
1. Create in `src/services/my-service/`
2. Follow service pattern above
3. Use path aliases for all imports
4. Add to app.module.ts imports
5. Inject `DatabaseService`, `LoggingService`, `EventService`, `CacheService`

### Adding a new model
1. Update `src/libs/infrastructure/database/prisma/schema.prisma`
2. Run `pnpm prisma:generate`
3. Create migration: `pnpm prisma:migrate:dev`
4. Create mapper in `@database/mappers/`
5. Add domain types to `@types/*`
6. Update `DatabaseService` if adding repository methods

### Modifying existing code
1. **Prefer editing existing files** over creating new ones
2. Fix all ESLint errors (NEVER disable rules with `eslint-disable`)
3. Maintain existing behavior unless explicitly changing it
4. Update tests if changing behavior
5. Run `pnpm validate:all` before committing
6. Run `pnpm type-check` to ensure TypeScript compliance

### Emitting events
```typescript
// ALWAYS use EventService (NOT EventEmitter2)
await this.eventService.emitEnterprise('patient.created', {
  eventId: `patient-created-${patient.id}`,
  eventType: 'patient.created',
  category: EventCategory.PATIENT_ACTIVITY,
  priority: EventPriority.HIGH,
  timestamp: new Date().toISOString(),
  source: 'PatientService',
  version: '1.0.0',
  userId: context?.user?.id,
  clinicId: patient.clinicId,
  payload: { patient }
});
```

### Listening to events
```typescript
// Use @OnEvent decorator (works with EventService)
@Injectable()
export class PatientEventListener {
  @OnEvent('patient.created')
  async handlePatientCreated(payload: EnterpriseEventPayload) {
    const patient = payload.payload.patient;
    await this.notificationService.sendWelcomeMessage(patient);
  }
}
```

## Important Architectural Decisions

1. **Fastify over Express**: Fastify is 2-3x faster, production-optimized
2. **EventService as Single Source of Truth**: All events go through EventService for monitoring, rate limiting, PHI validation
3. **CacheService abstraction**: Supports Redis and Dragonfly, easy to switch providers
4. **DatabaseService encapsulation**: All DB access through DatabaseService with connection pooling, caching, metrics
5. **Enhanced ConfigService**: Type-safe configuration with validation on boot
6. **Multi-tenant by design**: Clinic isolation enforced at every layer (guards, repos, cache keys)
7. **Plugin architecture**: Appointment system extensible via lifecycle hooks
8. **Queue-based async**: Heavy operations offloaded to BullMQ queues

## Documentation

See also:
- `README.md` - Main project documentation
- `QUICK_START_LOCAL.md` - Local development setup
- `src/libs/infrastructure/database/README.md` - Database architecture (10M+ users)
- `.cursor/rules/.cursorrules` - Detailed coding standards
- `.ai-rules/` - Comprehensive AI agent guidelines
  - `index.md` - Quick reference and system overview
  - `architecture.md` - SOLID principles, event-driven architecture, logging
  - `coding-standards.md` - TypeScript standards, naming conventions
  - `database.md` - Repository patterns, query optimization, transactions
  - `security.md` - Authentication, RBAC, session management, HIPAA compliance
  - `nestjs-specific.md` - Guards, interceptors, decorators, event handling
