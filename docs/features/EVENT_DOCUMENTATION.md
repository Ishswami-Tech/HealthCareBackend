# Event System Documentation

**Date**: 2024  
**Status**: ✅ **COMPLETE**

---

## 📋 Overview

This document provides comprehensive documentation for the event-driven architecture in the Healthcare Backend system. All events are emitted through the centralized `EventService`, which acts as the single source of truth for event emissions.

---

## 🏗️ Architecture

### Event Flow

```
┌─────────────────────────────────────────────────────────────┐
│              CENTRAL EVENT SYSTEM (Hub)                      │
│         @infrastructure/events/EventService                   │
│                                                              │
│  Services emit events:                                       │
│  await eventService.emit('ehr.lab_report.created', {...})   │
└─────────────────────────────────────────────────────────────┘
                        │
                        │ Events emitted via EventEmitter2
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Socket     │ │  Unified     │ │   Other      │
│   Listener   │ │ Communication│ │  Listeners │
│              │ │   Listener   │ │  (Audit,     │
│              │ │              │ │   Analytics) │
└──────────────┘ └──────────────┘ └──────────────┘
```

---

## 📚 Event Service API

### Simple API

```typescript
// Basic event emission
await this.eventService.emit('user.created', {
  userId: '123',
  email: 'user@example.com'
});
```

### Enterprise API

```typescript
// Enterprise event with full metadata
await this.eventService.emitEnterprise('user.created', {
  eventId: `user-created-${userId}-${Date.now()}`,
  eventType: 'user.created',
  category: EventCategory.USER_ACTIVITY,
  priority: EventPriority.HIGH,
  timestamp: new Date().toISOString(),
  source: 'UserService',
  version: '1.0.0',
  userId: userId,
  clinicId: clinicId,
  payload: {
    userId: userId,
    email: email,
    // ... other payload data
  }
});
```

---

## 🎯 Event Categories

### EventCategory Enum

```typescript
export enum EventCategory {
  USER_ACTIVITY = 'USER_ACTIVITY',
  APPOINTMENT = 'APPOINTMENT',
  EHR_RECORD = 'EHR_RECORD',
  BILLING = 'BILLING',
  COMMUNICATION = 'COMMUNICATION',
  SYSTEM = 'SYSTEM',
  SECURITY = 'SECURITY',
  AUDIT = 'AUDIT',
}
```

### EventPriority Enum

```typescript
export enum EventPriority {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  NORMAL = 'NORMAL',
  LOW = 'LOW',
}
```

---

## 📝 Event Patterns

### Naming Convention

Events follow the pattern: `{module}.{resource}.{action}`

Examples:
- `ehr.lab_report.created`
- `ehr.lab_report.updated`
- `ehr.lab_report.deleted`
- `appointment.created`
- `appointment.cancelled`
- `billing.invoice.created`
- `clinic.created`

---

## 🔍 Event Payload Structures

### EHR Events

#### Lab Report Created

```typescript
{
  eventId: string;
  eventType: 'ehr.lab_report.created';
  category: EventCategory.EHR_RECORD;
  priority: EventPriority.HIGH;
  timestamp: string;
  source: 'EHRService';
  version: '1.0.0';
  userId?: string;
  clinicId?: string;
  payload: {
    reportId: string;
    userId: string;
    clinicId: string;
    testName: string;
    result: string;
  };
}
```

#### Radiology Report Created

```typescript
{
  eventId: string;
  eventType: 'ehr.radiology_report.created';
  category: EventCategory.EHR_RECORD;
  priority: EventPriority.HIGH;
  timestamp: string;
  source: 'EHRService';
  version: '1.0.0';
  userId?: string;
  clinicId?: string;
  payload: {
    reportId: string;
    userId: string;
    clinicId: string;
    imageType: string;
    findings: string;
  };
}
```

#### Vital Sign Created (Critical Alert)

