# 🏥 HealthCare App - AI Rules Index

> **Comprehensive development guidelines for the HealthCare Backend application**
>
> **Production-Ready System**: Multi-tenant healthcare platform supporting 1M+ concurrent users with 200+ clinics

## 📋 Quick Reference

- [🏗️ Architecture Guidelines](./architecture.md) - SOLID principles, plugin architecture, multi-tenant design
- [📝 Coding Standards](./coding-standards.md) - TypeScript standards, naming conventions, path aliases
- [🗄️ Database Guidelines](./database.md) - PostgreSQL with Prisma, repository patterns, transactions
- [🚀 NestJS Specific](./nestjs-specific.md) - NestJS/Fastify patterns, guards, decorators, events
- [🔒 Security Guidelines](./security.md) - RBAC, session management, HIPAA compliance, audit logging

---

## 🎯 Essential Rules Summary

### **Core Architecture Principles**
- **SOLID Principles**: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion
- **DRY Principle**: Don't Repeat Yourself - extract common functionality into reusable components
- **Multi-Tenant Architecture**: Clinic-based data isolation with comprehensive RBAC (15+ healthcare roles)
- **Event-Driven Architecture**: Use domain events for loose coupling between modules
- **Repository Pattern**: Abstract data access layer with consistent interfaces
- **Plugin Architecture**: Extensible appointment system with lifecycle hooks
- **Resilience Patterns**: Circuit breakers, retry logic, graceful degradation

### **Project Structure**
- ✅ **NestJS with Fastify** (NOT Express)
- ✅ **TypeScript Strict Mode** - No `any` types
- ✅ **PostgreSQL Database** - Single database with multi-tenant clinic isolation
- ✅ **Path Aliases** - Use `@services`, `@infrastructure`, `@communication`, etc. (never relative imports)
- ✅ **Plugin Architecture** - Extensible appointment system with 12+ plugins
- ✅ **Multi-Channel Communication** - Email, SMS, WhatsApp, Push Notifications, WebSocket

### **Code Quality Standards**
```typescript
// Naming Conventions
user.service.ts           // Files: kebab-case
export class UserService  // Classes: PascalCase
const firstName = 'John'  // Variables: camelCase
const JWT_SECRET = 'key'  // Constants: UPPER_SNAKE_CASE
interface IUser {}        // Interfaces: PascalCase with 'I' prefix
```

### **Import Organization**
```typescript
// 1. External imports (Node.js, npm packages)
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

// 2. Internal imports - Infrastructure layer
import { PrismaService } from '@infrastructure/database';
import { RedisService } from '@infrastructure/cache';
import { QueueService } from '@infrastructure/queue';
import { EventsService } from '@infrastructure/events';

// 3. Internal imports - Core layer
import { JwtAuthGuard } from '@core/guards';
import { RbacService } from '@core/rbac';
import { SessionService } from '@core/session';

// 4. Internal imports - Services
import { UserService } from '@services/users';
import { NotificationService } from '@services/notification';
import { AppointmentService } from '@services/appointments';

// 5. Internal imports - Communication
import { WhatsAppService } from '@communication/messaging/whatsapp';
import { EmailService } from '@communication/messaging/email';

// 6. Internal imports - DTOs & Types
import { CreateUserDto, UpdateUserDto } from '@dtos';

// 7. Local imports (same directory)
import { UserRepository } from './user.repository';
```

## 📊 System Overview

### **Technology Stack**
- **Framework**: NestJS 10.x with Fastify 4.x adapter (production-optimized)
- **Language**: TypeScript 5.x (strict mode enabled)
- **Database**: PostgreSQL 14+ with Prisma ORM 5.x
- **Caching**: Redis 6.x with distributed partitioning (16 partitions for 1M+ users)
- **Queue**: BullMQ with 19 specialized queues + Bull Board dashboard
- **Real-time**: WebSocket (Socket.IO 4.x) with Redis adapter for horizontal scaling
- **Communication**: Multi-channel (Email/AWS SES, SMS, WhatsApp Business API, Push/Firebase+SNS)
- **Logging**: Custom `LoggingService` from `@infrastructure/logging` (HIPAA-compliant, structured JSON)
- **Security**: JWT + Redis sessions, progressive lockout, device fingerprinting
- **Monitoring**: Health checks, metrics, Redis Commander, Prisma Studio, custom logger dashboard

### **Key Features**
- **Multi-Tenant**: Up to 200 clinics with complete data isolation via `ClinicGuard`
- **Plugin System**: 12+ appointment lifecycle plugins (analytics, eligibility, payment, video, queue, follow-up, etc.)
- **RBAC System**: 12 healthcare-specific roles (SUPER_ADMIN, CLINIC_ADMIN, DOCTOR, PATIENT, RECEPTIONIST, PHARMACIST, THERAPIST, LAB_TECHNICIAN, FINANCE_BILLING, SUPPORT_STAFF, NURSE, COUNSELOR)
- **Session Management**: Distributed Redis sessions with 16 partitions, max 5 sessions/user, auto-cleanup, suspicious session detection
- **Security Features**:
  - JWT + Enhanced JWT dual verification with token blacklisting
  - Progressive lockout (10m → 25m → 45m → 1h → 6h)
  - Device fingerprinting with SHA-256
  - WebSocket JWT authentication
  - Redis-based rate limiting (sliding window algorithm)
