# Healthcare Backend - System Architecture & Integration Map

## 🎯 System Overview

**Healthcare Management System** designed for 1M+ users with:
- Multi-tenant clinic isolation
- Role-based access control (RBAC)
- HIPAA-compliant data management
- Real-time event-driven architecture
- Enterprise-grade caching and logging

---

## 📊 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT APPLICATIONS                                │
│  (Mobile Apps, Web Dashboard, Admin Portal, Doctor Portal, Patient Portal)  │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          API GATEWAY (NestJS)                                │
│                          app.module.ts                                       │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                 ┌─────────────────┴─────────────────┐
                 │                                   │
                 ▼                                   ▼
┌────────────────────────────┐          ┌────────────────────────────┐
│   AUTHENTICATION LAYER     │          │   AUTHORIZATION LAYER      │
│                            │          │                            │
│  • JwtAuthGuard            │◄────────►│  • RolesGuard              │
│  • JWT Token Management    │          │  • RBAC (Role-Based)       │
│  • Session Management      │          │  • Permission Checks       │
└────────────┬───────────────┘          └────────────┬───────────────┘
             │                                       │
             └───────────────┬───────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CORE INFRASTRUCTURE LAYER                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐   │
│  │   LOGGING SERVICE  │  │   CACHE SERVICE    │  │   EVENT SERVICE    │   │
│  │                    │  │                    │  │                    │   │
│  │  • LoggingService  │  │  • CacheService    │  │  • EventService    │   │
│  │  • PHI Audit Logs  │  │  • RedisService    │  │  • EventEmitter    │   │
│  │  • Correlation IDs │  │  • Tag-based Cache │  │  • Event Handlers  │   │
│  │  • Performance     │  │  • Circuit Breaker │  │  • Pub/Sub         │   │
│  │  • Distributed     │  │  • Compression     │  │  • Real-time Sync  │   │
│  │    Tracing         │  │  • TTL Management  │  │                    │   │
│  └────────┬───────────┘  └────────┬───────────┘  └────────┬───────────┘   │
│           │                       │                       │                │
│           └───────────────────────┼───────────────────────┘                │
│                                   │                                         │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BUSINESS SERVICES LAYER                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   USERS      │  │   AUTH       │  │   CLINIC     │  │ APPOINTMENTS │   │
│  │   SERVICE    │  │   SERVICE    │  │   SERVICE    │  │   SERVICE    │   │
│  │              │  │              │  │              │  │              │   │
│  │ • User CRUD  │  │ • Login      │  │ • Clinic Mgmt│  │ • Scheduling │   │
│  │ • Profiles   │  │ • Register   │  │ • Multi-     │  │ • Booking    │   │
│  │ • Roles      │  │ • Tokens     │  │   tenant     │  │ • Status     │   │
│  │              │  │ • Auth       │  │ • Isolation  │  │ • Cancels    │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                 │                 │            │
│         └─────────────────┼─────────────────┼─────────────────┘            │
│                           │                 │                              │
│  ┌──────────────┐  ┌──────┴───────┐  ┌──────┴───────┐  ┌──────────────┐   │
│  │   BILLING    │  │     EHR      │  │ NOTIFICATION │  │   SOCKET     │   │
│  │   SERVICE    │  │   SERVICE    │  │   SERVICE    │  │   SERVICE    │   │
│  │              │  │              │  │              │  │              │   │
│  │ • Plans      │  │ • Medical    │  │ • Push       │  │ • WebSocket  │   │
│  │ • Subscrip-  │  │   History    │  │ • Email      │  │ • Real-time  │   │
│  │   tions      │  │ • Lab        │  │ • SMS        │  │   Updates    │   │
│  │ • Invoices   │  │   Reports    │  │ • Templates  │  │ • Chat       │   │
│  │ • Payments   │  │ • Vitals     │  │ • Queue      │  │              │   │
│  │ • Quotas     │  │ • Allergies  │  │              │  │              │   │
│  │ • Analytics  │  │ • Meds       │  │              │  │              │   │
│  │ • Hybrid     │  │ • Clinic-wide│  │              │  │              │   │
│  │   Model      │  │   Analytics  │  │              │  │              │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────────────┘   │
│         │                 │                 │                              │
└─────────┼─────────────────┼─────────────────┼──────────────────────────────┘
          │                 │                 │
          └─────────────────┼─────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        COMMUNICATION LAYER                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐               │
