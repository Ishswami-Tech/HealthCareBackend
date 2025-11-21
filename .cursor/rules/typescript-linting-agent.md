# 🏥 Healthcare TypeScript & Linting Agent Rules

## 🎯 Agent Mission
This agent enforces comprehensive TypeScript, ESLint, and coding standards for the Healthcare Backend system. It ensures code quality, security, and compliance with healthcare industry standards.

**📚 IMPORTANT**: This file works in conjunction with the comprehensive `.ai-rules` folder documentation. Always reference both this file and the detailed guides in `.ai-rules/` when implementing features.

## 📚 Official Documentation References

**ALWAYS reference official documentation when implementing features or fixing issues:**

### Core Framework & Language
- **NestJS**: https://docs.nestjs.com - Framework architecture, modules, dependency injection, guards, interceptors, lifecycle hooks
- **TypeScript**: https://www.typescriptlang.org/docs/ - Type system, strict mode, type safety, advanced types, utility types
- **Fastify**: https://fastify.dev/docs/latest/ - HTTP framework, plugins, hooks, TypeScript support, request lifecycle

### Database & ORM
- **Prisma**: https://www.prisma.io/docs - Schema design, migrations, queries, transactions, type safety, Prisma Client API
- **PostgreSQL**: https://www.postgresql.org/docs/ - SQL syntax, performance optimization, indexing strategies, Row-Level Security (RLS)

### Caching & Session Management
- **Dragonfly**: https://www.dragonflydb.io/docs - High-performance cache, Redis-compatible API, commands, data structures
- **Redis**: https://redis.io/docs/ - Data structures, commands, pub/sub, clustering, persistence, performance tuning
- **@fastify/session**: https://github.com/fastify/session - Session management, Store interface (callback-based), cookie handling

### Queue & Background Jobs
- **BullMQ**: https://docs.bullmq.io/ - Job queues, workers, repeatable jobs, rate limiting, job priorities, error handling

### Real-time Communication
- **Socket.IO**: https://socket.io/docs/v4/ - WebSocket communication, rooms, namespaces, adapters, horizontal scaling

### Infrastructure & DevOps
- **Docker**: https://docs.docker.com/ - Containerization, Dockerfile best practices, docker-compose, multi-stage builds, networking
- **Kubernetes**: https://kubernetes.io/docs/ - Pods, services, deployments, ingress, configmaps, secrets, horizontal pod autoscaling

### Frontend (for API design reference)
- **Next.js**: https://nextjs.org/docs - SSR patterns, API routes, routing conventions, data fetching
- **React**: https://react.dev/reference/react - Component patterns, hooks, state management, performance optimization
- **Expo**: https://docs.expo.dev/ - Mobile app development, API compatibility, native modules

## 🔧 TypeScript Enforcement

### **Strict Mode Requirements**
```typescript
// ✅ ALWAYS use strict TypeScript
interface IUser {
  id: string;
  name: string;
  email: string;
  clinicId: string;
  roleType: 'DOCTOR' | 'NURSE' | 'RECEPTIONIST' | 'ADMIN';
}

// ❌ NEVER use any or unknown
function processData(data: any): any { } // FORBIDDEN
function processData(data: unknown): unknown { } // FORBIDDEN

// ✅ Use proper types
function processData(data: IUser): ProcessedUser { }
```

### **Type Safety Rules**
- **No `any` types** - Use proper interfaces and types
- **No `unknown` types** - Use specific types or type guards
- **Strict null checks** - Always handle null/undefined cases
- **Explicit return types** - Always specify function return types
- **Interface segregation** - Use specific interfaces over general ones

### **Path Aliases (MANDATORY)**
```typescript
// ✅ ALWAYS use path aliases
import { UserService } from '@services/users';
import { PrismaService } from '@infrastructure/database';
import { LoggingService } from '@logging';
import { CreateUserDto } from '@dtos';
import type { RequestContext } from '@types';
import { EventService, getEventServiceToken } from '@infrastructure/events'; // ✅ Use EventService (NOT EventEmitter2)
import { QueueService } from '@queue';
import { CacheService } from '@cache';

// ❌ NEVER use relative imports
import { UserService } from '../../../services/users/user.service';
```

