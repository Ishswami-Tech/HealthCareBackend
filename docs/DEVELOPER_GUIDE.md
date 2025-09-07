# Healthcare Backend - Developer Guide

Complete technical documentation for developers working on the healthcare backend system.

## 🏗️ Architecture Overview

### System Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   API Gateway   │    │   Load Balancer │
│   (Next.js)     │◄──►│   (NestJS)      │◄──►│   (Nginx)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   Application   │
                       │   Layer         │
                       └─────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
        ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
        │ PostgreSQL  │ │    Redis    │ │   BullMQ    │
        │ (Primary)   │ │   (Cache)   │ │  (Queues)   │
        └─────────────┘ └─────────────┘ └─────────────┘
```

### Core Architecture Principles

#### 1. **Plugin-Based Architecture**
- **Domain-Agnostic Core**: Shared functionality across healthcare and fashion domains
- **Plugin System**: Extensible appointment system with domain-specific plugins
- **SOLID & DRY Principles**: Single responsibility, open/closed, dependency inversion

#### 2. **Multi-Tenant Data Isolation**
- **Complete separation** between clinics with row-level security
- **Clinic context** from headers (`X-Clinic-ID`), query params, JWT, or subdomain
- **Scale**: 200 clinics, 50 locations per clinic, 25k patients per clinic
- **HIPAA Compliance**: Audit trails and PHI data protection

#### 3. **Enterprise-Grade Infrastructure**
- **Connection Pooling**: 20-300 connections with intelligent batch processing
- **Circuit Breaker Patterns**: Resilience against database failures
- **Real-time Monitoring**: Health checks and performance metrics
- **Auto-scaling**: Dynamic resource allocation based on load

## 🔧 Development Setup

### Prerequisites
- Node.js v16+
- PostgreSQL v14+
- Redis v6+
- Docker & Docker Compose

### Environment Configuration
```env
# Application
NODE_ENV=development
PORT=8088
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/userdb?schema=public
REDIS_HOST=redis
REDIS_PORT=6379

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=24h

# Enterprise Database
DB_POOL_MIN=20
DB_POOL_MAX=300
DB_CONNECTION_TIMEOUT=10000

# Healthcare
HEALTHCARE_ENABLE_AUDIT_LOGGING=true
HEALTHCARE_ENABLE_PHI_PROTECTION=true
HEALTHCARE_COMPLIANCE_LEVEL=HIPAA
```

### Docker Development
```bash
# Start all services
./run.sh dev start

# View logs
./run.sh dev logs:api
./run.sh dev logs:db
./run.sh dev logs:redis

# Stop services
./run.sh dev stop
```

## 🏗️ Code Architecture

### Complete Module Structure
```
src/
├── config/                    # Configuration modules
│   └── configuration.ts      # Environment-based configuration
├── libs/                     # Shared libraries
│   ├── communication/        # Real-time communication
│   │   ├── messaging/        # Email, SMS, WhatsApp
│   │   ├── socket/          # WebSocket implementation
│   │   └── events/          # Event emitters and handlers
│   ├── core/                # Core utilities and security
│   │   ├── guards/          # Authentication & authorization guards
│   │   ├── rbac/            # Role-based access control
│   │   ├── decorators/      # Custom decorators
│   │   └── filters/         # Exception filters
│   ├── dtos/                # Data Transfer Objects
│   │   ├── auth/            # Authentication DTOs
│   │   ├── users/           # User-related DTOs
│   │   └── shared/          # Common DTOs
│   ├── infrastructure/      # Infrastructure services
│   │   ├── database/        # Prisma, connection pooling, metrics
│   │   ├── cache/           # Redis caching strategies
│   │   ├── queue/           # BullMQ queue management
│   │   ├── logging/         # Enterprise logging system
│   │   └── events/          # Event-driven architecture
│   ├── security/            # Security components
│   │   ├── rate-limiting/   # Rate limiting
│   │   └── encryption/      # Data encryption
│   └── utils/               # Utility functions
├── services/                # Business logic modules
│   ├── auth/               # Authentication with plugin architecture
│   ├── users/              # User management with RBAC
│   ├── clinic/             # Clinic management
│   ├── appointments/       # Appointment system with plugins
│   └── health/             # Health monitoring
├── app.controller.ts        # Main application controller
├── app.module.ts           # Main application module
└── main.ts                 # Application entry point
```

### Application Module Dependencies
```typescript
@Module({
  imports: [
    // Configuration & Core
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    JwtModule.register({ secret: process.env.JWT_SECRET }),
    
    // Infrastructure
    DatabaseModule,
    CacheServiceModule,
    LoggingServiceModule,
    QueueModule.forRoot(),
    SocketModule,
    
    // Business Modules
    AuthModule,
    UsersModule,
    AppointmentsModule,
    ClinicModule,
    HealthModule,
    
    // Communication
    WhatsAppModule,
    BullBoardModule,
  ],
})
export class AppModule {}
```

### Core Services

**Authentication Service** (Plugin-based):
```typescript
@Injectable()
export class AuthService {
  async login(email: string, password: string) {
    // JWT authentication with session management
  }
  
