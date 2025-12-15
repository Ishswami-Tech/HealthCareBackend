# Health Service

**Purpose:** System health monitoring and diagnostics
**Location:** `src/services/health`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { HealthService } from '@services/health';

@Injectable()
export class MyService {
  constructor(private readonly healthService: HealthService) {}

  async checkHealth() {
    return await this.healthService.check();
  }
}
```

---

## Key Features

- ✅ **6 Health Indicators** - Database, Cache, Queue, Communication, Video, System
- ✅ **Metrics Collection** - CPU, memory, disk usage
- ✅ **Service Status** - Real-time service health
- ✅ **Public Endpoints** - For load balancers/monitoring

---

## Health Indicators (6)

1. **DatabaseHealthIndicator** - Database connection status
2. **CacheHealthIndicator** - Redis/cache health
3. **QueueHealthIndicator** - BullMQ queue status
4. **CommunicationHealthIndicator** - Communication channels health
5. **VideoHealthIndicator** - Video service health
6. **SystemHealthIndicator** - System resources (CPU, memory)

---

## API Endpoints

| Endpoint | Method | Role | Description |
|----------|--------|------|-------------|
| `/health` | GET | Public | Basic health check |
| `/health/detailed` | GET | Public | Detailed health indicators |

---

## Usage Examples

```typescript
// Basic health check
const health = await this.healthService.check();
// Returns: { status: 'ok', info: {}, error: {} }

// Detailed health check
const detailed = await this.healthService.checkDetailed();
// Returns: {
//   status: 'ok',
//   info: {
//     database: { status: 'up', ... },
//     cache: { status: 'up', ... },
//     ...
//   }
// }
```

---

## Related Documentation

- [System Architecture](../../docs/architecture/SYSTEM_ARCHITECTURE.md)

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
