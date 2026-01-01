# Frontend Integration Guide - Realtime Health Monitoring

**Purpose:** Integrate Socket.IO realtime health monitoring in frontend applications to eliminate polling and receive real-time health status updates.

**Location:** `src/services/health/realtime`

---

## 📋 Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Connection Setup](#connection-setup)
- [Event Listeners](#event-listeners)
- [Data Formats](#data-formats)
- [Complete Examples](#complete-examples)
- [Best Practices](#best-practices)
- [Fallback Strategy](#fallback-strategy)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

The realtime health monitoring system uses Socket.IO to push health status updates to frontend clients, eliminating the need for polling. This provides:

- ✅ **Real-time Updates** - Instant notifications when health status changes
- ✅ **No Polling** - Server pushes updates, reducing backend load
- ✅ **Efficient** - Incremental updates for individual services
- ✅ **Automatic** - Initial status sent on connection
- ✅ **Resilient** - Auto-reconnection on disconnect
- ✅ **Optimized** - Minimal payload size with shortened keys

---

## 🚀 Quick Start

### 1. Install Socket.IO Client

```bash
yarn add socket.io-client
# or
yarn add socket.io-client
```

### 2. Basic Connection

```typescript
import { io } from 'socket.io-client';

const healthSocket = io('http://your-backend-url/health', {
  transports: ['websocket', 'polling'],
  reconnection: true,
});

healthSocket.on('health:status', (data) => {
  console.log('Health status:', data);
});
```

---

## 🔌 Connection Setup

### Basic Configuration

```typescript
import { io, Socket } from 'socket.io-client';

const healthSocket = io('http://your-backend-url/health', {
  // Transport options
  transports: ['websocket', 'polling'], // Prefer websocket, fallback to polling
  
  // Reconnection settings
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
  
  // Timeout settings
  timeout: 20000,
  
  // Authentication (if required)
  auth: {
    token: 'your-auth-token'
  },
  
  // Additional options
  forceNew: false,
  multiplex: true
});
```

### Environment-Based Configuration

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8088';
const healthSocket = io(`${API_URL}/health`, {
  transports: ['websocket', 'polling'],
  reconnection: true,
});
```

---

## 📡 Event Listeners

### 1. `health:status` - Full Health Status

Sent on connection and periodically when status changes.

```typescript
healthSocket.on('health:status', (data: RealtimeHealthStatusPayload) => {
  // Update your health dashboard
  updateHealthDashboard(data);
});
```

**Data Format:**
```typescript
interface RealtimeHealthStatusPayload {
  t: string;                    // timestamp (ISO 8601)
  o: 'healthy' | 'degraded' | 'unhealthy';  // overall status
  s: {                          // services
    [serviceName: string]: {
      status: 'healthy' | 'degraded' | 'unhealthy';
      timestamp: string;
      responseTime?: number;
      error?: string;
      details?: Record<string, unknown>;
    };
  };
  e?: {                         // endpoints (only if changed)
    [endpointName: string]: {
      status: 'up' | 'down' | 'slow';
      responseTime: number;
      lastChecked: string;
      successRate: number;
    };
  };
  sys?: {                       // system metrics (only if threshold breached)
    cpu: number;                // CPU usage percentage
    memory: number;              // Memory usage percentage
    activeConnections: number;
    requestRate: number;
    errorRate: number;
  };
  u: number;                    // uptime in seconds
}
```

**Example:**
```typescript
{
  t: '2024-01-01T12:00:00.000Z',
  o: 'healthy',
  s: {
    database: {
      status: 'healthy',
      timestamp: '2024-01-01T12:00:00.000Z',
      responseTime: 45
    },
    cache: {
      status: 'healthy',
      timestamp: '2024-01-01T12:00:00.000Z',
      responseTime: 12
    },
    queue: {
      status: 'healthy',
      timestamp: '2024-01-01T12:00:00.000Z',
      responseTime: 8
    },
    logger: {
      status: 'healthy',
      timestamp: '2024-01-01T12:00:00.000Z',
      responseTime: 5
    },
    socket: {
      status: 'healthy',
      timestamp: '2024-01-01T12:00:00.000Z',
      responseTime: 2
    }
  },
  sys: {
    cpu: 45.2,
    memory: 62.8,
    activeConnections: 150,
    requestRate: 25.5,
    errorRate: 0.1
  },
  u: 86400
}
```

### 2. `health:service:update` - Incremental Updates

Sent when a specific service status changes (more efficient than full updates).

```typescript
healthSocket.on('health:service:update', (update: HealthUpdate) => {
  // Update specific service in your UI
  updateServiceStatus(update.id, update.st);
});
```

**Data Format:**
```typescript
interface HealthUpdate {
  t: string;                    // timestamp
  ty: 'service' | 'system';     // type
  id: string;                   // service ID (e.g., 'database', 'cache')
  st: 'healthy' | 'degraded' | 'unhealthy';  // status
  rt?: number;                  // response time (optional)
}
```

**Example:**
```typescript
{
  t: '2024-01-01T12:00:05.000Z',
  ty: 'service',
  id: 'database',
  st: 'unhealthy',
  rt: 5000
}
```

### 3. `health:heartbeat` - Keep-Alive Ping

Sent every 60 seconds to confirm connection is alive.

```typescript
healthSocket.on('health:heartbeat', (heartbeat: HealthHeartbeat) => {
  // Update last seen timestamp
  updateLastSeen(heartbeat.t);
});
```

**Data Format:**
```typescript
interface HealthHeartbeat {
  t: string;                    // timestamp
  o: 'healthy' | 'degraded' | 'unhealthy';  // overall status
}
```

**Example:**
```typescript
{
  t: '2024-01-01T12:01:00.000Z',
  o: 'healthy'
}
```

### 4. Connection Events

```typescript
// Connected
healthSocket.on('connect', () => {
  console.log('Connected to health monitoring');
  // Initial status will be sent automatically
});

// Disconnected
healthSocket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
  // Show offline status in UI
});

// Connection error
healthSocket.on('connect_error', (error) => {
  console.error('Connection error:', error);
  // Implement fallback strategy
});
```

---

## 📤 Sending Messages

### Subscribe (Optional)

Clients are automatically subscribed on connection, but you can explicitly subscribe:

```typescript
healthSocket.emit('health:subscribe', { room: 'health:all' }, (response) => {
  if (response.success) {
    console.log('Subscribed to health updates');
    if (response.status) {
      // Initial status received
      updateHealthDashboard(response.status);
    }
  }
});
```

**Response:**
```typescript
interface SubscribeResponse {
  success: boolean;
  message?: string;
  status?: RealtimeHealthStatus;
}
```

### Unsubscribe (Optional)

```typescript
healthSocket.emit('health:unsubscribe', (response) => {
  if (response.success) {
    console.log('Unsubscribed from health updates');
  }
});
```

---

## 💻 Complete Examples

### React Hook Example

```typescript
import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { RealtimeHealthStatusPayload } from '@core/types';

export function useHealthMonitoring() {
  const [healthStatus, setHealthStatus] = useState<RealtimeHealthStatusPayload | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8088';
    const healthSocket = io(`${API_URL}/health`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    // Connection events
    healthSocket.on('connect', () => {
      setIsConnected(true);
      console.log('Health monitoring connected');
    });

    healthSocket.on('disconnect', () => {
      setIsConnected(false);
      console.log('Health monitoring disconnected');
    });

    healthSocket.on('connect_error', (error) => {
      console.error('Health monitoring connection error:', error);
      setIsConnected(false);
    });

    // Health status events
    healthSocket.on('health:status', (data: RealtimeHealthStatusPayload) => {
      setHealthStatus(data);
      setLastUpdate(new Date());
    });

    healthSocket.on('health:service:update', (update) => {
      setHealthStatus(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          s: {
            ...prev.s,
            [update.id]: {
              status: update.st,
              timestamp: update.t,
              responseTime: update.rt
            }
          },
          t: update.t
        };
      });
      setLastUpdate(new Date());
    });

    healthSocket.on('health:heartbeat', (heartbeat) => {
      console.log('Heartbeat received:', heartbeat.o);
      setLastUpdate(new Date());
    });

    setSocket(healthSocket);

    return () => {
      healthSocket.disconnect();
    };
  }, []);

  const subscribe = useCallback(() => {
    if (socket) {
      socket.emit('health:subscribe', {}, (response) => {
        if (response.success && response.status) {
          setHealthStatus(response.status);
        }
      });
    }
  }, [socket]);

  const unsubscribe = useCallback(() => {
    if (socket) {
      socket.emit('health:unsubscribe', () => {});
    }
  }, [socket]);

  return {
    healthStatus,
    isConnected,
    lastUpdate,
    subscribe,
    unsubscribe,
  };
}
```

### React Component Example

```typescript
import React from 'react';
import { useHealthMonitoring } from './hooks/useHealthMonitoring';

