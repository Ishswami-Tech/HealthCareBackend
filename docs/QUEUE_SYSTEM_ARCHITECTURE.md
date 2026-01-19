# 🏥 Queue System Architecture - Complete Visual Guide

**Status**: ✅ Production-Ready  
**Version**: 2.0.0  
**Last Updated**: 2024

---

## 📋 Table of Contents

1. [System Overview](#system-overview)
2. [Queue Architecture](#queue-architecture)
3. [Role-Based Workflows](#role-based-workflows)
4. [Complete Scenarios](#complete-scenarios)
5. [Database Schema](#database-schema)
6. [API Endpoints](#api-endpoints)

---

## 🎯 System Overview

### Core Architecture

**Single Queue Table** with **Location + Category Filtering**

```
┌─────────────────────────────────────────────────────────────┐
│              SINGLE QUEUE TABLE (All Patients)              │
│                  (All Locations, All Categories)            │
└─────────────────────────────────────────────────────────────┘

Global Queue Entries:
1. Patient A (Location A, SPECIAL_CHILD) - Global: 1
2. Patient B (Location A, REGULAR_FOLLOWUP) - Global: 2
3. Patient C (Location B, SPECIAL_CHILD) - Global: 3
4. Patient D (Location A, SPECIAL_CHILD) - Global: 4
5. Patient E (Location B, NEW_OPD) - Global: 5
...
```

### Filtered Views (What Doctors See)

```
┌─────────────────────────────────────────────────────────────┐
│     Location A - SPECIAL_CHILD Queue View                   │
├─────────────────────────────────────────────────────────────┤
│ 1. Patient A - Category Position: 1 (Global: 1)            │
│ 2. Patient D - Category Position: 2 (Global: 4)             │
│ Total: 2 patients waiting                                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│     Location A - REGULAR_FOLLOWUP Queue View                │
├─────────────────────────────────────────────────────────────┤
│ 1. Patient B - Category Position: 1 (Global: 2)            │
│ Total: 1 patient waiting                                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│     Location B - SPECIAL_CHILD Queue View                   │
├─────────────────────────────────────────────────────────────┤
│ 1. Patient C - Category Position: 1 (Global: 3)            │
│ Total: 1 patient waiting                                    │
└─────────────────────────────────────────────────────────────┘
```

### Key Principles

1. **One Queue Table** - All patients in single table
2. **Location-Based** - Each location has separate queues (filtered)
3. **Category-Based** - Each category has separate positions (calculated)
4. **Doctor Completion Required** - Next patient only available after current
   consultation completes
5. **Role-Based Access** - Each role sees only what they need

---

## 🏗️ Queue Architecture

### Database Structure

```
Queue Table (Single Table)
├── Global Position: 1, 2, 3, 4, 5... (sequential)
├── Location Filter: clinicLocationId (required)
├── Category Filter: category (SPECIAL_CHILD, REGULAR_FOLLOWUP, etc.)
└── Status: WAITING, IN_PROGRESS, COMPLETED

When Doctor Views Queue:
→ Filter by: clinicLocationId + category
→ Calculate: Category Position (1, 2, 3...)
→ Show: Only WAITING patients
```

### Position Calculation

```sql
-- Category Position Calculation (On-the-Fly)
SELECT
  *,
  ROW_NUMBER() OVER (
    PARTITION BY clinicLocationId, category
    ORDER BY globalPosition
  ) as categoryPosition
FROM Queue
WHERE clinicLocationId = 'location-a'
  AND category = 'SPECIAL_CHILD'
  AND status = 'WAITING'
ORDER BY globalPosition
```

### Example: Multi-Location, Multi-Category

```
Global Queue:
1. Patient A (Location A, SPECIAL_CHILD) - Global: 1
2. Patient B (Location A, REGULAR_FOLLOWUP) - Global: 2
3. Patient C (Location B, SPECIAL_CHILD) - Global: 3
4. Patient D (Location A, SPECIAL_CHILD) - Global: 4
5. Patient E (Location B, NEW_OPD) - Global: 5
6. Patient F (Location A, REGULAR_FOLLOWUP) - Global: 6

Location A - SPECIAL_CHILD View:
→ Patient A (Category Pos: 1, Global: 1)
→ Patient D (Category Pos: 2, Global: 4)

Location A - REGULAR_FOLLOWUP View:
→ Patient B (Category Pos: 1, Global: 2)
→ Patient F (Category Pos: 2, Global: 6)

Location B - SPECIAL_CHILD View:
→ Patient C (Category Pos: 1, Global: 3)

Location B - NEW_OPD View:
→ Patient E (Category Pos: 1, Global: 5)
```

---

## 👥 Role-Based Workflows

### 1. CLINIC_ADMIN Role

**Permissions:**

- ✅ View all queues (all locations, all categories)
- ✅ Manage doctor assignments to locations/categories
- ✅ Manage clinic availability
- ✅ View analytics and reports
- ✅ Override queue operations
- ✅ Manage assistant doctor assignments

**Workflow:**

```
Admin Dashboard
├── All Locations Overview
│   ├── Location A: 15 waiting, 5 in progress
│   └── Location B: 8 waiting, 3 in progress
├── Doctor Management
│   ├── Assign doctors to locations
│   ├── Assign doctors to categories
│   └── View doctor availability
└── Analytics
    ├── Queue metrics per location
    ├── Doctor utilization
    └── Patient wait times
```

### 2. DOCTOR Role (Main Doctor)

**Permissions:**

- ✅ View queues for assigned location(s) and category(ies)
- ✅ Call next patient (only if current consultation completed)
- ✅ Complete consultation
- ✅ Approve assistant doctor prescriptions
- ✅ View patient history
- ✅ Update consultation notes

**Critical Rule:**

- ❌ **Cannot call next patient until current consultation is marked COMPLETED**
- ✅ Must complete current patient before getting next one

**Workflow:**

```
Doctor Dashboard (Location A)
├── My Queues (by category)
│   ├── SPECIAL_CHILD: 5 waiting
│   └── REGULAR_FOLLOWUP: 3 waiting
├── Current Patient
│   └── Patient X (IN_PROGRESS) - Must complete before next
└── Actions
    ├── Complete Current Consultation → Then can call next
    ├── Call Next Patient (disabled if current patient active)
    └── View Queue Statistics
```

### 3. ASSISTANT_DOCTOR Role

**Permissions:**

- ✅ View queues for assigned location(s) and category(ies)
- ✅ Call next patient (only if current consultation completed)
- ✅ Complete consultation
- ✅ Create prescriptions (requires approval)
- ❌ Cannot approve own prescriptions
- ✅ View pending approval requests

**Critical Rules:**

- ❌ **Cannot call next patient until current consultation is marked COMPLETED**
- ❌ **Prescriptions require main doctor approval**

**Workflow:**

```
Assistant Doctor Dashboard (Location A)
├── My Queues
│   ├── SPECIAL_CHILD: 5 waiting
│   └── NEW_OPD: 8 waiting
├── Current Patient
│   └── Patient Y (IN_PROGRESS) - Must complete before next
├── Pending Approvals
│   └── 2 prescriptions waiting for approval
└── Actions
    ├── Complete Current Consultation → Then can call next
    ├── Create Prescription → Auto-creates approval request
    └── View Approval Status
```

### 4. RECEPTIONIST Role

**Permissions:**

- ✅ View all queues at assigned location(s)
- ✅ **Manual check-in** (for patients who can't scan QR) - PRIMARY FUNCTION
- ✅ QR code check-in processing
- ✅ View patient queue positions
- ✅ Update patient information
- ✅ Cancel appointments
- ✅ Reschedule appointments
- ❌ Cannot call next patient (doctors only)
- ❌ Cannot complete consultations (doctors only)
- ❌ Cannot approve prescriptions

**Critical Function:**

- ✅ **Manual Check-In** - Receptionist can check in patients manually when QR
  doesn't work
- ✅ **NOT Admin** - Only Receptionist and Clinic Admin can manually check in

**Workflow:**

```
Receptionist Dashboard (Location A)
├── Check-In Options
│   ├── QR Code Scan (patient scans)
│   └── Manual Check-In (receptionist enters)
├── Queue Overview
│   ├── SPECIAL_CHILD: 5 waiting
│   ├── REGULAR_FOLLOWUP: 3 waiting
│   └── NEW_OPD: 8 waiting
└── Patient Management
    ├── Search patient
    ├── Manual check-in
    └── View queue position
```

### 5. PHARMACIST Role

**Permissions:**

- ✅ View prescriptions (after doctor approval)
- ✅ View patient medication history
- ✅ Process prescriptions
- ❌ Cannot see queues
- ❌ Cannot check in patients
- ❌ Cannot call patients

**Workflow:**

```
Pharmacist Dashboard
├── Pending Prescriptions
│   └── Approved prescriptions ready to process
├── Patient Medication History
└── Prescription Processing
```

### 6. PATIENT Role

**Permissions:**

- ✅ View own queue position
- ✅ View estimated wait time
- ✅ Receive notifications
- ❌ Cannot see other patients
- ❌ Cannot modify queue

**Workflow:**

```
Patient View
├── My Appointment
│   ├── Status: CONFIRMED (checked in)
│   ├── Queue Position: 3 (SPECIAL_CHILD category)
│   └── Estimated Wait: 45 minutes
└── Notifications
    └── "You're next!" when doctor calls
```

---

## 🔄 Complete Workflow

### Step-by-Step: Booking → Check-In → Queue → Consultation

```
1. PATIENT BOOKS APPOINTMENT
   ├── Status: SCHEDULED
   ├── Category: Auto-detected or selected
   ├── Time Slot: Validated (12:30-1:30 for SPECIAL_CHILD)
   └── Location: Selected

2. PATIENT ARRIVES AT CLINIC
   ├── Option A: Patient scans QR code
   └── Option B: RECEPTIONIST does manual check-in

3. CHECK-IN PROCESSED
   ├── QR Scan OR Manual Check-In by Receptionist
   ├── Validate: 30 min before to 1.5 hr after appointment time
   ├── Appointment Status: SCHEDULED → CONFIRMED
   └── Queue Entry Created
       ├── clinicLocationId: Location where checked in
       ├── category: SPECIAL_CHILD
       ├── globalPosition: Next available (e.g., 5)
       ├── status: WAITING
       └── categoryPosition: Calculated (e.g., 2 in SPECIAL_CHILD)

4. DOCTOR VIEWS QUEUE
   ├── Filter: Location A + SPECIAL_CHILD
   ├── Sees: Only WAITING patients from Location A
   └── Example: 5 patients waiting (positions 1, 2, 3, 4, 5)

5. DOCTOR CALLS NEXT PATIENT (CONSULTATION STARTS)
   ├── Check: Is current consultation completed?
   │   ├── YES → Can call next
   │   └── NO → Blocked, must complete current first
   ├── Get: Next WAITING patient (lowest category position)
   ├── Assign: Patient to doctor
   ├── Update: Status WAITING → IN_PROGRESS
   ├── Update: startedAt = current timestamp
   ├── Update: Doctor's currentPatientCount++
   └── Notify: Patient "You're next! Consultation starting..."

   ⚠️ RULE: Doctor CANNOT call next until current patient is COMPLETED
   ✅ CONSULTATION STARTS: When doctor calls next, consultation begins

6. CONSULTATION IN PROGRESS
   ├── Status: IN_PROGRESS
   ├── Consultation started when doctor called patient
   ├── Doctor cannot call next patient (blocked)
   ├── Patient being seen by doctor
   └── Queue positions remain unchanged during consultation

7. CONSULTATION COMPLETED (AUTOMATIC POSITION UPDATE)
   ├── Doctor marks as COMPLETED
   ├── Update: Status IN_PROGRESS → COMPLETED
   ├── Update: completedAt timestamp
   ├── If Assistant Doctor: Create prescription approval request
   ├── Decrement: Doctor's currentPatientCount--
   ├── Update: Appointment status → COMPLETED
   │
   ├── 🔄 AUTOMATIC POSITION RECALCULATION:
   │   ├── Remove completed patient from queue
   │   ├── Recalculate positions for ALL remaining patients
   │   ├── Example: Patient at Position 3 completes
   │   │   → Patient at Position 4 → becomes Position 3
   │   │   → Patient at Position 5 → becomes Position 4
   │   │   → All positions shift up automatically
   │   ├── Update: categoryPosition for all affected patients
   │   ├── Broadcast: Real-time position updates to all patients
   │   └── Update: Estimated wait times for remaining patients
   │
   └── ✅ NOW: Doctor can call next patient (unlocked)

   ⚠️ RULE: Next patient only available AFTER completion
   ✅ AUTOMATIC: Positions update when any patient completes

8. NEXT PATIENT AVAILABLE
   └── Doctor can now call next patient (step 5 repeats)
```

---

## 📊 Database Schema

### Queue Model

```prisma
model Queue {
  id                String                @id @default(uuid())
  appointmentId     String                @unique
  queueNumber       Int                   // Global position (1, 2, 3...)
  estimatedWaitTime Int?
  status            QueueStatus           @default(WAITING)
  clinicId          String
  clinicLocationId  String                // REQUIRED: Location filter
  category          AppointmentCategory?  // Category filter
  timeSlot          String?               // Original booked time slot
  globalPosition    Int                   // Same as queueNumber
  doctorId          String?               // Assigned doctor
  assistantDoctorId String?               // If handled by assistant
  priority          Int                   @default(0)
  isLateArrival     Boolean               @default(false)
  originalTimeSlot  String?
  arrivedAt         DateTime?
  checkedInAt       DateTime?
  startedAt         DateTime?            // When doctor called
  completedAt       DateTime?            // When marked completed
  notes             String?
  autoAssigned      Boolean               @default(false)
  requiresApproval   Boolean               @default(false)
  approvalStatus     ApprovalStatus?       @default(NOT_REQUIRED)
  createdAt         DateTime              @default(now())
  updatedAt         DateTime              @updatedAt

  // Relations
  appointment       Appointment           @relation(...)
  clinicLocation    ClinicLocation        @relation(...)
  doctor            Doctor?               @relation("QueueDoctors", ...)
  assistantDoctor   Doctor?               @relation("QueueAssistantDoctors", ...)

  // Indexes
  @@index([clinicId, clinicLocationId, category, status])
  @@index([clinicId, clinicLocationId, doctorId, status])
  @@index([clinicLocationId, category])
  @@index([doctorId, status])
}

enum QueueStatus {
  WAITING
  IN_PROGRESS
  COMPLETED
  CANCELLED
  NO_SHOW
}

enum AppointmentCategory {
  SPECIAL_CHILD
  REGULAR_FOLLOWUP
  SENIOR_CITIZEN
  NEW_OPD
  // Extensible: URGENT_CARE, PREVENTIVE_CARE, etc.
}
```

---

## 🔄 Complete Scenarios

### Scenario 1: Normal Flow with Position Updates

```
1. Patient books appointment (SPECIAL_CHILD, Location A)
   → Status: SCHEDULED

2. Patient arrives, scans QR code
   → Receptionist processes OR Patient self-scans
   → Status: CONFIRMED
   → Queue Entry Created (Location A, SPECIAL_CHILD, Position: 1)

3. Doctor A (Location A, SPECIAL_CHILD) views queue
   → Sees: 3 patients waiting
   │   - Patient X (Position 1)
   │   - Patient Y (Position 2)
   │   - Patient Z (Position 3)

4. Doctor A calls next (CONSULTATION STARTS)
   → Check: No current patient (can call)
   → Assign: Patient X to Doctor A
   → Status: WAITING → IN_PROGRESS
   → startedAt: 10:00 AM
   → Notify: Patient X "You're next! Consultation starting..."
   → ✅ Consultation begins now

5. Consultation in progress
   → Status: IN_PROGRESS
   → Doctor cannot call next (blocked)
   → Queue positions remain: Y(2), Z(3)

6. Doctor A completes consultation
   → Status: IN_PROGRESS → COMPLETED
   → completedAt: 10:30 AM
   → Doctor's currentPatientCount: 1 → 0
   │
   ├── 🔄 AUTOMATIC POSITION RECALCULATION:
   │   ├── Patient X removed from queue
   │   ├── Patient Y: Position 2 → Position 1 (shifted up)
   │   ├── Patient Z: Position 3 → Position 2 (shifted up)
   │   ├── Broadcast position updates to all patients
   │   └── Update estimated wait times
   │
   └── ✅ NOW: Doctor can call next patient (unlocked)

7. Doctor A calls next (if available)
   → Gets Patient Y (now Position 1)
   → Status: WAITING → IN_PROGRESS
   → Consultation starts again
```

### Scenario 2: Multiple Doctors, Same Category

```
Location A - SPECIAL_CHILD Queue:
- 20 patients waiting

Assigned Doctors:
- Doctor A (currentPatientCount: 0, max: 5)
- Doctor B (currentPatientCount: 2, max: 5)
- Assistant C (currentPatientCount: 1, max: 3)

Flow:
1. Doctor A calls next → Gets Patient 1 (Position 1)
2. Doctor B calls next → Gets Patient 2 (Position 2)
3. Assistant C calls next → Gets Patient 3 (Position 3)
4. All three doctors working simultaneously
5. When Doctor A completes Patient 1 → Can call next (Patient 4)
6. When Doctor B completes Patient 2 → Can call next (Patient 5)
```

### Scenario 3: Doctor Must Complete Before Next + Position Updates

```
Doctor A's Current State:
- Current Patient: Patient X (IN_PROGRESS, started 10:00 AM)
- Queue: 5 patients waiting
  │   - Patient Y (Position 1)
  │   - Patient Z (Position 2)
  │   - Patient A (Position 3)
  │   - Patient B (Position 4)
  │   - Patient C (Position 5)

Doctor A tries to call next:
→ System checks: getCurrentPatient(doctorId)
→ Returns: Patient X (status: IN_PROGRESS)
→ BLOCKED: Error "Cannot call next patient. Please complete current consultation first."
→ UI shows: [Call Next] button DISABLED
→ UI shows: "Complete Patient X consultation first"

Doctor A completes Patient X:
1. Doctor clicks "Complete Consultation"
2. System updates:
   → Status: IN_PROGRESS → COMPLETED
   → completedAt: 10:30 AM
   → currentPatientCount: 2 → 1
   → Appointment status: CONFIRMED → COMPLETED
3. If Assistant Doctor: Create prescription approval request
4. 🔄 AUTOMATIC POSITION RECALCULATION:
   ├── Patient X removed from queue
   ├── Recalculate positions for remaining 5 patients:
   │   ├── Patient Y: Position 1 → Position 1 (no change)
   │   ├── Patient Z: Position 2 → Position 2 (no change)
   │   ├── Patient A: Position 3 → Position 3 (no change)
   │   ├── Patient B: Position 4 → Position 4 (no change)
   │   └── Patient C: Position 5 → Position 5 (no change)
   ├── Broadcast position updates to all waiting patients
   └── Update estimated wait times

NOW Doctor A can call next:
→ System checks: getCurrentPatient(doctorId)
→ Returns: null (no IN_PROGRESS patient)
→ ALLOWED: Can call next
→ Gets Patient Y (Position 1)
→ Status: WAITING → IN_PROGRESS
→ startedAt: 10:31 AM
→ ✅ Consultation starts now
→ UI shows: [Call Next] button DISABLED (has current patient)
→ UI shows: "Complete Patient Y consultation first"
```

### Scenario 3B: Position Shift Example

```
Queue State Before Completion:
- Patient X (Position 1) - IN_PROGRESS (being seen)
- Patient Y (Position 2) - WAITING
- Patient Z (Position 3) - WAITING
- Patient A (Position 4) - WAITING

Doctor completes Patient X:
→ Patient X: IN_PROGRESS → COMPLETED
→ 🔄 AUTOMATIC RECALCULATION:
  ├── Patient X removed
  ├── Patient Y: Position 2 → Position 1 (shifted up)
  ├── Patient Z: Position 3 → Position 2 (shifted up)
  ├── Patient A: Position 4 → Position 3 (shifted up)
  └── All patients notified of new positions

Queue State After Completion:
- Patient Y (Position 1) - WAITING
- Patient Z (Position 2) - WAITING
- Patient A (Position 3) - WAITING
```

### Scenario 4: Manual Check-In by Receptionist

```
Patient arrives but QR code not working:
1. Patient goes to reception
2. Receptionist searches patient/appointment
3. Receptionist clicks "Manual Check-In"
4. System validates:
   - Appointment exists
   - Status is SCHEDULED
   - Within time window (30 min before to 1.5 hr after)
5. System processes check-in:
   - Status: SCHEDULED → CONFIRMED
   - Queue entry created
   - Check-in record created (marked as manual)
6. Patient enters queue
```

### Scenario 5: Assistant Doctor Prescription Approval

```
Assistant Doctor C handles Patient Z:
1. Consultation completed
2. Assistant creates prescription
3. System auto-creates approval request:
   - Status: PENDING
   - Notifies: Main Doctor (Doctor A or B)
4. Main Doctor reviews:
   - Approves → Prescription active
   - Rejects → Assistant notified, can revise
5. Patient gets prescription (after approval)
```

### Scenario 6: Late Arrival

```
Patient booked: 12:30-1:30 PM (SPECIAL_CHILD)
Patient arrives: 3:00 PM (late!)

Check-In Process:
1. System detects late arrival
2. Marks: isLateArrival = true
3. Sets: priority = 0 (lower priority)
4. Still adds to queue (SPECIAL_CHILD category)
5. Position: Based on arrival time (not booked time)
6. Doctor sees: "Late arrival" flag
```

### Scenario 7: No-Show Handling

```
Patient in queue (WAITING):
1. Doctor calls next → Patient doesn't respond
2. System waits 5 minutes
3. Still no response → Auto-mark as NO_SHOW
4. Remove from queue
5. Status: WAITING → NO_SHOW
6. Appointment status: CONFIRMED → NO_SHOW
7. Doctor can call next patient
```

### Scenario 8: Emergency Patient

```
Emergency patient arrives:
1. Receptionist creates emergency appointment
2. System sets: priority = 10 (highest)
3. Adds to queue (appropriate category)
4. Auto-moves to front of category queue
5. Notifies all doctors immediately
6. Doctor can call emergency patient next
```

### Scenario 9: Doctor Goes on Break

```
Doctor A goes on break:
1. Doctor marks self as "On Break"
2. System updates: isAvailable = false
3. Current patients (IN_PROGRESS) remain assigned
4. New patients not assigned to this doctor
5. When break ends: isAvailable = true
6. Doctor can resume calling next
```

### Scenario 10: Wrong Location Check-In

```
Patient books: Location A
Patient scans QR: Location B

System Response:
1. Validates QR code location
2. Detects mismatch
3. Rejects check-in
4. Error: "This appointment is for Location A. Please go to Location A."
5. Patient must go to correct location
```

### Scenario 11: Category Time Slot Ends

```
SPECIAL_CHILD time slot: 12:30-1:30 PM
Current time: 1:45 PM
5 patients still waiting

System Behavior:
1. Patients still in queue (not removed)
2. Mark as "overflow" (optional flag)
3. Doctors continue serving
4. Next day: Adjust capacity if needed
```

### Scenario 12: All Doctors Busy

```
Location A - SPECIAL_CHILD:
- 10 patients waiting
- 3 doctors assigned
- All 3 doctors have IN_PROGRESS patients

System Behavior:
1. Calculate wait time based on:
   - Number of waiting patients
   - Number of active doctors
   - Average consultation time
2. Show: "Estimated wait: 60 minutes"
3. Alert admin if wait time > 90 minutes
```

### Scenario 13: Doctor Reaches Capacity

```
Doctor A:
- maxConcurrentPatients: 5
- currentPatientCount: 5

Doctor A tries to call next:
→ System checks: currentPatientCount >= maxConcurrentPatients?
→ YES (5 >= 5)
→ BLOCKED: "Doctor has reached maximum capacity. Please complete current consultations first."

Doctor A completes 1 patient:
→ currentPatientCount: 5 → 4
→ NOW can call next (4 < 5)
```

### Scenario 14: Walk-In Patient

```
Patient arrives without appointment:
1. Receptionist creates appointment on-the-fly
2. Category: Determined by patient type
3. Time slot: Current time (if within category slot)
4. Priority: Lower than scheduled appointments
5. Adds to queue
6. Patient can be seen after scheduled patients
```

### Scenario 15: Patient Cancels After Check-In

```
Patient checked in, in queue (Position 3):
1. Patient cancels appointment
2. System removes from queue
3. Status: WAITING → CANCELLED
4. Recalculate positions for remaining patients
5. Notify doctor (if assigned)
```

### Scenario 16: System Downtime Recovery

```
System goes down during check-in:
1. Check-ins queued in cache/queue
2. When system recovers:
   - Process queued check-ins
   - Rebuild queue positions
   - Notify affected patients
   - Resume normal operations
```

---

## 🛡️ Critical Business Rules

### Rule 1: Doctor Completion Required + Position Updates

```typescript
/**
 * CRITICAL: Doctor cannot call next until current patient completed
 * CONSULTATION STARTS: When doctor calls next patient
 */
async callNext(doctorId: string, locationId: string): Promise<Queue> {
  // Check if doctor has IN_PROGRESS patient
  const currentPatient = await this.getCurrentPatient(doctorId);

  if (currentPatient && currentPatient.status === 'IN_PROGRESS') {
    throw new Error(
      'Cannot call next patient. Please complete current consultation first. ' +
      `Current patient: ${currentPatient.patientId}`
    );
  }

  // Get next patient
  const nextPatient = await this.getNextPatientInCategory(...);

  // Start consultation
  const updated = await this.databaseService.executeHealthcareWrite(async (client) => {
    return await client.queue.update({
      where: { id: nextPatient.id },
      data: {
        status: 'IN_PROGRESS',
        doctorId: doctorId,
        startedAt: new Date(), // Consultation starts now
        // ... other updates
      }
    });
  });

  // Notify patient: Consultation starting
  await this.notifyPatient(updated.appointmentId, 'CONSULTATION_STARTED');

  return updated;
}

/**
 * Complete consultation and auto-recalculate positions
 */
async completeConsultation(
  queueId: string,
  doctorId: string
): Promise<void> {
  // 1. Mark consultation as completed
  await this.databaseService.executeHealthcareWrite(async (client) => {
    await client.queue.update({
      where: { id: queueId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date()
      }
    });

    // Decrement doctor's patient count
    await client.doctor.update({
      where: { id: doctorId },
      data: {
        currentPatientCount: { decrement: 1 }
      }
    });
  });

  // 2. AUTOMATIC POSITION RECALCULATION
  await this.recalculateQueuePositions(queueId);

  // 3. Broadcast updates to all patients
  await this.broadcastPositionUpdates(queueId);
}

/**
 * Recalculate positions for all patients in same category/location
 */
private async recalculateQueuePositions(completedQueueId: string): Promise<void> {
  const completedQueue = await this.getQueueById(completedQueueId);

  // Get all WAITING patients in same category and location
  const waitingPatients = await this.databaseService.executeHealthcareRead(
    async (client) => {
      return await client.queue.findMany({
        where: {
          clinicLocationId: completedQueue.clinicLocationId,
          category: completedQueue.category,
          status: 'WAITING',
          id: { not: completedQueueId } // Exclude completed patient
        },
        orderBy: { queueNumber: 'asc' }
      });
    }
  );

  // Recalculate category positions
  await this.databaseService.executeHealthcareWrite(async (client) => {
    for (let i = 0; i < waitingPatients.length; i++) {
      const newPosition = i + 1; // 1, 2, 3...
      await client.queue.update({
        where: { id: waitingPatients[i].id },
        data: {
          // Note: categoryPosition is calculated on-the-fly in queries
          // But we update queueNumber for ordering
          queueNumber: completedQueue.queueNumber + i
        }
      });
    }
  });

  // Update estimated wait times
  await this.updateEstimatedWaitTimes(
    completedQueue.clinicLocationId,
    completedQueue.category
  );
}

/**
 * Get current patient being handled by doctor
 */
private async getCurrentPatient(doctorId: string): Promise<Queue | null> {
  return await this.databaseService.executeHealthcareRead(async (client) => {
    return await client.queue.findFirst({
      where: {
        doctorId,
        status: 'IN_PROGRESS'
      },
      orderBy: { startedAt: 'desc' }
    });
  });
}
```

### Rule 2: Manual Check-In by Receptionist

```typescript
/**
 * Receptionist can manually check in patients
 */
async manualCheckIn(
  appointmentId: string,
  locationId: string,
  receptionistId: string
): Promise<Queue> {
  // Validate receptionist has permission
  await this.validateReceptionistPermission(receptionistId, locationId);

  // Process check-in (same as QR check-in)
  return await this.processCheckIn(appointmentId, locationId, {
    method: 'MANUAL',
    checkedInBy: receptionistId
  });
}
```

### Rule 3: Location-Based Queue Filtering

```typescript
/**
 * All queue queries must filter by location
 */
async getQueueByCategory(
  clinicId: string,
  clinicLocationId: string, // REQUIRED
  category: AppointmentCategory
): Promise<Queue[]> {
  return await this.databaseService.executeHealthcareRead(async (client) => {
    return await client.queue.findMany({
      where: {
        clinicId,
        clinicLocationId, // Location filter
        category,         // Category filter
        status: 'WAITING',
        appointment: {
          status: 'CONFIRMED' // Only checked-in patients
        }
      },
      orderBy: { queueNumber: 'asc' }
    });
  });
}
```

---

## 🔐 Role Permissions Matrix

| Action                | CLINIC_ADMIN | DOCTOR            | ASSISTANT_DOCTOR    | RECEPTIONIST      | PHARMACIST | PATIENT  |
| --------------------- | ------------ | ----------------- | ------------------- | ----------------- | ---------- | -------- |
| View All Queues       | ✅           | ❌                | ❌                  | ✅ (own location) | ❌         | ❌       |
| View Category Queue   | ✅           | ✅ (assigned)     | ✅ (assigned)       | ✅ (own location) | ❌         | ❌       |
| Manual Check-In       | ✅           | ❌                | ❌                  | ✅ (PRIMARY)      | ❌         | ❌       |
| QR Check-In           | ✅           | ❌                | ❌                  | ✅                | ❌         | ✅ (own) |
| Call Next Patient     | ✅           | ✅ (if completed) | ✅ (if completed)   | ❌                | ❌         | ❌       |
| Complete Consultation | ✅           | ✅                | ✅                  | ❌                | ❌         | ❌       |
| Create Prescription   | ✅           | ✅                | ✅ (needs approval) | ❌                | ❌         | ❌       |
| Approve Prescription  | ✅           | ✅                | ❌                  | ❌                | ❌         | ❌       |
| View Own Position     | ✅           | ❌                | ❌                  | ✅                | ❌         | ✅       |
| Cancel Appointment    | ✅           | ❌                | ❌                  | ✅                | ❌         | ✅ (own) |
| Assign Doctors        | ✅           | ❌                | ❌                  | ❌                | ❌         | ❌       |

---

## 📡 API Endpoints

### Queue Management

```typescript
// Get queue by location and category
GET /api/queues/location/:locationId/category/:category
Headers: { X-Clinic-ID, Authorization }
Response: {
  locationId: "location-a",
  category: "SPECIAL_CHILD",
  entries: [
    { id: "...", patient: "...", categoryPosition: 1, ... }
  ],
  totalWaiting: 5,
  totalInProgress: 2
}

// Get doctor's queues (location-based)
GET /api/doctors/:doctorId/queues?locationId=location-a
Headers: { X-Clinic-ID, Authorization }
Response: {
  locationId: "location-a",
  queues: {
    SPECIAL_CHILD: { waiting: 5, inProgress: 1 },
    REGULAR_FOLLOWUP: { waiting: 3, inProgress: 0 }
  }
}

// Call next patient (requires completion check)
POST /api/queues/call-next
Headers: {
  X-Clinic-ID: "clinic-123",
  Authorization: "Bearer token",
  Role: "DOCTOR" or "ASSISTANT_DOCTOR"
}
Body: {
  locationId: "location-a", // REQUIRED
  category: "SPECIAL_CHILD" // Optional
  // doctorId from auth token
}
Response: {
  queueId: "...",
  patient: { ... },
  categoryPosition: 1,
  message: "Patient called successfully",
  doctorCurrentPatientCount: 2 // Updated count
}
Error (if current patient not completed): {
  error: "CURRENT_PATIENT_NOT_COMPLETED",
  message: "Please complete current consultation first",
  currentPatient: {
    id: "...",
    patientId: "...",
    patientName: "...",
    startedAt: "2024-01-15T10:00:00Z",
    status: "IN_PROGRESS"
  },
  action: "Complete the current consultation to call next patient"
}
Error (if doctor at capacity): {
  error: "DOCTOR_AT_CAPACITY",
  message: "Doctor has reached maximum capacity",
  currentPatientCount: 5,
  maxConcurrentPatients: 5,
  action: "Complete some consultations to free up capacity"
}

// Complete consultation
POST /api/queues/:queueId/complete
Headers: {
  X-Clinic-ID: "clinic-123",
  Authorization: "Bearer token",
  Role: "DOCTOR" or "ASSISTANT_DOCTOR"
}
Body: {
  notes?: "...",
  prescriptionCreated?: boolean // If assistant doctor
  // doctorId from auth token
}
Response: {
  success: true,
  message: "Consultation completed. You can now call next patient.",
  queueId: "...",
  completedAt: "2024-01-15T10:30:00Z",
  doctorCurrentPatientCount: 1, // Decremented
  canCallNext: true, // Now unlocked
  nextPatientAvailable: true // If patients waiting
}
Error (if not doctor's patient): {
  error: "UNAUTHORIZED",
  message: "This patient is not assigned to you"
}
Error (if already completed): {
  error: "ALREADY_COMPLETED",
  message: "This consultation is already completed"
}
```

### Check-In Endpoints

```typescript
// QR Code Check-In (Patient or Receptionist)
POST /api/appointments/check-in/scan-qr
Body: {
  qrCode: "CHK-location-123...",
  appointmentId: "...",
  coordinates?: { lat, lng }
}
Response: {
  success: true,
  appointmentId: "...",
  queueId: "...",
  categoryPosition: 3,
  estimatedWaitTime: 45
}

// Manual Check-In (Receptionist Primary, Admin can override)
POST /api/appointments/check-in/manual
Headers: {
  X-Clinic-ID: "clinic-123",
  Authorization: "Bearer token",
  Role: "RECEPTIONIST" or "CLINIC_ADMIN"
}
Body: {
  appointmentId: "...",
  locationId: "location-a"
  // receptionistId from auth token
}
Response: {
  success: true,
  appointmentId: "...",
  queueId: "...",
  categoryPosition: 3,
  checkedInBy: "receptionist-123",
  checkedInByRole: "RECEPTIONIST",
  method: "MANUAL",
  estimatedWaitTime: 45
}
Error (if not receptionist/admin): {
  error: "UNAUTHORIZED",
  message: "Only receptionist or clinic admin can perform manual check-in"
}
```

### Doctor Endpoints

```typescript
// Get current patient (IN_PROGRESS)
GET /api/doctors/:doctorId/current-patient
Response: {
  queueId: "...",
  patient: { ... },
  startedAt: "2024-01-15T10:00:00Z",
  status: "IN_PROGRESS"
}
// Returns null if no current patient

// Check if can call next
GET /api/doctors/:doctorId/can-call-next
Response: {
  canCallNext: false,
  reason: "Current patient not completed",
  currentPatient: { id: "...", patientId: "..." }
}
// OR
Response: {
  canCallNext: true,
  nextPatientAvailable: true,
  waitingCount: 5
}
```

---

## 🔄 State Machine

### Queue Status Flow

```
WAITING
  ↓ (Doctor calls next)
IN_PROGRESS
  ↓ (Doctor completes)
COMPLETED
  OR
  ↓ (Patient no-show)
NO_SHOW
  OR
  ↓ (Cancelled)
CANCELLED
```

### Doctor State Flow

```
Available (no current patient)
  ↓ (Calls next)
Has Current Patient (IN_PROGRESS)
  ↓ (Completes)
Available (can call next)
  OR
  ↓ (Reaches capacity)
At Capacity (cannot call next)
  ↓ (Completes one)
Available (can call next)
```

---

## 📊 Visual Queue Representation

### Doctor's View (Location A, SPECIAL_CHILD Category)

```
┌─────────────────────────────────────────────────────────┐
│  Doctor A - Location A - SPECIAL_CHILD Queue           │
├─────────────────────────────────────────────────────────┤
│  Current Patient (Consultation Started):                │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Patient X (IN_PROGRESS)                        │   │
│  │ Started: 10:00 AM (Consultation in progress)   │   │
│  │ Status: Being seen by doctor                    │   │
│  │ [Complete Consultation] ← Must click to unlock   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Waiting Patients (5):                                  │
│  1. Patient Y - Position 1 - Wait: 0 min                │
│  2. Patient Z - Position 2 - Wait: 15 min              │
│  3. Patient A - Position 3 - Wait: 30 min              │
│  4. Patient B - Position 4 - Wait: 45 min              │
│  5. Patient C - Position 5 - Wait: 60 min              │
│                                                         │
│  [Call Next Patient] ← DISABLED (complete current first)│
└─────────────────────────────────────────────────────────┘

After Doctor Completes Patient X:
┌─────────────────────────────────────────────────────────┐
│  Doctor A - Location A - SPECIAL_CHILD Queue           │
├─────────────────────────────────────────────────────────┤
│  ✅ Consultation Completed                              │
│  🔄 Positions Updated Automatically                     │
│                                                         │
│  Waiting Patients (4 - positions shifted up):           │
│  1. Patient Y - Position 1 (was 2) - Wait: 0 min       │
│  2. Patient Z - Position 2 (was 3) - Wait: 15 min       │
│  3. Patient A - Position 3 (was 4) - Wait: 30 min       │
│  4. Patient B - Position 4 (was 5) - Wait: 45 min      │
│                                                         │
│  [Call Next Patient] ← ENABLED (no current patient)    │
└─────────────────────────────────────────────────────────┘
```

### After Completion

```
┌─────────────────────────────────────────────────────────┐
│  Doctor A - Location A - SPECIAL_CHILD Queue           │
├─────────────────────────────────────────────────────────┤
│  Current Patient: None                                 │
│  ✅ Ready to call next patient                          │
│                                                         │
│  Waiting Patients (4):                                  │
│  1. Patient Y - Position 1 - Wait: 0 min                │
│  2. Patient Z - Position 2 - Wait: 15 min              │
│  3. Patient A - Position 3 - Wait: 30 min              │
│  4. Patient B - Position 4 - Wait: 45 min              │
│                                                         │
│  [Call Next Patient] ← ENABLED (no current patient)     │
└─────────────────────────────────────────────────────────┘
```

---

## 🎯 Key Implementation Rules

### 1. Doctor Completion Check + Position Updates (MANDATORY)

```typescript
// Before calling next, ALWAYS check:
const currentPatient = await getCurrentPatient(doctorId);
if (currentPatient?.status === 'IN_PROGRESS') {
  throw new Error('Complete current consultation first');
}

// When doctor calls next: CONSULTATION STARTS
await updateQueue(queueId, {
  status: 'IN_PROGRESS',
  startedAt: new Date(), // Consultation begins
  doctorId: doctorId,
});

// When doctor completes: AUTOMATIC POSITION UPDATE
await completeConsultation(queueId, doctorId);
// This automatically:
// 1. Marks as COMPLETED
// 2. Recalculates positions for all remaining patients
// 3. Broadcasts position updates
// 4. Updates estimated wait times
```

### 2. Location Filtering (MANDATORY)

```typescript
// ALL queue queries MUST include locationId:
WHERE clinicLocationId = ${locationId}
```

### 3. Category Position Calculation (AUTOMATED)

```typescript
// Use SQL window function:
ROW_NUMBER() OVER (
  PARTITION BY clinicLocationId, category
  ORDER BY globalPosition
) as categoryPosition
```

### 4. Manual Check-In (RECEPTIONIST PRIMARY, ADMIN CAN OVERRIDE)

```typescript
// RECEPTIONIST is primary for manual check-in, ADMIN can override:
if (userRole !== 'RECEPTIONIST' && userRole !== 'CLINIC_ADMIN') {
  throw new Error('Only receptionist or clinic admin can manually check in');
}

// Log who performed manual check-in
await createCheckInRecord({
  appointmentId,
  locationId,
  method: 'MANUAL',
  checkedInBy: userId, // Receptionist ID
  role: userRole,
});
```

### 5. Prescription Approval (ASSISTANT DOCTOR)

```typescript
// Assistant doctors ALWAYS need approval:
if (doctor.role === 'ASSISTANT_DOCTOR') {
  await createApprovalRequest(prescriptionId, doctorId);
  // Prescription blocked until approved
}
```

---

## ✅ Scenario Coverage Checklist

### Patient Scenarios

- [x] Early arrival (before 30 min window)
- [x] Late arrival (after 1.5 hr window)
- [x] Wrong location check-in
- [x] Duplicate check-in attempt
- [x] No-show (doesn't respond when called)
- [x] Cancellation after check-in
- [x] Emergency patient prioritization
- [x] Walk-in patient (no appointment)

### Doctor Scenarios

- [x] Must complete before calling next
- [x] Reaches capacity (maxConcurrentPatients)
- [x] Goes on break
- [x] Becomes unavailable mid-shift
- [x] Switches locations
- [x] Multiple doctors same category
- [x] Wrong patient called
- [x] Needs to skip patient

### Queue Scenarios

- [x] Empty queue
- [x] Very long queue (100+ patients)
- [x] All doctors busy
- [x] No doctors available for category
- [x] Position conflicts
- [x] Category overflow
- [x] Time slot ends with patients waiting

### Location Scenarios

- [x] Location closes early
- [x] Location opens late
- [x] Wrong location check-in
- [x] Multi-location doctor assignment
- [x] Location technical issues

### System Scenarios

- [x] System downtime
- [x] Database connection failure
- [x] Cache failure
- [x] Real-time update failure
- [x] Notification failure

### Role Scenarios

- [x] Receptionist manual check-in
- [x] Assistant doctor approval workflow
- [x] Doctor completion requirement
- [x] Admin override capabilities
- [x] Pharmacist prescription access

---

**Document Status**: ✅ Complete Architecture Guide  
**Last Updated**: 2024
