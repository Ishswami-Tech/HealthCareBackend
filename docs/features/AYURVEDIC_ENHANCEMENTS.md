# 🌿 Ayurvedic Healthcare System Enhancements

## Overview
Comprehensive Ayurvedic-specific enhancements to the Healthcare Backend, including specialized therapy management, enhanced role-based access control, and advanced appointment features with location-based check-ins.

---

## 📋 Table of Contents

1. [New Ayurvedic Features](#new-ayurvedic-features)
2. [Enhanced Role Management](#enhanced-role-management)
3. [Advanced Appointment Features](#advanced-appointment-features)
4. [Database Schema Changes](#database-schema-changes)
5. [API Endpoints](#api-endpoints)
6. [Implementation Guide](#implementation-guide)

---

## 🌿 New Ayurvedic Features

### 1. Enhanced Appointment Types

**New AppointmentType Enum Values:**
```typescript
enum AppointmentType {
  // Existing
  IN_PERSON
  VIDEO_CALL
  HOME_VISIT

  // NEW: Ayurvedic Specialty Procedures
  VIDDHAKARMA        // Surgical procedures
  AGNIKARMA          // Fire therapy
  PANCHAKARMA        // Detoxification therapies

  // NEW: Diagnostic Consultations
  NADI_PARIKSHA      // Pulse diagnosis
  DOSHA_ANALYSIS     // Constitutional assessment

  // NEW: Therapeutic Treatments
  SHIRODHARA         // Oil pouring therapy
  VIRECHANA          // Purgation therapy
  ABHYANGA           // Oil massage
  SWEDANA            // Sweating therapy
  BASTI              // Enema therapy
  NASYA              // Nasal therapy
  RAKTAMOKSHANA      // Bloodletting therapy
}
```

### 2. Therapy Classification

**New Enums:**
```typescript
enum TherapyType {
  SHODHANA           // Purification therapies (Panchakarma)
  SHAMANA            // Palliative therapies
  RASAYANA           // Rejuvenation therapies
  VAJIKARANA         // Aphrodisiac/reproductive therapies
}

enum TherapyDuration {
  SHORT              // 30-60 minutes
  MEDIUM             // 1-3 hours
  LONG               // 3-8 hours
  EXTENDED           // Multiple days (2-7 days)
  RESIDENTIAL        // 7-21 days residential treatment
}

enum AgniType {
  TIKSHNA            // Sharp/strong digestive fire
  MANDA              // Slow/weak digestive fire
  SAMA               // Balanced digestive fire
  VISHAMA            // Irregular digestive fire
}

enum TherapyStatus {
  SCHEDULED          // Therapy session scheduled
  IN_PROGRESS        // Currently undergoing therapy
  COMPLETED          // Therapy completed
  CANCELLED          // Cancelled by patient/clinic
  PAUSED             // Temporarily paused
}

enum QueueStatus {
  WAITING            // In queue, waiting
  CHECKED_IN         // Checked in, ready
  IN_TREATMENT       // Currently in treatment
  COMPLETED          // Treatment completed
  CANCELLED          // Queue entry cancelled
  NO_SHOW            // Patient didn't show up
}
```

### 3. Enhanced Ayurvedic Health Profile

**Extensions to User Model:**
```prisma
model User {
  // ... existing fields ...

  // NEW AYURVEDIC HEALTH PROFILE
  prakriti           Prakriti?           // Primary body constitution
  vikriti            String?             // Current state/imbalance description
  doshaImbalances    Json?               // [{dosha: 'VATA', severity: 'HIGH', notes: '...'}]
  agni               AgniType?           // Digestive fire strength
  dinacharya         String?             // Daily routine description
  ritucharya         String?             // Seasonal routine description
  dietaryRestrictions Json?              // Ayurvedic dietary restrictions
  lifestyleFactors   Json?               // Lifestyle assessment data
  seasonalPatterns   Json?               // Seasonal health pattern tracking

  // Relations
  therapySessions    TherapySession[]
  queueEntries       QueueEntry[]
  checkIns           CheckIn[]
}
```

### 4. Therapy Management System

**Enhanced AyurvedicTherapy Model:**
```prisma
model AyurvedicTherapy {
  id                String          @id @default(uuid())
  name              String
  description       String?
  therapyType       TherapyType
  duration          TherapyDuration
  estimatedDuration Int             // in minutes
  isActive          Boolean         @default(true)
  clinicId          String
  prerequisites     Json?           // Required conditions/preparations
  contraindications Json?           // Conditions where therapy is not recommended
  benefits          Json?           // Expected benefits
  price             Decimal?        // @db.Decimal(10, 2)
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  // Relations
  clinic            Clinic          @relation(fields: [clinicId], references: [id])
  sessions          TherapySession[]

  @@index([clinicId])
  @@index([therapyType])
  @@index([isActive])
}
```

**New TherapySession Model:**
```prisma
model TherapySession {
  id                String          @id @default(uuid())
  therapyId         String
  appointmentId     String
  patientId         String
  doctorId          String
  therapistId       String?         // Dedicated therapist if different from doctor
  clinicId          String
  sessionDate       DateTime
  startTime         DateTime
  endTime           DateTime?
  status            TherapyStatus   @default(SCHEDULED)
  notes             String?
  observations      Json?           // Clinical observations during session
  vitalsBefore      Json?           // Vitals before therapy
  vitalsAfter       Json?           // Vitals after therapy
  patientFeedback   String?
  nextSessionDate   DateTime?
  sessionNumber     Int             @default(1) // For multi-session therapies
  totalSessions     Int?            // Total planned sessions
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  // Relations
  therapy           AyurvedicTherapy @relation(fields: [therapyId], references: [id])
  appointment       Appointment     @relation(fields: [appointmentId], references: [id])
  patient           Patient         @relation(fields: [patientId], references: [id])
  doctor            Doctor          @relation(fields: [doctorId], references: [id])
  clinic            Clinic          @relation(fields: [clinicId], references: [id])

  @@index([therapyId])
  @@index([appointmentId])
  @@index([patientId])
  @@index([doctorId])
  @@index([clinicId])
  @@index([sessionDate])
  @@index([status])
}
```

---

## 👥 Enhanced Role Management

### 1. New Roles

**Extended Role Enum:**
```typescript
enum Role {
  // Existing
  SUPER_ADMIN
  CLINIC_ADMIN
  DOCTOR
  PATIENT
  RECEPTIONIST

  // NEW ROLES
  PHARMACIST           // Medicine desk management
  THERAPIST           // Panchakarma/therapy specialist
  LAB_TECHNICIAN      // Diagnostic test management
  FINANCE_BILLING     // Payment and invoice management
  SUPPORT_STAFF       // General clinic support
  NURSE               // Clinical support/assistance
  COUNSELOR           // Patient counseling
}
```

### 2. Multi-Clinic Role Assignment

**Enhanced UserRole Model:**
```prisma
model UserRole {
  id          String    @id @default(uuid())
  userId      String
  roleId      String
  clinicId    String?   // Clinic-specific role assignment
  assignedBy  String    @default("SYSTEM")
  assignedAt  DateTime  @default(now())
  expiresAt   DateTime? // Optional role expiration
  revokedAt   DateTime? // Role revocation timestamp
  revokedBy   String?   // Who revoked the role
  isActive    Boolean   @default(true)
  isPrimary   Boolean   @default(false)  // Primary role for the clinic
  permissions Json?                      // Additional role-specific permissions
  schedule    Json?                       // Role-specific schedule/availability
  department  String?                     // Department within clinic
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  // Relations
  user   User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role   RbacRole @relation(fields: [roleId], references: [id], onDelete: Cascade)
  clinic Clinic?  @relation(fields: [clinicId], references: [id])

  @@unique([userId, roleId, clinicId])
  @@index([userId])
  @@index([roleId])
  @@index([clinicId])
  @@index([isPrimary])
  @@index([isActive])
}
```

### 3. Permission System

**New RolePermission Model:**
```prisma
model RolePermission {
  id           String   @id @default(uuid())
  roleId       String
  permissionId String
  clinicId     String?  // Clinic-specific permissions
  isActive     Boolean  @default(true)
  assignedAt   DateTime @default(now())
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  // Relations
  role       RbacRole   @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  clinic     Clinic?    @relation(fields: [clinicId], references: [id])

  @@unique([roleId, permissionId, clinicId])
  @@index([roleId])
  @@index([permissionId])
  @@index([clinicId])
}
```

---

## 📅 Advanced Appointment Features

### 1. Specialized Queue Management

**TherapyQueue Model:**
```prisma
model TherapyQueue {
  id                String      @id @default(uuid())
  clinicId          String
  therapyType       TherapyType
  queueName         String      // e.g., "Panchakarma Queue", "Agnikarma Queue"
  isActive          Boolean     @default(true)
  maxCapacity       Int         @default(10)
  currentPosition   Int         @default(0)
  estimatedWaitTime Int?        // in minutes
  location          String?     // Physical location in clinic
  therapistIds      Json?       // Array of therapist IDs assigned to queue
  operatingHours    Json?       // Operating hours for this queue
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt

  // Relations
  clinic            Clinic      @relation(fields: [clinicId], references: [id])
  queueEntries      QueueEntry[]

  @@index([clinicId])
  @@index([therapyType])
  @@index([isActive])
  @@unique([clinicId, therapyType])
}
```

**QueueEntry Model:**
```prisma
model QueueEntry {
  id                String      @id @default(uuid())
  queueId           String
  appointmentId     String
  patientId         String
  position          Int
  status            QueueStatus @default(WAITING)
  estimatedWaitTime Int?        // in minutes
  actualWaitTime    Int?        // in minutes (calculated)
  checkedInAt       DateTime?
  startedAt         DateTime?
  completedAt       DateTime?
  priority          Int         @default(0) // Higher number = higher priority
  notes             String?
  notifiedAt        DateTime?   // When patient was notified
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt

  // Relations
  queue             TherapyQueue @relation(fields: [queueId], references: [id])
  appointment       Appointment  @relation(fields: [appointmentId], references: [id])
  patient           Patient      @relation(fields: [patientId], references: [id])

  @@index([queueId])
  @@index([appointmentId])
  @@index([patientId])
  @@index([status])
  @@index([position])
  @@unique([queueId, appointmentId])
}
```

### 2. Location-Based Check-In System

**CheckInLocation Model:**
```prisma
model CheckInLocation {
  id                String    @id @default(uuid())
  clinicId          String
  locationName      String
  locationCode      String    @unique // Human-readable code
  qrCode            String    @unique
  coordinates       Json      // {lat: number, lng: number, accuracy: number}
  radius            Float     @default(50.0) // in meters
  floor             String?
  building          String?
  department        String?
  isActive          Boolean   @default(true)
  allowedRoles      Json?     // Roles allowed to check in at this location
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  // Relations
  clinic            Clinic    @relation(fields: [clinicId], references: [id])
  checkIns          CheckIn[]

  @@index([clinicId])
  @@index([qrCode])
  @@index([locationCode])
  @@index([isActive])
}
```

**CheckIn Model:**
```prisma
model CheckIn {
  id                String    @id @default(uuid())
  appointmentId     String
  locationId        String
  patientId         String
  checkedInAt       DateTime  @default(now())
  coordinates       Json?     // Patient's actual location at check-in
  deviceInfo        Json?     // {deviceType, os, browser, etc.}
  ipAddress         String?
  isVerified        Boolean   @default(false)
  verifiedBy        String?   // Staff member who verified
  verifiedAt        DateTime?
  distanceFromLocation Float? // Distance in meters
  notes             String?
  checkInMethod     String    @default("QR_CODE") // QR_CODE, MANUAL, GEOFENCE
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  // Relations
  appointment       Appointment      @relation(fields: [appointmentId], references: [id])
  location          CheckInLocation  @relation(fields: [locationId], references: [id])
  patient           Patient          @relation(fields: [patientId], references: [id])

  @@index([appointmentId])
  @@index([locationId])
  @@index([patientId])
  @@index([checkedInAt])
  @@index([isVerified])
}
```

---

## 🗄️ Database Schema Changes

### Migration Strategy

1. **Phase 1: Add New Enums** (Non-breaking)
   - Add new AppointmentType values
   - Add TherapyType, TherapyDuration, AgniType, TherapyStatus, QueueStatus enums

2. **Phase 2: Extend Existing Models** (Non-breaking)
   - Add optional Ayurvedic fields to User model
   - Enhance AyurvedicTherapy model
   - Update UserRole model with new fields

3. **Phase 3: Add New Models** (Non-breaking)
   - TherapySession
   - TherapyQueue
   - QueueEntry
   - CheckInLocation
   - CheckIn
   - RolePermission

4. **Phase 4: Add Relations** (Non-breaking)
   - Update existing models with new relations

---

## 🔌 API Endpoints

### Ayurvedic Therapy Endpoints

```
POST   /api/v1/therapies                    # Create therapy
GET    /api/v1/therapies                    # List therapies
GET    /api/v1/therapies/:id                # Get therapy details
PUT    /api/v1/therapies/:id                # Update therapy
DELETE /api/v1/therapies/:id                # Delete therapy
GET    /api/v1/therapies/clinic/:clinicId   # Get clinic therapies
GET    /api/v1/therapies/type/:type         # Get therapies by type
```

### Therapy Session Endpoints

```
POST   /api/v1/therapy-sessions             # Create session
GET    /api/v1/therapy-sessions/:id         # Get session details
PUT    /api/v1/therapy-sessions/:id         # Update session
GET    /api/v1/therapy-sessions/patient/:id # Get patient sessions
GET    /api/v1/therapy-sessions/appointment/:id # Get appointment sessions
POST   /api/v1/therapy-sessions/:id/start   # Start session
POST   /api/v1/therapy-sessions/:id/complete # Complete session
POST   /api/v1/therapy-sessions/:id/cancel  # Cancel session
```

### Queue Management Endpoints

```
POST   /api/v1/queues                       # Create queue
GET    /api/v1/queues                       # List queues
GET    /api/v1/queues/:id                   # Get queue details
PUT    /api/v1/queues/:id                   # Update queue
POST   /api/v1/queues/:id/entries           # Add to queue
GET    /api/v1/queues/:id/entries           # Get queue entries
PUT    /api/v1/queues/:id/entries/:entryId  # Update queue entry
DELETE /api/v1/queues/:id/entries/:entryId  # Remove from queue
POST   /api/v1/queues/:id/next              # Call next patient
GET    /api/v1/queues/clinic/:clinicId      # Get clinic queues
```

### Check-In Endpoints

```
POST   /api/v1/check-in/locations           # Create check-in location
GET    /api/v1/check-in/locations           # List locations
GET    /api/v1/check-in/locations/:id       # Get location details
POST   /api/v1/check-in/qr/:qrCode          # Check in via QR code
POST   /api/v1/check-in/manual              # Manual check-in
POST   /api/v1/check-in/:id/verify          # Verify check-in
GET    /api/v1/check-in/appointment/:id     # Get appointment check-ins
```

### Role Management Endpoints

```
POST   /api/v1/roles/assign                 # Assign role to user
DELETE /api/v1/roles/revoke                 # Revoke role from user
GET    /api/v1/roles/user/:userId           # Get user roles
PUT    /api/v1/roles/:roleId/permissions    # Update role permissions
GET    /api/v1/roles/:roleId/permissions    # Get role permissions
```

---

## 🛠️ Implementation Guide

### Step 1: Update Prisma Schema

```bash
# Update schema.prisma with all new enums and models
# Run migration
pnpm exec prisma db push
pnpm exec prisma generate
```

### Step 2: Create Services

1. **AyurvedicTherapyService**
   - CRUD operations for therapies
   - Therapy availability management
   - Clinic-specific therapy filtering

2. **TherapySessionService**
   - Session creation and management
   - Session status tracking
   - Multi-session therapy handling

3. **QueueManagementService**
   - Queue creation and management
   - Queue entry operations
   - Real-time queue updates

4. **CheckInService**
   - Location verification
   - QR code generation
   - Geofencing logic

5. **RoleManagementService**
   - Multi-clinic role assignment
   - Permission management
   - Role hierarchy validation

### Step 3: Create Controllers

1. **TherapyController**
2. **TherapySessionController**
3. **QueueController**
4. **CheckInController**
5. **RolePermissionController**

### Step 4: Add Validation DTOs

Create DTOs for all new endpoints with proper validation using class-validator.

### Step 5: Update Existing Services

Extend existing services to support new features:
- AppointmentService: Add therapy appointment support
- UserService: Add Ayurvedic health profile management
- ClinicService: Add therapy and queue configuration

### Step 6: Testing

1. Unit tests for all services
2. Integration tests for API endpoints
3. E2E tests for complete workflows

---

## 🔒 Security Considerations

1. **HIPAA Compliance**
   - Encrypt all Ayurvedic health data
   - Audit log all access to health profiles
   - Secure therapy session notes

2. **Role-Based Access**
   - Verify permissions before role assignment
   - Validate clinic context for all operations
   - Implement permission hierarchy

3. **Location Verification**
   - Validate coordinates against clinic radius
   - Prevent check-in spoofing
   - Rate limit check-in attempts

---

## 📊 Performance Optimizations

1. **Caching**
   - Cache therapy definitions
   - Cache queue status
   - Cache role permissions

2. **Indexing**
   - All foreign keys indexed
   - Status fields indexed
   - Date fields indexed for reporting

3. **Query Optimization**
   - Use select to fetch only needed fields
   - Implement pagination for lists
   - Use database transactions for queue operations

---

## 🎯 Success Metrics

1. **Therapy Management**
   - Therapy booking success rate
   - Session completion rate
   - Patient satisfaction scores

2. **Queue Management**
   - Average wait time reduction
   - Queue throughput improvement
   - Patient no-show reduction

3. **Check-In System**
   - Check-in success rate
   - Location verification accuracy
   - Staff verification time reduction

---

## 📝 Next Steps

1. ✅ Schema updates (This document)
2. ⏳ Service implementation
3. ⏳ Controller implementation
4. ⏳ Frontend integration
5. ⏳ Testing and QA
6. ⏳ Production deployment

---

**Last Updated:** January 2025
**Version:** 1.0.0
**Status:** ✅ Specification Complete - Ready for Implementation
