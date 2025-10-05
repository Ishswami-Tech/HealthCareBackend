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
- **Framework**: NestJS 9.x with Fastify adapter
- **Language**: TypeScript (strict mode)
- **Database**: PostgreSQL 14+ with Prisma ORM
- **Caching**: Redis 6.x with multi-level caching strategy
- **Queue**: BullMQ with 19 specialized queues
- **Real-time**: WebSocket with Socket.IO
- **Communication**: Multi-channel (Email/AWS SES, SMS, WhatsApp/Business API, Push/Firebase+SNS)
- **Logging**: Custom LoggingService from `@infrastructure/logging` (enterprise-grade with HIPAA compliance)

### **Key Features**
- **Multi-Tenant**: Up to 200 clinics with complete data isolation
- **Plugin System**: 12+ appointment lifecycle plugins (analytics, eligibility, payment, video, etc.)
- **RBAC System**: 15+ healthcare-specific roles with resource-level permissions
- **Session Management**: Multi-device support with Redis-backed sessions
- **Audit Logging**: HIPAA-compliant comprehensive audit trails
- **Notification System**: Multi-channel delivery with fallback mechanisms
- **Queue System**: Specialized queues for appointments, notifications, billing, EHR, Ayurveda treatments
- **Caching Strategy**: Multi-level with SWR (Stale-While-Revalidate) pattern
- **Resilience**: Circuit breakers, retry logic, graceful degradation

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
// ✅ DO - Use permission guards
@Get('patients')
@RequirePermissions('READ_PATIENT')
@UseGuards(JwtAuthGuard, PermissionGuard)
async getPatients(@RequestContext() context: RequestContext) {
  return this.userService.findPatients(context.clinicId);
}
```

---

**💡 These guidelines ensure code consistency, maintainability, HIPAA compliance, and production-ready reliability across the healthcare system.**

**System Status**: Production-Ready | Supporting 1M+ concurrent users | 200+ clinics

**Last Updated**: January 2025
