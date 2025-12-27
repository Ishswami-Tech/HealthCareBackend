# Communication Module

**Purpose:** Multi-channel communication orchestration with smart routing
**Location:** `src/libs/communication`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { CommunicationService } from '@communication';
import { CommunicationCategory, CommunicationPriority } from '@types';

@Injectable()
export class MyService {
  constructor(private readonly communicationService: CommunicationService) {}

  async sendNotification(userId: string, email: string) {
    return await this.communicationService.send({
      category: CommunicationCategory.APPOINTMENT,
      priority: CommunicationPriority.HIGH,
      title: 'Appointment Reminder',
      body: 'Your appointment is scheduled for tomorrow at 10:00 AM',
      recipients: [{ userId, email }],
      channels: ['email', 'push', 'socket'], // Optional - auto-selected if not specified
    });
  }
}
```

---

## Key Features

- ✅ **5 Communication Channels** - Email, WhatsApp, Push, Socket, SMS
- ✅ **Smart Channel Selection** - Category-based routing (10 categories)
- ✅ **Multi-Tenant Support** - Provider routing via clinicId
- ✅ **Provider Adapters** - SMTP, SES, SendGrid, Meta WhatsApp, Twilio
- ✅ **User Preferences** - Channel preferences, quiet hours, category control
- ✅ **Rate Limiting** - Configurable per category (10 msgs/60s for login)
- ✅ **Delivery Tracking** - Database tracking with delivery logs
- ✅ **Metrics** - Success/failure rates per channel
- ✅ **Health Monitoring** - Real-time channel health status

---

## Communication Channels (5)

1. **Email** - SMTP, SES, SendGrid adapters with template support
2. **WhatsApp** - Meta Business API, Twilio adapters
3. **Push Notifications** - Firebase (FCM) primary, SNS fallback
4. **Socket (WebSocket)** - Real-time via Socket.IO
5. **SMS** - Planned (not yet implemented)

---

## Communication Categories (10)

Category-based channel routing with smart defaults:

| Category | Default Channels | Strategy | Priority | Rate Limit |
|----------|------------------|----------|----------|------------|
| **LOGIN** | socket | immediate | low | 10/60s |
| **EHR_RECORD** | socket, push, email | immediate | high | - |
| **APPOINTMENT** | socket, push, email | immediate | high | - |
| **REMINDER** | push, email | scheduled | normal | - |
| **BILLING** | push, email | queued | normal | - |
| **CRITICAL** | all channels + fallback | immediate | critical | - |
| **SYSTEM** | socket, email | queued | normal | - |
| **USER_ACTIVITY** | socket | immediate | low | - |
| **PRESCRIPTION** | push, email | immediate | high | - |
| **CHAT** | socket | immediate | normal | - |

---

## Usage Examples

### Basic Notification

```typescript
// Send with auto-selected channels based on category
await this.communicationService.send({
  category: CommunicationCategory.APPOINTMENT,
  priority: CommunicationPriority.HIGH,
  title: 'Appointment Scheduled',
  body: 'Your appointment is confirmed for tomorrow at 10:00 AM',
  recipients: [
    { userId: 'user123', email: 'patient@example.com' }
  ],
});
```

### Multi-Channel with Explicit Channels

```typescript
// Specify exact channels
await this.communicationService.send({
  category: CommunicationCategory.CRITICAL,
  priority: CommunicationPriority.CRITICAL,
  title: 'URGENT: Critical Alert',
  body: 'Your immediate attention is required',
  recipients: [
    {
      userId: 'user123',
      email: 'patient@example.com',
      phoneNumber: '+1234567890',
      deviceToken: 'fcm-token-here'
    }
  ],
  channels: ['socket', 'push', 'email', 'whatsapp'], // Explicit
});
```

### Multi-Tenant Communication

```typescript
// Multi-tenant with clinicId for provider routing
await this.communicationService.send({
  category: CommunicationCategory.BILLING,
  title: 'Invoice Ready',
  body: 'Your invoice is ready for download',
  recipients: [{ userId: 'user123', email: 'patient@example.com' }],
  metadata: {
    clinicId: 'clinic-abc-123', // Routes to clinic-specific providers
  },
});
```

### Respect User Preferences

```typescript
// User preferences: quiet hours, disabled channels
await this.communicationService.send({
  category: CommunicationCategory.REMINDER,
  title: 'Medication Reminder',
  body: 'Time to take your medication',
  recipients: [{ userId: 'user123', email: 'patient@example.com' }],
  respectPreferences: true, // Default: true
  applyRateLimit: true,     // Default: true
});
```

### Disable Rate Limiting

```typescript
// Critical messages bypass rate limits
await this.communicationService.send({
  category: CommunicationCategory.CRITICAL,
  title: 'Emergency Alert',
  body: 'Emergency notification',
  recipients: [{ userId: 'user123' }],
  applyRateLimit: false, // Bypass rate limiting
});
```

### Get Metrics

```typescript
// Communication metrics
const metrics = this.communicationService.getMetrics();
console.log(metrics);
// {
//   totalRequests: 1000,
//   successfulRequests: 950,
//   failedRequests: 50,
//   channelMetrics: {
//     socket: { sent: 500, successful: 490, failed: 10 },
//     push: { sent: 300, successful: 280, failed: 20 },
//     email: { sent: 200, successful: 180, failed: 20 },
//     ...
//   }
// }
```

---

## User Preferences

Users can control notification behavior:

```typescript
// User preferences control which channels receive notifications
interface UserCommunicationPreferences {
  userId: string;
  enabledChannels: CommunicationChannel[];  // ['email', 'push']
  disabledChannels: CommunicationChannel[]; // ['sms', 'whatsapp']
  quietHours?: {
    start: string;    // '22:00'
    end: string;      // '08:00'
    timezone: string; // 'America/New_York'
  };
  categoryPreferences?: {
    appointment?: CommunicationChannel[];
    billing?: CommunicationChannel[];
    // ...
  };
}
```

**Preference Hierarchy:**
1. Required channels (CRITICAL category) always sent
2. Quiet hours honored for non-critical messages
3. Category-specific preferences override defaults
4. Disabled channels filtered out
5. Rate limits applied per recipient

---

## Multi-Tenant Provider Configuration

Each clinic can configure their own providers:

```typescript
// Clinic-specific email provider
await this.emailService.sendSimpleEmail(
  {
    to: 'patient@example.com',
    subject: 'Appointment Reminder',
    body: '<p>Your appointment...</p>',
    isHtml: true,
  },
  'clinic-abc-123' // clinicId routes to clinic's configured provider
);