│  │  PUSH NOTIFS   │  │  EMAIL (SES)   │  │  SMS/WhatsApp  │               │
│  │                │  │                │  │                │               │
│  │ • Firebase     │  │ • Templates    │  │ • Twilio       │               │
│  │ • AWS SNS      │  │ • Queue        │  │ • WhatsApp     │               │
│  │ • Device       │  │ • Batch Send   │  │ • Business API │               │
│  │   Tokens       │  │ • Retry Logic  │  │                │               │
│  └────────────────┘  └────────────────┘  └────────────────┘               │
│                                                                              │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA & STORAGE LAYER                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐   │
│  │   PostgreSQL DB    │  │   Redis Cache      │  │   Bull Queue       │   │
│  │                    │  │                    │  │                    │   │
│  │ • Prisma ORM       │  │ • Session Store    │  │ • Email Jobs       │   │
│  │ • Multi-tenant     │  │ • Cache Store      │  │ • Notification     │   │
│  │ • Transactions     │  │ • Pub/Sub          │  │   Jobs             │   │
│  │ • Migrations       │  │ • Distributed Lock │  │ • Retry Logic      │   │
│  │ • Indexes          │  │ • Rate Limiting    │  │ • Priority Queue   │   │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Data Flow Patterns

### 1. **Subscription-Based Appointment Booking Flow**

```
Patient Request → Check Active Subscription → Verify Appointment Type Coverage
                                              ↓
                                    ┌─────────┴─────────┐
                                    │                   │
                              COVERED              NOT COVERED
                                    │                   │
                                    ▼                   ▼
                        Check Quota Available    Require Payment
                                    │                   │
                        ┌───────────┴────────┐          │
                        │                    │          │
                   QUOTA OK           QUOTA EXCEEDED    │
                        │                    │          │
                        ▼                    ▼          ▼
              Book with Subscription   Require Payment  Process Payment
                        │                    │               │
                        ▼                    └───────────────┘
              Decrement Quota                       │
                        │                           │
                        └───────────┬───────────────┘
                                    ▼
                        Update Appointment Status
                                    │
                        ┌───────────┴───────────┐
                        │                       │
                        ▼                       ▼
              Emit Event              Cache Invalidation
                        │                       │
                        ▼                       ▼
              Notification          Update User/Clinic Cache
```

### 2. **EHR Record Creation with Multi-Clinic Support**

```
Create Medical Record → Validate User/Clinic → Save to Database
                                                      │
                                    ┌─────────────────┴─────────────────┐
                                    │                                   │
                                    ▼                                   ▼
                        Emit Event (ehr.created)           Tag with clinicId
                                    │                                   │
                    ┌───────────────┼───────────────┐                   │
                    │               │               │                   │
                    ▼               ▼               ▼                   ▼
            Notification    Analytics Update   Audit Log    Invalidate Caches
                                                                │
                                                    ┌───────────┴───────────┐
                                                    │                       │
                                                    ▼                       ▼
                                        User Cache (ehr:userId)  Clinic Cache (clinic:clinicId)
```

### 3. **Payment Processing with Invoice Generation**

```
Payment Request → Validate Subscription/Appointment → Create Payment Record
                                                             │
                                            ┌────────────────┴────────────────┐
                                            │                                 │
                                            ▼                                 ▼
                                Process Payment Gateway           Create/Update Invoice
                                            │                                 │
                                ┌───────────┴───────────┐                     │
                                │                       │                     │
                          SUCCESS                   FAILED                    │
                                │                       │                     │
                                ▼                       ▼                     │
                    Update Status: COMPLETED   Update Status: FAILED         │
                                │                       │                     │
                                └───────────┬───────────┘                     │
                                            │                                 │
                                            └─────────────┬───────────────────┘
                                                          │
                                    ┌─────────────────────┴─────────────────┐
                                    │                                       │
                                    ▼                                       ▼
                        Emit Event (payment.updated)          Cache Invalidation
                                    │                                       │
                    ┌───────────────┼───────────────┐                       │
                    │               │               │                       │
                    ▼               ▼               ▼                       ▼
            Notification    Update Subscription  Logging    User Payment Cache
```

---

## 🔗 Integration Matrix

### Service Dependencies