export function HealthDashboard() {
  const { healthStatus, isConnected, lastUpdate } = useHealthMonitoring();

  if (!healthStatus) {
    return <div>Loading health status...</div>;
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'green';
      case 'degraded': return 'yellow';
      case 'unhealthy': return 'red';
      default: return 'gray';
    }
  };

  return (
    <div className="health-dashboard">
      <div className="header">
        <h2>System Health</h2>
        <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </div>
        {lastUpdate && (
          <div className="last-update">
            Last update: {lastUpdate.toLocaleTimeString()}
          </div>
        )}
      </div>

      <div className="overall-status">
        <h3>Overall Status: <span style={{ color: getStatusColor(healthStatus.o) }}>
          {healthStatus.o.toUpperCase()}
        </span></h3>
        <div>Uptime: {formatUptime(healthStatus.u)}</div>
      </div>

      <div className="services">
        <h3>Services</h3>
        {Object.entries(healthStatus.s).map(([name, service]) => (
          <div key={name} className="service-item">
            <span className="service-name">{name}</span>
            <span 
              className="service-status"
              style={{ color: getStatusColor(service.status) }}
            >
              {service.status}
            </span>
            {service.responseTime && (
              <span className="response-time">
                {service.responseTime}ms
              </span>
            )}
          </div>
        ))}
      </div>

      {healthStatus.sys && (
        <div className="system-metrics">
          <h3>System Metrics</h3>
          <div>CPU: {healthStatus.sys.cpu.toFixed(1)}%</div>
          <div>Memory: {healthStatus.sys.memory.toFixed(1)}%</div>
          <div>Error Rate: {healthStatus.sys.errorRate.toFixed(2)}%</div>
        </div>
      )}
    </div>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}