// Clinic-specific WhatsApp provider
await this.whatsAppService.sendCustomMessage(
  '+1234567890',
  'Your appointment is confirmed',
  'clinic-abc-123' // Uses clinic's WhatsApp Business account
);
```

**Supported Providers:**
- **Email:** SMTP, Mailtrap (dev), AWS SES, SendGrid
- **WhatsApp:** Meta Business API, Twilio WhatsApp
- **Push:** Firebase Cloud Messaging (FCM), AWS SNS (fallback)

---

## Delivery Tracking

All communications are tracked in the database:

```typescript
// Automatic delivery tracking
const result = await this.communicationService.send({...});

// Database records created:
// 1. Notification record (notificationId)
// 2. NotificationDeliveryLog for each channel attempt
//    - status: SENT | FAILED
//    - sentAt, deliveredAt, failedAt
//    - providerResponse, retryCount

// Result structure
interface CommunicationDeliveryResult {
  success: boolean;
  requestId: string;
  results: ChannelDeliveryResult[];
  timestamp: Date;
  metadata?: {
    category: CommunicationCategory;
    channelsUsed: CommunicationChannel[];
    recipientCount: number;
    rateLimited?: boolean;
  };
}
```

---

## Health Monitoring

```typescript
// Health check
const isHealthy = await this.communicationService.healthCheck();

// Detailed health status
const [healthy, latency] = await this.communicationService.getHealthStatus();

