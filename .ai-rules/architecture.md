# 🏗️ Architecture & Design Patterns

## 🎯 SOLID & DRY Principles

### **SOLID Principles**
- **S**ingle Responsibility: Each class/function has one reason to change
- **O**pen/Closed: Open for extension, closed for modification
- **L**iskov Substitution: Derived classes must be substitutable for base classes
- **I**nterface Segregation: Many specific interfaces over one general interface
- **D**ependency Inversion: Depend on abstractions, not concretions

### **DRY (Don't Repeat Yourself)**
- Extract common logic into utilities, services, or decorators
- Use composition over inheritance
- Create reusable components and patterns
- Avoid code duplication across modules

## 📁 Project Structure

### **Library Organization (`src/libs/`)**
```
libs/
├── communication/             # Communication layer
│   ├── messaging/            # Multi-channel messaging
│   │   ├── chat/            # Chat message backup
│   │   ├── email/           # Email via AWS SES
│   │   ├── push/            # Push notifications (Firebase, SNS)
│   │   └── whatsapp/        # WhatsApp Business API
│   └── socket/              # WebSocket implementation
│       ├── base-socket.ts   # Base socket gateway
│       ├── event-socket.broadcaster.ts  # Event broadcasting
│       └── socket-auth.middleware.ts    # Socket authentication
├── core/                     # Core framework components
│   ├── business-rules/      # Business rule engine
│   ├── decorators/          # Custom decorators
│   ├── errors/              # Healthcare error system
│   ├── filters/             # Exception filters
│   ├── guards/              # Authentication & authorization guards
│   ├── pipes/               # Validation pipes
│   ├── plugin-interface/    # Plugin architecture
│   ├── rbac/                # Role-based access control
│   ├── resilience/          # Circuit breaker & retry patterns
│   ├── session/             # Session management
│   └── types/               # Core type definitions (canonical domain types)
├── dtos/                     # Data transfer objects (shared DTOs)
├── infrastructure/           # Infrastructure layer
│   ├── cache/               # Redis caching with SWR
│   │   ├── controllers/     # Cache management endpoints
│   │   ├── decorators/      # Cache decorators
│   │   ├── interceptors/    # Cache interceptors
│   │   └── redis/           # Redis service
│   ├── database/            # Database layer
│   │   ├── clients/         # Database clients
│   │   ├── config/          # Database configuration
│   │   ├── interfaces/      # Repository interfaces
│   │   ├── prisma/          # Prisma schema & client
│   │   ├── repositories/    # Repository implementations
│   │   ├── scripts/         # Database scripts
│   │   └── types/           # Database types (DB-specific, mapped to @types)
│   ├── events/              # Event-driven architecture
│   │   └── types/           # Event type definitions
│   ├── logging/             # Logging service
│   │   └── types/           # Logging types
│   └── queue/               # BullMQ queue system
│       └── src/             # Queue implementations (19 specialized queues)
├── security/                # Security layer
│   └── rate-limit/          # Rate limiting & throttling
└── utils/                   # Utility functions
    ├── QR/                  # QR code generation
    ├── query/               # Query helpers & pagination
    └── rate-limit/          # Rate limit utilities
```

