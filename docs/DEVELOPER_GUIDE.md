# Developer Guide - Healthcare Backend

**Date**: December 2024  
**Status**: ✅ **COMPLETE**

---

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Configuration Management](#configuration-management)
4. [Environment Variables](#environment-variables)
5. [Common Issues & Solutions](#common-issues--solutions)
6. [Development Best Practices](#development-best-practices)

---

## 🚀 Quick Start

### Prerequisites

- Node.js v16+
- PostgreSQL 14+
- Redis/Dragonfly
- Docker & Docker Compose (optional)

### Setup

```bash
# Clone repository
git clone <repository-url>
cd HealthCareBackend

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
npx prisma migrate dev

# Start development server
npm run start:dev
```

---

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

### Core Principles

1. **Plugin-Based Architecture** - Extensible appointment system
2. **Multi-Tenant Data Isolation** - Complete clinic separation
3. **Enterprise-Grade Infrastructure** - Connection pooling, circuit breakers
4. **Event-Driven Architecture** - Central EventService
5. **RBAC System** - 12 roles, 25+ resources

---

## ⚙️ Configuration Management

### Central Configuration Service

All configuration is managed through `src/config/config.service.ts`:

```typescript
// Access configuration
const configService = app.get(ConfigService);

// Get database config
const dbConfig = configService.getDatabaseConfig();

// Get cache config
const cacheConfig = configService.getCacheConfig();

// Get video config
const videoConfig = configService.getVideoConfig();
```

### Configuration Files

- **Base Config**: `src/config/config.service.ts`
- **Environment Configs**: `src/config/environment/*.config.ts`
- **Feature Configs**: `src/config/*.config.ts` (video, cache, etc.)

### File Priority

Environment variables loaded in order (later overrides earlier):

1. `.env` (base configuration)
2. `.env.{NODE_ENV}` (environment-specific)
3. `.env.local` (local overrides, not committed)

---

## 🔧 Environment Variables

### Quick Reference

**Application**:
```env
NODE_ENV=development
PORT=8088
BASE_URL=http://localhost:8088
API_PREFIX=/api/v1
```

**Database**:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/healthcare
DIRECT_URL=postgresql://user:password@localhost:5432/healthcare
```

**Cache**:
```env
CACHE_ENABLED=true
CACHE_PROVIDER=dragonfly
DRAGONFLY_HOST=localhost
DRAGONFLY_PORT=6379
```

**Video**:
```env
VIDEO_ENABLED=true
VIDEO_PROVIDER=openvidu
OPENVIDU_URL=https://video.yourdomain.com
OPENVIDU_SECRET=your-secret
```

**Complete List**: See `docs/ENVIRONMENT_VARIABLES.md` for all variables.

---

## 🔄 Common Issues & Solutions

### Circular Dependencies

**Problem**: Module A imports Module B, Module B imports Module A.

**Solution 1**: Use `forwardRef()` for module dependencies:

```typescript
// Module A
@Module({
  imports: [forwardRef(() => ModuleB)],
})
export class ModuleA {}

// Module B
@Module({
  imports: [forwardRef(() => ModuleA)],
})
export class ModuleB {}
```

**Solution 2**: Use `forwardRef()` for service injection:

```typescript
constructor(
  @Inject(forwardRef(() => ServiceB))
  private readonly serviceB: ServiceB
) {}
```

**Solution 3**: Extract shared logic to a common module:

```typescript
// SharedModule
@Module({
  providers: [SharedService],
  exports: [SharedService],
})
export class SharedModule {}
```

**Detection**:
```bash
npx madge --circular --extensions ts src/
```

### Database Connection Issues

**Problem**: Connection pool exhausted or timeout errors.

**Solution**:
```env
# Increase connection pool
DB_POOL_SIZE=50
DB_CONNECTION_TIMEOUT=30000
```

**Check Connection Pool**:
```typescript
// Monitor pool usage
const poolStats = await databaseService.getConnectionPoolStats();
```

### Cache Issues

**Problem**: Cache not working or stale data.

**Solution**:
```typescript
// Clear cache
await cacheService.deleteByTag('users');

// Check cache health
const isHealthy = await cacheService.isHealthy();
```

### Video Provider Issues

**Problem**: Video service not working.

**Solution**:
```typescript
// Check provider health
const isHealthy = await videoService.isHealthy();
const provider = videoService.getCurrentProvider();

// Force fallback
process.env.VIDEO_PROVIDER = 'jitsi';
```

---

## 💡 Development Best Practices

### Path Aliases (MANDATORY)

**Always use path aliases**, never relative imports:

```typescript
// ✅ GOOD
import { DatabaseService } from '@database';
import { CacheService } from '@cache';
import { LoggingService } from '@logging';

// ❌ BAD
import { DatabaseService } from '../../../libs/infrastructure/database/database.service';
```

**Available Aliases**:
- `@services/*` → `src/services/*`
- `@infrastructure/*` → `src/libs/infrastructure/*`
- `@dtos/*` → `src/libs/dtos/*`
- `@core/*` → `src/libs/core/*`
- `@config` → `src/config`
- `@logging` → `src/libs/infrastructure/logging`
- `@cache` → `src/libs/infrastructure/cache`
- `@database` → `src/libs/infrastructure/database`

### TypeScript Standards

**Zero Tolerance Rules**:
- ❌ No `any` types
- ❌ No relative imports
- ❌ No `console.log` (use `LoggingService`)
- ❌ No missing error handling
- ❌ No missing input validation

**Example**:
```typescript
// ✅ GOOD
async findUser(id: string): Promise<User | null> {
  if (!id) {
    throw new BadRequestException('User ID is required');
  }
  return await this.databaseService.findUserByIdSafe(id);
}

// ❌ BAD
async findUser(id: any): Promise<any> {
  console.log('Finding user', id);
  return await this.databaseService.findUserByIdSafe(id);
}
```

### Error Handling

**Always use HealthcareError**:
```typescript
import { HealthcareError, ErrorCode } from '@core/errors';

if (!user) {
  throw new HealthcareError(
    ErrorCode.DATABASE_RECORD_NOT_FOUND,
    'User not found',
    undefined,
    { userId: id },
    'UserService.findUser'
  );
}
```

### Logging

**Always use LoggingService**:
```typescript
import { LoggingService, LogType, LogLevel } from '@logging';

await this.loggingService.log(
  LogType.BUSINESS,
  LogLevel.INFO,
  'User created successfully',
  'UserService.createUser',
  { userId: user.id, email: user.email }
);
```

### Database Queries

**Always use safe methods**:
```typescript
// ✅ GOOD - Uses safe method with pagination
const users = await this.databaseService.findUsersSafe(
  { role: 'PATIENT' },
  { take: 100, skip: 0 }
);

// ❌ BAD - Direct Prisma access
const users = await prisma.user.findMany({ where: { role: 'PATIENT' } });
```

### RBAC

**Always protect endpoints**:
```typescript
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
@RequireResourcePermission('appointments', 'read')
@Get(':id')
async getAppointment(@Param('id') id: string) {
  // Implementation
}
```

---

## 📚 Additional Resources

- **API Documentation**: `docs/API_DOCUMENTATION.md`
- **System Architecture**: `docs/architecture/SYSTEM_ARCHITECTURE.md`
- **Infrastructure**: `docs/INFRASTRUCTURE_DOCUMENTATION.md`
- **Role Permissions**: `docs/ROLE_PERMISSIONS_COMPLETE.md`
- **Complete System**: `docs/SYSTEM_COMPLETE.md`

---

**Last Updated**: December 2024  
**Status**: ✅ **COMPLETE**