```

### Vue.js Composition API Example

```typescript
import { ref, onMounted, onUnmounted } from 'vue';
import { io, Socket } from 'socket.io-client';

export function useHealthMonitoring() {
  const healthStatus = ref(null);
  const isConnected = ref(false);
  let socket: Socket | null = null;

  onMounted(() => {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8088';
    socket = io(`${API_URL}/health`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
    });

    socket.on('connect', () => {
      isConnected.value = true;
    });

    socket.on('disconnect', () => {
      isConnected.value = false;
    });

    socket.on('health:status', (data) => {
      healthStatus.value = data;
    });

    socket.on('health:service:update', (update) => {
      if (healthStatus.value) {
        healthStatus.value.s[update.id] = {
          status: update.st,
          timestamp: update.t,
          responseTime: update.rt
        };
      }
    });
  });

  onUnmounted(() => {
    if (socket) {
      socket.disconnect();
    }
  });

  return { healthStatus, isConnected };
}
```

### Vanilla JavaScript Example

```javascript
const API_URL = 'http://localhost:8088';
const healthSocket = io(`${API_URL}/health`, {
  transports: ['websocket', 'polling'],
  reconnection: true,
});

let healthStatus = null;

healthSocket.on('connect', () => {
  console.log('Connected to health monitoring');
  updateConnectionStatus(true);
});

healthSocket.on('disconnect', () => {
  console.log('Disconnected from health monitoring');
  updateConnectionStatus(false);
});

healthSocket.on('health:status', (data) => {
  healthStatus = data;
  updateHealthDashboard(data);
});

healthSocket.on('health:service:update', (update) => {
  if (healthStatus) {
    healthStatus.s[update.id] = {
      status: update.st,
      timestamp: update.t,
      responseTime: update.rt
    };
    updateServiceStatus(update.id, update.st);
  }
});

healthSocket.on('health:heartbeat', (heartbeat) => {
  updateLastSeen(heartbeat.t);
});

function updateHealthDashboard(data) {
  // Update your UI with health data
  document.getElementById('overall-status').textContent = data.o;
  // ... update other elements
}

