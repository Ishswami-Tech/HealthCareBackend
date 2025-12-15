# Core Library

**Purpose:** Enterprise core utilities, business logic, and shared types
**Location:** `src/libs/core`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
// Business Rules Engine
import { BusinessRulesEngine } from '@core';

const ruleEngine = app.get(BusinessRulesEngine);
const result = ruleEngine.evaluateRules(context, 'appointment_creation');

// RBAC
import { RbacService } from '@core';
import { Roles, Public } from '@core/decorators';

@Controller('users')
export class UserController {
  @Get()
  @Roles('DOCTOR', 'NURSE')
  async getUsers() { ... }

  @Post('login')
  @Public() // Bypass authentication
  async login() { ... }
}

// Guards
import { JwtAuthGuard, RolesGuard, ClinicGuard } from '@core/guards';

@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
export class ProtectedController { ... }

// Error Handling
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

throw new HealthcareError(
  ErrorCode.USER_NOT_FOUND,
  'User not found',
  undefined,
  { userId },
  'UserService.findOne'
);

// Types
import type { User, Appointment, RequestContext } from '@core/types';
```

---

## Key Features

- ✅ **Business Rules Engine** - Rule-based validation and workflow automation
- ✅ **RBAC System** - 12 healthcare roles, 140+ permissions
- ✅ **Session Management** - Multi-device session tracking (max 5 per user)
- ✅ **Plugin Interface** - Extensible plugin architecture (14 appointment plugins)
- ✅ **Error Handling** - HealthcareError with error codes
- ✅ **Guards** - JWT, Roles, Clinic isolation, RBAC, IP whitelist
- ✅ **Decorators** - @Roles, @Public, @Clinic, @Permissions, @Cache, @RateLimit
- ✅ **Filters** - HTTP exception filter with HIPAA compliance
- ✅ **Interceptors** - Healthcare cache interceptor
- ✅ **Resilience** - Circuit breaker, graceful shutdown
- ✅ **Shared Types** - Single source of truth for all domain types

---

## Components (11)

1. **Business Rules Engine** - Rule-based validation
2. **RBAC** - Role-Based Access Control
3. **Session Management** - Multi-device session tracking
4. **Plugin Interface** - Plugin registry and manager
5. **Error Handling** - HealthcareError, error codes
6. **Guards** - Authentication and authorization guards
7. **Decorators** - Custom route/method decorators
8. **Filters** - Exception filters
9. **Interceptors** - Cache interceptors
10. **Resilience** - Circuit breaker, graceful shutdown
11. **Types** - Shared domain types

---

## Business Rules Engine

Rule-based validation and workflow automation:

```typescript
import { BusinessRulesEngine } from '@core';

// Register a business rule
const rule: BusinessRule = {
  id: 'no-weekend-appointments',
  name: 'Prevent weekend appointments',
  description: 'Block appointments on weekends',
  category: 'appointment_creation',
  priority: 100,
  isActive: true,
  conditions: [
    {
      field: 'data.appointment.time',
      type: 'custom',
      value: null,
      operator: 'AND',
    }
  ],
  actions: [
    {
      type: 'block',
      message: 'Weekend appointments are not allowed',
    }
  ],
};

ruleEngine.registerRule(rule);

// Evaluate rules
const result = ruleEngine.evaluateRules(context, 'appointment_creation');

if (!result.valid) {
  throw new BadRequestException(result.violations.join(', '));
}
```

**Rule Categories:**
- `appointment_creation`
- `appointment_update`
- `appointment_cancellation`
- `user_access`
- `data_integrity`

**Condition Types:** equals, not_equals, greater_than, less_than, contains, not_contains, is_empty, is_not_empty, custom

**Action Types:** block, warn, allow, log, notify, require_approval

---

## RBAC (Role-Based Access Control)

12 healthcare roles with permission management:

```typescript
import { RbacService } from '@core';

