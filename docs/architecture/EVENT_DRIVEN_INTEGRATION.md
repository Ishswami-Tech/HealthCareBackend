# Event-Driven Integration Architecture

## Overview

This document describes the complete event-driven integration between the central event system, notifications, sockets, and messaging services.

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────┐
│              CENTRAL EVENT SYSTEM (Hub)                      │
│         @infrastructure/events/EventService                  │
└─────────────────────────────────────────────────────────────┘
                        │
                        │ Events emitted
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Socket     │ │ Notification │ │   Messaging  │
│   Listener   │ │   Listener   │ │   Listener   │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Socket.IO    │ │ Notification │ │ Email/Push/  │
│ Broadcast    │ │   Service    │ │ WhatsApp     │
└──────────────┘ └──────────────┘ └──────────────┘
```

## Folder Structure

```
src/
├── libs/
│   ├── infrastructure/
│   │   └── events/                    # ✅ CENTRAL EVENT SYSTEM
│   │       ├── event.service.ts       # Main event service
│   │       ├── events.module.ts
│   │       └── index.ts
│   │
│   └── communication/                 # ✅ COMMUNICATION LAYER
│       ├── messaging/                 # Multi-channel messaging
│       │   ├── email/
│       │   ├── push/
│       │   ├── whatsapp/
│       │   └── chat/
│       │
│       ├── socket/                    # WebSocket layer
│       │   ├── socket.service.ts
│       │   ├── event-socket.broadcaster.ts  # ✅ Already bridges events
│       │   └── app.gateway.ts
│       │
│       ├── notification/              # ✅ NOTIFICATION ORCHESTRATION
│       │   ├── notification.service.ts
│       │   ├── notification.module.ts
│       │   └── notification.controller.ts
│       │
│       ├── listeners/                 # 🆕 EVENT LISTENERS
│       │   ├── notification-event.listener.ts  # Events → Notifications
│       │   ├── listeners.module.ts
│       │   └── index.ts
│       │
│       ├── communication.module.ts
│       └── index.ts
```

## Integration Components

### 1. Central Event System
**Location:** `@infrastructure/events`

- **EventService**: Main event bus for all business events
- **EventsModule**: Module that provides EventService globally
- **Features**: Circuit breaker, caching, retry logic, HIPAA compliance

### 2. Notification Event Listener
**Location:** `@communication/listeners/notification-event.listener.ts`

- **Purpose**: Listens to business events and triggers notifications
- **Pattern**: Uses `@OnEvent('**')` to listen to all events
- **Rules**: Configurable notification rules for different event types
- **Integration**: Calls NotificationService to deliver notifications

### 3. Notification Service
**Location:** `@communication/notification/notification.service.ts`

- **Purpose**: Orchestrates multi-channel notification delivery
- **Channels**: Push (Firebase FCM), Email (AWS SES), SMS (future)
- **Features**: Fallback mechanisms, retry logic, metrics tracking
- **Integration**: Uses EventService to emit notification events

### 4. Socket Event Broadcaster
**Location:** `@communication/socket/event-socket.broadcaster.ts`

- **Purpose**: Bridges events to real-time WebSocket broadcasts
- **Pattern**: Listens to EventEmitter2 events
- **Features**: Room-based targeting, role-based filtering
- **Integration**: Automatically broadcasts events to connected clients

## Event Flow Example

### Scenario: Doctor creates a lab report

```
1. HTTP Request
   POST /api/ehr/lab-reports
   ↓
2. EHRService.createLabReport()
   ↓
3. Database: Insert lab report
   ↓
4. Event Emitted
   await this.eventService.emit('ehr.lab_report.created', {
     recordId: 'lab789',
     userId: 'patient123',
     clinicId: 'clinic456',
     doctorId: 'doctor321'
   })
   ↓
5. Event Distribution (Parallel)
   ├─→ NotificationEventListener
   │   ├─→ Matches rule: ehr.*.created
   │   ├─→ Determines recipients: Patient, Doctor
   │   ├─→ Calls NotificationService.sendUnifiedNotification()
   │   └─→ Delivers: Push + Email
   │
   ├─→ EventSocketBroadcaster
   │   ├─→ Determines rooms: user:patient123, clinic:clinic456
   │   └─→ Broadcasts via SocketService
   │
   └─→ Other listeners (Audit, Analytics, etc.)
   ↓
6. User Experience
   - Patient: Instant Socket.IO update + Push notification + Email
   - Doctor: Instant Socket.IO update + Push notification + Email
   - Clinic Staff: Socket.IO update (if subscribed)