```typescript
{
  eventId: string;
  eventType: 'ehr.vital.created';
  category: EventCategory.EHR_RECORD;
  priority: EventPriority.CRITICAL; // When out of range
  timestamp: string;
  source: 'EHRService';
  version: '1.0.0';
  userId?: string;
  clinicId?: string;
  payload: {
    vitalId: string;
    userId: string;
    clinicId: string;
    vitalType: string;
    value: number;
    isCritical: boolean; // true when out of normal range
  };
  metadata?: {
    isCritical: true;
    normalRange: { min: number; max: number };
  };
}
```

#### Allergy Created (Critical Alert)

```typescript
{
  eventId: string;
  eventType: 'ehr.allergy.created';
  category: EventCategory.EHR_RECORD;
  priority: EventPriority.CRITICAL; // When severe/critical
  timestamp: string;
  source: 'EHRService';
  version: '1.0.0';
  userId?: string;
  clinicId?: string;
  payload: {
    allergyId: string;
    userId: string;
    clinicId: string;
    allergen: string;
    severity: 'mild' | 'moderate' | 'severe' | 'critical';
  };
  metadata?: {
    severity: 'severe' | 'critical';
  };
}
```

---

### Appointment Events

#### Appointment Created

```typescript
{
  eventId: string;
  eventType: 'appointment.created';
  category: EventCategory.APPOINTMENT;
  priority: EventPriority.HIGH;
  timestamp: string;
  source: 'AppointmentService';
  version: '1.0.0';
  userId?: string;
  clinicId?: string;
  payload: {
    appointmentId: string;
    patientId: string;
    doctorId: string;
    clinicId: string;
    scheduledTime: string;
    type: string;
  };
}
```

#### Appointment Cancelled

```typescript
{
  eventId: string;
  eventType: 'appointment.cancelled';
  category: EventCategory.APPOINTMENT;
  priority: EventPriority.NORMAL;
  timestamp: string;
  source: 'AppointmentService';
  version: '1.0.0';
  userId?: string;
  clinicId?: string;
  payload: {
    appointmentId: string;
    patientId: string;
    doctorId: string;
    clinicId: string;
    reason?: string;
  };
}
```

---

### Billing Events

#### Invoice Created

```typescript
{
  eventId: string;
  eventType: 'billing.invoice.created';
  category: EventCategory.BILLING;
  priority: EventPriority.NORMAL;
  timestamp: string;
  source: 'BillingService';
  version: '1.0.0';
  userId?: string;
  clinicId?: string;
  payload: {
    invoiceId: string;
    userId: string;
    clinicId: string;
    invoiceNumber: string;
    amount: number;
    totalAmount: number;
  };
}
```

---

### Clinic Events

#### Clinic Created

```typescript
{
  eventId: string;
  eventType: 'clinic.created';
  category: EventCategory.SYSTEM;
  priority: EventPriority.HIGH;
  timestamp: string;
  source: 'ClinicService';
  version: '1.0.0';
  userId?: string;
  clinicId?: string;
  payload: {
    clinicId: string;
    name: string;
    subdomain: string;
    appName: string;
    createdBy: string;
  };
}
```

#### Clinic Updated

```typescript
{
  eventId: string;
  eventType: 'clinic.updated';
  category: EventCategory.SYSTEM;
  priority: EventPriority.NORMAL;
  timestamp: string;
  source: 'ClinicService';
  version: '1.0.0';
  userId?: string;
  clinicId?: string;
  payload: {
    clinicId: string;
    name: string;
    subdomain: string;
    updateFields: string[]; // Array of field names that were updated
  };
}
```

#### Clinic Deleted

```typescript
{
  eventId: string;
  eventType: 'clinic.deleted';
  category: EventCategory.SYSTEM;
  priority: EventPriority.HIGH;
  timestamp: string;
  source: 'ClinicService';
  version: '1.0.0';
  userId?: string;
  clinicId?: string;
  payload: {
    clinicId: string;
  };
}
```

---

### Video Events

#### Recording Stopped

```typescript
{
  eventId: string;
  eventType: 'video.recording.stopped';
  category: EventCategory.SYSTEM;
  priority: EventPriority.NORMAL;
  timestamp: string;
  source: 'VideoService';
  version: '1.0.0';
  userId?: string;
  clinicId?: string;
  payload: {
    appointmentId: string;
    recordingId: string;
    url?: string;
    duration: number;
  };
}
```