// Check permission
const check = await this.rbacService.checkPermission({
  userId: 'user123',
  clinicId: 'clinic-abc',
  resource: 'appointments',
  action: 'create',
  resourceId: 'appt-456', // Optional for ownership checks
});

if (!check.hasPermission) {
  throw new ForbiddenException(check.reason);
}

// Assign role
await this.rbacService.assignRole(
  userId,
  roleId,
  clinicId,
  assignedBy,
  expiresAt
);

// Revoke role
await this.rbacService.revokeRole(userId, roleId, clinicId, revokedBy);

// Get user roles
const roles = await this.rbacService.getUserRoles(userId, clinicId);

// Get permissions summary
const summary = await this.rbacService.getUserPermissionsSummary(userId, clinicId);
```

**12 Healthcare Roles:**
- SUPER_ADMIN - Full system access
- CLINIC_ADMIN - Clinic management
- DOCTOR - Medical operations
- NURSE - Patient care
- RECEPTIONIST - Front desk
- PATIENT - Self-service
- PHARMACIST - Pharmacy operations
- THERAPIST - Therapy services
- LAB_TECHNICIAN - Lab operations
- FINANCE_BILLING - Billing operations
- SUPPORT_STAFF - Support operations
- COUNSELOR - Counseling services

**Permission Format:** `resource:action`
- Examples: `appointments:create`, `patients:read`, `medical-records:*`, `*`

**Ownership-Based Access:**
- Automatic ownership checks for: profile, user, appointments, medical-records, patients
- Patients can update their own appointments
- Users can read/update their own profile

---

## Session Management

Multi-device session tracking with suspicious activity detection:

```typescript
import { SessionManagementService } from '@core/session';

// Create session
const session = await this.sessionManagementService.createSession({
  userId: 'user123',
  userAgent: req.headers['user-agent'],
  ipAddress: req.ip,
  deviceInfo: {
    browser: 'Chrome',
    os: 'Windows',
    device: 'Desktop',
  },
});

// Validate session
const isValid = await this.sessionManagementService.validateSession(
  sessionId,
  userId,
  ipAddress,
  userAgent
);

// Get user sessions
const sessions = await this.sessionManagementService.getUserSessions(userId);

// Revoke session
await this.sessionManagementService.revokeSession(sessionId, userId);

// Revoke all sessions (except current)
await this.sessionManagementService.revokeAllUserSessions(userId, currentSessionId);
```

**Session Features:**
- **Max 5 sessions** per user (oldest auto-revoked)
- **16 Redis partitions** for distributed storage
- **Suspicious activity detection** every 30 minutes
- **HIPAA-compliant** audit logging

---

## Plugin Interface

Extensible plugin architecture:

```typescript
import { AppointmentPlugin, PluginContext } from '@core/plugin-interface';

@Injectable()
export class MyPlugin implements AppointmentPlugin {
  name = 'my-plugin';
  version = '1.0.0';
  priority = 100;

  async beforeCreate(context: PluginContext): Promise<PluginContext> {
    // Pre-processing
    console.log('Before create:', context.data);
    return context;
  }

  async afterCreate(context: PluginContext): Promise<void> {
    // Post-processing
    console.log('After create:', context.result);
  }

  async onValidate(context: PluginContext): Promise<void> {
    // Validation
    if (!context.data.patientId) {
      throw new Error('Patient ID required');
    }
  }
}

// Register plugin
const registry = app.get(PluginRegistry);
registry.register(new MyPlugin());
```

**Plugin Lifecycle Hooks:**
- `beforeCreate`, `afterCreate`
- `beforeUpdate`, `afterUpdate`
- `beforeDelete`, `afterDelete`
- `onValidate`, `onError`

**14 Appointment Plugins:**
- DoctorAvailability, PatientAvailability
- ConflictCheck, SlotManagement
- Notification, Reminder
- Analytics, Audit
- Billing, Queue
- Video, Clinic, Provider
- Emergency

---

## Error Handling

Standardized error handling with error codes:

```typescript
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

