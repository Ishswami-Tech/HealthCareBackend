# 🔄 Circular Dependency Resolution Guide

## Overview

Circular dependencies occur when Module A imports Module B, and Module B imports
Module A, creating a loop. In large NestJS applications like this healthcare
backend, circular dependencies are common but must be carefully managed.

---

## 🎯 Detection

### Symptoms of Circular Dependencies

```bash
# Common error messages:
Error: Nest can't resolve dependencies of the XService (?, YService)
Error: A circular dependency has been detected
Scope [XModule -> YModule -> XModule]

# Runtime errors:
TypeError: Cannot read property 'method' of undefined
```

### Find Circular Dependencies

```bash
# Use madge to detect circular dependencies
npx madge --circular --extensions ts src/

# Or use this npm script
pnpm circular:check

# Visualize with image
npx madge --circular --extensions ts --image graph.svg src/
```

---

## ✅ Best Solutions for This Healthcare App

### 1. Use `forwardRef()` for Module Dependencies (Quick Fix)

**When to use**: When two modules legitimately need to know about each other.

#### Example: CheckInService and AppointmentService

**Before** (Circular Dependency ❌):

```typescript
// check-in.module.ts
@Module({
  imports: [
    AppointmentsModule, // ❌ Circular: Appointments imports CheckIn
  ],
  providers: [CheckInService],
  exports: [CheckInService],
})
export class CheckInModule {}

// appointments.module.ts
@Module({
  imports: [
    CheckInModule, // ❌ Circular: CheckIn imports Appointments
  ],
  providers: [AppointmentService],
  exports: [AppointmentService],
})
export class AppointmentsModule {}
```

**After** (Fixed with `forwardRef()` ✅):

```typescript
// check-in.module.ts
import { forwardRef } from '@nestjs/common';

@Module({
  imports: [
    forwardRef(() => AppointmentsModule), // ✅ Lazy load
  ],
  providers: [CheckInService],
  exports: [CheckInService],
})
export class CheckInModule {}

// appointments.module.ts
import { forwardRef } from '@nestjs/common';

@Module({
  imports: [
    forwardRef(() => CheckInModule), // ✅ Lazy load
  ],
  providers: [AppointmentService],
  exports: [AppointmentService],
})
export class AppointmentsModule {}
```

**Service Level with `forwardRef()`**:

```typescript
// check-in.service.ts
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { AppointmentService } from '@services/appointments';

@Injectable()
export class CheckInService {
  constructor(
    @Inject(forwardRef(() => AppointmentService))
    private readonly appointmentService: AppointmentService
  ) {}
}

// appointment.service.ts
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { CheckInService } from '@services/check-in';

@Injectable()
export class AppointmentService {
  constructor(
    @Inject(forwardRef(() => CheckInService))
    private readonly checkInService: CheckInService
  ) {}
}
```

---

### 2. Event-Driven Architecture (Preferred Solution ⭐)

**When to use**: When services need to react to changes in other services but
don't need direct coupling.

**This app already has EventService** - USE IT!

#### Example: CheckIn → Appointment Status Update

**Before** (Direct Dependency ❌):

```typescript
// check-in.service.ts
@Injectable()
export class CheckInService {
  constructor(
    private readonly appointmentService: AppointmentService // ❌ Direct coupling
  ) {}

  async checkIn(appointmentId: string) {
    // Create check-in
    const checkIn = await this.createCheckIn(appointmentId);

    // Update appointment status
    await this.appointmentService.updateStatus(appointmentId, 'CONFIRMED'); // ❌

    return checkIn;
  }
}
```

**After** (Event-Driven ✅):