// Uses CommunicationHealthMonitorService internally
// Checks: Socket, Email, Push, WhatsApp provider health
```

---

## Event Integration

Automatic event emission for all communications:

```typescript
// Event emitted after send()
{
  eventType: 'communication.sent',
  category: EventCategory.SYSTEM,
  priority: EventPriority.HIGH,
  payload: {
    category: CommunicationCategory.APPOINTMENT,
    success: true,
    channels: ['socket', 'push', 'email'],
    recipientCount: 1,
    results: [
      { channel: 'socket', success: true, messageId: 'socket:user:123:1234567890' },
      { channel: 'push', success: true, messageId: 'fcm:abc123' },
      { channel: 'email', success: true, messageId: 'ses:xyz789' }
    ]
  }
}
```

---

## Rate Limiting

Prevent spam with configurable rate limits:

```typescript
// Category-specific rate limits (defined in categoryConfig)
{
  category: CommunicationCategory.LOGIN,
  rateLimit: {
    limit: 10,         // 10 messages
    windowSeconds: 60  // per 60 seconds
  }
}

// Rate limit key format: communication:rate_limit:{category}:{recipientId}
// Uses CacheService.isRateLimited() for distributed rate limiting
```

---

## Configuration

Environment variables:

```env
# Email providers (tenant-specific)
EMAIL_PROVIDER=ses           # smtp | ses | sendgrid | mailtrap
SMTP_HOST=smtp.example.com
SMTP_PORT=587
AWS_SES_REGION=us-east-1

# WhatsApp providers (tenant-specific)
WHATSAPP_PROVIDER=meta       # meta | twilio
META_WHATSAPP_TOKEN=...
META_WHATSAPP_PHONE_ID=...

# Push notifications
FCM_PROJECT_ID=...
FCM_CREDENTIALS_PATH=...
AWS_SNS_REGION=us-east-1     # Fallback

# Socket.IO (WebSocket)
SOCKET_IO_CORS_ORIGIN=*
SOCKET_IO_PATH=/socket.io
```

---

## Troubleshooting

**Issue: Messages not being delivered**
```typescript
// 1. Check user preferences
const prefs = await this.databaseService.findNotificationPreferenceByUserIdSafe(userId);

// 2. Check channel health
const [healthy, latency] = await this.communicationService.getHealthStatus();

// 3. Check metrics
const metrics = this.communicationService.getMetrics();

// 4. Check delivery logs
const logs = await this.databaseService.executeRead(async (client) => {
  return await client.notificationDeliveryLog.findMany({
    where: { notificationId },
    orderBy: { sentAt: 'desc' }
  });
});
```

**Issue: Rate limiting blocking messages**
```typescript
// Option 1: Disable rate limiting for critical messages
await this.communicationService.send({
  category: CommunicationCategory.CRITICAL,
  applyRateLimit: false,
  ...
});

// Option 2: Check rate limit status
const key = `communication:rate_limit:${category}:${recipientId}`;
const isLimited = await this.cacheService.isRateLimited(key, 10, 60);
```

**Issue: Multi-tenant provider not routing correctly**
```typescript
// Ensure clinicId is passed in metadata
await this.communicationService.send({
  metadata: {
    clinicId: 'clinic-abc-123', // REQUIRED for tenant-specific routing
  },
  ...
});

// Check clinic's configured providers
const config = await this.communicationConfigService.getClinicConfig(clinicId);
```

---

## Architecture

```
CommunicationService (orchestrator)
├── Channel Services
│   ├── EmailService (SMTP/SES/SendGrid adapters)
│   ├── WhatsAppService (Meta/Twilio adapters)
│   ├── PushNotificationService (FCM + SNS fallback)
│   ├── SocketService (Socket.IO)
│   └── SMS (planned)
├── Provider Adapters
│   ├── Email: SES, SendGrid, SMTP
│   └── WhatsApp: Meta Business, Twilio
├── Support Services
│   ├── EventService (event emission)
│   ├── DatabaseService (delivery tracking)
│   ├── CacheService (rate limiting, preferences)
│   └── LoggingService (audit logs)
└── Health Monitor
    └── CommunicationHealthMonitorService