| Service | Depends On | Exports To | Events Emitted | Events Consumed |
|---------|-----------|-----------|----------------|-----------------|
| **Billing** | Prisma, Cache, Logging, Events | Appointments | `billing.plan.created`, `billing.subscription.created`, `billing.payment.created`, `billing.appointment.booked` | `appointment.cancelled` |
| **EHR** | Prisma, Cache, Logging, Events | Appointments, Users | `ehr.medical_history.created`, `ehr.lab_report.created`, `ehr.vital.created` | `appointment.completed` |
| **Appointments** | Prisma, Cache, Logging, Events, Billing, EHR | Users, Clinic, Billing | `appointment.created`, `appointment.cancelled`, `appointment.completed` | `billing.subscription.created` |
| **Users** | Prisma, Cache, Logging, Auth | All Services | `user.created`, `user.updated`, `user.deleted` | - |
| **Clinic** | Prisma, Cache, Logging | All Services | `clinic.created`, `clinic.updated` | - |
| **Notification** | Push, Email, SMS, Queue | All Services | `notification.sent`, `notification.failed` | `*.created`, `*.updated` (wildcard) |
| **Auth** | JWT, Prisma, Cache | All Services | `auth.login`, `auth.logout`, `auth.token.refreshed` | - |

### Shared Infrastructure Usage

```
┌───────────────────────────────────────────────────────────────────┐
│                    SHARED INFRASTRUCTURE                          │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  PrismaService (Database ORM)                                     │
│  ├─ Used by: All Business Services                               │
│  ├─ Connection Pool: 10-50 connections                           │
│  └─ Transaction Support: ACID compliance                         │
│                                                                   │
│  CacheService (Redis Abstraction)                                │
│  ├─ Used by: All Services                                        │
│  ├─ Features: Tag-based invalidation, TTL, Compression           │
│  ├─ PHI Protection: Encryption for health data                   │
│  └─ Performance: <5ms p95 latency                                │
│                                                                   │
│  LoggingService (Enterprise Logging)                             │
│  ├─ Used by: All Services                                        │
│  ├─ Features: Correlation IDs, Distributed tracing               │
│  ├─ Compliance: HIPAA audit trails                               │
│  └─ Buffer: 10K entries, 5s flush interval                       │
│                                                                   │
│  EventService (Event-Driven Architecture)                        │
│  ├─ Used by: All Services                                        │
│  ├─ Pattern: Pub/Sub with EventEmitter                           │
│  ├─ Features: Async processing, Decoupling                       │
│  └─ Wildcard Support: Pattern matching                           │
│                                                                   │
│  GuardsModule (RBAC + Authentication)                            │
│  ├─ JwtAuthGuard: Token validation                               │
│  ├─ RolesGuard: Permission checks                                │
│  └─ Used by: All Controllers                                     │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Database Schema Integration

### Core Models with Relationships

```
User
├─ hasMany: Appointments
├─ hasMany: Subscriptions
├─ hasMany: Payments
├─ hasMany: MedicalHistory
├─ hasMany: LabReports
├─ hasMany: Vitals
├─ hasMany: Allergies
├─ hasMany: Medications
└─ belongsTo: Clinic (via UserClinic junction)

Clinic
├─ hasMany: Users (via UserClinic)
├─ hasMany: Appointments
├─ hasMany: Subscriptions
├─ hasMany: BillingPlans
├─ hasMany: MedicalHistory (all EHR models)
└─ hasMany: Payments

Subscription
├─ belongsTo: User
├─ belongsTo: BillingPlan
├─ belongsTo: Clinic
├─ hasMany: Payments
├─ hasMany: Invoices
└─ hasMany: Appointments

Appointment
├─ belongsTo: User (patient)
├─ belongsTo: User (doctor)
├─ belongsTo: Clinic
├─ belongsTo: Subscription (optional)
└─ hasMany: Payments

BillingPlan
├─ hasMany: Subscriptions
├─ belongsTo: Clinic (optional)
└─ metadata: appointmentTypes coverage

MedicalHistory / LabReport / Vital / Allergy / Medication
├─ belongsTo: User
└─ belongsTo: Clinic (optional, for multi-tenant)
```

---

## 📡 Real-Time Features

### Event-Driven Architecture

**Events Emitted Across Services:**

```javascript
// Billing Service Events
billing.plan.created          → Cache invalidation
billing.subscription.created  → Notification to user, Update quota
billing.payment.created       → Logging, Analytics update
billing.appointment.booked    → Decrement quota, Notification
billing.subscription.cancelled → Notification, Analytics update

// EHR Service Events
ehr.medical_history.created   → Analytics update, Audit log
ehr.lab_report.created        → Notification to doctor
ehr.vital.created             → Check for critical alerts
ehr.allergy.created           → Update patient alerts

