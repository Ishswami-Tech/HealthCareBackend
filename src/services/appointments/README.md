# Appointments Service

**Purpose:** Appointment scheduling with extensible plugin architecture
**Location:** `src/services/appointments` **Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { AppointmentsService } from '@services/appointments';

@Injectable()
export class MyService {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  async scheduleAppointment() {
    const appointment = await this.appointmentsService.create({
      patientId: 'patient-123',
      doctorId: 'doctor-456',
      clinicId: 'clinic-789',
      scheduledAt: new Date('2025-12-20T10:00:00Z'),
      type: 'CONSULTATION',
      duration: 30,
    });
    return appointment;
  }
}
```

---

## Key Features

- ✅ **Plugin Architecture** - 14 specialized plugins for extensibility
- ✅ **Queue Management** - Clinic queue optimization
- ✅ **Recurring Appointments** - Support for recurring patterns
- ✅ **Video Integration** - Telemedicine consultation support
- ✅ **Payment Processing** - Integrated payment flows
- ✅ **Multi-Channel Notifications** - Email, WhatsApp, Push, Socket
- ✅ **Analytics** - Appointment analytics and reporting
- ✅ **Compliance** - Regulatory compliance checks
- ✅ **Conflict Resolution** - Automatic schedule conflict detection

---

## Available Plugins (14)

1. **NotificationPlugin** - Send appointment notifications (Email, WhatsApp,
   Push, Socket)
2. **ReminderPlugin** - Automated appointment reminders
3. **QueueManagementPlugin** - Clinic queue optimization
4. **PaymentPlugin** - Payment processing integration
5. **VideoConsultationPlugin** - Telemedicine integration
6. **CheckInPlugin** - Patient check-in workflow
7. **WaitlistPlugin** - Waitlist management
8. **TherapySchedulingPlugin** - Therapy session scheduling
9. **FollowUpPlugin** - Automated follow-up scheduling
10. **RecurringAppointmentPlugin** - Recurring appointment patterns
11. **BulkOperationsPlugin** - Batch appointment operations
12. **AnalyticsPlugin** - Appointment analytics
13. **CompliancePlugin** - Regulatory compliance checks
14. **ConflictResolutionPlugin** - Schedule conflict resolution

---

## API Endpoints

| Endpoint                                    | Method   | Role                      | Description            |
| ------------------------------------------- | -------- | ------------------------- | ---------------------- |
| `/api/v1/appointments/plugins/info`         | GET      | SUPER_ADMIN, CLINIC_ADMIN | Get plugin information |
| `/api/v1/appointments/plugins/execute`      | POST     | SUPER_ADMIN, CLINIC_ADMIN | Execute plugin         |
| `/api/v1/appointments/plugins/config/:name` | GET/POST | SUPER_ADMIN, CLINIC_ADMIN | Plugin configuration   |

[Full API documentation](../../docs/api/README.md)
[API Integration Analysis](../../docs/API_INTEGRATION_ANALYSIS.md)

---

## Usage Examples

### Example 1: Create Appointment with Plugins

```typescript
import { AppointmentsService, PluginManager } from '@services/appointments';

async createAppointmentWithNotification() {
  // Create appointment
  const appointment = await this.appointmentsService.create({
    patientId: 'patient-123',
    doctorId: 'doctor-456',
    scheduledAt: new Date('2025-12-20T10:00:00Z'),
    type: 'CONSULTATION',
  });

  // Plugins automatically execute (notification, queue, etc.)
  // via lifecycle hooks
}
```

### Example 2: Schedule Recurring Appointment

```typescript
async scheduleRecurring() {
  const appointment = await this.appointmentsService.create({
    patientId: 'patient-123',
    doctorId: 'doctor-456',
    scheduledAt: new Date('2025-12-20T10:00:00Z'),
    type: 'THERAPY',
    duration: 60,
    recurringPattern: {
      frequency: 'weekly',
      interval: 1,
      daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
      endDate: new Date('2026-03-20'),
    },
  });
}
```

---

## Testing

```bash
# Run appointment service tests
pnpm test appointments

# Run plugin tests
pnpm test appointments/plugins
```

---

## Related Documentation

- [Appointments Feature Guide](../../docs/features/APPOINTMENTS_COMPLETE.md)
- [Queue Integration Guide](../../docs/features/QUEUE_INTEGRATION_IMPLEMENTATION_GUIDE.md)
- [Subscription Appointments](../../docs/features/SUBSCRIPTION_APPOINTMENTS.md)
- [API Integration Analysis](../../docs/API_INTEGRATION_ANALYSIS.md)

---

## Troubleshooting

**Issue 1: Plugin Not Executing**

- **Cause:** Plugin not registered in PluginRegistry
- **Solution:** Ensure plugin is added to `plugins/` folder and imported in
  module

**Issue 2: Queue Conflicts**

- **Cause:** Multiple appointments scheduled at same time
- **Solution:** Enable ConflictResolutionPlugin to automatically detect and
  prevent conflicts

**Issue 3: Notifications Not Sent**

- **Cause:** NotificationPlugin configuration missing
- **Solution:** Configure notification channels in plugin config

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