```

**Flow:**
1. `send()` called with CommunicationRequest
2. Determine channels (category config or explicit)
3. Apply rate limiting (if enabled)
4. Fetch user preferences (quiet hours, disabled channels)
5. Filter channels by preferences
6. Create notification records in database
7. Send to each channel in parallel
8. Track delivery status in NotificationDeliveryLog
9. Update metrics
10. Emit communication.sent event

---

---

## WhatsApp & Multi-Tenant Implementation

### Overview

The communication system is fully integrated with WhatsApp as a primary channel alongside Email, with complete multi-tenant support. Each clinic can configure its own WhatsApp provider (Meta Business API or Twilio) with clinic-specific templates and dynamic clinic names.

### Channel Priority Configuration

**Primary Channels (Always Sent):**
- **Email** - Primary communication channel
- **WhatsApp** - Primary communication channel
- **Push Notifications** - In-house channel (FCM primary, SNS fallback)
- **Socket (WebSocket)** - In-house real-time channel

**Secondary Channel (Opt-in Only):**
- **SMS** - Only sent when user explicitly enables it (`smsEnabled: true`)

### Category Channel Mapping

| Category | Default Channels | Notes |
|----------|------------------|-------|
| **LOGIN** | `email`, `whatsapp` | Auth: Only email + WhatsApp (no push/socket for security) |
| **EHR_RECORD** | `socket`, `push`, `email`, `whatsapp` | Required: socket |
| **APPOINTMENT** | `socket`, `push`, `email`, `whatsapp` | All primary channels |
| **REMINDER** | `push`, `email`, `whatsapp`, `socket` | Scheduled delivery |
| **BILLING** | `push`, `email`, `whatsapp`, `socket` | Queued delivery |
| **CRITICAL** | `socket`, `push`, `email`, `whatsapp` | Required: socket, push. Fallback: SMS (if enabled) |
| **SYSTEM** | `socket`, `email`, `whatsapp` | System notifications |
| **USER_ACTIVITY** | `socket`, `email`, `whatsapp` | User activity tracking |
| **PRESCRIPTION** | `push`, `email`, `whatsapp`, `socket` | Prescription ready notifications |
| **CHAT** | `socket`, `email`, `whatsapp` | Chat notifications |

### Multi-Tenant WhatsApp Features

#### 1. Clinic-Specific Templates

Each clinic can configure its own WhatsApp template IDs:

```typescript
// Clinic configuration
{
  clinicId: "clinic-abc-123",
  whatsapp: {
    primary: {
      provider: "meta",
      templates: {
        otp: "clinic_otp_template_id",
        appointment: "clinic_appointment_template_id",
        reminder: "clinic_reminder_template_id",
        prescription: "clinic_prescription_template_id"
      }
    }
  }
}
```

#### 2. Dynamic Clinic Names

Clinic names are dynamically injected into all WhatsApp templates:

```typescript
// OTP Template Parameters
[
  { type: 'text', text: clinicName },  // "City Medical Center"
  { type: 'text', text: otp },          // "123456"
  { type: 'text', text: expiryMinutes } // "10"
]

// Appointment Template Parameters
[
  { type: 'text', text: clinicName },     // "City Medical Center"
  { type: 'text', text: patientName },    // "John Doe"
  { type: 'text', text: doctorName },     // "Dr. Smith"
  { type: 'text', text: appointmentDate }, // "2024-01-15"
  { type: 'text', text: appointmentTime }, // "10:00 AM"
  { type: 'text', text: location }        // "Main Clinic"
]
```

#### 3. Provider Routing

Each clinic can use its own WhatsApp provider:

```typescript
// Clinic uses Meta Business API
await whatsAppService.sendOTP(
  phoneNumber,
  otp,
  10, // expiry minutes
  2,  // max retries
  'clinic-abc-123' // Routes to clinic's Meta WhatsApp account
);

// Falls back to global provider if clinic provider fails
// Falls back to fallback provider if primary fails
```

### Recipient Enrichment

The system automatically enriches recipients with missing contact information:

```typescript
// Before enrichment
recipients: [
  { userId: 'user123' } // Only userId provided
]

// After enrichment (automatic)
recipients: [
  {
    userId: 'user123',
    email: 'patient@example.com',    // Fetched from database
    phoneNumber: '+1234567890'       // Fetched from database
  }
]
```

**Enrichment Process:**
1. Check if `email` or `phoneNumber` already provided
2. If missing and `userId` provided, fetch from database
3. Cache results to avoid repeated database queries
4. Gracefully skip channels if contact info unavailable

### Channel Validation

Channels are validated before sending to prevent errors:

```typescript
// Automatic validation
canSendChannel('email', recipient)      // Requires: recipient.email
canSendChannel('whatsapp', recipient)  // Requires: recipient.phoneNumber
canSendChannel('sms', recipient)        // Requires: recipient.phoneNumber
canSendChannel('push', recipient)      // Requires: recipient.deviceToken or userId
canSendChannel('socket', recipient)    // Requires: recipient.socketRoom or userId
```

**Behavior:**
- Missing contact info → Channel skipped (no error)
- Logged at DEBUG level with reason
- Other channels continue to send

### WhatsApp Integration Points

#### 1. OTP Authentication

```typescript
// AuthService.requestOtp() sends OTP via both channels
await authService.requestOtp({
  identifier: 'patient@example.com',
  clinicId: 'clinic-abc-123' // Optional, uses user's primary clinic if not provided
});