// Appointment Service Events
appointment.created           → Notification, Check subscription
appointment.cancelled         → Restore quota, Notification
appointment.completed         → Update stats, Trigger billing
appointment.confirmed         → Notification to patient/doctor

// Notification Service Events
notification.sent             → Audit log
notification.failed           → Retry queue
```

### Real-Time Communication Flow

```
┌──────────────┐
│    Client    │
└──────┬───────┘
       │ (WebSocket)
       ▼
┌──────────────────┐      ┌─────────────────┐
│  Socket Gateway  │◄────►│  Redis Pub/Sub  │
└──────┬───────────┘      └────────┬────────┘
       │                           │
       │ Emit Events               │ Subscribe
       ▼                           ▼
┌───────────────────────────────────────────┐
│         Event-Driven Services             │
│  • Appointment updates                    │
│  • Payment confirmations                  │
│  • Critical health alerts                 │
│  • Queue status updates                   │
└───────────────────────────────────────────┘
```

---

## 🔐 Security & Compliance

### Authentication Flow

```
Login Request → Validate Credentials → Generate JWT
                                         │
                        ┌────────────────┴────────────────┐
                        │                                 │
                        ▼                                 ▼
                Access Token (15min)            Refresh Token (7 days)
                        │                                 │
                        └────────────────┬────────────────┘
                                         │
                                         ▼
                            Store in Redis (Session)
                                         │
                                         ▼
                            Return to Client (HTTP-only cookie)
```

### Authorization with RBAC

```
API Request → JWT Validation → Extract User Role → Check Permissions
                                                          │
                                        ┌─────────────────┴─────────────────┐
                                        │                                   │
                                  HAS PERMISSION                    NO PERMISSION
                                        │                                   │
                                        ▼                                   ▼
                            Execute Controller Method              403 Forbidden
                                        │
                                        ▼
                            Check Clinic Isolation (if applicable)
                                        │
                        ┌───────────────┴───────────────┐
                        │                               │
                  SAME CLINIC                    DIFFERENT CLINIC
                        │                               │
                        ▼                               ▼
                Allow Access                    Check if SUPER_ADMIN
                                                        │
                                        ┌───────────────┴───────────────┐
                                        │                               │
                                  SUPER_ADMIN                    OTHER ROLE
                                        │                               │
                                        ▼                               ▼
                                Allow Access                    403 Forbidden
```

### HIPAA Compliance

**PHI Protection:**
- Cache encryption for health data (`containsPHI: true`)
- Audit logging for all EHR access
- Data minimization in logs (no PHI in general logs)
- Correlation IDs for tracing without exposing PHI
- Role-based access with clinic isolation

---

## 📊 Caching Strategy

### Cache Layers

```
┌────────────────────────────────────────────────────────────────┐
│                     CACHE HIERARCHY                             │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  L1: Application Memory Cache (NestJS Interceptors)            │
│  │   TTL: 60s | Use: Frequent read operations                  │
│  │                                                              │
│  L2: Redis Cache (CacheService)                                │
│  │   TTL: 900s-1800s | Use: Cross-instance sharing             │
│  │                                                              │
│  L3: Database (PostgreSQL)                                     │
│      Source of truth | Use: Persistent storage                 │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Cache Key Patterns

```javascript
// Billing Service
billing_plans:{clinicId}              // TTL: 1800s, Tags: ['billing_plans']
user_subscriptions:{userId}           // TTL: 900s, Tags: ['user_subscriptions:{userId}']
user_payments:{userId}                // TTL: 900s, Tags: ['user_payments:{userId}']
user_invoices:{userId}                // TTL: 900s, Tags: ['user_invoices:{userId}']

// EHR Service
ehr:comprehensive:{userId}            // TTL: 1800s, Tags: ['ehr:{userId}'], PHI: true
ehr:medical_history:{userId}          // TTL: 1800s, Tags: ['ehr:{userId}'], PHI: true
clinic:ehr_analytics:{clinicId}       // TTL: 1800s, Tags: ['clinic:{clinicId}']
clinic:critical_alerts:{clinicId}     // TTL: 300s, Tags: ['clinic:{clinicId}'], Priority: high

// User Service
user:{userId}                         // TTL: 1800s, Tags: ['user:{userId}']
clinic:users:{clinicId}               // TTL: 900s, Tags: ['clinic:{clinicId}']

// Session Management
session:{sessionId}                   // TTL: 86400s (24h), Tags: ['session:{userId}']
```

### Cache Invalidation Patterns