- **Audit Logging**: HIPAA-compliant with `LoggingService` + AuditLog model + Redis security events (30-day retention)
- **Notification System**: Multi-channel delivery (email, SMS, WhatsApp, push) with fallback mechanisms
- **Queue System**: 19 specialized queues for appointments, notifications, billing, EHR, Ayurveda treatments
- **Caching Strategy**: Multi-level with SWR (Stale-While-Revalidate) + Redis Sorted Sets for rate limiting
- **Resilience**: Circuit breakers, retry logic, graceful degradation, fail-open on Redis errors
- **Production Optimizations**: Clustering support, horizontal scaling, compression (gzip/br), Helmet security headers

### **Service Architecture**
```
services/
├── appointments/    # Appointment management with 12+ plugins
│   ├── communications/
│   ├── core/
│   └── plugins/    # Analytics, Eligibility, Payment, Video, Queue, etc.
├── auth/           # Authentication & session management
│   └── core/
├── billing/        # Billing & invoicing with PDF generation
│   ├── controllers/
│   └── dto/
├── clinic/         # Multi-clinic management with location support
│   ├── cliniclocation/
│   ├── dto/
│   ├── services/
│   └── shared/
├── ehr/            # Electronic Health Records
│   ├── controllers/
│   └── dto/
├── health/         # Health monitoring & metrics
├── notification/   # Multi-channel notification orchestration
└── users/          # User management with RBAC
    ├── controllers/
    └── core/
```

### **Infrastructure Components**
```
infrastructure/
├── cache/          # Redis caching with decorators & SWR
│   ├── controllers/
│   ├── decorators/
│   ├── interceptors/
│   └── redis/
├── database/       # Prisma with repository pattern
│   ├── clients/
│   ├── config/
│   ├── interfaces/
│   ├── prisma/
│   ├── repositories/
│   ├── scripts/
│   └── types/
├── events/         # Event-driven architecture
│   └── types/
├── logging/        # Enterprise LoggingService (HIPAA-compliant)
│   ├── logging.controller.ts  # Dashboard UI at /logger
│   ├── logging.service.ts     # Use this for all logging
│   └── types/
└── queue/          # BullMQ queue system (19 queues)
    └── src/
```

### **Communication Layer**
```
communication/
├── messaging/
│   ├── chat/       # Chat message backup
│   ├── email/      # AWS SES integration
│   ├── push/       # Firebase + AWS SNS
│   └── whatsapp/   # WhatsApp Business API
└── socket/         # WebSocket gateway with auth
    ├── base-socket.ts
    ├── event-socket.broadcaster.ts
    └── socket-auth.middleware.ts
```

### **Core Components**
```
core/
├── business-rules/  # Business rule engine
├── decorators/      # Custom decorators
├── errors/          # Healthcare error system
├── filters/         # Exception filters
├── guards/          # Auth & permission guards
├── pipes/           # Validation pipes
├── plugin-interface/# Plugin architecture base
├── rbac/            # Role-based access control
├── resilience/      # Circuit breaker & retry
├── session/         # Session management
└── types/           # Core type definitions
```

## 🔑 Critical Guidelines

### **Use Custom LoggingService (Enterprise-Grade)**
```typescript
// ✅ DO - Use custom LoggingService from @infrastructure/logging
import { Injectable } from '@nestjs/common';
import { LoggingService, LogType, LogLevel } from '@infrastructure/logging';

@Injectable()
export class UserService {
  constructor(private readonly loggingService: LoggingService) {}

  async createUser(data: CreateUserDto): Promise<User> {
    await this.loggingService.log(
      LogType.AUDIT,
      LogLevel.INFO,
      'Creating user',
      'UserService',
      { email: data.email }
    );
    // ...
    await this.loggingService.log(
      LogType.ERROR,
      LogLevel.ERROR,
      'Failed to create user',
      'UserService',
      { error: error.message }
    );
  }
}

// ❌ DON'T - Use NestJS built-in Logger for enterprise features
import { Logger } from '@nestjs/common'; // Missing HIPAA compliance, audit trails, PHI tracking
```

### **Always Use Path Aliases**
```typescript
// ✅ DO
import { UserService } from '@services/users';
import { PrismaService } from '@infrastructure/database';
import { RedisService } from '@infrastructure/cache';

// ❌ DON'T
import { UserService } from '../../../services/users/user.service';
```

