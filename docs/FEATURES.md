# 🏥 Healthcare Backend - Complete Features Documentation

**Last Updated:** January 2025  
**Status:** ✅ **Production Ready**

---

## 📋 Table of Contents

1. [Communication System](#communication-system)
2. [Appointments](#appointments)
3. [Video Consultations](#video-consultations)
4. [RBAC & Security](#rbac--security)
5. [Payment & Billing](#payment--billing)
6. [Event System](#event-system)
7. [Queue System](#queue-system)
8. [Multi-Tenant Architecture](#multi-tenant-architecture)

---

## 📧 Communication System

### Overview

**Primary Email Provider:** ✅ **ZeptoMail** (Configured)

The communication system supports multi-tenant, multi-provider architecture with automatic fallback.

### Features

- ✅ **ZeptoMail** - Primary email provider (transactional emails)
- ✅ **AWS SES** - Fallback email provider
- ✅ **SMTP** - Secondary fallback
- ✅ **Firebase FCM** - Primary push notifications
- ✅ **AWS SNS** - Push backup
- ✅ **Meta Business API** - WhatsApp messaging
- ✅ **Circuit Breakers** - Prevents cascading failures
- ✅ **Rate Limiting** - Per-provider, per-clinic
- ✅ **Health Monitoring** - Continuous provider health checks
- ✅ **Suppression Lists** - Bounce/complaint handling

### Quick Setup

```bash
# Configure clinic email (ZeptoMail primary)
PUT /api/v1/clinics/{clinicId}/communication/config
{
  "email": {
    "primary": {
      "provider": "zeptomail",
      "credentials": {
        "sendMailToken": "...",
        "fromEmail": "noreply@clinic.com",
        "fromName": "Clinic Name"
      }
    },
    "fallback": [
      { "provider": "aws_ses", ... }
    ]
  }
}
```

**Documentation:** See [Communication System Guide](../guides/COMMUNICATION_SYSTEM_COMPLETE_GUIDE.md)

---

## 📅 Appointments

### Overview

Complete appointment management system with follow-ups, subscriptions, and multi-tenant support.

### Features

- ✅ Appointment scheduling (in-person & video)
- ✅ Follow-up appointments
- ✅ Subscription-based appointments
- ✅ Appointment reminders (email, push, WhatsApp)
- ✅ Cancellation & rescheduling
- ✅ Multi-clinic support
- ✅ Doctor availability management
- ✅ Patient history tracking

### Key Endpoints

```bash
# Create appointment
POST /api/v1/appointments
GET /api/v1/appointments/{id}
PUT /api/v1/appointments/{id}
DELETE /api/v1/appointments/{id}

# Follow-ups
POST /api/v1/appointments/{id}/follow-up

# Subscriptions
POST /api/v1/appointments/subscriptions
```

**Status:** ✅ 100% Production Ready

---

## 🎥 Video Consultations

### Overview

Video consultation service with dual-provider support and automatic fallback.

### Features

- ✅ **OpenVidu** - Primary provider (AI-ready, custom domain)
- ✅ **Jitsi** - Fallback provider
- ✅ Automatic failover
- ✅ Session recording
- ✅ HIPAA compliant
- ✅ Event-driven architecture
- ✅ Health monitoring

### Configuration

```bash
# Environment variables
VIDEO_PROVIDER=openvidu  # or jitsi
OPENVIDU_URL=https://openvidu.example.com
OPENVIDU_SECRET=your-secret
JITSI_URL=https://meet.jit.si
```

### Key Endpoints

```bash
# Create session
POST /api/v1/video/sessions
GET /api/v1/video/sessions/{sessionId}
DELETE /api/v1/video/sessions/{sessionId}
```

**Status:** ✅ 100% Implemented

---

## 🔐 RBAC & Security

### Overview

Complete role-based access control with 12 roles and 25+ resources.

### Roles

1. **SUPER_ADMIN** - Full system access
2. **CLINIC_ADMIN** - Clinic management
3. **LOCATION_HEAD** - Location management
4. **DOCTOR** - Medical services
5. **NURSE** - Patient care
6. **RECEPTIONIST** - Front desk
7. **PHARMACIST** - Pharmacy operations
8. **LAB_TECHNICIAN** - Lab services
9. **PATIENT** - Patient access
10. **ACCOUNTANT** - Financial operations
11. **INVENTORY_MANAGER** - Inventory
12. **SYSTEM_AUDITOR** - Audit access

### Protection Status

- ✅ **10/11 Controllers** fully protected (91%)
- ✅ **180+ Endpoints** protected
- ✅ **12 Roles** with complete permissions
- ✅ **25+ Resources** defined
- ✅ Ownership checks implemented
- ✅ Audit logging enabled

### Usage

```typescript
// Controller protection
@UseGuards(JwtAuthGuard, RbacGuard)
@RequirePermissions('appointments:create')
@Post()
async createAppointment() { ... }
```

**Status:** ✅ Complete - All Critical Gaps Resolved

---

## 💳 Payment & Billing

### Overview

Complete payment processing system with multiple providers and subscription management.

### Payment Providers

- ✅ **Razorpay** - Primary (India)
- ✅ **PhonePe** - Alternative (India)
- ✅ **Stripe** - International
- ✅ **PayPal** - International

### Features

- ✅ Billing plans management
- ✅ Subscription management
- ✅ Invoice generation
- ✅ Payment processing
- ✅ Refund handling
- ✅ Webhook integration
- ✅ Analytics & reporting

### Payment Flows

1. **Subscription Payment** - Monthly for in-person appointments
2. **Per-Appointment Payment** - Video consultations
3. **Subscription-Based Appointment** - In-person with subscription
4. **Refund Processing** - Automated refunds

### Key Endpoints

```bash
# Billing
POST /api/v1/billing/plans
GET /api/v1/billing/invoices
POST /api/v1/billing/payments

# Subscriptions
POST /api/v1/billing/subscriptions
GET /api/v1/billing/subscriptions/{id}
```

**Status:** ✅ Production Ready

---

## 🎯 Event System

### Overview

Centralized event-driven architecture using EventService as single source of truth.

### Architecture

```
EventService (Hub)
    ↓
EventEmitter2
    ↓
┌──────────┬──────────┬──────────┐
│ Socket   │ Communication│ Audit   │
│ Listener │ Listener    │ Listener │
└──────────┴──────────┴──────────┘
```

### Event Categories

- **USER_ACTIVITY** - User actions
- **EHR_RECORD** - Medical records
- **APPOINTMENT** - Appointment events
- **BILLING** - Payment events
- **CLINIC** - Clinic operations
- **VIDEO** - Video consultations

### Usage

```typescript
// Simple event
await eventService.emit('user.created', { userId, email });

// Enterprise event
await eventService.emitEnterprise('ehr.lab_report.created', {
  category: EventCategory.EHR_RECORD,
  priority: EventPriority.HIGH,
  userId,
  clinicId,
  payload: { ... }
});
```

**Status:** ✅ Complete

---

## 🔄 Queue System

### Overview

Background job processing using BullMQ for heavy operations.

### Queue Types

- ✅ **EHR Workers** - Medical record processing
- ✅ **Email Workers** - Email sending
- ✅ **Notification Workers** - Push notifications
- ✅ **Billing Workers** - Payment processing
- ✅ **Report Workers** - Report generation

### Usage

```typescript
// Add job to queue
await queueService.add('email.send', {
  to: 'user@example.com',
  subject: 'Welcome',
  body: '...'
});

// Process job
@Processor('email.send')
async processEmailJob(job: Job) {
  // Process email
}
```

**Status:** ✅ Complete

---

## 🏢 Multi-Tenant Architecture

### Overview

Complete multi-tenant support with clinic-specific configurations.

### Features

- ✅ Clinic-specific communication providers
- ✅ Clinic-specific email addresses
- ✅ Clinic-specific WhatsApp numbers
- ✅ Automatic fallback to global config
- ✅ Encrypted credentials (AES-256-GCM)
- ✅ Per-clinic caching
- ✅ Health checks per clinic

### Configuration

```typescript
// Clinic-specific config stored in:
clinic.settings.communicationSettings = {
  email: {
    primary: { provider: 'zeptomail', ... },
    fallback: [{ provider: 'aws_ses', ... }]
  },
  whatsapp: { ... },
  sms: { ... }
}
```

**Status:** ✅ 95% Complete (Production Ready)

---

## 📊 System Status Summary

| Feature | Status | Documentation |
|---------|--------|---------------|
| **Communication** | ✅ Ready | [Communication Guide](../guides/COMMUNICATION_SYSTEM_COMPLETE_GUIDE.md) |
| **Appointments** | ✅ Ready | This document |
| **Video** | ✅ Ready | This document |
| **RBAC** | ✅ Ready | This document |
| **Payments** | ✅ Ready | This document |
| **Events** | ✅ Ready | This document |
| **Queue** | ✅ Ready | This document |
| **Multi-Tenant** | ✅ Ready | This document |

---

## 🚀 Quick Start

### 1. Communication Setup

```bash
# Configure ZeptoMail (primary email)
PUT /api/v1/clinics/{clinicId}/communication/config
```

### 2. RBAC Setup

```bash
# Roles and permissions are pre-configured
# Use @RequirePermissions() decorator in controllers
```

### 3. Video Setup

```bash
# Set environment variables
VIDEO_PROVIDER=openvidu
OPENVIDU_URL=...
```

### 4. Payment Setup

```bash
# Configure payment provider
PUT /api/v1/billing/config
```

---

## 📚 Related Documentation

- [Communication System Guide](../guides/COMMUNICATION_SYSTEM_COMPLETE_GUIDE.md) - Complete communication docs
- [API Documentation](./API_DOCUMENTATION.md) - API reference
- [Environment Variables](./ENVIRONMENT_VARIABLES.md) - Configuration
- [Developer Guide](./DEVELOPER_GUIDE.md) - Development setup

---

**Last Updated:** January 2025  
**Status:** ✅ **All Features Production Ready**