### **Centralized Types (MANDATORY)**
- All domain types and interfaces MUST be defined only in `@types` (alias to `src/libs/core/types`).
- Database-generated types MUST live in `@database/types` and be mapped to `@types` via mappers. Business logic must NOT depend directly on database types.
- DTOs MUST import from `@types` and MUST NOT import from `@database/types`.
- Services/controllers MUST import shared types from `@types` (single source of truth).

### **Alias Usage (MANDATORY)**
- **Configuration MUST import from `@config`** - Use enhanced ConfigService, NOT `@nestjs/config`
- Logging MUST import from `@logging/*`.
- Cache MUST import from `@cache/*`.
- Events MUST import from `@infrastructure/events` (EventService is the centralized event hub).
- Queue MUST import from `@queue/*`.
- Core domain modules import from `@core/*`.
- Communication modules import from `@communication/*`.

```typescript
// ✅ Correct
import type { Appointment } from '@types';
import { ConfigService } from '@config'; // Enhanced type-safe ConfigService
import { LoggingService } from '@logging';
import { CacheService } from '@cache';
import { EventService, getEventServiceToken } from '@infrastructure/events'; // ✅ Use EventService (NOT EventEmitter2)
import { QueueService } from '@queue';

// ❌ Incorrect
import { ConfigService } from '@nestjs/config'; // FORBIDDEN - use @config instead
import type { Appointment } from '../../libs/core/types/appointment.types';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { EventService } from '@infrastructure/events/event.service';
import { QueueService } from '@infrastructure/queue/src/queue.service';
```

### **Import & Boundary Enforcement (MANDATORY)**
- Use only approved aliases; no cross-layer relative imports.
- Business/services must depend on abstractions; infrastructure accessed via DI and approved facades.

## 🏗️ Architecture Patterns

### **SOLID Principles Enforcement**
1. **Single Responsibility** - One class, one purpose
2. **Open/Closed** - Open for extension, closed for modification
3. **Liskov Substitution** - Derived classes must be substitutable
4. **Interface Segregation** - Many specific interfaces over one general
5. **Dependency Inversion** - Depend on abstractions, not concretions

### **Service Pattern (MANDATORY)**
```typescript
@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggingService,
    private readonly cache: CacheService,
    private readonly eventService: EventService, // ✅ Use EventService (NOT EventEmitter2)
    private readonly sessionService: SessionService,
    private readonly rbacService: RbacService
  ) {}

  async create(data: CreateUserDto, requestContext?: RequestContext): Promise<User> {
    try {
      // 1. RBAC permission check
      if (requestContext?.user) {
        await this.rbacService.checkPermission(
          requestContext.user.id,
          'CREATE_USER'
        );
      }

      // 2. Business logic
      const user = await this.prisma.$client.user.create({
        data: {
          ...data,
          createdBy: requestContext?.user?.id
        }
      });

      // 3. Event emission via centralized EventService (single source of truth)
      await this.eventService.emitEnterprise('user.created', {
        eventId: `user-created-${user.id}`,
        eventType: 'user.created',
        category: EventCategory.USER_ACTIVITY,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: 'UserService',
        version: '1.0.0',
        userId: user.id,
        clinicId: requestContext?.clinicId,
        payload: {
          user,
          context: requestContext
        }
      });

      // 4. Caching
      const cacheKey = this.buildCacheKey('user', user.id, requestContext?.clinicId);
      await this.cache.set(cacheKey, JSON.stringify(user), 3600);

      // 5. Logging
      this.logger.info('User created successfully', {
        userId: user.id,
        clinicId: requestContext?.clinicId,
        createdBy: requestContext?.user?.id
      });

      return user;
    } catch (error) {
      this.logger.error('Failed to create user', {
        error: error.message,
        stack: error.stack,
        data,
        context: requestContext
      });
      throw error;
    }
  }

  private buildCacheKey(prefix: string, id: string, clinicId?: string): string {
    return clinicId ? `${prefix}:${clinicId}:${id}` : `${prefix}:${id}`;
  }
}
```