// Sends:
// 1. Email OTP (primary)
// 2. WhatsApp OTP (if phone number available)
```

#### 2. Appointment Notifications

```typescript
// Automatic WhatsApp notifications for:
// - Appointment created
// - Appointment updated
// - Appointment cancelled
// - Appointment rescheduled

// Uses clinic-specific templates with dynamic clinic names
```

#### 3. Appointment Reminders

```typescript
// Scheduled reminders include WhatsApp
// Channels: push, email, whatsapp, socket
// Uses clinic-specific reminder template
```

#### 4. Prescription Notifications

```typescript
// Prescription ready notifications via WhatsApp
await whatsAppService.sendPrescriptionNotification(
  phoneNumber,
  patientName,
  doctorName,
  medicationDetails,
  prescriptionUrl,
  clinicId // Uses clinic-specific template
);
```

### SMS Opt-in Mechanism

SMS is a **secondary channel** that requires explicit user opt-in:

```typescript
// User must enable SMS in preferences
{
  userId: 'user123',
  smsEnabled: true, // REQUIRED for SMS
  // ... other preferences
}

// SMS is filtered out if:
// 1. User hasn't enabled it (smsEnabled !== true)
// 2. No userId provided (can't check preference)
// 3. Category doesn't allow SMS (unless in fallbackChannels)
```

**SMS Usage:**
- Only sent when `smsEnabled: true` in user preferences
- Checked in `filterChannelsByPreferences()`
- Double-checked in `sendSMS()` for safety
- Used as fallback for CRITICAL category only

### Error Handling & Resilience

#### 1. Provider Fallback Chain

```typescript
// WhatsApp Provider Selection:
// 1. Try clinic-specific primary provider
// 2. If fails → Try clinic fallback providers
// 3. If all fail → Fall back to global provider
// 4. If global fails → Log error, return failure

// Email Provider Selection:
// Similar fallback chain with SMTP → SES → SendGrid
```

#### 2. Channel Failure Isolation

```typescript
// Each channel sends independently
// WhatsApp failure doesn't block Email
// Email failure doesn't block Push
// All failures logged, but other channels continue
```

#### 3. Retry Logic

```typescript
// WhatsApp OTP retry with exponential backoff
// Max retries: 2 (configurable)
// Backoff: 1s, 2s, 4s
// Rate limit errors: double delay
```

#### 4. Graceful Degradation

```typescript
// Missing clinic config → Uses default clinic name
// Missing template ID → Uses global template ID
// Missing phone number → Skips WhatsApp, sends Email
// Missing email → Skips Email, sends WhatsApp
// All channels fail → Returns failure, logs error
```

### Clinic Template Service

The `ClinicTemplateService` provides clinic-specific data:

```typescript
// Get complete clinic template data
const clinicData = await clinicTemplateService.getClinicTemplateData(clinicId);
// Returns:
// {
//   clinicId: "clinic-abc-123",
//   clinicName: "City Medical Center",
//   clinicLogo: "https://...",
//   clinicPhone: "+1234567890",
//   templateIds: {
//     otp: "clinic_otp_template",
//     appointment: "clinic_appointment_template",
//     reminder: "clinic_reminder_template",
//     prescription: "clinic_prescription_template"
//   }
// }

