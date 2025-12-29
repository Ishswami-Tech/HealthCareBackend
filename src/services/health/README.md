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

- ✅ **5 Health Indicators** - Database, Cache, Queue, Logging, Video
- ✅ **Metrics Collection** - CPU, memory, disk usage
- ✅ **Service Status** - Real-time service health
- ✅ **Public Endpoints** - For load balancers/monitoring
- ⚠️ **Note:** Communication and email health checks are clinic-specific and should be handled at the clinic level, not in system health checks

---

## Health Indicators (5)

1. **DatabaseHealthIndicator** - Database connection status
2. **CacheHealthIndicator** - Redis/cache health
3. **QueueHealthIndicator** - BullMQ queue status
4. **LoggingHealthIndicator** - Logging service health
5. **VideoHealthIndicator** - Video service health

**Note:** Communication and email health checks are removed from system health monitoring as they are clinic-specific configurations. Each clinic may have different communication service providers and configurations, so these should be monitored at the clinic level.

---

## API Endpoints

| Endpoint | Method | Role | Description |
|----------|--------|------|-------------|
| `/health` | GET | Public | Basic health check (HealthService-based, includes realtime status) |
| `/health?detailed=true` | GET | Public | Detailed health check with system metrics (HealthService-based, includes realtime status) |
| Socket.IO `/health` namespace | WebSocket | Public | Real-time health updates via push (recommended for dashboards) |

**Note:** All REST endpoints and Socket.IO realtime health monitoring use `HealthService` which internally uses Terminus for health checks. The `HealthService` is the single source of truth for health status throughout the application.

## Architecture

```
┌─────────────────────────────────────────┐
│         HealthController                │
│  (Uses HealthService)                   │
│  - GET /health                          │
│  - GET /health?detailed=true           │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         HealthService                    │
│  (Uses Terminus internally)              │
│  - getHealth() → includes realtime      │
│  - getDetailedHealth() → includes realtime│
└──────────────┬──────────────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌──────────────┐  ┌──────────────┐
│   Terminus   │  │ HealthCache  │
│   Health     │  │ Service      │
│   Indicators │  │ (Realtime)   │
└──────────────┘  └──────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│    RealtimeHealthGateway (Socket.IO)    │
│  (Uses HealthService via Aggregator)    │
│  - Socket.IO /health namespace         │
└─────────────────────────────────────────┘
```

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

- [Frontend Integration Guide](./FRONTEND_INTEGRATION.md) - Complete guide for integrating Socket.IO realtime health monitoring in frontend applications
- [System Architecture](../../docs/architecture/SYSTEM_ARCHITECTURE.md)

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
