# Healthcare Backend - Infrastructure Documentation

**Date**: 2024  
**Status**: ✅ **CONSOLIDATED INFRASTRUCTURE DOCUMENTATION**

---

## 📋 Overview

This document consolidates all infrastructure module documentation from `src/` directory. It provides a single reference point for all core infrastructure components.

---

## 📚 Table of Contents

### Core Infrastructure Services
1. [Configuration Module](#1-configuration-module)
2. [Database Infrastructure](#2-database-infrastructure)
3. [Cache System](#3-cache-system)
4. [Logging Service](#4-logging-service)
5. [Event System](#5-event-system)
6. [Queue System](#6-queue-system)
7. [Framework Abstraction](#7-framework-abstraction)
8. [Storage Service](#8-storage-service)
9. [Search Service](#9-search-service)
10. [HTTP Service](#10-http-service)

### Additional Documentation
11. [Error Handling](#11-error-handling)
12. [Communication Module](#12-communication-module)

---

## 1. Configuration Module

**Location**: `src/config/`
**Individual README**: [Config Module README](../../src/config/README.md)

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
**Individual README**: [Database Service README](../../src/libs/infrastructure/database/README.md)

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
**Individual README**: [Cache Service README](../../src/libs/infrastructure/cache/README.md)

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

## 4. Logging Service

**Location**: `src/libs/infrastructure/logging/`
**Individual README**: [Logging Service README](../../src/libs/infrastructure/logging/README.md)

### Overview

HIPAA-compliant structured logging service with PHI masking, 30-day retention, and 10 log types for healthcare applications.

### Key Features

- ✅ **10 Log Types** - SYSTEM, AUDIT, SECURITY, DATABASE, CACHE, API, ERROR, PERFORMANCE, EMAIL, NOTIFICATION
- ✅ **PHI Masking** - Automatic masking of Protected Health Information
- ✅ **Structured Logging** - JSON-formatted logs with metadata
- ✅ **30-Day Retention** - Automatic log rotation and archival
- ✅ **HIPAA Compliance** - Audit trails for all access to PHI

### Quick Start

```typescript
import { LoggingService, LogType, LogLevel } from '@logging';

@Injectable()
export class MyService {
  constructor(private readonly logger: LoggingService) {}

  async operation() {
    await this.logger.log(
      LogType.AUDIT,
      LogLevel.INFO,
      'Operation executed',
      'MyService',
      { userId: 'user123', action: 'READ' }
    );
  }
}
```

---

## 5. Event System

**Location**: `src/libs/infrastructure/events/`
**Individual README**: [Event Service README](../../src/libs/infrastructure/events/README.md)

### Overview

Central event hub for event-driven architecture with rate limiting, circuit breaker, and event buffering.

### Key Features

- ✅ **Central Event Hub** - Single source of truth for all events
- ✅ **Rate Limiting** - 1000 events/second with burst capacity
- ✅ **Circuit Breaker** - Prevents cascading failures
- ✅ **Event Buffering** - 50,000 events max with overflow protection
- ✅ **PHI Validation** - Automatic PHI masking in events

### Quick Start

```typescript
import { EventService } from '@infrastructure/events';
import { EventCategory, EventPriority } from '@types';

@Injectable()
export class MyService {
  constructor(private readonly eventService: EventService) {}

  async operation() {
    await this.eventService.emitEnterprise('user.created', {
      eventId: `user-created-${userId}`,
      eventType: 'user.created',
      category: EventCategory.USER_ACTIVITY,
      priority: EventPriority.HIGH,
      timestamp: new Date().toISOString(),
      source: 'MyService',
      version: '1.0.0',
      payload: { user },
    });
  }
}
```

---

## 6. Queue System

**Location**: `src/libs/infrastructure/queue/`
**Individual README**: [Queue Service README](./libs/infrastructure/queue/README.md)

### Overview

BullMQ-based queue system with 19 specialized queues for async task processing.

### Key Features

- ✅ **19 Specialized Queues** - Email, notification, reminder, appointment, payment, etc.
- ✅ **Job Retry** - Configurable retry with exponential backoff
- ✅ **Priority Jobs** - High/normal/low priority support
- ✅ **Delayed Jobs** - Schedule jobs for future execution
- ✅ **Repeatable Jobs** - Cron-based recurring jobs

### Quick Start

```typescript
import { QueueService } from '@queue';

@Injectable()
export class MyService {
  constructor(private readonly queueService: QueueService) {}

  async sendEmail(to: string, subject: string) {
    await this.queueService.addJob('email', {
      to,
      subject,
      template: 'welcome',
    });
  }
}
```

---

## 7. Framework Abstraction

**Location**: `src/libs/infrastructure/framework/`
**Individual README**: [Framework Service README](../../src/libs/infrastructure/framework/README.md)

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

## 8. Storage Service

**Location**: `src/libs/infrastructure/storage/`
**Individual README**: [Storage Service README](../../src/libs/infrastructure/storage/README.md)

### Overview

S3-compatible object storage service with pre-signed URLs, multi-bucket support, and CDN integration.

### Key Features

- ✅ **S3 Integration** - AWS S3 object storage
- ✅ **Pre-Signed URLs** - Secure temporary access to files
- ✅ **Multi-Bucket Support** - Separate buckets per clinic/tenant
- ✅ **CDN Integration** - CloudFront for faster delivery
- ✅ **File Validation** - Size and type validation

### Quick Start

```typescript
import { StorageService } from '@infrastructure/storage';

@Injectable()
export class MyService {
  constructor(private readonly storage: StorageService) {}

  async uploadFile(file: Buffer, filename: string) {
    const key = await this.storage.upload('my-bucket', filename, file);
    const url = await this.storage.getPresignedUrl('my-bucket', key, 3600);
    return url;
  }
}
```

---

## 9. Search Service

**Location**: `src/libs/infrastructure/search/`
**Individual README**: [Search Service README](./libs/infrastructure/search/README.md)

### Overview

Elasticsearch-based full-text search with fuzzy matching and database fallback.

### Key Features

- ✅ **Elasticsearch Integration** - Full-text search with relevance scoring
- ✅ **Fuzzy Matching** - Typo-tolerant search
- ✅ **Database Fallback** - Automatic fallback if Elasticsearch unavailable
- ✅ **Index Management** - Automatic index creation and updates
- ✅ **Multi-Tenant** - Clinic-isolated search indices

### Quick Start

```typescript
import { SearchService } from '@infrastructure/search';

@Injectable()
export class MyService {
  constructor(private readonly search: SearchService) {}

  async searchPatients(query: string) {
    const results = await this.search.search('patients', query, {
      fuzzy: true,
      limit: 10,
    });
    return results;
  }
}
```

---

## 10. HTTP Service

**Location**: `src/libs/infrastructure/http/`  
**Individual README**: [HTTP Service README](../../src/libs/infrastructure/http/README.md)

### Overview

Centralized HTTP service for making HTTP requests throughout the application. Wraps NestJS HttpService (axios) to provide consistent error handling, logging, retry logic, and type safety.

### Key Features

- ✅ **Automatic Error Handling** - All errors transformed to HealthcareError
- ✅ **Request/Response Logging** - Automatic logging with LoggingService
- ✅ **Retry Logic** - Configurable retries with exponential backoff
- ✅ **Type-Safe** - Full TypeScript support with generic types
- ✅ **Timeout Management** - Configurable timeouts per request
- ✅ **Health Check Support** - Built-in health check capabilities
- ✅ **SSL Support** - Automatic SSL verification skip in development

### Quick Start

```typescript
import { HttpService } from '@infrastructure/http';

@Injectable()
export class MyService {
  constructor(private readonly httpService: HttpService) {}

  async fetchData() {
    const response = await this.httpService.get<MyType>('https://api.example.com/data', {
      retries: 3,
      timeout: 5000,
    });
    return response.data;
  }
}
```

### Available Methods

- `get<T>(url, options?)` - GET request
- `post<T, D>(url, data?, options?)` - POST request
- `put<T, D>(url, data?, options?)` - PUT request
- `patch<T, D>(url, data?, options?)` - PATCH request
- `delete<T>(url, options?)` - DELETE request
- `head<T>(url, options?)` - HEAD request

### Request Options

```typescript
interface HttpRequestOptions {
  retries?: number;                    // Number of retry attempts (default: 0)
  retryDelay?: number;                 // Retry delay in ms (default: 1000)
  exponentialBackoff?: boolean;        // Use exponential backoff (default: true)
  shouldRetry?: (error: unknown) => boolean; // Custom retry condition
  logRequest?: boolean;                // Whether to log request (default: true)
  timeout?: number;                    // Request timeout in ms
  headers?: Record<string, string>;     // Additional headers
  // ... all AxiosRequestConfig options
}
```

### Response Format

```typescript
interface HttpResponse<T> {
  data: T;                              // Response data (typed)
  status: number;                       // HTTP status code
  statusText: string;                   // HTTP status text
  headers: Record<string, string>;      // Response headers
  config: AxiosRequestConfig;          // Request configuration
  requestDuration: number;              // Request duration in milliseconds
}
```

### Best Practices

1. **Always use centralized HTTP service** - Never use `@nestjs/axios` HttpService directly
2. **Use type generics** - Always specify response type: `get<MyType>(url)`
3. **Configure retries** - Use retries for external API calls: `{ retries: 3 }`
4. **Handle errors** - Errors are automatically transformed to HealthcareError
5. **Use timeouts** - Always set appropriate timeouts for external calls

### Migration from @nestjs/axios

**Before:**
```typescript
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const response = await firstValueFrom(
  this.httpService.get<Data>('https://api.example.com/data')
);
```

**After:**
```typescript
import { HttpService } from '@infrastructure/http';

const response = await this.httpService.get<Data>('https://api.example.com/data');
```

---

## 11. Error Handling

**Location**: `src/libs/core/errors/`
**Individual README**: [Core Library README](./libs/core/README.md#error-handling)

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

## 12. Communication Module

**Location**: `src/libs/communication/`
**Individual README**: [Communication Module README](../../src/libs/communication/README.md)
**WhatsApp Channel**: `src/libs/communication/channels/whatsapp/`

### Overview

Multi-channel communication orchestration with smart routing, supporting Email, WhatsApp, Push, Socket, and SMS channels.

### Key Features

- ✅ **5 Communication Channels** - Email, WhatsApp, Push, Socket, SMS
- ✅ **Smart Channel Selection** - Category-based routing (10 categories)
- ✅ **Multi-Tenant Support** - Provider routing via clinicId
- ✅ **User Preferences** - Channel preferences, quiet hours, category control
- ✅ **Rate Limiting** - Configurable per category
- ✅ **Delivery Tracking** - Database tracking with delivery logs

### Quick Start

```typescript
import { CommunicationService } from '@communication';
import { CommunicationCategory, CommunicationPriority } from '@types';

@Injectable()
export class MyService {
  constructor(private readonly communicationService: CommunicationService) {}

  async sendNotification(userId: string, email: string) {
    return await this.communicationService.send({
      category: CommunicationCategory.APPOINTMENT,
      priority: CommunicationPriority.HIGH,
      title: 'Appointment Reminder',
      body: 'Your appointment is scheduled for tomorrow',
      recipients: [{ userId, email }],
      channels: ['email', 'push', 'socket'], // Optional - auto-selected
    });
  }
}
```

### Supported Channels

1. **Email** - SMTP, SES, SendGrid adapters
2. **WhatsApp** - Meta Business API, Twilio adapters
3. **Push** - Firebase Cloud Messaging (FCM)
4. **Socket** - Real-time via Socket.IO
5. **SMS** - Planned (not yet implemented)

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

// HTTP Service (Centralized)
import { HttpService } from '@infrastructure/http';

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