function updateServiceStatus(serviceId, status) {
  // Update specific service in UI
  const element = document.getElementById(`service-${serviceId}`);
  if (element) {
    element.textContent = status;
    element.className = `status-${status}`;
  }
}
```

---

## 🎯 Best Practices

### 1. Connection Management

- **Always clean up** connections when components unmount
- **Handle reconnection** gracefully with user feedback
- **Monitor connection state** and show offline indicators

### 2. State Management

- **Store health status** in your state management solution (Redux, Zustand, etc.)
- **Update incrementally** using `health:service:update` events
- **Debounce rapid updates** if needed

### 3. Error Handling

```typescript
healthSocket.on('connect_error', (error) => {
  console.error('Connection error:', error);
  // Implement fallback to REST polling
  startPollingFallback();
});

healthSocket.on('disconnect', (reason) => {
  if (reason === 'io server disconnect') {
    // Server disconnected, reconnect manually
    healthSocket.connect();
  }
  // Show offline status
  showOfflineIndicator();
});
```

### 4. Performance Optimization

- **Use incremental updates** (`health:service:update`) instead of full status when possible
- **Throttle UI updates** if receiving too many updates
- **Cache previous status** to show during disconnections

---

## 🔄 Fallback Strategy

If Socket.IO connection fails, fall back to REST polling:

```typescript
let pollingInterval: NodeJS.Timeout | null = null;

function startPollingFallback() {
  if (pollingInterval) return; // Already polling

  pollingInterval = setInterval(async () => {
    try {
      const response = await fetch('/health?detailed=true');
      const data = await response.json();
      updateHealthDashboard(data);
    } catch (error) {
      console.error('Polling failed:', error);
    }
  }, 30000); // Poll every 30 seconds
}

function stopPollingFallback() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// Use in connection handler
healthSocket.on('connect', () => {
  stopPollingFallback(); // Stop polling when Socket.IO connects
});

healthSocket.on('disconnect', () => {
  startPollingFallback(); // Start polling when Socket.IO disconnects
});
```

---

## 🐛 Troubleshooting

### Connection Issues

**Problem:** Cannot connect to Socket.IO

**Solutions:**
- Check CORS configuration on backend
- Verify the namespace path (`/health`)
- Check authentication requirements
- Ensure WebSocket is not blocked by firewall/proxy

### Missing Updates

**Problem:** Not receiving health status updates

**Solutions:**
- Verify you're listening to the correct events
- Check if you're in the correct room (`health:all`)
- Ensure connection is established (`connect` event fired)
- Check browser console for errors

### Performance Issues

**Problem:** Too many updates causing UI lag

**Solutions:**
- Throttle or debounce UI updates
- Use `health:service:update` for incremental updates
- Implement virtual scrolling for large service lists
- Cache and batch updates

---

## 📚 Related Documentation

- [Health Service README](./README.md) - Backend health service documentation
- [Socket.IO Documentation](https://socket.io/docs/v4/) - Official Socket.IO docs
- [System Architecture](../../docs/architecture/SYSTEM_ARCHITECTURE.md) - Overall system architecture

---

## 🔗 API Reference

### Events Received

| Event | Description | Frequency |
|-------|-------------|-----------|
| `health:status` | Full health status | On connect + when status changes |
| `health:service:update` | Incremental service update | When individual service changes |
| `health:heartbeat` | Keep-alive ping | Every 60 seconds |

### Events Sent

| Event | Description | Payload |
|-------|-------------|---------|
| `health:subscribe` | Subscribe to updates (optional) | `{ room?: string }` |
| `health:unsubscribe` | Unsubscribe from updates (optional) | None |

### Connection Events

| Event | Description |
|-------|-------------|
| `connect` | Successfully connected |
| `disconnect` | Disconnected from server |
| `connect_error` | Connection error occurred |

---

## ✅ Checklist

- [ ] Install `socket.io-client` package
- [ ] Configure connection with correct URL and namespace
- [ ] Listen to `health:status` event for initial and full updates
- [ ] Listen to `health:service:update` for incremental updates
- [ ] Listen to `health:heartbeat` for connection keep-alive
- [ ] Handle connection/disconnection events
- [ ] Implement error handling and fallback strategy
- [ ] Clean up connections on component unmount
- [ ] Update UI with health status data
- [ ] Test reconnection behavior

---

**Last Updated:** 2024-01-01
**Version:** 1.0.0