## 🛡️ Security Standards

### **Authentication & Authorization**
```typescript
// ✅ ALWAYS use proper guards
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
export class UserController {
  @Post()
  @Roles(Role.DOCTOR, Role.RECEPTIONIST)
  async create(
    @Body() createUserDto: CreateUserDto, 
    @RequestContext() context: RequestContext
  ) {
    return this.userService.create(createUserDto, context);
  }
}
```

### **Input Validation (MANDATORY)**
```typescript
export class CreateUserDto {
  @ApiProperty({ description: 'User full name' })
  @IsString()
  @Length(2, 50)
  @Transform(({ value }) => value?.trim())
  @Matches(/^[a-zA-Z\s]+$/, { message: 'Name can only contain letters and spaces' })
  name: string;

  @ApiProperty({ description: 'User email address' })
  @IsEmail()
  @Transform(({ value }) => value?.toLowerCase().trim())
  @MaxLength(100)
  email: string;

  @ApiProperty({ description: 'Strong password' })
  @IsString()
  @Length(8, 100)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character'
  })
  password: string;
}
```

## 📝 Logging Standards

### **Use Custom LoggingService (MANDATORY)**
```typescript
// ✅ ALWAYS use LoggingService from @infrastructure/logging
import { LoggingService, LogType, LogLevel } from '@infrastructure/logging';

@Injectable()
export class UserService {
  constructor(private readonly loggingService: LoggingService) {}

  async createUser(data: CreateUserDto): Promise<User> {
    await this.loggingService.log(
      LogType.AUDIT,
      LogLevel.INFO,
      'Creating new user',
      'UserService',
      { email: data.email, clinicId: data.clinicId }
    );
    // ... implementation
  }
}

// ❌ NEVER use NestJS built-in Logger
import { Logger } from '@nestjs/common'; // FORBIDDEN
console.log('Debug info'); // FORBIDDEN
```

## 🔄 NestJS Patterns

**Reference**: https://docs.nestjs.com

### **Module Structure**
```typescript
@Module({
  imports: [
    // External modules
    ConfigModule.forRoot(),
    
    // Internal modules
    DatabaseModule,
    AuthModule,
    UserModule
  ],
  controllers: [UserController],
  providers: [
    UserService,
    // Global providers
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    }
  ],
  exports: [UserService]
})
export class UserModule {}
```

### **Dependency Injection**
```typescript
@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: LoggingService,
    private readonly cache: CacheService,
    private readonly eventService: EventService, // ✅ Use EventService (NOT EventEmitter2)
    private readonly configService: ConfigService
  ) {}
}
```

## 🚫 Anti-Patterns to Avoid

### **❌ FORBIDDEN Patterns**
```typescript
// Don't use any type
function processData(data: any): any { }

// Don't use console.log
console.log('Debug info');

// Don't ignore errors
const user = await this.userService.create(data); // No try-catch

// Don't use relative imports
import { UserService } from '../../../services/users/user.service';

// Don't hardcode values
const PORT = 4000;
const SECRET = 'hardcoded-secret';

// Don't skip validation
@Post()
async create(@Body() data: any) { } // No DTO validation

// Don't use Express
import { NestExpressApplication } from '@nestjs/platform-express';
```

### **✅ Correct Patterns**
```typescript
// Use proper types
function processData(data: ProcessDataDto): ProcessedDataDto { }

// Use proper logging
this.logger.info('Debug info', { context: 'UserService' });

// Handle errors properly
try {
  const user = await this.userService.create(data);
  return user;
} catch (error) {
  this.logger.error('Failed to create user', error);
  throw error;
}

// Use path aliases
import { UserService } from '@services/users';

// Use configuration
constructor(private configService: ConfigService) {
  const port = this.configService.get<number>('port');
}

// Use proper DTOs
@Post()
async create(@Body() createUserDto: CreateUserDto) { }

// Use Fastify
import { NestFastifyApplication } from '@nestjs/platform-fastify';
```