### **Service Organization (`src/services/`)**
```
services/
├── appointments/            # Appointment management system
│   ├── communications/      # Appointment communications
│   ├── core/               # Core appointment logic
│   └── plugins/            # Plugin architecture
│       ├── analytics/      # Analytics plugin
│       ├── base/           # Base plugin interface
│       ├── checkin/        # Check-in plugin
│       ├── config/         # Plugin configuration
│       ├── confirmation/   # Confirmation plugin
│       ├── eligibility/    # Eligibility verification
│       ├── followup/       # Follow-up management
│       ├── health/         # Health checks
│       ├── location/       # Location-based features
│       ├── notifications/  # Notification plugin
│       ├── payment/        # Payment integration
│       ├── queue/          # Queue management
│       ├── reminders/      # Reminder system
│       ├── resources/      # Resource management
│       ├── templates/      # Appointment templates
│       ├── utils/          # Plugin utilities
│       ├── video/          # Video consultation
│       └── waitlist/       # Waitlist management
├── auth/                   # Authentication service
│   └── core/               # Auth core logic
├── billing/                # Billing & invoicing
│   ├── controllers/        # Billing endpoints
│   └── dto/                # Billing DTOs
├── clinic/                 # Multi-clinic management
│   ├── cliniclocation/     # Clinic location service
│   ├── dto/                # Clinic DTOs
│   ├── services/           # Clinic services
│   └── shared/             # Shared clinic utilities
├── ehr/                    # Electronic Health Records
│   ├── controllers/        # EHR endpoints
│   └── dto/                # EHR DTOs
├── health/                 # Health monitoring service
├── notification/           # Notification service
└── users/                  # User management
    ├── controllers/        # User endpoints
    └── core/               # User core logic
```

### **Configuration & Documentation**
```
src/
├── config/                 # Application configuration
│   └── environment/        # Environment-specific configs
├── libs/                   # Libraries (see above)
├── services/               # Services (see above)
└── main.ts                # Application bootstrap

docs/
├── api/                    # API documentation
├── architecture/           # Architecture documentation
│   ├── SYSTEM_ARCHITECTURE.md
│   ├── COMPLETE_SYSTEM_SUMMARY.md
│   └── INTEGRATION_VERIFICATION.md
├── features/               # Feature-specific docs
│   ├── SUBSCRIPTION_APPOINTMENTS.md
│   ├── INVOICE_PDF_WHATSAPP_FEATURE.md
│   └── NOTIFICATION_SYSTEM_IMPLEMENTATION.md
└── guides/                 # Implementation guides
    ├── NOTIFICATION_IMPLEMENTATION_GUIDE.md
    ├── NOTIFICATION_STRATEGY.md
    └── AI_IMPLEMENTATION_PROMPT.md
```

## 🔧 Design Patterns
## 🌍 High-Scale Architecture (10M Users)
- Module and boundary rules: services depend on abstractions; infrastructure behind interfaces; imports adhere to aliases.
- Rollout strategies: canary first, then 50/50, then full; define rollback criteria and monitoring signals.
- Stateless services; shared-nothing where possible; session in Redis with partitioning.
- Horizontal scaling as first-class: HPA targets on CPU/RAM/RPS; graceful shutdown.
- Bulkheads: isolate critical services (auth, billing, appointments) with separate pools/queues.
- Circuit breakers and timeouts on all network calls; retry with exponential backoff + jitter.
- Multi-tenant isolation enforced in every layer (guards, repos, cache keys, metrics labels).
- Read/write separation; read replicas for heavy reads; CQRS where it reduces contention.
- Event-driven integration between domains; idempotent consumers; DLQ and replay strategy.
- Feature flags and gradual rollouts; surge protection; brownout modes under pressure.

### **Repository Pattern**
```typescript
// Abstract repository interface
export abstract class BaseRepository<T> {
  abstract findById(id: string): Promise<T | null>;
  abstract create(data: Partial<T>): Promise<T>;
  abstract update(id: string, data: Partial<T>): Promise<T>;
  abstract delete(id: string): Promise<void>;
}

// Concrete implementation
@Injectable()
export class UserRepository extends BaseRepository<User> {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.healthcare.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  async create(data: CreateUserData): Promise<User> {
    return this.prisma.healthcare.user.create({ data });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.healthcare.user.findUnique({
      where: { email }
    });
  }
}
```

### **Factory Pattern**
```typescript
// Service factory for different domains
@Injectable()
export class ServiceFactory {
  constructor(
    private readonly healthcareUserService: HealthcareUserService,
    private readonly fashionUserService: FashionUserService
  ) {}

  getUserService(domain: 'healthcare' | 'fashion'): UserServiceInterface {
    switch (domain) {
      case 'healthcare':
        return this.healthcareUserService;
      case 'fashion':
        return this.fashionUserService;
      default:
        throw new Error(`Unknown domain: ${domain}`);
    }
  }
}
```