---

## 🎧 Event Listeners

### Notification Event Listener

The `NotificationEventListener` listens to all events (`@OnEvent('**')`) and routes them to appropriate communication channels.

**Pattern Matching**:
- EHR events → Socket + Push + Email
- Appointment events → Socket + Push + Email
- Billing events → Push + Email
- Critical alerts → All channels with CRITICAL priority

**Example**:
```typescript
@Injectable()
export class NotificationEventListener implements OnModuleInit {
  @OnEvent('**')
  async handleEvent(event: string, payload: EnterpriseEventPayload) {
    // Match event pattern to communication rules
    // Send notifications via appropriate channels
  }
}
```

---

## ✅ Event Validation

### Required Fields

All enterprise events must include:
- `eventId`: Unique identifier
- `eventType`: Event type string
- `category`: EventCategory enum
- `priority`: EventPriority enum
- `timestamp`: ISO 8601 timestamp
- `source`: Service name emitting the event
- `version`: API version
- `payload`: Event-specific data

### Optional Fields

- `userId`: User ID (if applicable)
- `clinicId`: Clinic ID (if applicable)
- `metadata`: Additional metadata

---

## 🔒 HIPAA Compliance

### PHI Data Protection

- All events with PHI are automatically validated
- PHI data is masked in logs
- Event payloads are sanitized before storage
- Access to event logs is restricted

### Audit Trail

- All events are logged to `AuditLog` table
- Events include IP address, user agent, device info
- 30-day retention for compliance

---

## 📊 Event Statistics

### Total Events Emitted

- **EHR Module**: 24 events (8 record types × 3 operations)
- **Appointment Module**: ~10 events
- **Billing Module**: ~5 events
- **Clinic Module**: 3 events
- **Video Module**: ~3 events
- **Total**: ~45+ event types

### Event Categories

- **EHR_RECORD**: 24 events
- **APPOINTMENT**: ~10 events
- **BILLING**: ~5 events
- **SYSTEM**: ~6 events
- **USER_ACTIVITY**: ~5 events

---

## 🚀 Best Practices

### 1. Always Use EventService

```typescript
// ✅ CORRECT
await this.eventService.emit('user.created', payload);

// ❌ WRONG
this.eventEmitter.emit('user.created', payload);
```

### 2. Use Enterprise API for Important Events

```typescript
// ✅ CORRECT - For important events
await this.eventService.emitEnterprise('ehr.lab_report.created', {
  eventId: `lab-report-${reportId}-${Date.now()}`,
  eventType: 'ehr.lab_report.created',
  category: EventCategory.EHR_RECORD,
  priority: EventPriority.HIGH,
  // ... full payload
});
```

### 3. Include Required Metadata

```typescript
// ✅ CORRECT
await this.eventService.emitEnterprise('appointment.created', {
  eventId: `appt-${appointmentId}-${Date.now()}`,
  eventType: 'appointment.created',
  category: EventCategory.APPOINTMENT,
  priority: EventPriority.HIGH,
  timestamp: new Date().toISOString(),
  source: 'AppointmentService',
  version: '1.0.0',
  userId: patientId,
  clinicId: clinicId,
  payload: { /* appointment data */ }
});
```

### 4. Use Appropriate Priority

- **CRITICAL**: Critical alerts (vitals out of range, severe allergies)
- **HIGH**: Important events (appointments, lab reports, clinic changes)
- **NORMAL**: Regular events (invoices, updates)
- **LOW**: Background events (analytics, metrics)

---

## 📚 Related Documentation

- **EventService**: `src/libs/infrastructure/events/event.service.ts`
- **Event Types**: `src/libs/core/types/event.types.ts`
- **Notification Listener**: `src/libs/communication/listeners/notification-event.listener.ts`
- **Event Module**: `src/libs/infrastructure/events/events.module.ts`

---

**Last Updated**: 2024  
**Status**: ✅ **EVENT DOCUMENTATION COMPLETE**

