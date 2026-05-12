# 📧 Communication & Notification System - Complete Guide

> **Comprehensive guide for the Healthcare Backend communication and
> notification system with ZeptoMail as primary email provider**

**Status:** ✅ Production-ready  
**Last Updated:** January 2025

**Note:** All deprecated `/notifications/*` endpoints have been removed. Use
`/communication/*` endpoints only.

> **📚 Related Guides:**
>
> - **[Email Integration Guide](./EMAIL_INTEGRATION_GUIDE.md)** - Detailed email
>   provider setup (ZeptoMail, AWS SES, SMTP)
> - **[AWS SES Complete Guide](./AWS_SES_COMPLETE_GUIDE.md)** - AWS SES specific
>   setup, best practices, and compliance audit
> - **[FCM Integration Guide](./FCM_INTEGRATION_GUIDE.md)** - Push notification
>   setup (Firebase Cloud Messaging)
>
> **When to use this guide:** Use this guide for system-wide communication
> overview. For detailed provider-specific setup, see the individual guides.

---

## 📋 Table of Contents

1. [Executive Summary](#executive-summary)
2. [Integration Architecture](#integration-architecture)
3. [Channel Implementation](#channel-implementation)
4. [Email System](#email-system)
5. [Push Notifications](#push-notifications)
6. [WhatsApp & SMS](#whatsapp--sms)
7. [Service Integration](#service-integration)
8. [Event-Driven Integration](#event-driven-integration)
9. [Multi-Tenant Support](#multi-tenant-support)
10. [Category-Based Routing](#category-based-routing)
11. [User Preferences](#user-preferences)
12. [Robustness Features](#robustness-features)
13. [Health Monitoring & Metrics](#health-monitoring--metrics)
14. [Configuration](#configuration)
15. [API Endpoints Reference](#api-endpoints-reference)
16. [Testing](#testing)
17. [Troubleshooting](#troubleshooting)
18. [Best Practices](#best-practices)
19. [Integration Checklist](#integration-checklist)

---

## 🎯 Executive Summary

✅ **All communication channels are properly implemented and integrated**  
✅ **Notification system is fully functional with event-driven architecture**  
✅ **Multi-tenant support is complete across all channels**  
✅ **All services are using the unified CommunicationService**  
✅ **Event listeners are properly configured for automatic notifications**  
✅ **All deprecated endpoints removed - use `/communication/*` only**

### Primary Providers

| Channel      | Primary Provider         | Fallback Providers                             |
| ------------ | ------------------------ | ---------------------------------------------- |
| **Email**    | **ZeptoMail**            | AWS SES, SMTP                                  |
| **Push**     | Firebase Cloud Messaging | AWS SNS                                        |
| **WhatsApp** | Meta Business API        | Twilio                                         |
| **SMS**      | AWS SNS                  | Twilio (Configuration ready, adapters pending) |

---

## 🏗️ Integration Architecture

### System Flow

```
Business Events (Appointments, Auth, EHR, etc.)
    ↓
EventService (Central Event System)
    ↓
NotificationEventListener (Event-driven triggers)
    ↓
CommunicationService (Unified communication orchestration)
    ↓
Channel Services (Email, WhatsApp, Push, Socket, SMS)
    ↓
Provider Adapters (ZeptoMail, AWS SES, Meta WhatsApp, Twilio, FCM, etc.)
    ↓
Delivery & Tracking
```

### Key Components

1. **CommunicationService** - Unified entry point for all communication
2. **NotificationEventListener** - Event-driven automatic notifications
3. **Channel Services** - Email, WhatsApp, Push, Socket, SMS
4. **Provider Adapters** - Multi-tenant provider routing
5. **CommunicationController** - Unified REST API endpoints at
   `/communication/*`

---

## 📧 Channel Implementation

### ✅ Email Channel

**Status:** ✅ Fully Integrated

**Implementation:**

- ✅ `EmailService` - Unified email service
- ✅ `ZeptoMailEmailAdapter` - Primary provider (multi-tenant)
- ✅ `SESEmailAdapter` - AWS SES fallback (multi-tenant)
- ✅ `SMTPEmailAdapter` - Custom SMTP (multi-tenant)
- ✅ `EmailTemplatesService` - Template management
- ✅ Multi-tenant routing via `clinicId`
- ✅ Provider fallback mechanism
- ✅ Credential encryption/decryption

**Integration Points:**

- ✅ `AuthService` - Welcome emails, password reset, OTP
- ✅ `AppointmentNotificationService` - Appointment reminders
- ✅ `CommunicationService` - Unified email sending
- ✅ `CommunicationController` - REST API endpoints at `/communication/*`

**Usage Examples:**

```typescript
// Direct usage in services
await this.emailService.sendEmail({
  to: 'user@example.com',
  subject: 'Welcome',
  template: EmailTemplate.WELCOME,
  context: { name: 'John' },
  clinicId: 'clinic-123', // Multi-tenant routing
});

// Via CommunicationService
await this.communicationService.send({
  category: CommunicationCategory.APPOINTMENT,
  title: 'Appointment Reminder',
  body: 'Your appointment is tomorrow',
  recipients: [{ email: 'user@example.com' }],
  channels: ['email'],
  metadata: { clinicId: 'clinic-123' },
});
```

### ✅ WhatsApp Channel

**Status:** ✅ Fully Integrated

**Implementation:**

- ✅ `WhatsAppService` - Unified WhatsApp service
- ✅ `MetaWhatsAppAdapter` - Meta Business API (multi-tenant)
- ✅ `TwilioWhatsAppAdapter` - Twilio WhatsApp (multi-tenant)
- ✅ Template support with dynamic clinic names
- ✅ Multi-tenant routing via `clinicId`
- ✅ Provider fallback mechanism
- ✅ OTP support with retry logic

**Integration Points:**

- ✅ `AppointmentNotificationService` - Appointment reminders
- ✅ `CommunicationService` - Unified WhatsApp sending
- ✅ `CommunicationController` - REST API endpoints at `/communication/*`

**Usage Examples:**

```typescript
// Via CommunicationService
await this.communicationService.send({
  category: CommunicationCategory.APPOINTMENT,
  title: 'Appointment Reminder',
  body: 'Your appointment is tomorrow',
  recipients: [{ phoneNumber: '+1234567890' }],
  channels: ['whatsapp'],
  metadata: { clinicId: 'clinic-123' },
});
```

### ✅ Push Notification Channel

**Status:** ✅ Fully Integrated

**Implementation:**

- ✅ `PushNotificationService` - Unified push service
- ✅ Firebase Cloud Messaging (FCM) - Primary
- ✅ AWS SNS - Fallback
- ✅ Topic-based notifications
- ✅ Multi-device support
- ✅ Delivery tracking

**Integration Points:**

- ✅ `AppointmentNotificationService` - Appointment reminders
- ✅ `CommunicationService` - Unified push sending
- ✅ `CommunicationController` - REST API endpoints at `/communication/*`
  (includes topic-based)

**Usage Examples:**

```typescript
// Via CommunicationService
await this.communicationService.send({
  category: CommunicationCategory.APPOINTMENT,
  title: 'Appointment Reminder',
  body: 'Your appointment is tomorrow',
  recipients: [{ deviceToken: 'fcm-token' }],
  channels: ['push'],
  metadata: { clinicId: 'clinic-123' },
});
```

### ✅ Socket (WebSocket) Channel

**Status:** ✅ Fully Integrated

**Implementation:**

- ✅ `SocketService` - Real-time WebSocket service
- ✅ Socket.IO integration
- ✅ Room-based messaging
- ✅ Multi-tenant namespace support
- ✅ Real-time delivery

**Integration Points:**

- ✅ `AppointmentNotificationService` - Real-time appointment updates
- ✅ `CommunicationService` - Unified socket sending
- ✅ EHR updates - Real-time medical record notifications

**Usage Examples:**

```typescript
// Via CommunicationService
await this.communicationService.send({
  category: CommunicationCategory.EHR_RECORD,
  title: 'New Lab Report',
  body: 'Your lab results are ready',
  recipients: [{ userId: 'user-123', socketRoom: 'user:user-123' }],
  channels: ['socket'],
  metadata: { clinicId: 'clinic-123' },
});
```

### ⚠️ SMS Channel

**Status:** ⚠️ Configuration Ready, Adapter Implementation Pending

**Implementation:**

- ✅ Configuration system ready
- ✅ Multi-tenant credential storage
- ✅ Provider configuration (Twilio, AWS SNS)
- ⚠️ SMS adapters not yet implemented
- ✅ Opt-in logic implemented (only sent when user enables)

**Integration Points:**

- ✅ `CommunicationService` - SMS channel configured
- ✅ User preference filtering (SMS only if enabled)
- ⚠️ Adapter implementation needed

---

## 📧 Email System

### Primary Provider: ZeptoMail

**ZeptoMail** is configured as the **primary email provider** by default for all
clinics.

#### Why ZeptoMail?

- ✅ **Transactional email optimized** - Designed for transactional emails
- ✅ **High deliverability** - Better inbox placement
- ✅ **Cost-effective** - Competitive pricing
- ✅ **API-first** - RESTful API with better error handling
- ✅ **Built-in tracking** - Open/click tracking via headers
- ✅ **Attachment support** - Up to 15 MB per email

#### ZeptoMail Setup

**1. Get ZeptoMail Credentials:**

1. Log in to [ZeptoMail Console](https://www.zoho.com/zeptomail/)
2. Navigate to **Mail Agents** section
3. Create a new Mail Agent (or use existing)
4. Go to **Setup Info** → **API** tab
5. Generate and copy the **Send Mail Token**

**2. Configure Clinic Email:**

```bash
PUT /api/v1/clinics/{clinicId}/communication/config
Authorization: Bearer <token>

{
  "email": {
    "primary": {
      "provider": "zeptomail",
      "enabled": true,
      "credentials": {
        "sendMailToken": "your_send_mail_token",
        "fromEmail": "noreply@yourdomain.com",
        "fromName": "Your Clinic Name",
        "bounceAddress": "bounces@yourdomain.com"
      },
      "priority": 1
    },
    "fallback": [
      {
        "provider": "aws_ses",
        "enabled": true,
        "credentials": {
          "region": "us-east-1",
          "accessKeyId": "AKIA...",
          "secretAccessKey": "...",
          "fromEmail": "noreply@yourdomain.com",
          "fromName": "Your Clinic Name"
        },
        "priority": 2
      }
    ],
    "defaultFrom": "noreply@yourdomain.com",
    "defaultFromName": "Your Clinic Name"
  }
}
```

**3. Test Configuration:**

```bash
POST /api/v1/clinics/{clinicId}/communication/test-email
Authorization: Bearer <token>

{
  "testEmail": "your-email@example.com"
}
```

#### ZeptoMail API Integration

**Base URL:** `https://api.zeptomail.com/v1.1/email`

**Authentication:** `Zoho-enczapikey <send_mail_token>`

**Request Format:**

```json
{
  "bounce_address": "bounces@yourdomain.com",
  "from": {
    "address": "noreply@yourdomain.com",
    "name": "Your Company"
  },
  "to": [
    {
      "email_address": {
        "address": "recipient@example.com",
        "name": "Recipient Name"
      }
    }
  ],
  "subject": "Subject of the Email",
  "htmlbody": "<p>Your email content here.</p>",
  "textbody": "Plain text version (optional)"
}
```

**Features:**

- Template support
- Attachment management via file cache
- Full control over email headers
- Open/click tracking via `X-TM-OPEN-TRACK` and `X-TM-CLICK-TRACK` headers

**Limitations:**

- Email size limit: **15 MB** (headers + body + attachments)
- Transactional emails only (no bulk/promotional)
- IP restrictions recommended for production

#### Fallback Providers

**AWS SES (Fallback 1):**

- High deliverability
- HIPAA compliant
- Global infrastructure
- See [AWS_SES_COMPLETE_GUIDE.md](./AWS_SES_COMPLETE_GUIDE.md) for setup

**SMTP (Fallback 2):**

- Custom SMTP servers
- Gmail, Outlook, or custom SMTP
- Standard SMTP protocol

**Fallback Flow:**

1. Try ZeptoMail (primary)
2. If unhealthy → Try AWS SES
3. If unhealthy → Try SMTP
4. If all fail → Return error

---

## 🔔 Push Notifications

### Primary Provider: Firebase Cloud Messaging (FCM)

**Firebase Cloud Messaging** is the primary push notification provider.

#### Setup

**1. Firebase Configuration:**

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_VAPID_KEY=your-vapid-key  # For web push
```

**2. API Endpoints:**

```bash
# Register device token
POST /api/v1/communication/push/device-token
{
  "token": "FCM_TOKEN_FROM_BROWSER",
  "platform": "web",
  "userId": "user-123"
}

# Send push notification
POST /api/v1/communication/push
{
  "deviceToken": "FCM_TOKEN",
  "title": "Notification Title",
  "body": "Notification Body",
  "data": {
    "type": "appointment",
    "id": "123"
  }
}
```

#### Fallback: AWS SNS

**AWS SNS** serves as backup when FCM fails.

**Setup:** See [AWS_SNS_INTEGRATION_GUIDE.md](./AWS_SNS_INTEGRATION_GUIDE.md)

**Features:**

- HIPAA compliant
- High reliability
- Automatic failover
- Enterprise SLA

---

## 💬 WhatsApp & SMS

### ✅ WhatsApp: Meta Business API

**Status:** ✅ Fully Integrated

**Primary provider** for WhatsApp messaging with multi-tenant support.

#### Why WhatsApp?

- ✅ **High engagement** - Better open rates than email/SMS
- ✅ **Template support** - Pre-approved templates for OTP, appointments,
  prescriptions
- ✅ **Rich media** - Support for documents, images, videos
- ✅ **Two-way communication** - Users can reply directly
- ✅ **Global reach** - 2B+ users worldwide

#### WhatsApp Setup

**1. Get Meta Business API Credentials:**

1. Create a [Meta Business Account](https://business.facebook.com/)
2. Set up a WhatsApp Business Account
3. Create a Meta App and get API credentials
4. Get your Phone Number ID and Business Account ID
5. Create and approve message templates in Meta Business Manager

**2. Configure Clinic WhatsApp:**

```bash
PUT /api/v1/clinics/{clinicId}/communication/config
Authorization: Bearer <token>

{
  "whatsapp": {
    "primary": {
      "provider": "meta_business",
      "enabled": true,
      "credentials": {
        "apiKey": "EAAxxxxxxxxxxxx",
        "phoneNumberId": "123456789012345",
        "businessAccountId": "987654321098765"
      },
      "priority": 1
    },
    "fallback": [
      {
        "provider": "twilio",
        "enabled": true,
        "credentials": {
          "accountSid": "ACxxxxxxxxxxxx",
          "authToken": "your_twilio_auth_token",
          "from": "whatsapp:+1234567890"
        },
        "priority": 2
      }
    ],
    "defaultNumber": "+1234567890"
  }
}
```

**3. Test Configuration:**

```bash
POST /api/v1/clinics/{clinicId}/communication/test-whatsapp
Authorization: Bearer <token>

{
  "testPhoneNumber": "+1234567890"
}
```

#### WhatsApp API Integration

**Base URL:** `https://graph.facebook.com/v17.0`

**Authentication:** `Bearer <api_key>`

**Features:**

- Template messages (OTP, appointment reminders, prescriptions)
- Custom text messages
- Document sending (prescriptions, invoices)
- Multi-tenant routing via `clinicId`
- Dynamic clinic names in templates
- Retry logic for failed deliveries

**Template Message Format:**

```json
{
  "messaging_product": "whatsapp",
  "to": "+1234567890",
  "type": "template",
  "template": {
    "name": "otp_verification",
    "language": { "code": "en" },
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "Clinic Name" },
          { "type": "text", "text": "123456" }
        ]
      }
    ]
  }
}
```

**Usage Examples:**

```typescript
// Via CommunicationService
await this.communicationService.send({
  category: CommunicationCategory.APPOINTMENT,
  title: 'Appointment Reminder',
  body: 'Your appointment is tomorrow at 10 AM',
  recipients: [{ phoneNumber: '+1234567890' }],
  channels: ['whatsapp'],
  metadata: { clinicId: 'clinic-123' },
});

// Direct WhatsApp service
await this.whatsAppService.sendOTP(
  '+1234567890',
  '123456',
  10, // expiry minutes
  2, // max retries
  'clinic-123' // clinicId for multi-tenant routing
);
```

#### Fallback Provider: Twilio

**Twilio WhatsApp** serves as backup when Meta Business API fails.

**Setup:** Configure via clinic communication settings with Twilio credentials.

**Features:**

- Automatic failover
- Template support
- Global coverage

#### Environment Variables

```bash
# WhatsApp Configuration (Global - can be overridden per clinic)
WHATSAPP_ENABLED=true
WHATSAPP_API_URL=https://graph.facebook.com/v17.0
WHATSAPP_API_KEY=your_meta_api_key
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_account_id
WHATSAPP_OTP_TEMPLATE_ID=otp_verification
WHATSAPP_APPOINTMENT_TEMPLATE_ID=appointment_reminder
WHATSAPP_PRESCRIPTION_TEMPLATE_ID=prescription_notification

# Clinic-Specific (Optional)
CLINIC_AADESH_AYURVEDELAY_WHATSAPP_API_KEY=clinic_specific_key
CLINIC_AADESH_AYURVEDELAY_WHATSAPP_PHONE_NUMBER_ID=clinic_phone_id
```

### ⚠️ SMS: AWS SNS

**Status:** ⚠️ Configuration Ready, Adapter Implementation Pending

**Primary provider** for SMS notifications.

**Use cases:**

- OTP verification
- Critical alerts
- Emergency notifications

**Note:** SMS is a **secondary/opt-in channel** - only sent when user explicitly
enables it (`smsEnabled: true` in user preferences).

**Status:** Configuration ready, adapters pending implementation.

---

## 🔗 Service Integration

### ✅ Auth Service Integration

**Status:** ✅ Fully Integrated

**Email Notifications:**

- ✅ Welcome emails (registration)
- ✅ Password reset emails
- ✅ OTP emails
- ✅ Social auth welcome emails

**Implementation:**

```typescript
// src/services/auth/auth.service.ts
await this.emailService.sendEmail({
  to: user.email,
  subject: `Welcome to ${appName}`,
  template: EmailTemplate.WELCOME,
  context: { name: user.name, role: user.role },
  clinicId: requestDto.clinicId, // Multi-tenant routing
});
```

**Verification:**

- ✅ All email calls include `clinicId` for multi-tenant routing
- ✅ Dynamic app name from environment variables
- ✅ Template-based emails with proper context

### ✅ Appointment Service Integration

**Status:** ✅ Fully Integrated

**Channels Used:**

- ✅ Email - Appointment reminders, confirmations, cancellations
- ✅ WhatsApp - Appointment reminders, confirmations
- ✅ Push - Real-time appointment updates
- ✅ Socket - Real-time appointment notifications

**Implementation:**

```typescript
// src/services/appointments/plugins/notifications/appointment-notification.service.ts
await this.sendNotification({
  appointmentId: 'appt-123',
  type: 'reminder',
  channels: ['email', 'whatsapp', 'push', 'socket'],
  clinicId: 'clinic-123', // Multi-tenant routing
  templateData: { ... }
});
```

**Verification:**

- ✅ All channels properly integrated
- ✅ Multi-tenant routing via `clinicId`
- ✅ Template support with clinic-specific data
- ✅ Error handling and logging

### ✅ Communication Controller Integration

**Status:** ✅ Fully Integrated

**Endpoints:**

- ✅ `POST /communication/send` - Unified communication
- ✅ `POST /communication/email` - Email only
- ✅ `POST /communication/push` - Push only
- ✅ `POST /communication/whatsapp` - WhatsApp only
- ✅ `POST /communication/appointment/*` - Appointment-specific
- ✅ `GET /communication/health` - Health status
- ✅ `GET /communication/analytics` - Enhanced analytics
- ✅ `GET /communication/dashboard` - Health dashboard
- ✅ `GET /communication/alerts` - Active alerts

**Verification:**

- ✅ All endpoints properly implemented
- ✅ Category-based channel selection
- ✅ Multi-tenant support
- ✅ Health monitoring

**Note:** All deprecated `/notifications/*` endpoints have been removed. Use
`/communication/*` endpoints only.

---

## 📡 Event-Driven Integration

### ✅ Notification Event Listener

**Status:** ✅ Fully Integrated

**Event Patterns Handled:**

- ✅ `ehr.*.created` - EHR record notifications
- ✅ `appointment.*` - Appointment notifications
- ✅ `auth.*` - Authentication notifications
- ✅ `billing.*` - Billing notifications
- ✅ `prescription.*` - Prescription notifications

**Implementation:**

```typescript
// src/libs/communication/listeners/notification-event.listener.ts
@OnEvent('**')
async handleEvent(eventType: string, payload: EnterpriseEventPayload) {
  const rule = this.findMatchingRule(eventType, payload);
  if (rule && rule.shouldNotify(payload)) {
    await this.communicationService.send({
      category: rule.category,
      title: this.buildTitle(rule, payload),
      body: this.buildBody(rule, payload),
      recipients: rule.recipients(payload),
      channels: rule.channels,
      priority: rule.priority
    });
  }
}
```

**Verification:**

- ✅ Listener registered and active
- ✅ Event patterns properly matched
- ✅ CommunicationService called correctly
- ✅ Recipients properly extracted from events

---

## 🏢 Multi-Tenant Support

### ✅ Clinic-Specific Routing

**Status:** ✅ Fully Integrated

**Implementation:**

- ✅ `clinicId` passed through all communication calls
- ✅ `ProviderFactory` routes to clinic-specific adapters
- ✅ `CommunicationConfigService` loads clinic-specific credentials
- ✅ Environment variable fallback (clinic-specific → global)

**Verification:**

```typescript
// Email routing
await this.emailService.sendEmail({
  to: 'user@example.com',
  clinicId: 'clinic-123', // Routes to clinic-123's email provider
});

// WhatsApp routing
await this.communicationService.send({
  recipients: [{ phoneNumber: '+1234567890' }],
  channels: ['whatsapp'],
  metadata: { clinicId: 'clinic-123' }, // Routes to clinic-123's WhatsApp provider
});
```

---

## 📊 Category-Based Channel Selection

### ✅ Communication Categories

**Status:** ✅ Fully Integrated

| Category          | Default Channels                      | Strategy  | Priority | Rate Limit |
| ----------------- | ------------------------------------- | --------- | -------- | ---------- |
| **LOGIN**         | `email`, `whatsapp`                   | IMMEDIATE | LOW      | 10/60s     |
| **APPOINTMENT**   | `socket`, `push`, `email`, `whatsapp` | IMMEDIATE | HIGH     | None       |
| **REMINDER**      | `push`, `email`, `whatsapp`, `socket` | SCHEDULED | NORMAL   | None       |
| **BILLING**       | `push`, `email`, `whatsapp`, `socket` | QUEUED    | NORMAL   | None       |
| **EHR_RECORD**    | `socket`, `push`, `email`, `whatsapp` | IMMEDIATE | HIGH     | None       |
| **CRITICAL**      | `socket`, `push`, `email`, `whatsapp` | IMMEDIATE | CRITICAL | None       |
| **SYSTEM**        | `email`                               | IMMEDIATE | LOW      | None       |
| **USER_ACTIVITY** | `push`, `socket`                      | IMMEDIATE | LOW      | None       |
| **PRESCRIPTION**  | `push`, `email`, `whatsapp`, `socket` | IMMEDIATE | HIGH     | None       |
| **CHAT**          | `socket`, `push`                      | IMMEDIATE | NORMAL   | None       |

**Verification:**

- ✅ All categories properly configured
- ✅ Channel selection works correctly
- ✅ Strategy (IMMEDIATE/SCHEDULED/QUEUED) implemented
- ✅ Priority levels respected
- ✅ Rate limiting applied where configured

---

## 👤 User Preferences Integration

### ✅ Preference-Based Filtering

**Status:** ✅ Fully Integrated

**Features:**

- ✅ Channel preferences (enable/disable channels)
- ✅ Quiet hours (time-based filtering)
- ✅ Category preferences (enable/disable categories)
- ✅ SMS opt-in (only sent when explicitly enabled)

**Implementation:**

```typescript
// CommunicationService filters channels based on preferences
const preferences = await this.getUserPreferences(recipients);
const finalChannels = this.filterChannelsByPreferences(
  channels,
  preferences,
  recipients,
  request.category
);
```

**Verification:**

- ✅ Preferences loaded from database/cache
- ✅ Channels filtered correctly
- ✅ SMS only sent when `smsEnabled: true`
- ✅ Quiet hours respected

---

## 🛡️ Robustness Features

### 1. Circuit Breaker Pattern

**Purpose:** Prevents cascading failures by temporarily stopping requests to
failing providers.

**Configuration:**

- **Threshold:** Opens after 5 consecutive failures
- **Recovery:** Attempts recovery after 60 seconds
- **States:** `closed` → `open` → `half-open` → `closed`

**Benefits:**

- Prevents overwhelming failing providers
- Fast failure detection
- Automatic recovery attempts
- Per-provider and per-clinic isolation

### 2. Rate Limiting

**Configuration:**

```typescript
{
  zeptomail: { maxRequests: 1000, windowMs: 60000, burstAllowance: 100 },
  aws_ses: { maxRequests: 1000, windowMs: 60000, burstAllowance: 100 },
  smtp: { maxRequests: 500, windowMs: 60000, burstAllowance: 50 },
}
```

**Features:**

- Per-provider limits
- Per-clinic isolation
- Burst allowance for traffic spikes
- Automatic rate limit detection

### 3. Retry Logic with Exponential Backoff

**Strategy:**

- **Max Retries:** 3 attempts (configurable)
- **Base Delay:** 1 second
- **Exponential Backoff:** `delay = baseDelay * 2^attempt`
- **Rate Limit Handling:** Double delay for rate limit errors
- **Smart Retry:** Only retries retryable errors

**Non-Retryable Errors:**

- 4xx client errors (400, 401, 403, 404)
- Invalid credentials
- Invalid email addresses
- Suppressed emails

### 4. Provider Fallback

**Flow:**

1. Try primary provider (ZeptoMail)
2. Check health status
3. If unhealthy, try fallback providers in order
4. Log fallback usage
5. Return first healthy provider

### 5. Health Monitoring

**Metrics Tracked:**

- Total requests
- Successful requests
- Failed requests
- Consecutive failures
- Average latency
- Circuit breaker state
- Success rate

**Health Checks:**

- Performed every 30 seconds
- Cached for 10 seconds to reduce load
- Alerts when success rate < 80%
- Tracks circuit breaker state changes

### 6. Suppression List Management

**Features:**

- Automatic bounce handling
- Complaint processing
- Unsubscribe management
- Multi-tenant isolation
- Cache-based lookups
- Database persistence

**Integration:**

- All email adapters check suppression list before sending
- Automatic filtering of suppressed emails
- Graceful handling (continues with allowed emails)

### 7. Timeout Protection

**Default Timeouts:**

- Email sending: 30 seconds
- Health checks: 2 seconds
- Webhook processing: 5 seconds
- API calls: 30 seconds

**Implementation:**

- Uses `Promise.race()` with timeout promise
- Throws timeout error if exceeded
- Logs timeout events
- Allows retry on timeout

### 8. Error Classification

**Error Categories:**

- **Retryable:** Network errors, 5xx, timeouts, rate limits
- **Non-Retryable:** 4xx, invalid credentials, suppressed emails
- **Circuit Breaker:** Opens circuit for retryable errors

---

## 📊 Health Monitoring & Metrics

### ✅ Health Status

**Status:** ✅ Fully Integrated

**Features:**

- ✅ Real-time channel health status
- ✅ Provider health monitoring
- ✅ Delivery metrics (success/failure rates)
- ✅ Health check endpoints
- ✅ Enhanced analytics with detailed metrics
- ✅ Comprehensive health dashboard
- ✅ Active alerts system

**Endpoints:**

- ✅ `GET /communication/health` - Overall health
- ✅ `GET /communication/analytics` - Enhanced analytics with detailed metrics
- ✅ `GET /communication/dashboard` - Comprehensive health dashboard
- ✅ `GET /communication/alerts` - Active alerts

**Verification:**

- ✅ Health monitoring active
- ✅ Metrics tracked correctly
- ✅ Health endpoints return accurate data
- ✅ Alerting system implemented

### Enhanced Analytics (`/analytics`)

**Features:**

- ✅ Per-channel metrics (email, WhatsApp, push, socket, SMS)
- ✅ Delivery rates, bounce rates, complaint rates
- ✅ Provider-specific metrics breakdown
- ✅ Time period filtering (1h, 24h, 7d, 30d)
- ✅ Clinic-specific filtering
- ✅ Real-time data from database

**Metrics Provided:**

- **Per Channel**: Total sent, delivered, failed, bounced (email), complained
  (email), delivery rate (%), bounce rate (email, %), complaint rate (email, %)
- **Per Provider**: Sent count, delivered count, failed count
- **Time Periods**: 1 hour, 24 hours, 7 days, 30 days
- **Filtering**: By clinic ID, by provider, by time period

**Example Response:**

```json
{
  "metrics": {
    "email": {
      "sent": 1000,
      "delivered": 950,
      "bounced": 20,
      "complained": 5,
      "bounceRate": 2.0,
      "complaintRate": 0.5,
      "deliveryRate": 95.0,
      "providers": {
        "zeptomail": { "sent": 800, "delivered": 760, "failed": 40 },
        "aws_ses": { "sent": 200, "delivered": 190, "failed": 10 }
      }
    }
  },
  "period": "24h",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Health Dashboard (`/dashboard`)

**Features:**

- ✅ Comprehensive health status
- ✅ Real-time metrics
- ✅ Active alerts display
- ✅ Recent activity summary (last 1 hour)
- ✅ Success rate calculations
- ✅ Cached for performance (1 minute TTL)
- ✅ Clinic-specific filtering

**Response Structure:**

```json
{
  "health": {
    "healthy": true,
    "services": {
      "firebase": true,
      "zeptomail": true,
      "awsSes": true,
      "awsSns": true,
      "firebaseDatabase": true
    },
    "timestamp": "2024-01-01T00:00:00Z"
  },
  "metrics": {
    "totalRequests": 1000,
    "successfulRequests": 950,
    "failedRequests": 50,
    "channelMetrics": {
      "email": { "sent": 500, "successful": 480, "failed": 20 },
      "whatsapp": { "sent": 300, "successful": 290, "failed": 10 },
      "push": { "sent": 200, "successful": 180, "failed": 20 }
    }
  },
  "alerts": [
    {
      "channel": "email",
      "alertType": "failure_rate",
      "severity": "warning",
      "message": "High failure rate detected for email: 12.5% (threshold: 10%)",
      "metrics": {
        "totalRequests": 100,
        "failedRequests": 12,
        "failureRate": 12.5,
        "consecutiveFailures": 3
      },
      "timestamp": "2024-01-01T00:00:00Z"
    }
  ],
  "recentActivity": {
    "totalRequests": 50,
    "successfulRequests": 48,
    "failedRequests": 2,
    "successRate": 96
  },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Alerting System (`/alerts`)

**Service:** `CommunicationAlertingService`

**Features:**

- ✅ **Failure Rate Monitoring** - Alerts when failure rate exceeds threshold
- ✅ **Consecutive Failure Tracking** - Alerts on multiple consecutive failures
- ✅ **Per-Channel Configuration** - Custom thresholds per channel
- ✅ **Alert Cooldown** - Prevents alert spam (5-minute cooldown)
- ✅ **Severity Levels** - Warning and Critical alerts
- ✅ **Event Emission** - Alerts emitted as system events
- ✅ **Comprehensive Logging** - All alerts logged with full context
- ✅ Cached for performance (30 seconds TTL)

**Alert Configuration:**

```typescript
{
  email: {
    failureRateThreshold: 10%,      // Alert if >10% failure rate
    consecutiveFailuresThreshold: 5,
    timeWindowMinutes: 15,
    enabled: true
  },
  whatsapp: {
    failureRateThreshold: 15%,      // Alert if >15% failure rate
    consecutiveFailuresThreshold: 5,
    timeWindowMinutes: 15,
    enabled: true
  },
  push: {
    failureRateThreshold: 20%,      // Alert if >20% failure rate
    consecutiveFailuresThreshold: 10,
    timeWindowMinutes: 15,
    enabled: true
  }
}
```

**Alert Types:**

1. **Failure Rate Alert** - Triggered when failure rate exceeds threshold
2. **Consecutive Failures Alert** - Triggered when consecutive failures exceed
   threshold
3. **Provider Down Alert** - Triggered when provider is completely down (future)

**Alert Processing:**

1. Check Metrics - Query delivery logs for recent failures
2. Calculate Rates - Compute failure rates and consecutive failures
3. Compare Thresholds - Check against configured thresholds
4. Cooldown Check - Verify alert hasn't been sent recently
5. Trigger Alert - Log alert and emit event
6. Record Alert - Store alert time for cooldown

**Alert Events:** Alerts are emitted as system events:

```typescript
{
  eventType: 'communication.alert.triggered',
  category: EventCategory.SYSTEM,
  priority: EventPriority.CRITICAL | EventPriority.HIGH,
  payload: {
    alert: { /* AlertStatus */ },
    timestamp: Date
  }
}
```

---

## ⚙️ Configuration

### Environment Variables

```bash
# ZeptoMail (Primary Email Provider)
ZEPTOMAIL_SEND_MAIL_TOKEN=your_send_mail_token
ZEPTOMAIL_FROM_EMAIL=noreply@yourdomain.com
ZEPTOMAIL_FROM_NAME=Healthcare App
ZEPTOMAIL_BOUNCE_ADDRESS=bounces@yourdomain.com

# AWS SES (Fallback Email Provider)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_SES_FROM_EMAIL=noreply@yourdomain.com
AWS_SES_FROM_NAME=Healthcare App

# Firebase (Primary Push Provider)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_VAPID_KEY=your-vapid-key

# Circuit Breaker
COMMUNICATION_CIRCUIT_BREAKER_THRESHOLD=5
COMMUNICATION_CIRCUIT_BREAKER_TIMEOUT=60000

# Rate Limiting
COMMUNICATION_RATE_LIMIT_WINDOW=60000
COMMUNICATION_RATE_LIMIT_BURST=100

# Health Checks
COMMUNICATION_HEALTH_CHECK_INTERVAL=30000

# App Configuration
APP_NAME=Healthcare App
SUPPORT_EMAIL=info@viddhakarma.com
DEFAULT_FROM_EMAIL=noreply@healthcare.com
DEFAULT_FROM_NAME=Healthcare App
EMAIL_CATEGORY=Notification
APP_LOGIN_URL=https://app.healthcare/login
```

### Per-Clinic Configuration

**Via API:**

```bash
PUT /api/v1/clinics/{clinicId}/communication/config
```

**Via Database:**

```sql
UPDATE clinics
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{communicationSettings,email,primary}',
  '{
    "provider": "zeptomail",
    "enabled": true,
    "credentials": {
      "sendMailToken": "...",
      "fromEmail": "noreply@clinic-domain.com",
      "fromName": "Clinic Name"
    },
    "priority": 1
  }'::jsonb
)
WHERE id = 'clinic-id-here';
```

**Clinic-Specific Environment Variables:**

```bash
# Pattern: CLINIC_{CLINIC_IDENTIFIER}_{BASE_KEY}
CLINIC_AADESH_AYURVEDELAY_ZEPTOMAIL_SEND_MAIL_TOKEN=clinic_specific_token
CLINIC_AADESH_AYURVEDELAY_ZEPTOMAIL_FROM_EMAIL=noreply@clinic.com
```

---

## 🔌 API Endpoints Reference

### Unified Communication Endpoints

All communication endpoints are available at `/api/v1/communication/*`:

#### Send Communication

- `POST /communication/send` - Unified send endpoint with category-based routing
- `POST /communication/email` - Send email only
- `POST /communication/push` - Send push notification only
- `POST /communication/whatsapp` - Send WhatsApp message only

#### Appointment & Prescription

- `POST /communication/appointment/reminder` - Appointment reminders
- `POST /communication/prescription/ready` - Prescription ready notifications

#### Push Notifications

- `POST /communication/push/multiple` - Send to multiple devices
- `POST /communication/push/topic` - Send to topic
- `POST /communication/push/subscribe` - Subscribe device to topic
- `POST /communication/push/unsubscribe` - Unsubscribe device from topic

#### Chat

- `POST /communication/chat/backup` - Backup chat message
- `GET /communication/chat/history/:userId` - Get chat history
- `GET /communication/chat/stats` - Chat statistics

#### Monitoring & Analytics

- `GET /communication/health` - Health status
- `GET /communication/analytics` - Enhanced analytics with detailed metrics
- `GET /communication/dashboard` - Comprehensive health dashboard
- `GET /communication/alerts` - Active alerts
- `GET /communication/stats` - Basic statistics
- `POST /communication/test` - Test system

### Quick Start Examples

#### Send Email

```http
POST /api/v1/communication/email
Content-Type: application/json

{
  "to": "user@example.com",
  "subject": "Welcome",
  "body": "Welcome to our service",
  "html": "<html>...</html>",
  "clinicId": "clinic-123"
}
```

#### Send Push Notification

```http
POST /api/v1/communication/push
Content-Type: application/json

{
  "deviceToken": "fcm-token",
  "title": "Notification Title",
  "body": "Notification Body",
  "data": { "key": "value" }
}
```

#### Unified Send (Multiple Channels)

```http
POST /api/v1/communication/send
Content-Type: application/json

{
  "category": "APPOINTMENT",
  "title": "Appointment Reminder",
  "body": "Your appointment is tomorrow",
  "recipients": [
    {
      "email": "user@example.com",
      "deviceToken": "fcm-token"
    }
  ],
  "channels": ["email", "push", "whatsapp"],
  "priority": "HIGH",
  "metadata": {
    "clinicId": "clinic-123"
  }
}
```

#### Get Analytics

```http
GET /api/v1/communication/analytics?clinicId=clinic-123&period=24h
```

#### Get Dashboard

```http
GET /api/v1/communication/dashboard?clinicId=clinic-123
```

#### Get Active Alerts

```http
GET /api/v1/communication/alerts?channel=email
```

---

## 🧪 Testing

### Email Testing

**1. Simple Test Email:**

```bash
GET /api/v1/email/test
```

**2. Custom Test Email:**

```bash
POST /api/v1/email/test-custom
{
  "to": "your-email@example.com",
  "template": "VERIFICATION"
}
```

**Available Templates:**

- `VERIFICATION` - Email verification
- `PASSWORD_RESET` - Password reset
- `OTP_LOGIN` - OTP login code
- `WELCOME` - Welcome email
- `LOGIN_NOTIFICATION` - Login notification
- `SECURITY_ALERT` - Security alert

**3. Clinic-Specific Test:**

```bash
POST /api/v1/clinics/{clinicId}/communication/test-email
{
  "testEmail": "your-email@example.com"
}
```

**4. Communication Service Test:**

```bash
POST /api/v1/communication/email
{
  "to": "your-email@example.com",
  "subject": "Test Email",
  "body": "<h1>Test</h1><p>This is a test email.</p>",
  "isHtml": true,
  "clinicId": "clinic-123"
}
```

**5. Email Service Status:**

```bash
GET /api/v1/email/status
```

### Push Notification Testing

**1. Register Device Token:**

```bash
POST /api/v1/communication/push/device-token
{
  "token": "FCM_TOKEN",
  "platform": "web",
  "userId": "user-123"
}
```

**2. Send Push Notification:**

```bash
POST /api/v1/communication/push
{
  "deviceToken": "FCM_TOKEN",
  "title": "Test Notification",
  "body": "This is a test push notification",
  "data": {
    "type": "test",
    "id": "123"
  }
}
```

### Health Check

```bash
GET /api/v1/communication/health
```

**Response:**

```json
{
  "healthy": true,
  "services": {
    "firebase": true,
    "zeptomail": true,
    "awsSes": true,
    "awsSns": true,
    "firebaseDatabase": true
  },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

---

## 🐛 Troubleshooting

### ZeptoMail Issues

**Issue: "Send Mail Token is required"**

**Solution:**

1. Verify `sendMailToken` is set in clinic configuration
2. Check token is valid (not expired)
3. Regenerate token in ZeptoMail console if needed

**Issue: "Email address is not verified"**

**Solution:**

1. Verify `fromEmail` in ZeptoMail console
2. Complete domain verification if using custom domain
3. Check Mail Agent configuration

**Issue: "Rate limit exceeded"**

**Solution:**

1. Check ZeptoMail quota limits
2. Implement rate limiting in application
3. Use fallback providers for high volume

### Circuit Breaker Open

**Symptoms:** All requests to provider fail immediately

**Solutions:**

1. Check provider health status
2. Verify credentials are valid
3. Check for rate limiting
4. Wait for recovery timeout (60 seconds)
5. Manually reset circuit breaker if needed

### High Failure Rate

**Symptoms:** Success rate < 80%

**Solutions:**

1. Check provider status page
2. Verify credentials
3. Check rate limits
4. Review error logs
5. Consider using fallback provider

### Email Not Received

**Solutions:**

1. Check suppression list (bounces/complaints)
2. Verify email address is valid
3. Check spam folder
4. Review provider delivery logs
5. Test with different email provider

---

## ✅ Best Practices

### Email Best Practices

1. **Always use ZeptoMail as primary** - Best for transactional emails
2. **Configure fallback providers** - AWS SES and SMTP
3. **Monitor health metrics** - Check success rates regularly
4. **Set appropriate timeouts** - Based on operation type
5. **Handle retryable vs non-retryable errors** - Appropriately
6. **Use suppression lists** - Prevent sending to invalid addresses
7. **Monitor rate limits** - Prevent quota exhaustion
8. **Test fallback mechanisms** - Regularly

### Security Best Practices

1. **Never commit credentials** - Use environment variables
2. **Encrypt credentials** - System automatically encrypts before storing
3. **Rotate tokens/passwords** - Regularly
4. **Enable IP restrictions** - In ZeptoMail for production
5. **Monitor email sending** - For unusual activity
6. **Use HTTPS only** - For webhook endpoints
7. **Verify signatures** - For webhook messages

### Performance Best Practices

1. **Use caching** - Suppression lists, health checks
2. **Batch operations** - When possible
3. **Implement connection pooling** - For SMTP
4. **Monitor latency** - Track response times
5. **Optimize retry logic** - Exponential backoff
6. **Use async operations** - Don't block main thread

---

## ✅ Integration Checklist

### ✅ Core Services

- [x] CommunicationService implemented and exported
- [x] NotificationEventListener registered and active
- [x] All channel services (Email, WhatsApp, Push, Socket) implemented
- [x] Provider adapters (ZeptoMail, AWS SES, Meta WhatsApp, etc.) implemented
- [x] Multi-tenant routing via clinicId
- [x] Provider fallback mechanism

### ✅ Service Integration

- [x] AuthService uses EmailService with clinicId
- [x] AppointmentNotificationService uses all channels
- [x] CommunicationController properly implemented (all endpoints)
- [x] All services pass clinicId for multi-tenant routing
- [x] Legacy NotificationController removed

### ✅ Event-Driven Integration

- [x] NotificationEventListener listens to events
- [x] Event patterns properly matched
- [x] CommunicationService called from listeners
- [x] Recipients extracted from event payloads

### ✅ Multi-Tenant Support

- [x] clinicId passed through all communication calls
- [x] ProviderFactory routes to clinic-specific adapters
- [x] CommunicationConfigService loads clinic credentials
- [x] Environment variable fallback working

### ✅ Category-Based Routing

- [x] All 10 categories configured
- [x] Channel selection based on category
- [x] Strategy (IMMEDIATE/SCHEDULED/QUEUED) implemented
- [x] Priority levels respected
- [x] Rate limiting applied

### ✅ User Preferences

- [x] Preferences loaded from database/cache
- [x] Channels filtered by preferences
- [x] SMS opt-in logic implemented
- [x] Quiet hours respected

### ✅ Health & Metrics

- [x] Health monitoring active
- [x] Metrics tracked correctly
- [x] Health endpoints implemented
- [x] Enhanced analytics implemented
- [x] Dashboard implemented
- [x] Alerting system implemented

### ✅ Error Handling

- [x] Errors logged properly
- [x] Fallback providers used
- [x] Retry logic implemented
- [x] Graceful degradation

---

## ⚠️ Known Issues & Limitations

### ⚠️ SMS Channel

- **Status:** Configuration ready, adapters pending
- **Impact:** SMS cannot be sent yet, but configuration is ready
- **Workaround:** Use WhatsApp or Email for SMS-like notifications

### ✅ Legacy Endpoints - REMOVED

- **Status:** ✅ All deprecated endpoints removed
- **Impact:** All `/notifications/*` endpoints are no longer available
- **Action Required:** Use `/communication/*` endpoints only

---

## 📝 Legacy Endpoints Migration

**Status:** ✅ **COMPLETED** - All deprecated endpoints removed

**Migration Summary:**

- ✅ All deprecated `/notifications/*` endpoints removed
- ✅ `NotificationController` deleted
- ✅ All clients must use `/communication/*` endpoints
- ✅ Migration complete - no legacy endpoints available

**Endpoint Mappings:** | Legacy Endpoint | New Endpoint | Notes |
|----------------|--------------|-------| | `POST /notifications/push` |
`POST /communication/push` | Send push notification | |
`POST /notifications/email` | `POST /communication/email` | Send email | |
`POST /notifications/send` | `POST /communication/send` | Unified send endpoint
| | `GET /notifications/stats` | `GET /communication/stats` | Statistics | |
`GET /notifications/health` | `GET /communication/health` | Health status |

**Migration Benefits:**

- ✅ Unified API with category-based routing
- ✅ Better error handling and retry logic
- ✅ Enhanced monitoring and metrics
- ✅ Multi-tenant support
- ✅ Rate limiting and user preferences
- ✅ Provider fallback mechanism

---

## 📚 Related Documentation

- [Email Integration Guide](./EMAIL_INTEGRATION_GUIDE.md) - Email system details
- [Superadmin Clinic Management](./SUPERADMIN_CLINIC_MANAGEMENT.md) - Clinic
  configuration
- [AWS SES Complete Guide](./AWS_SES_COMPLETE_GUIDE.md) - AWS SES setup
- [FCM Integration Guide](./FCM_INTEGRATION_GUIDE.md) - Push notifications

---

## 🎯 Quick Reference

### Default Configuration

```typescript
{
  email: {
    primary: {
      provider: "zeptomail",  // ✅ Primary
      enabled: true
    },
    fallback: [
      { provider: "aws_ses" },  // Fallback 1
      { provider: "smtp" }      // Fallback 2
    ]
  }
}
```

### API Endpoints Summary

- `GET /api/v1/email/status` - Email service status
- `POST /api/v1/email/test-custom` - Test email
- `POST /api/v1/communication/email` - Send email via communication service
- `POST /api/v1/clinics/{clinicId}/communication/test-email` - Test clinic email
- `GET /api/v1/clinics/{clinicId}/communication/config` - Get clinic config
- `PUT /api/v1/clinics/{clinicId}/communication/config` - Update clinic config
- `GET /api/v1/communication/health` - Health status
- `GET /api/v1/communication/analytics` - Enhanced analytics
- `GET /api/v1/communication/dashboard` - Health dashboard
- `GET /api/v1/communication/alerts` - Active alerts

---

## 📊 Summary

✅ **Communication System:** Fully integrated and production-ready  
✅ **Notification System:** Fully integrated with event-driven architecture  
✅ **Multi-Tenant Support:** Complete across all channels  
✅ **Service Integration:** All services properly using CommunicationService  
✅ **Event Listeners:** Active and processing events correctly  
✅ **Health Monitoring:** Active and providing accurate metrics  
✅ **Legacy Endpoints:** Removed - use `/communication/*` only

**Overall Status:** ✅ **PRODUCTION READY**

The communication and notification systems are fully implemented, integrated,
and ready for production use. All channels (Email, WhatsApp, Push, Socket) are
working correctly with multi-tenant support. All deprecated endpoints have been
removed - use `/communication/*` endpoints only. The only pending item is SMS
adapter implementation, but the configuration system is ready.

**Last Updated:** January 2025  
**Primary Email Provider:** ✅ **ZeptoMail** (Configured)