// Lightweight: Get clinic name only
const clinicName = await clinicTemplateService.getClinicName(clinicId);
// Returns: "City Medical Center" or "Healthcare Clinic" (fallback)
```

**Caching:**
- Clinic template data cached for 1 hour
- Cache key: `clinic_template_data:{clinicId}`
- Cache invalidation on clinic update

### Implementation Checklist

✅ **Multi-Tenant Support**
- Clinic-specific WhatsApp providers
- Clinic-specific template IDs
- Dynamic clinic names in templates
- Provider fallback chains

✅ **Channel Configuration**
- Email + WhatsApp as primary channels
- Push + Socket as in-house channels
- SMS as secondary (opt-in only)
- Category-based channel routing

✅ **Recipient Enrichment**
- Automatic phone number fetching
- Automatic email fetching
- Graceful handling of missing data

✅ **Channel Validation**
- Pre-send validation of required contact info
- Automatic channel skipping when data missing
- Comprehensive logging

✅ **WhatsApp Integration**
- OTP via WhatsApp
- Appointment notifications
- Appointment reminders
- Prescription notifications

✅ **Error Handling**
- Provider fallback chains
- Channel failure isolation
- Retry logic with exponential backoff
- Graceful degradation

✅ **User Preferences**
- SMS opt-in mechanism
- Preference checking before sending
- Category-specific preferences
- Quiet hours support

### Usage Examples

#### Send OTP with Multi-Tenant Support

```typescript
// AuthService automatically handles this
await authService.requestOtp({
  identifier: 'patient@example.com',
  clinicId: 'clinic-abc-123' // Optional
});

// Sends:
// 1. Email OTP with clinic-specific email provider
// 2. WhatsApp OTP with clinic-specific WhatsApp provider
//    - Uses clinic's OTP template ID
//    - Includes clinic name in template
```

#### Send Appointment Notification

```typescript
await communicationService.send({
  category: CommunicationCategory.APPOINTMENT,
  title: 'Appointment Scheduled',
  body: 'Your appointment is confirmed',
  recipients: [
    { userId: 'user123' } // Email & phone fetched automatically
  ],
  metadata: {
    clinicId: 'clinic-abc-123' // Routes to clinic providers
  }
});

// Sends via:
// - Socket (real-time)
// - Push (FCM)
// - Email (clinic's email provider)
// - WhatsApp (clinic's WhatsApp provider with clinic template)
```

#### Send SMS (Opt-in Only)

```typescript
// Only sent if user has smsEnabled: true
await communicationService.send({
  category: CommunicationCategory.CRITICAL,
  title: 'Critical Alert',
  body: 'Urgent notification',
  recipients: [
    { userId: 'user123' } // Must have smsEnabled: true
  ],
  channels: ['sms'] // Explicitly request SMS
});
```

### Troubleshooting

**Issue: WhatsApp messages not sending**
```typescript
// 1. Check clinic configuration
const config = await communicationConfigService.getClinicConfig(clinicId);
console.log(config.whatsapp);

// 2. Check provider health
const adapter = await providerFactory.getWhatsAppProviderWithFallback(clinicId);
const health = await adapter.getHealthStatus();

// 3. Check phone number format
// Must be E.164 format: +1234567890

// 4. Check template approval
// WhatsApp templates must be approved by Meta before use
```

**Issue: Clinic name not appearing in templates**
```typescript
// 1. Verify clinic exists
const clinic = await databaseService.findClinicByIdSafe(clinicId);

// 2. Check cache
const clinicData = await clinicTemplateService.getClinicTemplateData(clinicId);

// 3. Invalidate cache if needed
await clinicTemplateService.invalidateCache(clinicId);
```

**Issue: SMS not sending even when enabled**
```typescript
// 1. Verify user preference
const prefs = await databaseService.findNotificationPreferenceByUserIdSafe(userId);
console.log(prefs.smsEnabled); // Must be true

// 2. Check category allows SMS
// SMS only in fallbackChannels for CRITICAL category
// Or explicitly requested in channels array

// 3. Verify phone number
const user = await databaseService.findUserByIdSafe(userId);
console.log(user.phoneNumber); // Must be present
```

---

## Related Documentation

- [Event Integration](../../docs/architecture/EVENT_INTEGRATION.md)
- [Multi-Tenant Communication](../../docs/features/MULTI_TENANT_COMMUNICATION.md)
- [Notification System Implementation](../../docs/features/NOTIFICATION_SYSTEM_IMPLEMENTATION.md)
- [WhatsApp Integration](./channels/whatsapp/WHATSAPP_INTEGRATION.md)
- [Email Templates](./channels/email/)

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
