# Logging Service

**Purpose:** HIPAA-compliant structured logging with audit trails
**Location:** `src/libs/infrastructure/logging`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { LoggingService, LogType, LogLevel } from '@logging';

@Injectable()
export class MyService {
  constructor(private readonly logger: LoggingService) {}

  async example() {
    // Simple logging
    this.logger.info('User logged in', { userId: 'user123' });
    this.logger.error('Operation failed', { error: 'details' });

    // Typed logging
    await this.logger.log(
      LogType.AUDIT,
      LogLevel.INFO,
      'User action performed',
      'MyService',
      { userId: 'user123', action: 'UPDATE_PROFILE' }
    );
  }
}
```

---

## Key Features

- ✅ **HIPAA-Compliant** - PHI masking, audit trails, 30-day retention
- ✅ **Structured Logging** - JSON format with context
- ✅ **Multiple Log Types** - AUDIT, SECURITY, PERFORMANCE, PAYMENT, etc.
- ✅ **Log Levels** - DEBUG, INFO, WARN, ERROR, FATAL
- ✅ **Context Propagation** - Automatic request context injection
- ✅ **Health Monitoring** - Log volume tracking
- ✅ **Web Dashboard** - Real-time log viewing (⚠️ needs authentication)

---

## Log Types

```typescript
enum LogType {
  SYSTEM = 'SYSTEM',
  SECURITY = 'SECURITY',
  AUDIT = 'AUDIT',
  PERFORMANCE = 'PERFORMANCE',
  PAYMENT = 'PAYMENT',
  COMMUNICATION = 'COMMUNICATION',
  QUEUE = 'QUEUE',
  CACHE = 'CACHE',
  DATABASE = 'DATABASE',
  API = 'API',
}
```

---

## Usage Examples

### Example 1: Audit Logging

```typescript
await this.logger.log(
  LogType.AUDIT,
  LogLevel.INFO,
  'Patient record accessed',
  'EHRService',
  {
    userId: context.user.id,
    clinicId: context.clinicId,
    patientId: 'patient123',
    action: 'READ',
    timestamp: new Date().toISO

String(),
  }
);
```

### Example 2: Error Logging

```typescript
try {
  await this.performOperation();
} catch (error) {
  await this.logger.log(
    LogType.SYSTEM,
    LogLevel.ERROR,
    'Operation failed',
    'MyService',
    {
      error: error.message,
      stack: error.stack,
      context: { userId, clinicId },
    }
  );
  throw error;
}
```

### Example 3: Performance Logging

```typescript
const start = Date.now();
const result = await this.databaseService.query(/* ... */);
const duration = Date.now() - start;

if (duration > 1000) {  // Log slow queries
  await this.logger.log(
    LogType.PERFORMANCE,
    LogLevel.WARN,
    'Slow database query',
    'DatabaseService',
    { query, duration, threshold: 1000 }
  );
}
```

---

## Configuration

```env
# Logging Configuration
LOG_LEVEL=info                    # debug, info, warn, error, fatal
LOG_RETENTION_DAYS=30
LOG_PHI_MASKING=true
LOG_MAX_SIZE=100MB
```

[Full environment variables guide](../../../docs/ENVIRONMENT_VARIABLES.md)

---

## PHI Masking

The logging service automatically masks sensitive PHI data:

```typescript
// Input
this.logger.info('User data', {
  email: 'patient@example.com',
  ssn: '123-45-6789',
  phone: '555-1234',
});

// Logged as
{
  email: 'p******@example.com',
  ssn: '***-**-****',
  phone: '***-****',
}
```

---

## Related Documentation

- [Complete Infrastructure Documentation](../../../INFRASTRUCTURE_DOCUMENTATION.md#logging)
- [HIPAA Compliance](../../../docs/DEVELOPER_GUIDE.md#hipaa-compliance)

---

## Troubleshooting

**Issue 1: Logs not appearing**
- Check `LOG_LEVEL` setting
- Verify LoggingModule is imported

**Issue 2: Disk space issues**
- Adjust `LOG_RETENTION_DAYS`
- Implement log rotation

---

## Contributing

See main [README.md](../../../../README.md) for contribution guidelines.
