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

## Related Documentation

- [Event Integration](../../docs/architecture/EVENT_INTEGRATION.md)
- [Multi-Tenant Communication](../../docs/features/MULTI_TENANT_COMMUNICATION.md)
- [Notification System Implementation](../../docs/features/NOTIFICATION_SYSTEM_IMPLEMENTATION.md)
- [WhatsApp Integration](./channels/whatsapp/WHATSAPP_INTEGRATION.md)
- [Email Templates](./channels/email/)

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