## 🔍 Code Review Checklist

### **TypeScript Compliance**
- [ ] No `any` or `unknown` types
- [ ] All functions have explicit return types
- [ ] Strict null checks handled
- [ ] Path aliases used (no relative imports)
- [ ] All shared types/interfaces imported only from `@types`
- [ ] DTOs do not import from `@database/types`
- [ ] Business logic does not depend on database types directly
- [ ] Interfaces properly defined

### **Architecture Compliance**
- [ ] SOLID principles followed
- [ ] Single responsibility per class
- [ ] Dependency injection used
- [ ] Event-driven patterns implemented
- [ ] Repository pattern used

### **Security Compliance**
- [ ] Input validation with DTOs
- [ ] RBAC guards implemented
- [ ] Clinic isolation enforced
- [ ] Audit logging implemented
- [ ] Sensitive data encrypted

### **NestJS Compliance**
- [ ] Fastify used (not Express)
- [ ] Proper module structure
- [ ] Guards and interceptors used
- [ ] Exception filters implemented
- [ ] Custom decorators used

### **Logging Compliance**
- [ ] LoggingService used (not NestJS Logger)
- [ ] Structured logging with context
- [ ] HIPAA-compliant audit trails
- [ ] Error logging with stack traces
- [ ] Logging imports resolve from `@logging/*`

### **Infrastructure Aliases Compliance**
- [ ] Cache imports resolve from `@cache/*`
- [ ] Events imports resolve from `@infrastructure/events` (EventService is the single source of truth)
- [ ] Queue imports resolve from `@queue/*`

### **EventService Compliance**
- [ ] EventService used for all event emissions (NOT EventEmitter2)
- [ ] forwardRef with getEventServiceToken() used for circular dependencies
- [ ] Type guards (isEventService) used when injecting EventService with forwardRef
- [ ] EventService.onAny() used for wildcard event subscriptions
- [ ] @OnEvent decorators work correctly (EventService emits through EventEmitter2 internally)

## 🎯 Code Quality Metrics

### **Function Guidelines**
- **Length**: Maximum 50 lines
- **Parameters**: Maximum 4 parameters, use objects for more
- **Complexity**: Maximum cyclomatic complexity of 10
- **Nesting**: Maximum 3 levels of nesting

### **Class Guidelines**
- **Size**: Maximum 300 lines
- **Methods**: Maximum 15 methods per class
- **Dependencies**: Maximum 7 constructor dependencies
- **Cohesion**: High cohesion, low coupling

## 🚀 Performance Standards

### **Database Optimization**
**Reference**: https://www.prisma.io/docs | https://www.postgresql.org/docs/
- Use Prisma with proper indexing (follow Prisma indexing best practices)
- Implement connection pooling (Prisma connection pool configuration)
- Use transactions for data consistency (Prisma transaction API)
- Cache frequently accessed data (Dragonfly/Redis patterns)

### **Cache Optimization**
**Reference**: https://www.dragonflydb.io/docs | https://redis.io/docs/
- Use CacheService abstraction for provider-agnostic caching
- Implement proper TTL management based on data sensitivity
- Use cache patterns: cache-aside, write-through, write-behind
- Handle cache failures gracefully with fallback strategies

### **Memory Management**
- Avoid memory leaks in event listeners
- Use proper cleanup in OnModuleDestroy
- Implement circuit breakers for external services
- Monitor memory usage in production

## 📊 Monitoring & Observability

### **Health Checks**
- Implement `/health` endpoint
- Database connectivity checks
- Redis connectivity checks
- External service health checks

### **Metrics Collection**
- Request/response times
- Error rates
- Database query performance
- Cache hit/miss ratios

## 🔧 Development Workflow

### **Pre-commit Checks**
1. TypeScript compilation
2. ESLint validation
3. Prettier formatting
4. Unit test execution
5. Integration test execution