```javascript
// Tag-based Invalidation
await cacheService.invalidateCacheByTag('billing_plans');
await cacheService.invalidateCacheByTag(`ehr:${userId}`);
await cacheService.invalidateCacheByTag(`clinic:${clinicId}`);

// Automatic Invalidation on Events
'billing.subscription.created' → invalidate('user_subscriptions:{userId}')
'ehr.medical_history.created'  → invalidate('ehr:{userId}', 'clinic:{clinicId}')
'user.updated'                 → invalidate('user:{userId}')
```

---

## 🚀 Performance Optimization

### Database Optimization

```sql
-- Key Indexes for Performance
CREATE INDEX idx_subscription_user_clinic ON Subscription(userId, clinicId);
CREATE INDEX idx_appointment_clinic_date ON Appointment(clinicId, scheduledAt);
CREATE INDEX idx_medical_history_user_clinic ON MedicalHistory(userId, clinicId);
CREATE INDEX idx_payment_clinic_status ON Payment(clinicId, status);
CREATE INDEX idx_vital_user_date ON Vital(userId, recordedAt);

-- Composite Indexes for Common Queries
CREATE INDEX idx_subscription_status_period ON Subscription(status, currentPeriodEnd);
CREATE INDEX idx_appointment_user_status ON Appointment(userId, status);
```

### Query Optimization

```javascript
// Batch Loading with Promise.all
const [subscriptions, payments, invoices] = await Promise.all([
  this.getSubscriptions(userId),
  this.getPayments(userId),
  this.getInvoices(userId)
]);

// Select Only Required Fields
const payments = await prisma.payment.findMany({
  select: { amount: true, createdAt: true },
  where: { clinicId }
});

// Use Cursor-Based Pagination for Large Datasets
const appointments = await prisma.appointment.findMany({
  take: 50,
  skip: 1,
  cursor: { id: lastAppointmentId },
  orderBy: { scheduledAt: 'desc' }
});
```

---

## 📝 Logging & Monitoring

### Log Levels & Types

```typescript
// Log Types
SYSTEM    // System operations (startup, shutdown, config)
API       // API requests and responses
DATABASE  // Database queries and transactions
CACHE     // Cache hits, misses, invalidations
SECURITY  // Authentication, authorization, breaches
ERROR     // Application errors and exceptions
AUDIT     // HIPAA-compliant audit trails
METRICS   // Performance metrics

// Log Levels
DEBUG     // Development debugging
INFO      // General information
WARN      // Warning messages
ERROR     // Error conditions
FATAL     // Critical errors requiring immediate attention
```

### Distributed Tracing

```javascript
// Correlation ID Flow
Request → Generate Correlation ID → Pass to all services → Include in all logs

// Example Log Entry
{
  correlationId: 'req_1234567890',
  traceId: 'trace_abcdef',
  userId: 'user_123',
  clinicId: 'clinic_456',
  operation: 'createSubscription',
  service: 'BillingService',
  level: 'INFO',
  message: 'Subscription created',
  timestamp: '2024-01-15T10:30:00Z',
  duration: 45 // ms
}
```

---

## ✅ Integration Verification Checklist

### ✓ Core Infrastructure
- [x] **PrismaService**: Used by all services for database access
- [x] **CacheService**: Integrated in Billing & EHR with tag-based invalidation
- [x] **LoggingService**: All services log operations with context
- [x] **EventService**: Event emission and handling across services

### ✓ Business Services
- [x] **BillingService**:
  - Integrated with Appointments (subscription-based booking)
  - Event emission for payments, subscriptions
  - Cache invalidation on updates
  - Logging all operations

- [x] **EHRService**:
  - Multi-clinic support with clinicId
  - Clinic-wide analytics and search
  - Critical alerts system
  - Event emission for health records
  - Cache with PHI protection

- [x] **Appointments**:
  - Links to subscriptions via `subscriptionId`
  - Quota tracking support
  - Event-driven updates

- [x] **NotificationService**:
  - Push notifications (Firebase, SNS)
  - Email (SES) with templates and queue
  - SMS/WhatsApp integration
  - Event-driven triggers

### ✓ Security & Compliance
- [x] **Authentication**: JWT-based with refresh tokens
- [x] **Authorization**: RBAC with role decorators
- [x] **Clinic Isolation**: Multi-tenant support
- [x] **HIPAA Compliance**: PHI encryption, audit logs, data minimization

