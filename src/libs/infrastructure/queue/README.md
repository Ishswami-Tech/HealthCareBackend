# Queue Service

**Purpose:** Background job processing with BullMQ (19 specialized queues)
**Location:** `src/libs/infrastructure/queue`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { QueueService } from '@queue';

@Injectable()
export class MyService {
  constructor(private readonly queueService: QueueService) {}

  async example() {
    // Add job to queue
    await this.queueService.addJob('email', {
      to: 'user@example.com',
      template: 'welcome',
      data: { name: 'John Doe' },
    });

    // Add job with options
    await this.queueService.addJob(
      'notification',
      { userId: 'user123', message: 'Hello!' },
      {
        delay: 5000,           // Delay 5 seconds
        priority: 1,           // High priority
        attempts: 3,           // Retry 3 times
        removeOnComplete: true,
      }
    );
  }
}
```

---

## Key Features

- ✅ **19 Specialized Queues** - appointment, email, notification, payment, etc.
- ✅ **Job Retry** - Automatic retry with exponential backoff
- ✅ **Job Priority** - High/normal/low priority jobs
- ✅ **Delayed Jobs** - Schedule jobs for future execution
- ✅ **Repeatable Jobs** - Cron-based recurring jobs
- ✅ **Rate Limiting** - Control job processing rate
- ✅ **Job Monitoring** - Real-time queue status and metrics
- ✅ **Health Checks** - Queue health monitoring

---

## Available Queues (19)

1. **appointment** - Appointment processing
2. **email** - Email sending
3. **notification** - Push notifications
4. **reminder** - Appointment reminders
5. **therapy** - Therapy session processing
6. **payment** - Payment processing
7. **analytics** - Analytics data processing
8. **followup** - Follow-up scheduling
9. **recurring** - Recurring appointments
10. **bulk** - Bulk operations
11. **compliance** - Compliance checks
12. **conflict-resolution** - Schedule conflict resolution
13. **clinic-queue** - Clinic queue management
14. **waitlist** - Waitlist management
15. **check-in** - Patient check-in
16. **video-consultation** - Video consultation processing
17. **lab** - Lab report processing
18. **prescription** - Prescription processing
19. **billing** - Billing operations

---

## Usage Examples

### Example 1: Send Email

```typescript
await this.queueService.addJob('email', {
  to: 'patient@example.com',
  subject: 'Appointment Confirmation',
  template: 'appointment_confirmation',
  data: {
    patientName: 'John Doe',
    appointmentDate: '2025-12-20',
    doctorName: 'Dr. Smith',
  },
});
```

### Example 2: Schedule Delayed Job

```typescript
// Send reminder 24 hours before appointment
await this.queueService.addJob(
  'reminder',
  { appointmentId: 'appt123' },
  { delay: 24 * 60 * 60 * 1000 }  // 24 hours
);
```

### Example 3: Repeatable Job (Cron)

```typescript
// Daily analytics at midnight
await this.queueService.addRepeatableJob(
  'analytics',
  { type: 'daily_report' },
  { pattern: '0 0 * * *' }  // Cron: Every day at midnight
);
```

---

## Configuration

```env
# Queue Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-password

# Queue Settings
QUEUE_DEFAULT_ATTEMPTS=3
QUEUE_DEFAULT_BACKOFF=exponential
QUEUE_RATE_LIMIT=100            # Jobs per minute
```

[Full environment variables guide](../../../docs/ENVIRONMENT_VARIABLES.md)

---

## Creating Workers

```typescript
import { Processor, Process } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

@Processor('email')
export class EmailWorker {
  @Process()
  async handleEmailJob(job: Job<{ to: string; subject: string; template: string; data: unknown }>) {
    const { to, subject, template, data } = job.data;

    // Send email
    await this.emailService.send({
      to,
      subject,
      template,
      data,
    });

    return { sent: true, messageId: 'msg123' };
  }

  @Process('bulk-send')
  async handleBulkEmail(job: Job<{ emails: string[]; template: string; data: unknown }>) {
    // Handle bulk email sending
  }
}
```

---

## Job Monitoring

```typescript
// Get queue statistics
const stats = await this.queueService.getQueueStats('email');
// Returns: {
//   waiting: 10,
//   active: 2,
//   completed: 1000,
//   failed: 5,
//   delayed: 3,
// }

// Get job status
const job = await this.queueService.getJob('email', 'job-id-123');
console.log(job.progress());  // 0-100
console.log(job.getState());  // 'waiting', 'active', 'completed', 'failed'
```

---

## Related Documentation

- [Queue Integration Guide](../../../docs/features/QUEUE_INTEGRATION_IMPLEMENTATION_GUIDE.md)
- [Complete Infrastructure Documentation](../../../INFRASTRUCTURE_DOCUMENTATION.md#queue)

---

## Troubleshooting

**Issue 1: Jobs stuck in waiting**
- Check Redis connection
- Verify workers are running
- Review rate limiting settings

**Issue 2: Jobs failing repeatedly**
- Check job data format
- Review error logs
- Adjust retry attempts

---

## Contributing

See main [README.md](../../../../README.md) for contribution guidelines.