### **Change Management Policy (MANDATORY)**
- Prefer modifying existing files for fixes/features; create new files only when required for clear separation of concerns or new modules.
- Do not duplicate types, services, or utilities; extend or refactor existing implementations instead.
- Never bypass lint rules: no `eslint-disable`, no `@ts-ignore`, no commented-out rules. Resolve root causes with proper typing and refactors.

### **Functionality Preservation (MANDATORY)**
- Do not change existing functionality or external behavior when fixing lint/type errors or performing refactors.
- Refactors must be behavior-preserving; add/keep tests to verify parity where applicable.
- Any intentional behavior change requires explicit specification, review, and tests.

### **Code Review Process**
1. Architecture compliance check
2. Security standards verification
3. Performance impact assessment
4. Documentation completeness
5. Test coverage validation

## 🚨 Critical Rules

- **ZERO TOLERANCE** for `any` types
- **ZERO TOLERANCE** for relative imports
- **ZERO TOLERANCE** for console.log
- **ZERO TOLERANCE** for Express usage
- **ZERO TOLERANCE** for direct EventEmitter2 usage (use EventService instead)
- **ZERO TOLERANCE** for missing error handling
- **ZERO TOLERANCE** for missing input validation
- **ZERO TOLERANCE** for missing RBAC checks

## 🎯 Agent Behavior

When reviewing or generating code:

1. **Always enforce TypeScript strict mode** - No exceptions
2. **Always use path aliases** - Never allow relative imports
3. **Always implement proper error handling** - Try-catch with logging
4. **Always use LoggingService** - Never allow console.log or NestJS Logger
5. **Always validate inputs** - DTOs with class-validator
6. **Always implement RBAC** - Guards and permission checks
7. **Always follow SOLID principles** - Single responsibility, dependency inversion
8. **Always use Fastify** - Never suggest Express
9. **Always use EventService** - Never use EventEmitter2 directly (EventService is the single source of truth)
10. **Always implement clinic isolation** - Multi-tenant data separation
11. **Always add audit logging** - HIPAA compliance requirements

Remember: This is a production healthcare system handling sensitive patient data. Code quality, security, and compliance are non-negotiable.

## 🔄 EventService Integration

**EventService is the CENTRALIZED EVENT HUB and single source of truth for all event emissions.**

- All services MUST use EventService (NOT EventEmitter2 directly)
- Use `getEventServiceToken()` with `forwardRef()` for circular dependencies
- Use type guards (`isEventService`) when injecting with forwardRef
- Use `EventService.onAny()` for wildcard event subscriptions
- `@OnEvent` decorators work correctly (EventService emits through EventEmitter2 internally)

For detailed integration documentation, see: `docs/architecture/EVENT_COMMUNICATION_INTEGRATION.md`

## 📚 Comprehensive AI Rules Documentation

**ALWAYS reference the comprehensive `.ai-rules` folder for detailed guidelines:**

- **🏗️ Architecture**: `.ai-rules/architecture.md` - SOLID principles, plugin architecture, multi-tenant design, project structure
- **📝 Coding Standards**: `.ai-rules/coding-standards.md` - TypeScript standards, naming conventions, import organization, path aliases
- **🗄️ Database**: `.ai-rules/database.md` - PostgreSQL with Prisma, repository patterns, transactions, 10M users optimization
- **🚀 NestJS Specific**: `.ai-rules/nestjs-specific.md` - NestJS/Fastify patterns, guards, decorators, events, module structure
- **🔒 Security**: `.ai-rules/security.md` - RBAC, session management, HIPAA compliance, audit logging, JWT authentication
- **📋 Index**: `.ai-rules/index.md` - Complete system overview, quick reference, technology stack, service architecture

**Key Points from `.ai-rules`:**
- **DatabaseService**: Use `DatabaseService` (NOT `PrismaService`) from `@infrastructure/database`
- **CacheService**: Use `CacheService` (NOT `RedisService`) - Provider-agnostic cache abstraction
- **EventService**: Use `EventService` (NOT `EventEmitter2`) - CENTRALIZED EVENT HUB
- **LoggingService**: Use `LoggingService` from `@infrastructure/logging` (NOT NestJS Logger)
- **10M Users Ready**: Optimized for 1M+ concurrent users, 200+ clinics, horizontal scaling
- **Multi-Tenant**: Clinic-based data isolation with comprehensive RBAC (15+ healthcare roles)
- **Plugin Architecture**: Extensible appointment system with 12+ plugins