### **Strategy Pattern**
```typescript
// Authentication strategy interface
export interface AuthStrategy {
  authenticate(credentials: any): Promise<User | null>;
}

// JWT strategy implementation
@Injectable()
export class JwtAuthStrategy implements AuthStrategy {
  async authenticate(token: string): Promise<User | null> {
    // JWT authentication logic
  }
}

// OAuth strategy implementation
@Injectable()
export class OAuthStrategy implements AuthStrategy {
  async authenticate(oauthData: any): Promise<User | null> {
    // OAuth authentication logic
  }
}

// Context using strategies
@Injectable()
export class AuthService {
  constructor(
    private readonly jwtStrategy: JwtAuthStrategy,
    private readonly oauthStrategy: OAuthStrategy
  ) {}

  async authenticate(type: 'jwt' | 'oauth', credentials: any): Promise<User | null> {
    const strategy = type === 'jwt' ? this.jwtStrategy : this.oauthStrategy;
    return strategy.authenticate(credentials);
  }
}
```

### **Decorator Pattern**
```typescript
// Caching decorator
export function Cacheable(ttl: number = 3600) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const cacheKey = `${target.constructor.name}:${propertyName}:${JSON.stringify(args)}`;
      const cached = await this.cache.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }
      
      const result = await method.apply(this, args);
      await this.cache.set(cacheKey, JSON.stringify(result), ttl);
      
      return result;
    };
  };
}

// Usage
@Injectable()
export class UserService {
  @Cacheable(3600) // Cache for 1 hour
  async findById(id: string): Promise<User | null> {
    return this.userRepository.findById(id);
  }
}
```

## 🔄 Event-Driven Architecture

### **Event Emitter Pattern**
```typescript
// Event definitions
export interface UserEvents {
  'user.created': { user: User };
  'user.updated': { user: User; changes: Partial<User> };
  'user.deleted': { userId: string };
}

// Service with event emission
@Injectable()
export class UserService {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly userRepository: UserRepository
  ) {}

  async create(data: CreateUserDto): Promise<User> {
    const user = await this.userRepository.create(data);
    
    // Emit event for other services to react
    this.eventEmitter.emit('user.created', { user });
    
    return user;
  }
}

// Event listener
@Injectable()
export class NotificationService {
  @OnEvent('user.created')
  async handleUserCreated(payload: { user: User }) {
    await this.sendWelcomeEmail(payload.user.email);
  }

  @OnEvent('user.updated')
  async handleUserUpdated(payload: { user: User; changes: Partial<User> }) {
    if (payload.changes.email) {
      await this.sendEmailChangeNotification(payload.user);
    }
  }
}
```

## 🗄️ Database Architecture

### **Prisma Service Pattern**
```typescript
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private client: PrismaClient;

  constructor(private configService: ConfigService) {
    this.client = new PrismaClient({
      datasources: {
        db: { url: this.configService.get('DATABASE_URL') }
      },
      log: ['query', 'info', 'warn', 'error'],
      errorFormat: 'pretty'
    });
  }

  get $client(): PrismaClient {
    return this.client;
  }

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }

  // Health check for database connectivity
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      return false;
    }
  }

  // Transaction support
  async transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.client.$transaction(fn);
  }
}
```

## 🔧 Dependency Injection Patterns

### **Interface Segregation**
```typescript
// Specific interfaces for different concerns
export interface IUserReader {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
}

export interface IUserWriter {
  create(data: CreateUserData): Promise<User>;
  update(id: string, data: UpdateUserData): Promise<User>;
  delete(id: string): Promise<void>;
}

export interface IUserService extends IUserReader, IUserWriter {
  // Combined interface
}

// Implementation
@Injectable()
export class UserService implements IUserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: LoggingService
  ) {}

  // Implement all interface methods
}
```