```typescript
// check-in.service.ts
import { EventService } from '@infrastructure/events';

@Injectable()
export class CheckInService {
  constructor(
    private readonly eventService: EventService, // ✅ Only depends on infrastructure
    private readonly logger: LoggingService
  ) {}

  async checkIn(appointmentId: string) {
    // Create check-in
    const checkIn = await this.createCheckIn(appointmentId);

    // Emit event (no direct coupling)
    await this.eventService.emitEnterprise('patient.checked_in', {
      eventId: `checkin-${checkIn.id}`,
      eventType: 'patient.arrival_confirmed',
      category: EventCategory.APPOINTMENT,
      priority: EventPriority.HIGH,
      timestamp: new Date().toISOString(),
      source: 'CheckInService',
      version: '1.0.0',
      payload: {
        appointmentId,
        checkInId: checkIn.id,
        confirmedAt: checkIn.checkedInAt,
      },
    });

    return checkIn;
  }
}

// appointment.service.ts
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class AppointmentService {
  // No dependency on CheckInService!

  @OnEvent('patient.arrival_confirmed')
  async handlePatientArrivalConfirmed(payload: EnterpriseEventPayload) {
    const { appointmentId } = payload.payload;

    // Update appointment status
    await this.updateStatus(appointmentId, 'CONFIRMED');

    this.logger.info('Appointment status updated after arrival confirmation', {
      appointmentId,
    });
  }
}
```

**Benefits**:

- ✅ No circular dependency
- ✅ Services are decoupled
- ✅ Easy to add more listeners (notifications, analytics, etc.)
- ✅ Better testability
- ✅ Follows SOLID principles

---

### 3. Use Type-Only Imports (TypeScript)

**When to use**: When you only need types, not runtime values.

**Before** (Runtime Import ❌):

```typescript
// check-in.service.ts
import { AppointmentService } from '@services/appointments'; // ❌ Runtime import

export class CheckInService {
  async processCheckIn(appointment: AppointmentService['findById']) {
    // Using type
    // ...
  }
}
```

**After** (Type-Only Import ✅):

```typescript
// check-in.service.ts
import type { AppointmentService } from '@services/appointments'; // ✅ Type-only import

export class CheckInService {
  async processCheckIn(
    appointment: ReturnType<AppointmentService['findById']>
  ) {
    // ...
  }
}

// Even better: Use shared types
import type { Appointment } from '@core/types'; // ✅ Best practice

export class CheckInService {
  async processCheckIn(appointment: Appointment) {
    // ...
  }
}
```

---

### 4. Shared Types in `@core/types` (Already Exists!)

**Your app already has this structure** - use it properly!

**File Structure**:

```
src/libs/core/types/
├── appointment.types.ts      ← Domain types
├── database.types.ts         ← Database types
├── clinic.types.ts           ← Clinic types
└── index.ts                  ← Central export
```

**Best Practice**:

```typescript
// ✅ ALWAYS import from @core/types (NOT from service files)
import type { Appointment, CheckIn, Patient } from '@core/types';

// ❌ NEVER import types from service files
import type { Appointment } from '@services/appointments/appointment.service'; // ❌ BAD!
```

**Define types once, use everywhere**:

```typescript
// src/libs/core/types/appointment.types.ts
export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  locationId: string;
  status: AppointmentStatus;
  date: Date;
}

export interface CheckIn {
  id: string;
  appointmentId: string;
  locationId: string;
  checkedInAt: Date;
}

// Now services import from ONE place
// check-in.service.ts
import type { Appointment, CheckIn } from '@core/types'; // ✅

// appointment.service.ts
import type { Appointment, CheckIn } from '@core/types'; // ✅
```

---

### 5. Interface Segregation (Extract Interfaces)

**When to use**: When Service A only needs a few methods from Service B.

#### Example: CheckInService only needs `findAppointmentById`

**Before** (Full Service Dependency ❌):

```typescript
// check-in.service.ts
import { AppointmentService } from '@services/appointments'; // ❌ Depends on entire service

@Injectable()
export class CheckInService {
  constructor(
    private readonly appointmentService: AppointmentService // ❌ Circular
  ) {}

  async checkIn(appointmentId: string) {
    const appointment = await this.appointmentService.findById(appointmentId); // Only needs this one method!
    // ...
  }
}
```

**After** (Interface Segregation ✅):