  async requestOTP(identifier: string, deliveryMethod: 'email' | 'sms' | 'whatsapp') {
    // Multi-channel OTP delivery with fallback
  }
}
```

**Appointment Service** (Plugin Architecture):
```typescript
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly coreAppointmentService: CoreAppointmentService,
    private readonly pluginManager: AppointmentEnterprisePluginManager,
    private readonly conflictResolutionService: ConflictResolutionService,
    private readonly workflowEngine: AppointmentWorkflowEngine,
  ) {}
}
```

**Clinic Service** (Enterprise-grade):
```typescript
@Injectable()
export class ClinicService {
  async getClinicDashboardEnterprise(clinicId: string, userId: string) {
    // Enterprise-grade clinic dashboard with metrics
  }
  
  async getClinicPatientsEnterprise(clinicId: string, userId: string, filters: any) {
    // Advanced patient filtering with pagination
  }
}
```

## 🔐 Security Implementation

### Authentication Flow
```typescript
@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

      const payload = await this.jwtService.verifyAsync(token);
      request['user'] = payload;
      
    // Rate limiting and audit logging
      await this.rateLimitService.checkRateLimit(payload.id, request.ip);
    await this.loggingService.log(LogType.AUTH, AppLogLevel.INFO, 'User authenticated');
      
      return true;
  }
}
```

### Role-Based Access Control
```typescript
@Get('patients')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireResourcePermission('patients', 'read')
async getPatients(@Request() req: AuthenticatedRequest) {
  // Implementation with automatic clinic context
}
```

### Healthcare-Specific Roles
- **Administrative**: SUPER_ADMIN, SYSTEM_ADMIN, CLINIC_ADMIN, SUPPORT
- **Medical Staff**: DOCTOR, NURSE, PHARMACIST, LAB_TECHNICIAN, RADIOLOGIST
- **Support Staff**: RECEPTIONIST, MEDICAL_ASSISTANT, BILLING_SPECIALIST
- **Compliance**: AUDITOR, COMPLIANCE_OFFICER, DATA_ANALYST
- **Patients**: PATIENT

## 📊 Infrastructure Components

### Database Layer Architecture

#### **HealthcareDatabaseClient**
```typescript
@Injectable()
export class HealthcareDatabaseClient implements IHealthcareDatabaseClient {
  // Connection pooling for 10M+ users
  // Metrics tracking and monitoring
  // Error handling with RepositoryResult
  // Health monitoring and circuit breakers
  // Transaction support with audit trails
  // Multi-tenant clinic isolation
  // HIPAA compliance features
  
  async executeQuery<T>(query: string, params: any[]): Promise<RepositoryResult<T>> {
    // Circuit breaker pattern
    // Query optimization
    // Audit logging
    // Clinic isolation
  }
}
```

#### **Connection Pool Manager**
```typescript
@Injectable()
export class ConnectionPoolManager {
  // 20-300 connections with intelligent batch processing
  // Circuit breaker patterns for resilience
  // Query queue management (20-100 queries per batch)
  // Health monitoring and auto-scaling
  // Performance metrics tracking
  
  private queryQueue: Array<{
    query: string;
    params: any[];
    options: QueryOptions;
    resolve: (result: any) => void;
    reject: (error: any) => void;
    timestamp: Date;
  }> = [];
}
```

#### **Prisma Service Configuration**
```typescript
@Injectable({ scope: Scope.REQUEST })
export class PrismaService extends PrismaClient {
  private static readonly MAX_CONNECTIONS = 50;
  private static readonly CONNECTION_TIMEOUT = 3000;
  private static readonly QUERY_TIMEOUT = 10000;
  
  // Singleton pattern for connection management
  // Request-scoped for multi-tenancy
  // Automatic retry logic
  // Performance monitoring
}
```

### Caching Strategy

#### **Multi-Level Caching**
```typescript
@Injectable()
export class HealthcareCacheService {
  async get<T>(key: string, clinicId: string): Promise<T | null> {
    // L1: Memory cache (in-memory Map)
    // L2: Redis cache (distributed)
    // Automatic cache invalidation
    // Clinic-specific cache keys
    // TTL-based expiration
  }
  