### **Provider Configuration**
```typescript
// Module with proper DI configuration
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CacheModule
  ],
  providers: [
    // Service providers
    UserService,
    AuthService,
    
    // Repository providers
    {
      provide: 'IUserRepository',
      useClass: UserRepository
    },
    
    // Factory providers
    {
      provide: 'UserServiceFactory',
      useFactory: (
        healthcareService: HealthcareUserService,
        fashionService: FashionUserService
      ) => new ServiceFactory(healthcareService, fashionService),
      inject: [HealthcareUserService, FashionUserService]
    }
  ],
  controllers: [UserController],
  exports: [UserService, 'IUserRepository']
})
export class UserModule {}
```

## 🔄 Module Organization

### **Feature Module Pattern**
```typescript
// Core module for shared functionality
@Global()
@Module({
  imports: [
    ConfigModule.forRoot(),
    DatabaseModule,
    LoggingModule,
    CacheModule,
    EventsModule
  ],
  exports: [
    DatabaseModule,
    LoggingModule,
    CacheModule,
    EventsModule
  ]
})
export class CoreModule {}

// Feature module with plugin support
@Module({
  imports: [
    CoreModule,
    AuthModule,
    NotificationModule
  ],
  providers: [
    UserService,
    UserRepository,
    // Session management
    SessionService,
    // RBAC integration
    RbacService
  ],
  controllers: [UserController],
  exports: [UserService, SessionService]
})
export class UserModule {}

// Service module with comprehensive integrations
@Module({
  imports: [
    UserModule,
    ClinicModule,
    NotificationModule,
    BillingModule,
    EhrModule,
    QueueModule
  ],
  providers: [
    AppointmentService,
    AppointmentRepository,
    // Plugin system
    PluginRegistry,
    // Appointment plugins
    AnalyticsPlugin,
    CheckinPlugin,
    ConfirmationPlugin,
    EligibilityPlugin,
    FollowupPlugin,
    NotificationPlugin,
    PaymentPlugin,
    QueuePlugin,
    ReminderPlugin,
    VideoPlugin,
    WaitlistPlugin
  ],
  controllers: [AppointmentController],
  exports: [AppointmentService]
})
export class AppointmentModule {}
```

### **Plugin Architecture Pattern**
```typescript
// Base plugin interface
export interface IAppointmentPlugin {
  readonly name: string;
  readonly priority: number;

  beforeCreate?(data: CreateAppointmentDto): Promise<void>;
  afterCreate?(appointment: Appointment): Promise<void>;
  beforeUpdate?(id: string, data: UpdateAppointmentDto): Promise<void>;
  afterUpdate?(appointment: Appointment): Promise<void>;
  beforeCancel?(id: string): Promise<void>;
  afterCancel?(appointment: Appointment): Promise<void>;
}

// Plugin implementation
@Injectable()
export class NotificationPlugin implements IAppointmentPlugin {
  readonly name = 'NotificationPlugin';
  readonly priority = 100;

  constructor(
    private readonly notificationService: NotificationService,
    private readonly logger: LoggingService
  ) {}

  async afterCreate(appointment: Appointment): Promise<void> {
    await this.notificationService.sendAppointmentConfirmation(
      appointment.patientId,
      appointment
    );
    this.logger.info('Notification sent for new appointment', {
      appointmentId: appointment.id
    });
  }

  async afterUpdate(appointment: Appointment): Promise<void> {
    await this.notificationService.sendAppointmentUpdate(
      appointment.patientId,
      appointment
    );
  }

  async afterCancel(appointment: Appointment): Promise<void> {
    await this.notificationService.sendAppointmentCancellation(
      appointment.patientId,
      appointment
    );
  }
}

// Plugin registry
@Injectable()
export class PluginRegistry {
  private plugins: IAppointmentPlugin[] = [];

  registerPlugin(plugin: IAppointmentPlugin): void {
    this.plugins.push(plugin);
    this.plugins.sort((a, b) => a.priority - b.priority);
  }

  async executeBeforeCreate(data: CreateAppointmentDto): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.beforeCreate) {
        await plugin.beforeCreate(data);
      }
    }
  }

  async executeAfterCreate(appointment: Appointment): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.afterCreate) {
        await plugin.afterCreate(appointment);
      }
    }
  }
}
```