```typescript
// src/libs/core/interfaces/appointment.interface.ts
export interface IAppointmentFinder {
  findById(id: string): Promise<Appointment | null>;
}

// appointment.service.ts
import type { IAppointmentFinder } from '@core/interfaces';

@Injectable()
export class AppointmentService implements IAppointmentFinder {
  // ✅ Implements interface
  async findById(id: string): Promise<Appointment | null> {
    return await this.database.executeHealthcareRead(async client => {
      return await client.appointment.findUnique({ where: { id } });
    });
  }
}

// check-in.service.ts
import type { IAppointmentFinder } from '@core/interfaces'; // ✅ Only interface
import { AppointmentService } from '@services/appointments'; // For injection token

@Injectable()
export class CheckInService {
  constructor(
    @Inject(AppointmentService) // Use as injection token
    private readonly appointmentFinder: IAppointmentFinder // But type as interface
  ) {}

  async checkIn(appointmentId: string) {
    const appointment = await this.appointmentFinder.findById(appointmentId); // ✅
    // ...
  }
}
```

---

### 6. Database Service Pattern (Already Implemented! ✅)

**Your app already uses this pattern** - it prevents circular dependencies!

**Good Architecture** (Already in place):

```typescript
// check-in.service.ts
@Injectable()
export class CheckInService {
  constructor(
    private readonly database: DatabaseService // ✅ Only depends on infrastructure
  ) {}

  async checkIn(appointmentId: string) {
    // Query database directly - NO dependency on AppointmentService!
    const appointment = await this.database.executeHealthcareRead(
      async client => {
        return await client.appointment.findUnique({
          where: { id: appointmentId },
        });
      }
    );

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    // Create check-in
    const checkIn = await this.database.executeHealthcareWrite(async client => {
      return await client.checkIn.create({
        data: {
          appointmentId,
          locationId: appointment.locationId,
          patientId: appointment.patientId,
          clinicId: appointment.clinicId,
        },
      });
    });

    return checkIn;
  }
}
```

**Why this works**:

- ✅ Both services depend on `DatabaseService` (infrastructure layer)
- ✅ No service-to-service dependencies
- ✅ Follows Dependency Inversion Principle

---

### 7. Avoid Barrel Export Circular Dependencies

**Problem**: Index files (barrel exports) can create circular dependencies.

**Before** (Barrel Export Issue ❌):

```typescript
// src/services/appointments/index.ts
export * from './appointment.service';
export * from './appointment.controller';
export * from './appointments.module'; // ❌ Exports module

// src/services/check-in/index.ts
export * from './check-in.service';
export * from './check-in.controller';
export * from './check-in.module'; // ❌ Exports module

// Somewhere else
import { CheckInModule } from '@services/check-in'; // ❌ Gets entire barrel
```

**After** (Specific Imports ✅):

```typescript
// src/services/appointments/index.ts
export * from './appointment.service';
export * from './appointment.controller';
// DON'T export module from barrel

// Direct imports
import { CheckInModule } from '@services/check-in/check-in.module'; // ✅ Specific file
```

---

### 8. Lazy Module Loading

**When to use**: For large features that rarely interact.

```typescript
// app.module.ts
import { Module } from '@nestjs/common';

@Module({
  imports: [
    // Eager loading (default)
    CoreModule,
    DatabaseModule,

    // Lazy loading for optional features
    // These modules only load when first requested
  ],
})
export class AppModule {}

// Use dynamic imports
async loadCheckInModule() {
  const { CheckInModule } = await import('@services/check-in/check-in.module');
  return CheckInModule;
}
```

---

## 🛠️ Practical Refactoring Steps

### Step 1: Identify Circular Dependencies

```bash
# Install madge
pnpm add -D madge

# Check for circular dependencies
npx madge --circular --extensions ts src/

# Output will show:
# Circular dependency found:
# services/appointments/appointment.service.ts ->
# services/check-in/check-in.service.ts ->
# services/appointments/appointment.service.ts
```

### Step 2: Categorize Dependencies

For each circular dependency, ask:

1. **Is it a type-only dependency?** → Use `import type`