### ✓ Communication
- [x] **Real-time**: WebSocket support via SocketModule
- [x] **Events**: EventEmitter with wildcard support
- [x] **Queues**: Bull queues for email and notifications
- [x] **Caching**: Redis with Pub/Sub

---

## 🔄 Cross-Service Integration Examples

### Example 1: Booking Subscription-Based Appointment

```typescript
// Step 1: Check subscription coverage (Billing Service)
const coverage = await billingService.checkAppointmentCoverage(
  subscriptionId,
  'VIDEO_CALL'
);

// Step 2: Create appointment (Appointments Service)
const appointment = await appointmentsService.createAppointment({
  userId,
  doctorId,
  clinicId,
  type: 'VIDEO_CALL',
  scheduledAt: '2024-01-20T10:00:00Z'
});

// Step 3: Link with subscription if covered (Billing Service)
if (coverage.covered) {
  await billingService.bookAppointmentWithSubscription(
    subscriptionId,
    appointment.id
  );
  // Automatically decrements quota, emits event, invalidates cache
}

// Step 4: Send notification (Notification Service - triggered by event)
// Event 'billing.appointment.booked' → NotificationService sends confirmation
```

### Example 2: Creating Health Record with Clinic Analytics

```typescript
// Step 1: Create medical history (EHR Service)
const record = await ehrService.createMedicalHistory({
  userId: 'patient_123',
  clinicId: 'clinic_456',
  condition: 'Diabetes Type 2',
  date: '2024-01-15'
});
// Emits 'ehr.medical_history.created'
// Invalidates: ehr:patient_123, clinic:clinic_456

// Step 2: Check for critical conditions (EHR Service - automatic)
const alerts = await ehrService.getClinicCriticalAlerts('clinic_456');

// Step 3: Update clinic analytics (EHR Service - cached)
const analytics = await ehrService.getClinicEHRAnalytics('clinic_456');
// Returns: common conditions, patient counts, recent activity

// Step 4: Notification (Notification Service - event-driven)
// If critical condition detected → Notify clinic staff
```

### Example 3: Payment with Invoice Auto-Generation

```typescript
// Step 1: Create payment (Billing Service)
const payment = await billingService.createPayment({
  amount: 1000,
  userId: 'patient_123',
  clinicId: 'clinic_456',
  appointmentId: 'appt_789',
  method: 'CARD'
});

// Step 2: Process payment gateway (External service)
const paymentResult = await paymentGateway.process(payment.id);

// Step 3: Update payment status (Billing Service)
await billingService.updatePayment(payment.id, {
  status: 'COMPLETED',
  transactionId: paymentResult.transactionId
});
// Automatically creates/updates invoice if linked

// Step 4: Cache invalidation and events
// Invalidates: user_payments:patient_123
// Emits: billing.payment.updated
// Notification: Payment confirmation sent
```

---

## 📈 Scalability Considerations

### Horizontal Scaling
- **Stateless Services**: All services are stateless, can scale independently
- **Load Balancing**: Distribute requests across multiple instances
- **Database Connection Pooling**: Prisma manages connection pool (10-50 connections)
- **Redis Cluster**: Cache layer can scale with Redis cluster

### Performance Targets (1M+ Users)
- API Response Time: p95 < 200ms
- Cache Hit Rate: > 80%
- Database Query Time: p95 < 50ms
- Event Processing: < 100ms
- Notification Delivery: < 5s

### Queue Management
```javascript
// Email Queue (Bull)
- Priority Levels: low, normal, high, critical
- Retry Logic: 3 attempts with exponential backoff
- Rate Limiting: 100 emails/minute per clinic
- Batch Processing: Group emails for efficiency
```

---

## 🎯 Summary

**All Services are Fully Integrated:**

✅ **Billing Service** → Integrated with Appointments, Notifications, Logging, Caching, Events
✅ **EHR Service** → Integrated with Clinic, Users, Notifications, Logging, Caching, Events
✅ **Appointments** → Integrated with Billing, Users, Clinic, Notifications
✅ **Notifications** → Integrated with all services via events
✅ **Logging** → Used by all services for audit trails and monitoring
✅ **Caching** → Used by all services with tag-based invalidation
✅ **Events** → Event-driven architecture connecting all services

**System is Production-Ready with:**
- Multi-tenant clinic isolation
- HIPAA-compliant data handling
- Real-time event processing
- Enterprise-grade caching
- Comprehensive logging
- Role-based access control
- Subscription-based billing with hybrid payments
- Comprehensive EHR system with clinic-wide analytics
- Scalable architecture for 1M+ users