## 🚫 Anti-Patterns to Avoid

### **❌ Avoid These Patterns**
```typescript
// God Object - too many responsibilities
class UserService {
  createUser() {}
  sendEmail() {}
  processPayment() {}
  generateReport() {}
  manageInventory() {}
  // ... 50+ methods
}

// Tight Coupling - direct dependencies
class UserService {
  constructor() {
    this.database = new PostgresDatabase(); // Hard dependency
    this.emailService = new EmailService(); // Hard dependency
  }
}

// Violation of Interface Segregation
interface IUserService {
  // User methods
  createUser(): void;
  updateUser(): void;
  
  // Admin methods (not needed by all clients)
  deleteAllUsers(): void;
  exportUserData(): void;
  
  // Reporting methods (not needed by all clients)
  generateUserReport(): void;
  analyzeUserBehavior(): void;
}
```

### **✅ Correct Patterns**
```typescript
// Single Responsibility - focused classes
class UserService {
  createUser() {}
  updateUser() {}
  findUser() {}
}

class EmailService {
  sendEmail() {}
  sendBulkEmail() {}
}

// Dependency Inversion - depend on abstractions
class UserService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly emailService: IEmailService
  ) {}
}

// Interface Segregation - specific interfaces
interface IUserReader {
  findById(id: string): Promise<User>;
  findByEmail(email: string): Promise<User>;
}

interface IUserWriter {
  create(data: CreateUserData): Promise<User>;
  update(id: string, data: UpdateUserData): Promise<User>;
}

interface IUserAdmin {
  deleteAllUsers(): Promise<void>;
  exportUserData(): Promise<Buffer>;
}
```

## 📝 Logging Architecture

### **Enterprise LoggingService (HIPAA-Compliant)**

**ALWAYS use the custom `LoggingService` from `@infrastructure/logging` for all logging needs.**

```typescript
// ✅ DO - Use custom LoggingService
import { Injectable } from '@nestjs/common';
import { LoggingService, LogType, LogLevel } from '@infrastructure/logging';

@Injectable()
export class UserService {
  constructor(private readonly loggingService: LoggingService) {}

  async createUser(data: CreateUserDto): Promise<User> {
    // Log user creation with audit trail
    await this.loggingService.log(
      LogType.AUDIT,
      LogLevel.INFO,
      'Creating new user',
      'UserService',
      { email: data.email, clinicId: data.clinicId }
    );

    try {
      const user = await this.prisma.user.create({ data });

      // Log success
      await this.loggingService.log(
        LogType.AUDIT,
        LogLevel.INFO,
        'User created successfully',
        'UserService',
        { userId: user.id, email: user.email }
      );

      return user;
    } catch (error) {
      // Log error with full context
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to create user',
        'UserService',
        {
          error: error.message,
          stack: error.stack,
          email: data.email
        }
      );
      throw error;
    }
  }
}

// ❌ DON'T - Use NestJS built-in Logger
import { Logger } from '@nestjs/common'; // Missing HIPAA compliance, audit trails, PHI tracking
```

### **Key LoggingService Features**

1. **HIPAA-Compliant PHI Access Logging**
```typescript
// Log PHI access with complete audit trail
await this.loggingService.logPhiAccess(
  userId,
  userRole,
  patientId,
  'VIEW',
  {
    resource: 'MedicalRecord',
    resourceId: recordId,
    clinicId: clinicId,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
    sessionId: request.session.id,
    dataFields: ['diagnosis', 'medications', 'allergies'],
    purpose: 'treatment',
    outcome: 'SUCCESS'
  }
);
```