  // Cache TTL Configuration
  clinicDataTtl: 3600,      // 1 hour
  patientDataTtl: 1800,     // 30 minutes
  appointmentDataTtl: 300,  // 5 minutes
  emergencyDataTtl: 60,     // 1 minute
}
```

### Queue System (19 Specialized Queues)

#### **Queue Configuration**
```typescript
const queueConfigs = [
  // Clinic queues
  { name: APPOINTMENT_QUEUE, concurrency: 50, domain: 'clinic' },
  { name: ENHANCED_APPOINTMENT_QUEUE, concurrency: 30, domain: 'clinic' },
  { name: NOTIFICATION_QUEUE, concurrency: 100, domain: 'clinic' },
  { name: EMAIL_QUEUE, concurrency: 80, domain: 'clinic' },
  { name: VIDHAKARMA_QUEUE, concurrency: 20, domain: 'clinic' },
  { name: PANCHAKARMA_QUEUE, concurrency: 20, domain: 'clinic' },
  { name: CHEQUP_QUEUE, concurrency: 25, domain: 'clinic' },
  { name: AYURVEDA_THERAPY_QUEUE, concurrency: 15, domain: 'clinic' },
  { name: SERVICE_QUEUE, concurrency: 40, domain: 'clinic' },
  { name: DOCTOR_AVAILABILITY_QUEUE, concurrency: 30, domain: 'clinic' },
  { name: QUEUE_MANAGEMENT_QUEUE, concurrency: 20, domain: 'clinic' },
  { name: WAITING_LIST_QUEUE, concurrency: 25, domain: 'clinic' },
  { name: PAYMENT_PROCESSING_QUEUE, concurrency: 35, domain: 'clinic' },
  { name: CALENDAR_SYNC_QUEUE, concurrency: 20, domain: 'clinic' },
  { name: PATIENT_PREFERENCE_QUEUE, concurrency: 15, domain: 'clinic' },
  { name: ANALYTICS_QUEUE, concurrency: 25, domain: 'clinic' },
  { name: REMINDER_QUEUE, concurrency: 40, domain: 'clinic' },
  { name: FOLLOW_UP_QUEUE, concurrency: 30, domain: 'clinic' },
  { name: RECURRING_APPOINTMENT_QUEUE, concurrency: 20, domain: 'clinic' },
];
```

#### **Queue Management Features**
- **Priority-based processing**: Critical queues get higher priority
- **Retry mechanisms**: Exponential backoff for failed jobs
- **Dead letter queues**: Failed job handling and analysis
- **Real-time monitoring**: Queue health and performance metrics
- **Auto-scaling**: Dynamic worker allocation based on load

### Logging System

#### **Enterprise Logging Service**
```typescript
@Injectable()
export class LoggingService {
  // Enterprise-grade logging for 1M+ users
  // HIPAA-compliant PHI audit logging
  // Real-time performance monitoring
  // Multi-tenant clinic isolation
  // Advanced security event tracking
  // Circuit breaker patterns for resilience
  
  private readonly maxBufferSize = 10000; // Increased for 1M users
  private readonly flushInterval = 5000; // 5 seconds for 1M users
  
  async log(
    type: LogType,
    level: AppLogLevel,
    message: string,
    source: string,
    metadata?: any
  ) {
    // Structured logging with correlation IDs
    // HIPAA compliance features
    // Performance metrics buffering
    // Multi-tenant isolation
  }
}
```

### Communication Infrastructure

#### **WebSocket Implementation**
```typescript
@Injectable()
@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 60000,
})
export class BaseSocket {
  // Real-time communication
  // Room-based messaging
  // Connection management
  // Reconnection handling
  // Client metadata tracking
}
```

#### **Event-Driven Architecture**
```typescript
@Injectable()
export class EnterpriseEventService {
  // Event-driven architecture with HIPAA compliance
  // Circuit breaker patterns
  // Event buffering for high volume
  // Multi-tenant event isolation
  // Performance monitoring
}
```

## 🧪 Testing

### Unit Testing
```typescript
describe('ClinicService', () => {
  let service: ClinicService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClinicService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ClinicService>(ClinicService);
  });

  it('should create a clinic', async () => {
    const result = await service.create(clinicData);
    expect(result).toBeDefined();
  });
});
```

### Integration Testing
```typescript
describe('ClinicController (e2e)', () => {
  it('/clinics (GET)', () => {
    return request(app.getHttpServer())
      .get('/clinics')
      .set('Authorization', 'Bearer valid-jwt-token')
      .set('X-Clinic-ID', 'test-clinic-001')
      .expect(200);
  });
});
```

## 📈 Performance Optimization

### Database Performance
- **300 DB connections** (vs previous 100)
- **Intelligent query batching** (20-100 queries per batch)
- **Circuit breaker patterns** for resilience
- **Real-time health monitoring**

### Caching Strategy
- **Redis with 1GB memory** allocation
- **LRU eviction policy**
- **Multi-level caching** (memory + Redis)
- **Healthcare-specific cache keys**

### Queue System
- **19 specialized queues** for different operations
- **Priority-based processing**
- **Retry mechanisms** with exponential backoff
- **Dead letter queues** for failed jobs

## 📈 Monitoring & Debugging

### Health Checks
- `/health` - Basic health check
- `/health/detailed` - Comprehensive system status
- `/health/api` - API-specific health

### Performance Monitoring
```typescript
@Injectable()
export class MetricsService {
  recordTiming(key: string, duration: number) {
    this.incrementCounter(`${key}.count`);
    this.incrementCounter(`${key}.total`, duration);
    this.setGauge(`${key}.avg`, this.getAverage(key));
  }
}
```

### Logging
```typescript
@Injectable()
export class LoggingService {
  async log(type: LogType, level: AppLogLevel, message: string, source: string, metadata?: any) {
    const logEntry = {
      type, level, message, source, metadata,
      timestamp: new Date(),
      clinicId: this.getCurrentClinicId(),
      userId: this.getCurrentUserId(),
    };
    
    await this.prisma.log.create({ data: logEntry });
    await this.redis.lpush('recent-logs', JSON.stringify(logEntry));
  }
}
```

## 🚀 Deployment

### Docker Production
```dockerfile
FROM node:16-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:16-alpine AS production
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 8088
CMD ["node", "dist/main.js"]
```

### Environment-Specific Configuration
```env
# Production
NODE_ENV=production
DATABASE_URL=postgresql://user:password@postgres:5432/userdb?schema=public
JWT_SECRET=super-secure-production-secret
HEALTHCARE_ENABLE_AUDIT_LOGGING=true
```

## 🔧 Troubleshooting

### Common Issues

**Database Connection Issues**:
```bash
# Check database connectivity
npm run db:health
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity;"
```

**Redis Connection Issues**:
```bash
# Check Redis connectivity
redis-cli ping
redis-cli info stats
```

**Queue Processing Issues**:
```bash
# Check queue status
curl http://localhost:8088/queue-dashboard
curl http://localhost:8088/queue/metrics
```

### Performance Debugging
```sql
-- Find slow queries
SELECT query, mean_time, calls, total_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