2. **Can it be solved with events?** → Use EventService (preferred)

3. **Is it a database query?** → Use DatabaseService directly

4. **Is it unavoidable?** → Use `forwardRef()`

### Step 3: Refactor Pattern Decision Tree

```
Circular Dependency Detected
         │
         ├─→ Only need types? ────────→ Use `import type`
         │
         ├─→ React to changes? ────────→ Use EventService
         │
         ├─→ Need database data? ──────→ Query DatabaseService directly
         │
         ├─→ Need few methods? ────────→ Extract Interface
         │
         └─→ Unavoidable? ─────────────→ Use forwardRef()
```

---

## 📝 Checklist for Your Healthcare App

### Immediate Actions

- [ ] Run `npx madge --circular --extensions ts src/` to find all circular
      dependencies
- [ ] Review all service-to-service dependencies
- [ ] Convert direct service calls to events where possible
- [ ] Ensure all types are imported from `@core/types` (not from services)
- [ ] Use `import type` for type-only imports
- [ ] Add `forwardRef()` only as last resort

### Long-term Best Practices

- [ ] **Layer Dependencies** (Already mostly done):

  ```
  Controllers → Services → Infrastructure → Core
  (Can only depend downward, never upward)
  ```

- [ ] **Event-Driven for Cross-Service Communication**:

  ```
  Service A → EventService → Service B
  (No direct dependency)
  ```

- [ ] **Shared Types in @core/types**:

  ```
  All services import from: @core/types
  Never import types from: @services/*
  ```

- [ ] **Database Queries in Services**:
  ```
  Instead of: serviceA.getData()
  Use: this.database.executeHealthcareRead(...)
  ```

---

## 🧪 Testing for Circular Dependencies

Add to `package.json`:

```json
{
  "scripts": {
    "circular:check": "madge --circular --extensions ts src/",
    "circular:check:json": "madge --circular --extensions ts --json src/",
    "circular:graph": "madge --circular --extensions ts --image circular-deps.svg src/"
  },
  "devDependencies": {
    "madge": "^7.0.0"
  }
}
```

Add to CI/CD:

```bash
# In GitHub Actions / GitLab CI
- name: Check circular dependencies
  run: |
    pnpm circular:check
    if [ $? -ne 0 ]; then
      echo "Circular dependencies detected!"
      exit 1
    fi
```

---

## 🔍 Common Patterns in This App

### Pattern 1: Appointment ↔ CheckIn

**Solution**: Use Events

```typescript
// CheckIn creates → Emit event → Appointment listens
@OnEvent('patient.checked_in')
async handleCheckedIn(payload) { /* ... */ }
```

### Pattern 2: User ↔ Clinic ↔ Patient

**Solution**: Use DatabaseService directly

```typescript
// Both query database, no circular dependency
const user = await this.database.executeHealthcareRead(...)
```

### Pattern 3: Notification ↔ Appointment

**Solution**: Event-driven

```typescript
// Appointment changes → Emit event → Notification listens
@OnEvent('appointment.created')
async sendNotification(payload) { /* ... */ }
```

---

## 📚 References

- **NestJS Circular Dependency**:
  https://docs.nestjs.com/fundamentals/circular-dependency
- **Event-Driven Architecture**: Already implemented in this app via
  `EventService`
- **Dependency Inversion Principle**: Already followed via `DatabaseService`

---

## ✅ Summary for Your App

Your healthcare app **already follows good patterns**:

- ✅ DatabaseService for data access
- ✅ EventService for event-driven architecture
- ✅ Shared types in @core/types
- ✅ Layered architecture

**To fix circular dependencies**:

1. ⭐ **Use EventService** (already exists!) - Preferred
2. Use `import type` for type-only imports
3. Query DatabaseService directly instead of calling other services
4. Use `forwardRef()` only as last resort

**Quick Win**: Replace most service-to-service calls with event emissions!

---

**Version**: 1.0.0 **Last Updated**: 2024-12-15 **Maintained By**: Healthcare
Backend Team
