# 📋 Appointment & Follow-Up System - Complete Flow Documentation

## 📚 Table of Contents

1. [Overview](#overview)
2. [Current System Architecture](#current-system-architecture)
3. [Proposed Enhanced Flow](#proposed-enhanced-flow)
4. [Database Schema](#database-schema)
5. [API Flows](#api-flows)
6. [Service Layer Flows](#service-layer-flows)
7. [Workflow States](#workflow-states)
8. [Implementation Guide](#implementation-guide)
9. [Examples](#examples)

---

## 🎯 Overview

This document describes the complete flow for handling appointments and follow-ups in the Healthcare Backend system. It covers both the current implementation and proposed enhancements for a comprehensive appointment management system.

### Key Concepts

- **Regular Appointments**: Standard consultations, checkups, therapies, etc.
- **Follow-Up Plans**: Recommendations for future appointments (not yet scheduled)
- **Follow-Up Appointments**: Actual scheduled appointments that are follow-ups to previous appointments
- **Recurring Appointments**: Series of appointments with a pattern
- **Appointment Chains**: Parent appointment and all its follow-ups

---

## 🏗️ Current System Architecture

### Current Appointment Model

```
Appointment
├── Basic Info: id, type, doctorId, patientId, clinicId, locationId
├── Scheduling: date, time, duration
├── Status: PENDING → SCHEDULED → CONFIRMED → CHECKED_IN → IN_PROGRESS → COMPLETED
├── Lifecycle: startedAt, checkedInAt, completedAt
├── Special: therapyId, subscriptionId, isSubscriptionBased
└── Metadata: notes, priority, cancellationReason
```

### Current Follow-Up System

```
FollowUpPlan (Cache-Only)
├── Reference: appointmentId (original appointment)
├── Scheduling: scheduledFor (date), daysAfter
├── Type: routine, urgent, specialist, therapy, surgery
├── Status: scheduled, completed, cancelled, overdue
├── Instructions: medications, tests, restrictions, notes
└── Issue: Not persisted, not linked to actual appointments
```

### Current Limitations

1. ❌ No parent-child relationship between appointments
2. ❌ Follow-up plans stored only in cache (not database)
3. ❌ No automatic conversion from plan to appointment
4. ❌ No appointment chain tracking
5. ❌ Manual follow-up creation only

---

## 🚀 Proposed Enhanced Flow

### Enhanced Appointment Model

```
Appointment
├── Basic Info: [existing fields]
├── Relationships:
│   ├── parentAppointmentId → Links to original appointment
│   ├── followUpAppointments[] → All follow-ups from this appointment
│   ├── seriesId → Links to recurring series
│   └── seriesSequence → Position in series
├── Follow-Up Metadata:
│   ├── isFollowUp → Boolean flag
│   ├── followUpReason → Why this follow-up was created
│   └── originalAppointmentId → Original appointment reference
└── Enhanced Status: [includes FOLLOW_UP_SCHEDULED]
```

### Enhanced Follow-Up System

```
FollowUpPlan (Database-Persisted)
├── Reference: appointmentId (original appointment)
├── Scheduling: scheduledFor, daysAfter
├── Type & Status: [existing]
├── Link to Appointment:
│   └── followUpAppointmentId → Actual appointment when created
└── Persistence: Stored in database with proper relationships
```

---

## 📊 Complete Flow Diagrams

### Flow 1: Regular Appointment Creation

```
┌─────────────────────────────────────────────────────────────┐
│                    REGULAR APPOINTMENT FLOW                  │
└─────────────────────────────────────────────────────────────┘

1. CLIENT REQUEST
   POST /appointments
   {
     patientId, doctorId, clinicId, locationId,
     appointmentDate, duration, type, priority, notes
   }
   ↓
2. VALIDATION LAYER
   ├── RBAC Check (user permissions)
   ├── Business Rules Validation
   │   ├── Doctor availability
   │   ├── Patient eligibility
   │   └── Clinic rules
   └── Input validation (DTO)
   ↓
3. CONFLICT RESOLUTION
   ├── Check doctor schedule
   ├── Check resource availability
   ├── Check patient existing appointments
   └── Suggest alternatives if conflict
   ↓
4. APPOINTMENT CREATION
   ├── Create Appointment record
   │   ├── status = SCHEDULED
   │   ├── parentAppointmentId = null
   │   ├── isFollowUp = false
   │   └── seriesId = null (if not recurring)
   ├── Initialize Workflow Engine
   └── Generate Appointment ID
   ↓
5. BACKGROUND OPERATIONS (Async)
   ├── Queue notification jobs
   │   ├── Email confirmation
   │   ├── SMS reminder
   │   └── Push notification
   ├── Update cache
   └── Emit events (appointment.created)
   ↓
6. HIPAA AUDIT LOG
   └── Log appointment creation
   ↓
7. RESPONSE
   {
     success: true,
     data: { appointmentId, status, date, time, ... },
     message: "Appointment created successfully"
   }
```

### Flow 2: Appointment Completion with Follow-Up

```
┌─────────────────────────────────────────────────────────────┐
│           APPOINTMENT COMPLETION WITH FOLLOW-UP FLOW         │
└─────────────────────────────────────────────────────────────┘

1. DOCTOR COMPLETES APPOINTMENT
   POST /appointments/:id/complete
   {
     doctorId,
     notes, diagnosis, treatmentPlan,
     followUpRequired: true,
     followUpDate: "2024-02-15",
     followUpType: "routine",
     followUpInstructions: "Monitor blood pressure"
   }
   ↓
2. VALIDATION
   ├── Verify doctor has permission
   ├── Check appointment status (must be IN_PROGRESS)
   └── Validate follow-up data if provided
   ↓
3. UPDATE APPOINTMENT STATUS
   ├── Update appointment
   │   ├── status = COMPLETED
   │   ├── completedAt = now()
   │   └── Store completion data in metadata
   └── Update workflow state
   ↓
4. CREATE FOLLOW-UP PLAN (if followUpRequired = true)
   ├── Create FollowUpPlan record
   │   ├── appointmentId = current appointment
   │   ├── scheduledFor = followUpDate or calculate from daysAfter
   │   ├── followUpType = routine/urgent/specialist/therapy/surgery
   │   ├── status = "scheduled"
   │   ├── instructions = followUpInstructions
   │   └── followUpAppointmentId = null (not yet scheduled)
   ├── Store in database
   └── Cache follow-up plan
   ↓
5. AUTO-SCHEDULE FOLLOW-UP (if followUpDate provided)
   ├── Check if followUpDate is valid
   ├── Create Appointment for follow-up
   │   ├── type = FOLLOW_UP (or specific type)
   │   ├── parentAppointmentId = original appointment ID
   │   ├── isFollowUp = true
   │   ├── followUpReason = "Post-consultation follow-up"
   │   ├── originalAppointmentId = original appointment ID
   │   └── status = SCHEDULED
   ├── Link FollowUpPlan to new appointment
   │   └── followUpAppointmentId = new appointment ID
   └── Update FollowUpPlan.status = "completed"
   ↓
6. BACKGROUND OPERATIONS
   ├── Send completion notifications
   ├── Send follow-up plan notifications
   ├── Schedule reminders (if follow-up scheduled)
   └── Emit events
   │   ├── appointment.completed
   │   └── followup.plan.created
   ↓
7. HIPAA AUDIT LOG
   ├── Log appointment completion
   └── Log follow-up plan creation
   ↓
8. RESPONSE
   {
     success: true,
     data: {
       appointment: { id, status: "COMPLETED", ... },
       followUpPlan: { id, scheduledFor, ... },
       followUpAppointment: { id, date, ... } // if auto-scheduled
     }
   }
```

### Flow 3: Manual Follow-Up Scheduling

```
┌─────────────────────────────────────────────────────────────┐
│              MANUAL FOLLOW-UP SCHEDULING FLOW                 │
└─────────────────────────────────────────────────────────────┘

1. GET PENDING FOLLOW-UP PLANS
   GET /patients/:patientId/follow-up-plans?status=scheduled
   ↓
2. RESPONSE: List of FollowUpPlans
   [
     {
       id: "plan-123",
       appointmentId: "app-456",
       scheduledFor: "2024-02-15",
       followUpType: "routine",
       instructions: "Monitor progress",
       status: "scheduled"
     }
   ]
   ↓
3. PATIENT/DOCTOR SELECTS PLAN TO SCHEDULE
   POST /follow-up-plans/:planId/schedule
   {
     appointmentDate: "2024-02-15T10:00:00Z",
     doctorId: "doctor-789", // can be same or different
     locationId: "location-123",
     notes: "Patient requested morning slot"
   }
   ↓
4. VALIDATION
   ├── Verify plan exists and status = "scheduled"
   ├── Check if appointmentDate >= plan.scheduledFor
   ├── Validate doctor availability
   └── Check for conflicts
   ↓
5. CREATE FOLLOW-UP APPOINTMENT
   ├── Create Appointment
   │   ├── type = FOLLOW_UP (or from plan.followUpType)
   │   ├── parentAppointmentId = plan.appointmentId
   │   ├── isFollowUp = true
   │   ├── followUpReason = plan.instructions
   │   ├── originalAppointmentId = plan.appointmentId
   │   ├── date = appointmentDate
   │   └── status = SCHEDULED
   ├── Link to FollowUpPlan
   │   └── followUpAppointmentId = new appointment ID
   └── Update FollowUpPlan.status = "completed"
   ↓
6. BACKGROUND OPERATIONS
   ├── Send appointment confirmation
   ├── Schedule reminders
   └── Emit events
   │   ├── appointment.created
   │   └── followup.plan.converted
   ↓
7. RESPONSE
   {
     success: true,
     data: {
       followUpPlan: { id, status: "completed", ... },
       appointment: { id, date, parentAppointmentId, ... }
     }
   }
```

### Flow 4: Appointment Chain Query

```
┌─────────────────────────────────────────────────────────────┐
│                  APPOINTMENT CHAIN QUERY FLOW                 │
└─────────────────────────────────────────────────────────────┘

1. GET APPOINTMENT WITH CHAIN
   GET /appointments/:id/chain
   ↓
2. FETCH APPOINTMENT
   ├── Get appointment by ID
   └── Include relations: patient, doctor, clinic, location
   ↓
3. FETCH PARENT APPOINTMENT (if exists)
   ├── If parentAppointmentId exists
   └── Get parent appointment with relations
   ↓
4. FETCH ALL FOLLOW-UPS
   ├── Query appointments where parentAppointmentId = current.id
   ├── Include FollowUpPlan data
   └── Order by date ascending
   ↓
5. BUILD CHAIN STRUCTURE
   {
     original: {
       id: "app-1",
       date: "2024-01-15",
       status: "COMPLETED",
       type: "CONSULTATION"
     },
     followUps: [
       {
         id: "app-2",
         date: "2024-02-15",
         status: "SCHEDULED",
         type: "FOLLOW_UP",
         followUpPlan: { ... }
       },
       {
         id: "app-3",
         date: "2024-03-15",
         status: "PENDING",
         type: "FOLLOW_UP",
         followUpPlan: { ... }
       }
     ]
   }
   ↓
6. RESPONSE
   {
     success: true,
     data: {
       chain: { original, followUps },
       totalAppointments: 3,
       completed: 1,
       pending: 2
     }
   }
```

### Flow 5: Recurring Appointment Series

```
┌─────────────────────────────────────────────────────────────┐
│              RECURRING APPOINTMENT SERIES FLOW               │
└─────────────────────────────────────────────────────────────┘

1. CREATE RECURRING SERIES
   POST /appointments/recurring
   {
     templateId: "template-123",
     patientId: "patient-456",
     startDate: "2024-01-15",
     endDate: "2024-06-15",
     recurrencePattern: "WEEKLY"
   }
   ↓
2. VALIDATE TEMPLATE
   ├── Get AppointmentTemplate
   ├── Verify template is active
   └── Check recurrence pattern
   ↓
3. GENERATE APPOINTMENT SERIES
   ├── Calculate all appointment dates
   │   └── Based on pattern (WEEKLY, MONTHLY, etc.)
   ├── Create RecurringAppointmentSeries record
   └── seriesId = new UUID
   ↓
4. CREATE MULTIPLE APPOINTMENTS
   FOR EACH date in series:
     ├── Create Appointment
     │   ├── seriesId = series.id
     │   ├── seriesSequence = index (1, 2, 3...)
     │   ├── parentAppointmentId = null (first in series)
     │   ├── isFollowUp = false
     │   └── status = SCHEDULED
     └── Link appointments in sequence
   ↓
5. BACKGROUND OPERATIONS
   ├── Queue notifications for all appointments
   └── Emit events
   │   ├── appointment.series.created
   │   └── appointment.created (for each)
   ↓
6. RESPONSE
   {
     success: true,
     data: {
       seriesId: "series-789",
       appointments: [
         { id: "app-1", date: "2024-01-15", sequence: 1 },
         { id: "app-2", date: "2024-01-22", sequence: 2 },
         ...
       ],
       totalAppointments: 22
     }
   }
```

---

## 🗄️ Database Schema

### Enhanced Appointment Model

```prisma
model Appointment {
  // Existing fields
  id                  String              @id @default(uuid())
  type                AppointmentType
  doctorId            String
  patientId           String
  locationId          String
  clinicId            String
  date                DateTime
  time                String
  duration            Int
  status              AppointmentStatus
  priority            String?             @default("NORMAL")
  notes               String?
  userId              String
  updatedBy           String?
  cancellationReason  String?
  metadata            Json?
  cancelledBy         String?
  cancelledAt         DateTime?
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  therapyId           String?
  startedAt           DateTime?
  checkedInAt         DateTime?
  completedAt         DateTime?
  subscriptionId      String?
  isSubscriptionBased Boolean             @default(false)
  
  // NEW: Follow-up relationships
  parentAppointmentId  String?
  parentAppointment    Appointment?        @relation("AppointmentFollowUps", fields: [parentAppointmentId], references: [id])
  followUpAppointments Appointment[]       @relation("AppointmentFollowUps")
  
  // NEW: Recurring series
  seriesId            String?
  series              RecurringAppointmentSeries? @relation(fields: [seriesId], references: [id])
  seriesSequence      Int?                // Position in series (1, 2, 3...)
  
  // NEW: Follow-up metadata
  isFollowUp          Boolean              @default(false)
  followUpReason      String?              // Why this follow-up was created
  originalAppointmentId String?            // Original appointment that triggered this
  
  // Relations
  clinic              Clinic               @relation(fields: [clinicId], references: [id])
  doctor              Doctor                @relation(fields: [doctorId], references: [id])
  location            ClinicLocation        @relation(fields: [locationId], references: [id])
  patient             Patient               @relation(fields: [patientId], references: [id])
  subscription        Subscription?         @relation(fields: [subscriptionId], references: [id])
  therapy             Therapy?              @relation(fields: [therapyId], references: [id])
  user                User                  @relation(fields: [userId], references: [id])
  
  // NEW: Follow-up plan relation
  followUpPlan        FollowUpPlan?
  
  // Existing relations
  checkIns            CheckIn[]
  payment             Payment?
  queue               Queue?
  queueEntries        QueueEntry[]
  resourceBookings    ResourceBooking[]
  therapySessions     TherapySession[]
  VideoConsultation   VideoConsultation[]

  @@index([doctorId])
  @@index([patientId])
  @@index([locationId])
  @@index([clinicId])
  @@index([subscriptionId])
  @@index([parentAppointmentId])      // NEW
  @@index([seriesId])                 // NEW
  @@index([isFollowUp])                // NEW
  @@index([originalAppointmentId])    // NEW
}
```

### FollowUpPlan Model

```prisma
model FollowUpPlan {
  id                    String       @id @default(uuid())
  appointmentId         String       // Original appointment
  patientId             String
  doctorId              String
  clinicId              String
  followUpType          String       // routine, urgent, specialist, therapy, surgery
  scheduledFor          DateTime     // Recommended date
  daysAfter             Int?         // Days after original appointment
  status                String       // scheduled, completed, cancelled, overdue
  priority              String       // low, normal, high, urgent
  instructions          String
  medications           String[]     @default([])
  tests                 String[]     @default([])
  restrictions          String[]     @default([])
  notes                 String?
  
  // Link to actual appointment when created
  followUpAppointmentId String?      @unique
  followUpAppointment   Appointment? @relation(fields: [followUpAppointmentId], references: [id])
  
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt
  
  // Relations
  appointment           Appointment   @relation(fields: [appointmentId], references: [id])
  patient               Patient       @relation(fields: [patientId], references: [id])
  doctor                Doctor         @relation(fields: [doctorId], references: [id])
  clinic                Clinic         @relation(fields: [clinicId], references: [id])
  
  @@index([appointmentId])
  @@index([patientId])
  @@index([clinicId])
  @@index([status])
  @@index([scheduledFor])
  @@index([followUpAppointmentId])
}
```

### Enhanced RecurringAppointmentSeries

```prisma
model RecurringAppointmentSeries {
  id         String              @id @default(uuid())
  templateId String
  patientId  String
  clinicId   String
  startDate  DateTime
  endDate    DateTime?
  status     String              @default("active") // active, paused, cancelled
  createdAt  DateTime            @default(now())
  updatedAt  DateTime            @updatedAt
  
  clinic     Clinic              @relation(fields: [clinicId], references: [id])
  patient    Patient             @relation(fields: [patientId], references: [id])
  template   AppointmentTemplate @relation(fields: [templateId], references: [id])
  appointments Appointment[]     // NEW: Link to appointments in series
  
  @@index([templateId])
  @@index([patientId])
  @@index([clinicId])
  @@index([status])
}
```

### Updated AppointmentStatus Enum

```prisma
enum AppointmentStatus {
  PENDING
  SCHEDULED
  CONFIRMED
  CHECKED_IN
  IN_PROGRESS
  COMPLETED
  CANCELLED
  NO_SHOW
  RESCHEDULED
  WAITING
  ON_HOLD
  TRANSFERRED
  DISCHARGED
  FOLLOW_UP_SCHEDULED  // NEW
}
```

---

## 🔌 API Flows

### Endpoint: Create Regular Appointment

```http
POST /appointments
Headers:
  Authorization: Bearer <token>
  X-Clinic-ID: <clinic-id>
  Content-Type: application/json

Body:
{
  "patientId": "uuid",
  "doctorId": "uuid",
  "clinicId": "uuid",
  "locationId": "uuid",
  "appointmentDate": "2024-01-15T10:00:00Z",
  "duration": 30,
  "type": "CONSULTATION",
  "priority": "NORMAL",
  "notes": "Regular checkup"
}

Response: 201 Created
{
  "success": true,
  "data": {
    "id": "appointment-uuid",
    "status": "SCHEDULED",
    "date": "2024-01-15T10:00:00Z",
    "type": "CONSULTATION",
    "parentAppointmentId": null,
    "isFollowUp": false
  },
  "message": "Appointment created successfully"
}
```

### Endpoint: Complete Appointment with Follow-Up

```http
POST /appointments/:id/complete
Headers:
  Authorization: Bearer <token>
  X-Clinic-ID: <clinic-id>
  Content-Type: application/json

Body:
{
  "doctorId": "uuid",
  "notes": "Patient is recovering well",
  "diagnosis": "Hypertension",
  "treatmentPlan": "Medication and lifestyle changes",
  "followUpRequired": true,
  "followUpDate": "2024-02-15",
  "followUpType": "routine",
  "followUpInstructions": "Monitor blood pressure weekly"
}

Response: 200 OK
{
  "success": true,
  "data": {
    "appointment": {
      "id": "appointment-uuid",
      "status": "COMPLETED",
      "completedAt": "2024-01-15T11:00:00Z"
    },
    "followUpPlan": {
      "id": "followup-plan-uuid",
      "scheduledFor": "2024-02-15",
      "status": "completed", // if auto-scheduled
      "followUpType": "routine"
    },
    "followUpAppointment": {
      "id": "followup-appointment-uuid",
      "parentAppointmentId": "appointment-uuid",
      "isFollowUp": true,
      "date": "2024-02-15T10:00:00Z",
      "status": "SCHEDULED"
    }
  },
  "message": "Appointment completed and follow-up scheduled"
}
```

### Endpoint: Get Appointment Chain

```http
GET /appointments/:id/chain
Headers:
  Authorization: Bearer <token>
  X-Clinic-ID: <clinic-id>

Response: 200 OK
{
  "success": true,
  "data": {
    "chain": {
      "original": {
        "id": "app-1",
        "date": "2024-01-15T10:00:00Z",
        "status": "COMPLETED",
        "type": "CONSULTATION",
        "doctor": { "id": "...", "name": "Dr. Smith" },
        "patient": { "id": "...", "name": "John Doe" }
      },
      "followUps": [
        {
          "id": "app-2",
          "date": "2024-02-15T10:00:00Z",
          "status": "SCHEDULED",
          "type": "FOLLOW_UP",
          "parentAppointmentId": "app-1",
          "isFollowUp": true,
          "followUpReason": "Monitor blood pressure",
          "followUpPlan": {
            "id": "plan-1",
            "followUpType": "routine",
            "instructions": "Monitor blood pressure weekly"
          }
        }
      ]
    },
    "totalAppointments": 2,
    "completed": 1,
    "pending": 1
  }
}
```

### Endpoint: Schedule Follow-Up from Plan

```http
POST /follow-up-plans/:planId/schedule
Headers:
  Authorization: Bearer <token>
  X-Clinic-ID: <clinic-id>
  Content-Type: application/json

Body:
{
  "appointmentDate": "2024-02-15T10:00:00Z",
  "doctorId": "uuid",
  "locationId": "uuid",
  "notes": "Patient requested morning slot"
}

Response: 201 Created
{
  "success": true,
  "data": {
    "followUpPlan": {
      "id": "plan-uuid",
      "status": "completed",
      "followUpAppointmentId": "appointment-uuid"
    },
    "appointment": {
      "id": "appointment-uuid",
      "parentAppointmentId": "original-appointment-uuid",
      "isFollowUp": true,
      "date": "2024-02-15T10:00:00Z",
      "status": "SCHEDULED"
    }
  },
  "message": "Follow-up appointment scheduled successfully"
}
```

### Endpoint: Get Patient Follow-Up Plans

```http
GET /patients/:patientId/follow-up-plans?status=scheduled&clinicId=uuid
Headers:
  Authorization: Bearer <token>
  X-Clinic-ID: <clinic-id>

Response: 200 OK
{
  "success": true,
  "data": [
    {
      "id": "plan-1",
      "appointmentId": "app-1",
      "scheduledFor": "2024-02-15",
      "followUpType": "routine",
      "status": "scheduled",
      "instructions": "Monitor blood pressure",
      "medications": ["Lisinopril"],
      "tests": ["Blood pressure check"],
      "originalAppointment": {
        "id": "app-1",
        "date": "2024-01-15",
        "doctor": { "name": "Dr. Smith" }
      }
    }
  ]
}
```

---

## 🔄 Service Layer Flows

### CoreAppointmentService.createAppointment()

```typescript
async createAppointment(
  createDto: CreateAppointmentDto,
  context: AppointmentContext
): Promise<AppointmentResult> {
  // 1. Validate business rules
  const validation = await this.businessRules.validateAppointmentCreation(createDto, context);
  if (!validation.passed) {
    return { success: false, error: 'BUSINESS_RULE_VIOLATION', ... };
  }

  // 2. Check conflicts
  const conflictResult = await this.conflictResolutionService.resolveSchedulingConflict(...);
  if (!conflictResult.canSchedule) {
    return { success: false, error: 'SCHEDULING_CONFLICT', ... };
  }

  // 3. Create appointment
  const appointmentData = {
    ...createDto,
    userId: context.userId,
    status: AppointmentStatus.SCHEDULED,
    parentAppointmentId: null, // Regular appointment
    isFollowUp: false,
    date: new Date(createDto.date),
  };

  const appointment = await this.databaseService.createAppointmentSafe(appointmentData);

  // 4. Initialize workflow
  this.workflowEngine.initializeWorkflow(appointment.id, 'APPOINTMENT_CREATED');

  // 5. Queue background operations
  await this.queueBackgroundOperations(appointment, context);

  // 6. Emit events
  await this.eventService.emit('appointment.created', { appointmentId: appointment.id, ... });

  // 7. HIPAA audit log
  await this.hipaaAuditLog('CREATE_APPOINTMENT', context, { appointmentId: appointment.id });

  return { success: true, data: appointment, ... };
}
```

### CoreAppointmentService.completeAppointment()

```typescript
async completeAppointment(
  appointmentId: string,
  completeDto: CompleteAppointmentDto,
  context: AppointmentContext
): Promise<AppointmentResult> {
  // 1. Get appointment
  const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
  if (!appointment) {
    return { success: false, error: 'APPOINTMENT_NOT_FOUND', ... };
  }

  // 2. Update appointment status
  const updated = await this.databaseService.updateAppointmentSafe(appointmentId, {
    status: AppointmentStatus.COMPLETED,
    completedAt: new Date(),
    metadata: {
      ...appointment.metadata,
      completion: {
        notes: completeDto.notes,
        diagnosis: completeDto.diagnosis,
        treatmentPlan: completeDto.treatmentPlan,
      },
    },
  });

  // 3. Create follow-up plan if required
  let followUpPlan = null;
  let followUpAppointment = null;

  if (completeDto.followUpRequired) {
    // Create follow-up plan
    followUpPlan = await this.followUpService.createFollowUpPlan(
      appointmentId,
      appointment.patientId,
      appointment.doctorId,
      appointment.clinicId,
      completeDto.followUpType || 'routine',
      completeDto.followUpDate 
        ? Math.ceil((new Date(completeDto.followUpDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
        : 7, // Default 7 days
      completeDto.followUpInstructions || 'Follow-up appointment recommended',
      completeDto.followUpPriority || 'normal'
    );

    // Auto-schedule if date provided
    if (completeDto.followUpDate) {
      followUpAppointment = await this.createFollowUpAppointment(
        followUpPlan.id,
        completeDto.followUpDate,
        context
      );
    }
  }

  // 4. Update workflow
  this.workflowEngine.transitionStatus(
    appointmentId,
    appointment.status,
    AppointmentStatus.COMPLETED,
    context.userId
  );

  // 5. Emit events
  await this.eventService.emit('appointment.completed', { appointmentId, ... });
  if (followUpPlan) {
    await this.eventService.emit('followup.plan.created', { followUpPlanId: followUpPlan.id, ... });
  }

  return {
    success: true,
    data: {
      appointment: updated,
      followUpPlan,
      followUpAppointment,
    },
    ...
  };
}
```

### AppointmentFollowUpService.createFollowUpAppointment()

```typescript
async createFollowUpAppointment(
  followUpPlanId: string,
  appointmentDate: string,
  context: AppointmentContext
): Promise<AppointmentResult> {
  // 1. Get follow-up plan
  const plan = await this.databaseService.findFollowUpPlanByIdSafe(followUpPlanId);
  if (!plan || plan.status !== 'scheduled') {
    return { success: false, error: 'FOLLOWUP_PLAN_NOT_FOUND', ... };
  }

  // 2. Get original appointment
  const originalAppointment = await this.databaseService.findAppointmentByIdSafe(plan.appointmentId);

  // 3. Create follow-up appointment
  const followUpAppointmentData = {
    patientId: plan.patientId,
    doctorId: plan.doctorId, // Can be changed
    clinicId: plan.clinicId,
    locationId: originalAppointment.locationId, // Can be changed
    date: new Date(appointmentDate),
    time: originalAppointment.time, // Can be changed
    duration: originalAppointment.duration,
    type: AppointmentType.FOLLOW_UP,
    status: AppointmentStatus.SCHEDULED,
    priority: this.mapPriority(plan.priority),
    notes: plan.instructions,
    userId: context.userId,
    // Follow-up specific fields
    parentAppointmentId: plan.appointmentId,
    isFollowUp: true,
    followUpReason: plan.instructions,
    originalAppointmentId: plan.appointmentId,
  };

  const followUpAppointment = await this.databaseService.createAppointmentSafe(followUpAppointmentData);

  // 4. Link plan to appointment
  await this.databaseService.updateFollowUpPlanSafe(plan.id, {
    followUpAppointmentId: followUpAppointment.id,
    status: 'completed',
  });

  // 5. Queue notifications
  await this.queueBackgroundOperations(followUpAppointment, context);

  // 6. Emit events
  await this.eventService.emit('appointment.created', {
    appointmentId: followUpAppointment.id,
    isFollowUp: true,
    parentAppointmentId: plan.appointmentId,
    ...
  });

  return {
    success: true,
    data: followUpAppointment,
    ...
  };
}
```

---

## 📈 Workflow States

### Regular Appointment State Machine

```
PENDING
  ↓ (scheduled)
SCHEDULED
  ↓ (confirmed)
CONFIRMED
  ↓ (patient arrives)
CHECKED_IN
  ↓ (doctor starts)
IN_PROGRESS
  ↓ (doctor completes)
COMPLETED
  └─→ (if followUpRequired) → Create FollowUpPlan → [FOLLOW_UP_SCHEDULED]
```

### Follow-Up Appointment State Machine

```
FOLLOW_UP_SCHEDULED (plan created, not yet scheduled)
  ↓ (appointment created from plan)
SCHEDULED
  ↓ (confirmed)
CONFIRMED
  ↓ (patient arrives)
CHECKED_IN
  ↓ (doctor starts)
IN_PROGRESS
  ↓ (doctor completes)
COMPLETED
  └─→ (can create another follow-up if needed)
```

### Follow-Up Plan State Machine

```
scheduled (plan created, not yet converted to appointment)
  ↓ (appointment created)
completed (appointment scheduled)
  OR
cancelled (plan cancelled)
  OR
overdue (scheduledFor date passed without scheduling)
```

---

## 🛠️ Implementation Guide

### Step 1: Database Migration

1. Create migration for new fields:
   ```bash
   npx prisma migrate dev --name add_followup_relationships
   ```

2. Add indexes for performance:
   - `parentAppointmentId`
   - `isFollowUp`
   - `seriesId`
   - `originalAppointmentId`

### Step 2: Update Prisma Schema

1. Add new fields to `Appointment` model
2. Create `FollowUpPlan` model
3. Update `RecurringAppointmentSeries` model
4. Add new enum values

### Step 3: Update DTOs

1. Add follow-up fields to `CreateAppointmentDto`
2. Add follow-up fields to `CompleteAppointmentDto`
3. Create `CreateFollowUpPlanDto`
4. Create `ScheduleFollowUpDto`
5. Create `AppointmentChainResponseDto`

### Step 4: Update Services

1. **CoreAppointmentService**:
   - Add `createFollowUpAppointment()`
   - Add `getAppointmentChain()`
   - Update `completeAppointment()` to handle follow-ups

2. **AppointmentFollowUpService**:
   - Move from cache to database
   - Add `createFollowUpAppointment()`
   - Add `getFollowUpChain()`
   - Add `convertPlanToAppointment()`

3. **DatabaseService**:
   - Add `findFollowUpPlanByIdSafe()`
   - Add `createFollowUpPlanSafe()`
   - Add `updateFollowUpPlanSafe()`
   - Add `findAppointmentsByParentIdSafe()`

### Step 5: Update Controllers

1. Add new endpoints:
   - `POST /appointments/:id/follow-up`
   - `GET /appointments/:id/chain`
   - `GET /appointments/:id/follow-ups`
   - `POST /follow-up-plans/:id/schedule`
   - `GET /patients/:id/follow-up-plans`

2. Update existing endpoints:
   - `POST /appointments/:id/complete` - Add follow-up handling
   - `GET /appointments/:id` - Include parent/children

### Step 6: Update Workflow Engine

1. Add `FOLLOW_UP_SCHEDULED` state
2. Add transitions for follow-up appointments
3. Add validation for follow-up creation

### Step 7: Update Event Handlers

1. Handle `appointment.completed` → Create follow-up plan
2. Handle `followup.plan.created` → Send notifications
3. Handle `followup.plan.converted` → Update plan status

### Step 8: Testing

1. Unit tests for service methods
2. Integration tests for API endpoints
3. E2E tests for complete flows
4. Performance tests for chain queries

---

## 📝 Examples

### Example 1: Complete Flow - Consultation with Follow-Up

```
1. Patient books consultation
   POST /appointments
   → Appointment created (id: app-1, status: SCHEDULED)

2. Patient checks in
   POST /appointments/app-1/check-in
   → Status: CHECKED_IN

3. Doctor starts consultation
   POST /appointments/app-1/start
   → Status: IN_PROGRESS

4. Doctor completes consultation
   POST /appointments/app-1/complete
   {
     followUpRequired: true,
     followUpDate: "2024-02-15",
     followUpType: "routine",
     followUpInstructions: "Monitor blood pressure"
   }
   → Status: COMPLETED
   → FollowUpPlan created (id: plan-1)
   → FollowUpAppointment created (id: app-2, parentAppointmentId: app-1)

5. Patient views appointment chain
   GET /appointments/app-1/chain
   → Returns: original appointment + follow-up appointment
```

### Example 2: Manual Follow-Up Scheduling

```
1. Doctor completes appointment
   POST /appointments/app-1/complete
   { followUpRequired: true } // No date provided
   → FollowUpPlan created (status: scheduled)

2. Patient views pending follow-ups
   GET /patients/patient-123/follow-up-plans?status=scheduled
   → Returns list of pending plans

3. Patient schedules follow-up
   POST /follow-up-plans/plan-1/schedule
   { appointmentDate: "2024-02-15T10:00:00Z" }
   → FollowUpAppointment created (id: app-2)
   → FollowUpPlan updated (status: completed)
```

### Example 3: Recurring Therapy Sessions

```
1. Create recurring series
   POST /appointments/recurring
   {
     templateId: "therapy-template",
     patientId: "patient-123",
     startDate: "2024-01-15",
     endDate: "2024-06-15",
     recurrencePattern: "WEEKLY"
   }
   → RecurringAppointmentSeries created (id: series-1)
   → 22 appointments created (seriesSequence: 1-22)

2. Each appointment has:
   - seriesId: "series-1"
   - seriesSequence: 1, 2, 3, ..., 22
   - parentAppointmentId: null (first in series)
   - isFollowUp: false
```

---

## 🔒 Security & Compliance

### HIPAA Compliance

- All appointment operations logged in audit trail
- Follow-up plans include patient data → encrypted storage
- Access control: Patients can only see their own appointments
- RBAC: Doctors can create follow-ups for their patients

### Data Privacy

- Follow-up plans contain medical instructions → encrypted
- Appointment chains only visible to authorized users
- Audit logs for all follow-up plan conversions

---

## 📊 Performance Considerations

### Indexing Strategy

```sql
-- Fast lookup of follow-ups for an appointment
CREATE INDEX idx_appointment_parent ON "Appointment"("parentAppointmentId");

-- Fast lookup of appointments in a series
CREATE INDEX idx_appointment_series ON "Appointment"("seriesId", "seriesSequence");

-- Fast filtering of follow-up appointments
CREATE INDEX idx_appointment_isfollowup ON "Appointment"("isFollowUp") WHERE "isFollowUp" = true;

-- Fast lookup of follow-up plans by patient
CREATE INDEX idx_followupplan_patient ON "FollowUpPlan"("patientId", "status");
```

### Caching Strategy

- Cache appointment chains (TTL: 5 minutes)
- Cache follow-up plans (TTL: 1 hour)
- Invalidate cache on appointment updates
- Use Redis for distributed caching

### Query Optimization

- Use `include` for eager loading relationships
- Paginate follow-up lists
- Use database views for complex chain queries
- Batch load appointments in series

---

## 🚨 Error Handling

### Common Error Scenarios

1. **Follow-up plan not found**
   - Error: `FOLLOWUP_PLAN_NOT_FOUND`
   - Status: 404
   - Action: Verify plan ID exists

2. **Follow-up plan already converted**
   - Error: `FOLLOWUP_PLAN_ALREADY_CONVERTED`
   - Status: 400
   - Action: Check plan status before conversion

3. **Invalid follow-up date**
   - Error: `INVALID_FOLLOWUP_DATE`
   - Status: 400
   - Action: Ensure date >= plan.scheduledFor

4. **Scheduling conflict for follow-up**
   - Error: `SCHEDULING_CONFLICT`
   - Status: 409
   - Action: Suggest alternative slots

---

## 📚 Related Documentation

- [Appointment Service Documentation](./APPOINTMENT_SERVICE.md)
- [Follow-Up Plugin Documentation](./FOLLOWUP_PLUGIN.md)
- [Workflow Engine Documentation](./WORKFLOW_ENGINE.md)
- [Database Schema Documentation](../../../src/libs/infrastructure/database/prisma/README.md)

---

## 🔄 Version History

- **v1.0** (2024-01-15): Initial documentation
- **v1.1** (2024-01-20): Added recurring appointments flow
- **v1.2** (2024-01-25): Added appointment chain queries

---

## 📞 Support

For questions or issues related to appointment and follow-up flows, please contact:
- Technical Lead: [Contact Info]
- Documentation: [Link to Wiki]
- Issue Tracker: [Link to Issues]

---

**Last Updated**: 2024-01-15  
**Maintained By**: Healthcare Backend Team