## 🔗 Documentation Usage in Code

When implementing features, **ALWAYS**:

1. **Check official documentation first** - Don't guess, verify patterns from official docs
2. **Reference documentation in comments** - Add `@see` links for complex implementations
3. **Follow official TypeScript types** - Use types from `@types/*` packages and official definitions
4. **Use official examples** - Adapt official examples to our codebase patterns
5. **Document deviations** - If deviating from official patterns, document why

### Example: Documentation References in Code

```typescript
/**
 * Fastify Session Store Adapter
 * 
 * Implements @fastify/session Store interface using CacheService
 * @see https://github.com/fastify/session#store - Store interface specification
 * @see https://www.dragonflydb.io/docs - Cache backend documentation
 * @see https://fastify.dev/docs/latest/Guides/TypeScript/ - Fastify TypeScript patterns
 */
@Injectable()
export class FastifySessionStoreAdapter implements SessionStore {
  /**
   * Get session data by session ID
   * Implements Fastify Store interface with callback pattern
   * @see https://github.com/fastify/session#store-interface
   */
  get(sid: string, callback: (err: unknown, result?: unknown) => void): void {
    // Implementation follows Fastify Store callback pattern
  }
}
```

### Technology-Specific Documentation Patterns

#### NestJS Implementation
```typescript
/**
 * User Service
 * @see https://docs.nestjs.com/providers - Dependency injection patterns
 * @see https://docs.nestjs.com/techniques/database - Database integration
 */
@Injectable()
export class UserService {
  // Follow NestJS lifecycle hooks: OnModuleInit, OnModuleDestroy
}
```

#### Prisma Queries
```typescript
/**
 * Database query with Prisma
 * @see https://www.prisma.io/docs/concepts/components/prisma-client/crud - CRUD operations
 * @see https://www.prisma.io/docs/concepts/components/prisma-client/transactions - Transactions
 */
async createUser(data: CreateUserDto): Promise<User> {
  return this.prisma.$transaction(async (tx) => {
    // Transaction implementation
  });
}
```

#### Fastify Plugins
```typescript
/**
 * Register Fastify Session plugin
 * @see https://fastify.dev/docs/latest/Reference/Plugins/ - Plugin registration
 * @see https://github.com/fastify/session - Session plugin documentation
 */
async registerSession(app: INestApplication, options: Record<string, unknown>): Promise<void> {
  await this.registerPlugin(app, fastifySession, options);
}
```

#### Cache Operations
```typescript
/**
 * Cache patient records
 * @see https://www.dragonflydb.io/docs/commands/ - Cache commands
 * @see https://redis.io/docs/manual/patterns/cache-aside/ - Cache-aside pattern
 */
async cachePatientRecords<T>(patientId: string, fetchFn: () => Promise<T>): Promise<T> {
  // Cache-aside pattern implementation
}
```

#### Queue Jobs
```typescript
/**
 * Process appointment notification job
 * @see https://docs.bullmq.io/guide/jobs - Job creation and processing
 * @see https://docs.bullmq.io/guide/workers - Worker implementation
 */
@Processor('appointment-notifications')
export class AppointmentNotificationProcessor {
  @Process('send-notification')
  async handleNotification(job: Job<NotificationData>): Promise<void> {
    // Job processing implementation
  }
}
```

#### Socket.IO Events
```typescript
/**
 * Socket.IO event handler
 * @see https://socket.io/docs/v4/server-api/ - Server API
 * @see https://socket.io/docs/v4/rooms-and-namespaces/ - Rooms and namespaces
 */
@WebSocketGateway({ namespace: '/appointments' })
export class AppointmentGateway {
  @SubscribeMessage('join-room')
  handleJoinRoom(client: Socket, roomId: string): void {
    // Room management implementation
  }
}
```

**Last Updated**: January 2025
