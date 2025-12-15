# Event Service

**Purpose:** Central event hub for event-driven architecture
**Location:** `src/libs/infrastructure/events`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { EventService } from '@infrastructure/events';
import { EventCategory, EventPriority } from '@core/types';

@Injectable()
export class MyService {
  constructor(private readonly eventService: EventService) {}

  async example() {
    // Simple event emission
    await this.eventService.emit('user.created', { userId: 'user123' });

    // Enterprise event emission (recommended)
    await this.eventService.emitEnterprise('user.created', {
      eventId: `user-created-${Date.now()}`,
      eventType: 'user.created',
      category: EventCategory.USER_ACTIVITY,
      priority: EventPriority.HIGH,
      timestamp: new Date().toISOString(),
      source: 'UserService',
      version: '1.0.0',
      userId: 'user123',
      clinicId: 'clinic456',
      payload: { /* event data */ },
    });
  }
}
```

---

## Key Features

- ✅ **Single Source of Truth** - All events go through EventService
- ✅ **Circuit Breaker** - Resilience for event processing
- ✅ **Rate Limiting** - 1000 events/second per source
- ✅ **Event Buffering** - 50,000 events max
- ✅ **HIPAA Compliance** - PHI validation and audit
- ✅ **Performance Monitoring** - Event metrics and health checks
- ✅ **Wildcard Subscriptions** - Listen to all events with `onAny()`

---

## Event Flow

```
Service → EventService.emitEnterprise()
            ↓
       EventEmitter2.emit()
            ↓
       Event Listeners (@OnEvent)
            ↓
     NotificationEventListener, SocketBroadcaster, AuditListener, etc.
```

---

## Usage Examples

### Emitting Events

```typescript
// In any service
await this.eventService.emitEnterprise('appointment.created', {
  eventId: `appointment-${appointment.id}`,
  eventType: 'appointment.created',
  category: EventCategory.APPOINTMENT,
  priority: EventPriority.HIGH,
  timestamp: new Date().toISOString(),
  source: 'AppointmentService',
  version: '1.0.0',
  userId: appointment.userId,
  clinicId: appointment.clinicId,
  payload: { appointment },
});
```

### Listening to Events

```typescript
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class MyListener {
  @OnEvent('user.created')
  async handleUserCreated(payload: EnterpriseEventPayload) {
    // React to user created event
    console.log('User created:', payload.payload.user);
  }

  @OnEvent('**')  // Listen to ALL events
  async handleAllEvents(payload: any) {
    // React to any event
  }
}
```

---

## Event Categories

```typescript
enum EventCategory {
  USER_ACTIVITY = 'USER_ACTIVITY',
  APPOINTMENT = 'APPOINTMENT',
  EHR_RECORD = 'EHR_RECORD',
  BILLING = 'BILLING',
  PAYMENT = 'PAYMENT',
  COMMUNICATION = 'COMMUNICATION',
  SYSTEM = 'SYSTEM',
}
```

---

## Configuration

```env
# Event Service Configuration
EVENT_MAX_RATE=1000              # Events per second
EVENT_BUFFER_SIZE=50000
EVENT_CIRCUIT_BREAKER_THRESHOLD=100
EVENT_CIRCUIT_BREAKER_TIMEOUT=60000
```

---

## Related Documentation

- [Event-Driven Integration](../../../docs/architecture/EVENT_INTEGRATION.md)
- [Event Documentation](../../../docs/features/EVENT_DOCUMENTATION.md)
- [Complete Infrastructure Documentation](../../../INFRASTRUCTURE_DOCUMENTATION.md#events)

---

## Troubleshooting

**Issue 1: Events not received by listeners**
- Verify `@OnEvent()` decorator is used
- Check EventEmitterModule is imported in AppModule
- Ensure listener is provided in module

**Issue 2: Circuit breaker open**
- Check event emission rate
- Review `EVENT_CIRCUIT_BREAKER_THRESHOLD`

---

## Contributing

See main [README.md](../../../../README.md) for contribution guidelines.