### **Clinic Isolation Pattern**
```typescript
// ✅ DO - Always filter by clinicId for multi-tenant data
async findUsers(clinicId: string): Promise<User[]> {
  return this.prisma.$client.user.findMany({
    where: { clinicId, isActive: true }
  });
}

// ❌ DON'T - Query without clinic isolation
async findUsers(): Promise<User[]> {
  return this.prisma.$client.user.findMany();
}
```

### **RBAC & Permissions**
```typescript
// ✅ DO - Use role guards with clinic isolation
import { Roles } from '@core/decorators';
import { Role } from '@infrastructure/database/prisma/prisma.types';
import { JwtAuthGuard, RolesGuard, ClinicGuard } from '@core/guards';

@Controller('patients')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
export class PatientsController {
  @Get()
  @Roles(Role.DOCTOR, Role.NURSE, Role.RECEPTIONIST)
  async getPatients(@Req() request: Request) {
    // request.clinicId is automatically set by ClinicGuard
    // request.user is set by JwtAuthGuard
    return this.patientService.findAll(request.clinicId);
  }

  @Post()
  @Roles(Role.DOCTOR, Role.RECEPTIONIST)
  async createPatient(@Body() createDto: CreatePatientDto, @Req() request: Request) {
    return this.patientService.create(createDto, request.clinicId);
  }
}
```

### **Security Best Practices**
```typescript
// ✅ DO - Use session management for authentication
import { SessionManagementService, CreateSessionDto } from '@core/session';

@Injectable()
export class AuthService {
  constructor(
    private readonly sessionService: SessionManagementService,
    private readonly jwtAuthService: JwtAuthService
  ) {}

  async login(credentials: LoginDto, deviceInfo: DeviceInfo): Promise<AuthResponse> {
    const user = await this.validateCredentials(credentials);

    // Create session with distributed partitioning
    const session = await this.sessionService.createSession({
      userId: user.id,
      clinicId: user.clinicId,
      userAgent: deviceInfo.userAgent,
      ipAddress: deviceInfo.ipAddress,
      deviceId: deviceInfo.deviceId
    });

    // Generate JWT with session ID
    const accessToken = await this.jwtAuthService.generateEnhancedToken({
      sub: user.id,
      sessionId: session.sessionId,
      role: user.role,
      clinicId: user.clinicId
    });

    return { accessToken, session };
  }
}

// ✅ DO - Use rate limiting
import { RateLimitService } from '@infrastructure/utils/rate-limit';

@Injectable()
export class ApiController {
  constructor(private readonly rateLimitService: RateLimitService) {}

  async handleRequest(userId: string) {
    const { limited, remaining } = await this.rateLimitService.isRateLimited(
      userId,
      'api'
    );

    if (limited) {
      throw new TooManyRequestsException(`Rate limit exceeded. ${remaining} requests remaining.`);
    }

    // Process request...
  }
}
```

---

**💡 These guidelines ensure code consistency, maintainability, HIPAA compliance, and production-ready reliability across the healthcare system.**

## 🛡️ Security Summary

### **Implemented Security Features**
- ✅ **JWT Authentication**: Dual verification (basic + enhanced) with Redis token blacklisting
- ✅ **Session Management**: Distributed Redis sessions (16 partitions), 5 sessions/user limit, auto-cleanup
- ✅ **Progressive Lockout**: 10min → 25min → 45min → 1h → 6h based on failed attempts
- ✅ **Rate Limiting**: Redis-based sliding window (1000 req/min), Fastify rate limiting
- ✅ **RBAC**: 12 healthcare roles with route-level guards (`JwtAuthGuard`, `RolesGuard`, `ClinicGuard`)
- ✅ **Multi-Tenant Isolation**: Automatic clinic isolation via `ClinicGuard` with 5-source extraction (headers, query, JWT, params, body)
- ✅ **Security Headers**: Helmet CSP, CORS with origin validation, frame-ancestors protection
- ✅ **WebSocket Security**: JWT auth middleware with session + token support
- ✅ **Audit Logging**: Redis security events (30-day retention) + LoggingService (HIPAA-compliant)
- ✅ **Device Fingerprinting**: SHA-256 user agent hashing
- ✅ **Suspicious Session Detection**: Auto-detection every 30 minutes (multiple IPs, unusual agents, rapid location changes)

### **Production Optimizations**
- ✅ **Horizontal Scaling**: Redis adapter for WebSocket, distributed sessions, clustering support
- ✅ **Compression**: Gzip/Brotli (threshold: 1KB, quality: 4/6)
- ✅ **Connection Pooling**: Prisma connection pooling, Redis connection reuse
- ✅ **Graceful Shutdown**: SIGTERM/SIGINT handlers with 30s timeout
- ✅ **Health Checks**: `/health` endpoint for load balancers
- ✅ **Bot Protection**: Auto-detect and block bot scans (admin, wp-, php, cgi-bin)

---

**System Status**: ✅ Production-Ready | 🚀 Optimized for 1M+ concurrent users | 🏥 Supporting 200+ clinics

**Last Updated**: January 2025
