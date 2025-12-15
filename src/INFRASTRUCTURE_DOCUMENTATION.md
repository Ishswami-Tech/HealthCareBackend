# Healthcare Backend - Infrastructure Documentation

**Date**: 2024  
**Status**: ✅ **CONSOLIDATED INFRASTRUCTURE DOCUMENTATION**

---

## 📋 Overview

This document consolidates all infrastructure module documentation from `src/` directory. It provides a single reference point for all core infrastructure components.

---

## 📚 Table of Contents

1. [Configuration Module](#configuration-module)
2. [Database Infrastructure](#database-infrastructure)
3. [Cache System](#cache-system)
4. [Framework Abstraction](#framework-abstraction)
5. [Error Handling](#error-handling)
6. [WhatsApp Integration](#whatsapp-integration)

---

## 1. Configuration Module

**Location**: `src/config/`

### Overview

Centralized configuration service providing a single source of truth for all application configuration. All environment variables are loaded through dotenv and accessed via `ConfigService`.

### Key Features

- ✅ Single source of truth for all configuration
- ✅ Type-safe configuration getters
- ✅ Environment file priority: `.env.local` → `.env.{NODE_ENV}` → `.env`
- ✅ Docker-aware defaults
- ✅ Typed configuration methods

### Quick Start

```typescript
import { ConfigService } from '@config';

@Injectable()
export class MyService {
  constructor(private readonly config: ConfigService) {}

  getConfig() {
    // Application config
    const appConfig = this.config.getAppConfig();
    const port = appConfig.port;

    // Database config
    const dbConfig = this.config.getDatabaseConfig();

    // Cache config
    const cacheProvider = this.config.getCacheProvider(); // 'redis' | 'dragonfly' | 'memory'
    const cacheHost = this.config.getCacheHost(); // Docker-aware

    // JWT config
    const jwtConfig = this.config.getJwtConfig();
  }
}
```

### Available Configuration Methods

- **Application**: `getAppConfig()`, `isDevelopment()`, `isProduction()`
- **Database**: `getDatabaseConfig()`
- **Cache**: `getCacheConfig()`, `getCacheProvider()`, `getCacheHost()`, `getCachePort()`
- **JWT**: `getJwtConfig()`
- **Rate Limiting**: `getRateLimitConfig()`, `getEnhancedRateLimitConfig()`
- **Logging**: `getLoggingConfig()`
- **Email**: `getEmailConfig()`
- **CORS**: `getCorsConfig()`
- **Security**: `getSecurityConfig()`
- **WhatsApp**: `getWhatsappConfig()`

### Best Practices

1. **Always use ConfigService** - Never access `process.env` directly
2. **Use typed getters** - Prefer `getAppConfig()` over `getEnv()`
3. **Use ENV_VARS constants** - Use constants from `@config/constants`
4. **Provide defaults** - Always provide default values

---

## 2. Database Infrastructure

**Location**: `src/libs/infrastructure/database/`

### Overview

Single unified database service optimized for **10 million+ users** with enterprise-grade patterns and HIPAA compliance.

### Key Features

- ✅ **Single Entry Point**: Only `DatabaseService` is the public interface
- ✅ **Connection Pooling**: Optimized for 10M+ users (500 max connections)
- ✅ **Query Optimization**: Automatic query analysis and optimization
- ✅ **Caching**: Redis-based caching with SWR (Stale-While-Revalidate)
- ✅ **Multi-Tenant Isolation**: Clinic-based data isolation
- ✅ **HIPAA Compliance**: Audit logging, encryption, access controls
- ✅ **Read Replicas**: Support for read scaling
- ✅ **Transaction Support**: ACID-compliant transactions with retry logic

### Quick Start

```typescript
import { DatabaseService } from "@infrastructure/database";

@Injectable()
export class UserService {
  constructor(private readonly database: DatabaseService) {}

  async findUser(id: string) {
    return await this.database.executeHealthcareRead(async (client) => {
      return await client.user.findUnique({ where: { id } });
    });
  }

  async createUser(userData: CreateUserInput) {
    return await this.database.executeHealthcareWrite(
      async (client) => {
        return await client.user.create({ data: userData });
      },
      {
        userId: 'system',
        action: 'CREATE_USER',
        resourceType: 'User',
      }
    );
  }

  async createUserWithProfile(userData: CreateUserInput, profileData: CreateProfileInput) {
    return await this.database.executeInTransaction(async (tx) => {
      const user = await tx.user.create({ data: userData });
      const profile = await tx.profile.create({
        data: { ...profileData, userId: user.id },
      });
      return { user, profile };
    });
  }
}
```

### Connection Pooling

**Configuration** (optimized for 10M+ users):
- **Min Connections**: 50 (warm pool)
- **Max Connections**: 500 (scalable pool)
- **Connection Timeout**: 30 seconds
- **Query Timeout**: 15 seconds
- **Auto-Scaling**: CPU threshold 75%, Connection threshold 400 (80% of max)

### HIPAA Compliance

- **Audit Logging**: All write operations logged (7 years retention)
- **Data Encryption**: AES-256 at rest, SSL/TLS in transit
- **Access Controls**: Role-based, clinic-based, location-based
- **Data Retention**: Patient records (30 years), Medical history (lifetime)

---

## 3. Cache System

**Location**: `src/libs/infrastructure/cache/`

### Overview

High-performance, robust, and scalable caching implementation with Stale-While-Revalidate support, designed to handle 10+ million users with enterprise-grade features.

### Key Features

- ✅ **SWR (Stale-While-Revalidate)** - Returns stale data immediately while updating in background
- ✅ **Provider-Agnostic** - Supports Redis and Dragonfly (26x faster than Redis)
- ✅ **Multi-Layer Caching** - L1 (In-Memory) → L2 (Redis/Dragonfly) → L3 (Database)
- ✅ **Tag-based Invalidation** - Group related cache entries for easier invalidation
- ✅ **Healthcare Compliance** - HIPAA-compliant caching with PHI protection
- ✅ **Enterprise Scalability** - Connection pooling, sharding, load balancing
- ✅ **Circuit Breaking** - Prevents cascading failures during outages

### Quick Start

```typescript
import { Cache } from '@core/decorators';
import { CacheService } from '@infrastructure/cache';

// Using decorator
@Controller('users')
export class UsersController {
  @Get()
  @Cache({ ttl: 1800, tags: ['users'] })
  async getAllUsers() {
    return this.usersRepository.find();
  }
}

// Using service
@Injectable()
export class UserService {
  constructor(private readonly cacheService: CacheService) {}

  async getUser(id: string) {
    return this.cacheService.cache(
      `user:${id}`,
      () => this.userRepository.findById(id),
      { ttl: 3600 }
    );
  }
}
```

### Multi-Layer Cache Architecture

```
L1: In-Memory Cache (~0.1ms) → L2: Redis/Dragonfly (~1-5ms) → L3: Database (~10-100ms)
```

**Performance Benefits**:
- **L1 Hit**: ~0.1ms (10-100x faster)
- **L2 Hit**: ~1-5ms (2-5x faster)
- **L3 Hit**: ~10-100ms (source of truth)
- **Overall**: 20-30% reduction in database load

### Cache Decorator Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| ttl | number | 3600 | Cache time-to-live in seconds |
| keyTemplate | string | Class+Method | Cache key template with placeholders |
| enableSWR | boolean | true | Whether to use SWR caching |
| staleTime | number | ttl/2 | When data becomes stale |
| tags | string[] | [] | Tags for grouped invalidation |
| compress | boolean | false | Whether to compress large data |
| containsPHI | boolean | false | Contains Protected Health Information |
| complianceLevel | 'standard'\|'sensitive'\|'restricted' | 'standard' | Compliance level |

### TTL Guidelines

- **Real-time data**: 0 seconds (no cache)
- **Emergency data**: 300 seconds (5 minutes)
- **Frequently changing data**: 300-900 seconds (5-15 minutes)
- **Semi-static data**: 1800-3600 seconds (30-60 minutes)
- **Static data**: 86400 seconds (24 hours)

---

## 4. Framework Abstraction

**Location**: `src/libs/infrastructure/framework/`

### Overview

Complete abstraction layer for NestJS and Fastify, centralizing all framework-specific code and providing a clean, type-safe API for application bootstrap.

### Key Features

- ✅ **Framework Abstraction**: Easy to switch between Fastify and Express
- ✅ **Type Safety**: Full TypeScript support with no `any` types
- ✅ **Centralized Code**: All framework code in one place
- ✅ **SOLID Principles**: Single responsibility, dependency inversion
- ✅ **Fastify-Only**: Per AI rules, only Fastify is supported

### Components

1. **ServiceContainer** - Type-safe service retrieval from NestJS DI container
2. **MiddlewareManager** - Framework-agnostic middleware configuration
3. **ApplicationLifecycleManager** - Manages complete application lifecycle
4. **ServerConfigurator** - Centralizes server configuration
5. **BootstrapOrchestrator** - High-level orchestrator for complete bootstrap process

### Quick Start

```typescript
import {
  createFrameworkAdapter,
  BootstrapOrchestrator
} from '@infrastructure/framework';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const frameworkAdapter = createFrameworkAdapter();

  const orchestrator = new BootstrapOrchestrator(
    frameworkAdapter,
    logger
  );

  const context = await orchestrator.bootstrap({
    appModule: AppModule,
    applicationConfig: {
      environment: 'production',
      isHorizontalScaling: false,
      instanceId: '1',
      trustProxy: true,
      bodyLimit: 50 * 1024 * 1024,
    },
    middlewareConfig: {
      validationPipe: { transform: true, whitelist: true },
      enableVersioning: true,
      globalPrefix: 'api/v1',
    },
    serverConfig: {
      port: 8088,
      host: '0.0.0.0'
    },
    logger
  });
}
```

---

## 5. Error Handling

**Location**: `src/libs/core/errors/`

### Overview

Simple, robust error handling system for healthcare applications with comprehensive error types and automatic logging.

### Quick Start

```typescript
import { HealthcareErrorsService } from '@core/errors';

@Injectable()
export class UserService {
  constructor(private readonly errors: HealthcareErrorsService) {}

  async findUser(userId: string) {
    const user = await this.userRepository.findById(userId);
    
    if (!user) {
      throw this.errors.userNotFound(userId, 'UserService.findUser');
    }
    
    return user;
  }
}
```

### Available Error Methods

#### Authentication & Authorization
- `invalidCredentials(context?)` - Invalid login credentials
- `tokenExpired(context?)` - JWT token expired
- `insufficientPermissions(context?)` - User lacks required permissions
- `accountLocked(context?)` - Account temporarily locked
- `otpInvalid(context?)` - Invalid OTP code

#### User Management
- `userNotFound(userId?, context?)` - User not found
- `userAlreadyExists(email?, context?)` - User already exists
- `emailAlreadyExists(email, context?)` - Email already in use

#### Clinic Management
- `clinicNotFound(clinicId?, context?)` - Clinic not found
- `clinicAccessDenied(clinicId?, context?)` - No access to clinic

#### Appointments
- `appointmentNotFound(appointmentId?, context?)` - Appointment not found
- `appointmentConflict(appointmentId?, context?)` - Appointment conflict
- `appointmentSlotUnavailable(slot?, context?)` - Time slot unavailable

#### Validation
- `validationError(field, message?, context?)` - General validation error
- `invalidEmail(email?, context?)` - Invalid email format
- `invalidPhone(phone?, context?)` - Invalid phone format
- `invalidUuid(id?, context?)` - Invalid UUID format

#### HIPAA & Compliance
- `hipaaViolation(violation?, context?)` - HIPAA violation
- `phiAccessUnauthorized(patientId?, context?)` - Unauthorized PHI access
- `consentExpired(patientId?, context?)` - Patient consent expired

### Error Response Format

```json
{
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "User not found. Please check the user ID and try again.",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

---

## 6. WhatsApp Integration

**Location**: `src/libs/communication/channels/whatsapp/`

### Overview

WhatsApp Business API integration for sending OTPs, appointment reminders, and prescription notifications.

### Prerequisites

1. Meta Developer account
2. WhatsApp Business account
3. Verified phone number
4. Approved message templates

### Configuration

```env
# WhatsApp Configuration
WHATSAPP_ENABLED=true
WHATSAPP_API_URL=https://graph.facebook.com/v17.0
WHATSAPP_API_KEY=your-whatsapp-api-key
WHATSAPP_PHONE_NUMBER_ID=your-whatsapp-phone-number-id
WHATSAPP_BUSINESS_ACCOUNT_ID=your-whatsapp-business-account-id
WHATSAPP_OTP_TEMPLATE_ID=your_otp_template_name
WHATSAPP_APPOINTMENT_TEMPLATE_ID=your_appointment_template_name
WHATSAPP_PRESCRIPTION_TEMPLATE_ID=your_prescription_template_name
```

### Usage

```typescript
// Sending OTP
POST /auth/request-otp
{
  "email": "user@example.com",
  "deliveryMethod": "whatsapp"
}

// Sending Appointment Reminder
await whatsAppService.sendAppointmentReminder(
  phoneNumber,
  patientName,
  doctorName,
  appointmentDate,
  appointmentTime,
  location
);

// Sending Prescription Notification
await whatsAppService.sendPrescriptionNotification(
  phoneNumber,
  patientName,
  doctorName,
  medicationDetails,
  prescriptionUrl
);
```

---

## 📚 Quick Reference

### Import Paths

```typescript
// Configuration
import { ConfigService } from '@config';

// Database
import { DatabaseService } from '@infrastructure/database';

// Cache
import { CacheService } from '@infrastructure/cache';
import { Cache } from '@core/decorators';

// Framework
import { BootstrapOrchestrator } from '@infrastructure/framework';

// Errors
import { HealthcareErrorsService } from '@core/errors';
```

### Common Patterns

```typescript
// Configuration
const config = this.config.getAppConfig();

// Database Read
await this.database.executeHealthcareRead(async (client) => {
  return await client.user.findUnique({ where: { id } });
});

// Database Write
await this.database.executeHealthcareWrite(
  async (client) => {
    return await client.user.create({ data });
  },
  { userId, action, resourceType }
);

// Cache with Decorator
@Cache({ ttl: 1800, tags: ['users'] })
async getUsers() { }

// Cache with Service
await this.cacheService.cache(key, fetchFn, { ttl: 3600 });

// Error Handling
throw this.errors.userNotFound(userId, 'Service.method');
```

---

---

**Last Updated**: 2024  
**Status**: ✅ **CONSOLIDATED - ALL INFRASTRUCTURE DOCUMENTATION**

