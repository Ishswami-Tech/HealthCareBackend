# Notification Service

**Purpose:** REST API for notifications (⚠️ Deprecated - use CommunicationModule)
**Location:** `src/services/notification`
**Status:** ⚠️ **DEPRECATED** - Migrate to CommunicationModule

---

## ⚠️ Deprecation Notice

This service is **deprecated** and will be removed in a future release.

**Please use `CommunicationModule` instead:**
- Location: `src/libs/communication`
- Documentation: [Communication Module README](../../libs/communication/README.md)

All endpoints return `X-Deprecated` header with migration instructions.

---

## Migration Guide

### Old (Notification Service)
```typescript
import { NotificationService } from '@services/notification';

await this.notificationService.sendPush({ ... });
```

### New (Communication Module)
```typescript
import { CommunicationService } from '@libs/communication';

await this.communicationService.send({
  category: CommunicationCategory.APPOINTMENT,
  channels: ['push'],
  recipients: [{ userId: 'user123' }],
  content: { ... },
});
```

---

## Related Documentation

- [Communication Module](../../libs/communication/README.md)
- [Multi-Tenant Communication](../../docs/features/MULTI_TENANT_COMMUNICATION.md)
- [Notification System Implementation](../../docs/features/NOTIFICATION_SYSTEM_IMPLEMENTATION.md)

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