## 📊 Expected Performance

### Database Queries
- **Before**: 170-380ms for common queries
- **After**: 50-150ms (60-70% improvement)

### System Capacity
- **Response Time**: < 100ms
- **Cache Hit Ratio**: > 80%
- **API Availability**: 99.9%
- **Concurrent Users**: 10+ lakh users
- **Clinics Supported**: Up to 200 clinics

## 🔧 Available Scripts

```json
{
  "scripts": {
    "build": "nest build",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "prisma:seed": "ts-node src/libs/infrastructure/database/prisma/seed.ts",
    "prisma:studio": "prisma studio",
    "test": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "test:cov": "jest --coverage"
  }
}
```

## 🏥 Service-Specific Documentation

### Authentication Service
- **Location**: `src/services/auth/`
- **Documentation**: `src/services/auth/Auth.readme.md`
- **Features**: Plugin-based architecture, multi-domain support, OTP delivery

### User Management
- **Location**: `src/services/users/`
- **Documentation**: `src/services/users/UserServiceReadme.md`
- **Features**: RBAC, clinic isolation, profile management

### Appointment System
- **Location**: `src/services/appointments/`
- **Documentation**: `src/services/appointments/ARCHITECTURE.md`
- **Features**: Plugin architecture, conflict resolution, workflow engine

### Clinic Management
- **Location**: `src/services/clinic/`
- **Documentation**: `src/services/clinic/README.md`
- **Features**: Multi-tenant, enterprise dashboard, patient management

### Infrastructure Services
- **Database**: `src/libs/infrastructure/database/`
- **Caching**: `src/libs/infrastructure/cache/`
- **Queue**: `src/libs/infrastructure/queue/`
- **Logging**: `src/libs/infrastructure/logging/`
- **Communication**: `src/libs/communication/` (WhatsApp, WebSocket, Events)

## 🔧 Development Workflow

### Code Organization
- **Services**: Business logic in `src/services/`
- **Infrastructure**: Shared utilities in `src/libs/infrastructure/`
- **Core**: Security and utilities in `src/libs/core/`
- **Communication**: Real-time features in `src/libs/communication/`

### Best Practices
- **Multi-tenancy**: Always use clinic context for data operations
- **Error Handling**: Use RepositoryResult pattern for database operations
- **Logging**: Include clinic ID and user ID in all log entries
- **Caching**: Use clinic-specific cache keys
- **Security**: Apply RBAC guards to all protected endpoints

### Adding New Features
1. Create service in appropriate `src/services/` directory
2. Add module to `app.module.ts` imports
3. Implement proper error handling and logging
4. Add RBAC permissions if needed
5. Update API documentation
6. Write unit and integration tests

This developer guide provides all the essential technical information needed to work with the healthcare backend system. For API-specific documentation, see [API Documentation](api/README.md).