// Throw healthcare error
throw new HealthcareError(
  ErrorCode.USER_NOT_FOUND,
  'User not found',
  undefined,
  { userId: 'user123' },
  'UserService.findOne'
);

// Error codes enum
enum ErrorCode {
  // Authentication
  AUTHENTICATION_REQUIRED = 'AUTHENTICATION_REQUIRED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  SESSION_EXPIRED = 'SESSION_EXPIRED',

  // Authorization
  AUTHORIZATION_FAILED = 'AUTHORIZATION_FAILED',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',

  // Database
  DATABASE_RECORD_NOT_FOUND = 'DATABASE_RECORD_NOT_FOUND',
  DATABASE_DUPLICATE_ENTRY = 'DATABASE_DUPLICATE_ENTRY',
  DATABASE_OPERATION_FAILED = 'DATABASE_OPERATION_FAILED',

  // Validation
  INVALID_INPUT = 'INVALID_INPUT',
  VALIDATION_FAILED = 'VALIDATION_FAILED',

  // Business Logic
  OPERATION_FAILED = 'OPERATION_FAILED',
  RESOURCE_CONFLICT = 'RESOURCE_CONFLICT',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // System
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
}
```

---

## Guards

Authentication and authorization guards:

### JwtAuthGuard

```typescript
import { JwtAuthGuard } from '@core/guards';

@Controller('protected')
@UseGuards(JwtAuthGuard)
export class ProtectedController {
  @Get()
  async getData(@Request() req) {
    // req.user populated by JwtAuthGuard
    console.log('User:', req.user);
  }
}
```

### RolesGuard

```typescript
import { RolesGuard } from '@core/guards';
import { Roles } from '@core/decorators';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  @Get()
  @Roles('SUPER_ADMIN', 'CLINIC_ADMIN')
  async getAdminData() {
    // Only SUPER_ADMIN and CLINIC_ADMIN can access
  }
}
```

### ClinicGuard

```typescript
import { ClinicGuard } from '@core/guards';

@Controller('patients')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
export class PatientsController {
  @Get()
  async getPatients(@Request() req) {
    // req.clinicId populated by ClinicGuard
    // Enforces multi-tenant isolation
    console.log('Clinic:', req.clinicId);
  }
}
```

### RbacGuard

```typescript
import { RbacGuard } from '@core/guards';
import { RequirePermissions } from '@core/decorators';

@Controller('records')
@UseGuards(JwtAuthGuard, RbacGuard)
export class RecordsController {
  @Get()
  @RequirePermissions('medical-records:read')
  async getRecords() {
    // Requires 'medical-records:read' permission
  }
}
```

### IPWhitelistGuard

```typescript
import { IPWhitelistGuard } from '@core/guards';

@Controller('admin')
@UseGuards(IPWhitelistGuard)
export class AdminController {
  // Only allows access from whitelisted IPs
}
```

---

## Decorators

Custom decorators for routes and methods:

```typescript
import { Roles, Public, Clinic, Permissions, Cache, RateLimit } from '@core/decorators';

@Controller('users')
export class UsersController {
  @Get()
  @Roles('DOCTOR', 'NURSE') // Require DOCTOR or NURSE role
  async getUsers() { ... }

  @Post('login')
  @Public() // Bypass JWT authentication
  async login() { ... }

  @Get(':id')
  @Clinic() // Enforce clinic isolation
  async getUser(@Param('id') id: string) { ... }

  @Get('summary')
  @Permissions('users:read', 'reports:read') // Require specific permissions
  async getSummary() { ... }

  @Get('expensive')
  @Cache({ ttl: 300 }) // Cache for 5 minutes
  async getExpensiveData() { ... }

  @Post('action')
  @RateLimit({ windowMs: 60000, max: 10 }) // 10 requests per minute
  async performAction() { ... }
}
```

---

## Filters

HTTP exception filter with HIPAA compliance:

```typescript
import { HttpExceptionFilter } from '@core/filters';