```

## Notification Rules

The NotificationEventListener uses configurable rules to determine:
- **Which events** trigger notifications
- **Which channels** to use (push, email, SMS)
- **Who receives** the notification (user, clinic, role-based)
- **Priority** level (normal, high, critical)
- **Template** to use for notification content

### Current Rules

1. **EHR Events**: `ehr.*.created` → Push + Email to patient and clinic staff
2. **User Events**: `user.created` → Email welcome, `user.updated` → Push + Email
3. **Appointment Events**: `appointment.*` → Push + Email to patient and doctor
4. **Billing Events**: `billing.*` → Push + Email to user

## Module Integration

### AppModule
```typescript
@Module({
  imports: [
    EventsModule,        // ✅ Central event system
    SocketModule,        // WebSocket
    NotificationModule,  // Notification orchestration
    // ... other modules
  ],
})
```

### CommunicationModule
```typescript
@Module({
  imports: [
    EmailModule,
    WhatsAppModule,
    PushModule,
    SocketModule,
    NotificationModule,  // ✅ Notification orchestration
    ListenersModule,     // ✅ Event listeners
  ],
  exports: [
    // ... all modules
  ],
})
```

### NotificationModule
```typescript
@Module({
  imports: [
    EventsModule,        // ✅ Central event system
    EventEmitterModule,
    LoggingModule,
    EmailModule,
  ],
  providers: [
    NotificationService,
    // ... other services
  ],
})
```

### ListenersModule
```typescript
@Module({
  imports: [
    EventsModule,        // ✅ Central event system
    EventEmitterModule,
    LoggingModule,
    NotificationModule,  // ✅ Notification service
  ],
  providers: [
    NotificationEventListener,  // ✅ Event listener
  ],
})
```

## Usage Examples

### Emitting Events (Services)

```typescript
// In any service (ehr.service.ts, users.service.ts, etc.)
constructor(
  private readonly eventService: IEventService
) {}

async createLabReport(data: CreateLabReportDto) {
  const record = await this.databaseService.create(...);
  
  // Emit event - listeners will automatically react
  await this.eventService.emit('ehr.lab_report.created', {
    recordId: record.id,
    userId: data.userId,
    clinicId: data.clinicId,
    doctorId: data.doctorId,
  });
  
  return record;
}
```

### Adding New Notification Rules

```typescript
// In notification-event.listener.ts
private readonly notificationRules: NotificationRule[] = [
  // Add new rule
  {
    eventPattern: /^prescription\.created$/,
    channels: ['push', 'email'],
    priority: 'high',
    template: 'prescription_created',
    recipients: payload => {
      if (payload.userId) {
        return [{ userId: payload.userId }];
      }
      return [];
    },
    shouldNotify: () => true,
  },
];
```

## Benefits

1. **Decoupling**: Services don't know about listeners
2. **Scalability**: Add listeners without changing emitters
3. **Maintainability**: Clear separation of concerns
4. **Flexibility**: Easy to add new notification rules
5. **Reliability**: Central event system with circuit breakers
6. **Compliance**: Full audit trail via events

## Testing

### Testing Event Emission
```typescript
// Mock EventService
const mockEventService = {
  emit: jest.fn(),
};

// Test service emits event
await service.createLabReport(data);
expect(mockEventService.emit).toHaveBeenCalledWith(
  'ehr.lab_report.created',
  expect.objectContaining({ recordId: expect.any(String) })
);
```

### Testing Notification Listener
```typescript
// Mock NotificationService
const mockNotificationService = {
  sendUnifiedNotification: jest.fn(),
};

// Emit event and verify listener reacts
await eventService.emit('ehr.lab_report.created', payload);
expect(mockNotificationService.sendUnifiedNotification).toHaveBeenCalled();
```

## Future Enhancements

1. **Messaging Event Listener**: Trigger WhatsApp/Email from events
2. **Notification Preferences**: User-specific notification rules
3. **Scheduled Notifications**: Queue notifications for later delivery
4. **Notification Batching**: Batch multiple notifications
5. **Rich Notifications**: Add actions, images, deep links

## Summary

The event-driven integration provides:
- ✅ Central event system as single source of truth
- ✅ Automatic notification triggering from business events
- ✅ Real-time Socket.IO updates
- ✅ Multi-channel notification delivery
- ✅ Scalable and maintainable architecture
- ✅ Full compliance and audit trail