2. **Multi-Tenant Clinic Logging**
```typescript
// Log operations with clinic isolation
await this.loggingService.logClinicOperation(
  clinicId,
  'APPOINTMENT_CREATED',
  userId,
  {
    appointmentId: appointment.id,
    patientId: appointment.patientId,
    doctorId: appointment.doctorId,
    scheduledTime: appointment.scheduledTime
  }
);
```

3. **Performance Monitoring**
```typescript
// Track operation performance
this.loggingService.logPerformance(
  'database_query',
  duration,
  {
    query: 'findPatientsByClinic',
    recordCount: results.length,
    clinicId: clinicId
  }
);
```

4. **Security Event Logging**
```typescript
// Log security events
await this.loggingService.logSecurity(
  'UNAUTHORIZED_ACCESS_ATTEMPT',
  {
    userId: userId,
    resource: 'PatientRecord',
    resourceId: patientId,
    ipAddress: request.ip,
    reason: 'User lacks READ_PATIENT permission'
  }
);
```

5. **Emergency Logging**
```typescript
// Critical system events
await this.loggingService.logEmergency(
  'Database connection pool exhausted',
  {
    activeConnections: 100,
    queuedRequests: 50,
    clinicsAffected: ['clinic-1', 'clinic-2']
  }
);
```

6. **Batch Logging for High Volume**
```typescript
// Log multiple events efficiently
await this.loggingService.logBatch([
  {
    type: LogType.USER_ACTIVITY,
    level: LogLevel.INFO,
    message: 'User viewed dashboard',
    context: 'DashboardController',
    metadata: { userId, clinicId }
  },
  {
    type: LogType.PERFORMANCE,
    level: LogLevel.INFO,
    message: 'Dashboard loaded',
    context: 'DashboardController',
    metadata: { duration: 150, widgets: 5 }
  }
]);
```

### **LogType Categories**

- **System & Infrastructure**: `SYSTEM`, `ERROR`, `DATABASE`, `CACHE`, `QUEUE`, `PERFORMANCE`
- **Authentication & Security**: `AUTH`, `SECURITY`, `ACCESS_CONTROL`, `LOGIN`, `LOGOUT`
- **Communication**: `REQUEST`, `RESPONSE`, `WEBSOCKET`, `EMAIL`, `SMS`, `NOTIFICATION`
- **Business Operations**: `AUDIT`, `APPOINTMENT`, `BUSINESS`, `PAYMENT`, `USER_ACTIVITY`
- **HIPAA Compliance**: `PHI_ACCESS`, `MEDICAL_RECORD_ACCESS`, `PATIENT_DATA_EXPORT`, `CONSENT_MANAGEMENT`
- **Emergency & Critical**: `EMERGENCY`, `CRITICAL_ALERT`, `INCIDENT`
- **Multi-Tenant**: `CLINIC_OPERATIONS`, `TENANT_ISOLATION`, `MULTI_CLINIC`

### **LogLevel Hierarchy**

- `ERROR` - Critical errors requiring immediate attention
- `WARN` - Warning conditions that should be reviewed
- `INFO` - Informational messages about normal operations
- `DEBUG` - Debug information for development
- `VERBOSE` - Detailed trace information
- `TRACE` - Very detailed diagnostic information

### **Benefits of Custom LoggingService**

✅ **HIPAA Compliance** - Automatic PHI access tracking and audit trails
✅ **Distributed Tracing** - Correlation IDs and trace IDs for request tracking
✅ **Multi-Tenant Support** - Clinic isolation and tenant-specific logging
✅ **Performance Monitoring** - Built-in metrics collection and thresholds
✅ **Security Events** - Comprehensive security event tracking
✅ **Auto-Scaling** - Buffered metrics for 1M+ concurrent users
✅ **Redis Caching** - Fast log retrieval with configurable retention
✅ **Database Integration** - Automatic audit log creation
✅ **Dashboard UI** - Web interface at `/logger` for viewing logs

---

**💡 These architectural patterns ensure scalable, maintainable, and testable code that follows SOLID principles and industry best practices.**

**Last Updated**: December 2024