@Controller()
@UseFilters(HttpExceptionFilter)
export class MyController {
  // Exception filter automatically applied
}

// Or globally
app.useGlobalFilters(new HttpExceptionFilter());
```

**Features:**
- HIPAA-compliant error messages (no PHI exposure)
- Structured error responses
- Automatic logging
- Request context tracking

---

## Interceptors

Healthcare cache interceptor:

```typescript
import { HealthcareCacheInterceptor } from '@core/interceptors';

@Controller('data')
@UseInterceptors(HealthcareCacheInterceptor)
export class DataController {
  @Get()
  @CacheKey('expensive-data')
  @CacheTTL(300) // 5 minutes
  async getData() {
    // Automatically cached
  }
}
```

---

## Resilience

Circuit breaker and graceful shutdown:

```typescript
import { CircuitBreakerService, GracefulShutdownService } from '@core/resilience';

// Circuit breaker
const result = await this.circuitBreaker.execute(
  'external-api',
  async () => {
    return await this.externalApi.call();
  },
  {
    threshold: 5,        // Failures before open
    timeout: 30000,      // 30 seconds
    resetTimeout: 60000, // 1 minute
  }
);

// Graceful shutdown
await this.gracefulShutdown.shutdown(() => {
  // Cleanup logic
});
```

**Circuit Breaker States:**
- CLOSED - Normal operation
- OPEN - Failing, reject requests
- HALF_OPEN - Testing recovery

---

## Shared Types

Single source of truth for all domain types:

```typescript
import type {
  User,
  Appointment,
  Patient,
  Doctor,
  Clinic,
  RequestContext,
  EnterpriseEventPayload,
  CommunicationRequest,
  PaymentIntentOptions,
  RbacContext,
  SessionData,
  BusinessRule,
  PluginContext,
} from '@core/types';

// All domain types live in @core/types
// Never import from @database/types in services/controllers
```

**Type Categories:**
- **User & Auth:** User, Role, Permission, SessionData
- **Clinic:** Clinic, ClinicConfig
- **Appointments:** Appointment, AppointmentStatus, RecurringAppointment
- **EHR:** MedicalRecord, Prescription, Vitals
- **Billing:** Invoice, Payment, BillingPlan
- **Communication:** CommunicationRequest, NotificationPreferences
- **Events:** EnterpriseEventPayload, EventCategory, EventPriority
- **Infrastructure:** RequestContext, CacheOptions, QueueOptions
- **RBAC:** RbacContext, PermissionCheck, RoleAssignment
- **Business Rules:** BusinessRule, RuleCondition, RuleAction

---

## Configuration

No environment variables (utility library)

---

## Architecture

```
CoreModule
├── Business Rules
│   ├── BusinessRulesEngine
│   └── RuleValidationService
├── RBAC
│   ├── RbacService
│   ├── RoleService
│   └── PermissionService
├── Session
│   ├── SessionManagementService
│   └── FastifySessionStoreAdapter
├── Plugin Interface
│   ├── PluginRegistry
│   └── PluginManager
├── Error Handling
│   ├── HealthcareError
│   ├── ErrorCodes
│   └── Error Handlers
├── Guards
│   ├── JwtAuthGuard
│   ├── RolesGuard
│   ├── ClinicGuard
│   ├── RbacGuard
│   └── IPWhitelistGuard
├── Decorators
│   ├── @Roles
│   ├── @Public
│   ├── @Clinic
│   ├── @Permissions
│   ├── @Cache
│   └── @RateLimit
├── Filters
│   └── HttpExceptionFilter
├── Interceptors
│   └── HealthcareCacheInterceptor
├── Resilience
│   ├── CircuitBreakerService
│   └── GracefulShutdownService
└── Types
    └── All shared domain types
```

---

## Related Documentation

- [System Architecture](../../docs/architecture/SYSTEM_ARCHITECTURE.md)
- [RBAC Documentation](./rbac/)
- [Business Rules](./business-rules/)
- [Plugin Interface](./plugin-interface/)

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
