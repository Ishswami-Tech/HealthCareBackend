/**
 * Realtime Health Monitoring Types
 * Enterprise-level types for real-time health status broadcasting
 *
 * @module RealtimeHealthTypes
 * @description Types for real-time health monitoring via Socket.IO
 * Follows SOLID, DRY, and KISS principles
 */

/**
 * Health status values (for realtime monitoring)
 * Renamed to RealtimeHealthStatus to avoid conflict with other HealthStatus types
 */
export type RealtimeHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Service health status (for realtime monitoring)
 */
export interface ServiceHealthStatus {
  /** Service status */
  readonly status: RealtimeHealthStatus;
  /** Response time in milliseconds */
  readonly responseTime?: number;
  /** Timestamp of last check */
  readonly timestamp: string;
  /** Optional error message */
  readonly error?: string;
  /** Optional service-specific details */
  readonly details?: Record<string, unknown>;
}

/**
 * Endpoint health status
 */
export interface EndpointHealthStatus {
  /** Endpoint status */
  readonly status: 'up' | 'down' | 'slow';
  /** Response time in milliseconds */
  readonly responseTime: number;
  /** Last checked timestamp */
  readonly lastChecked: string;
  /** Success rate percentage (0-100) */
  readonly successRate: number;
}

/**
 * System metrics (for realtime monitoring)
 * Note: Different from SystemMetrics in common.types.ts which includes full memory/CPU details
 */
export interface RealtimeSystemMetrics {
  /** CPU usage percentage (0-100) */
  readonly cpu: number;
  /** Memory usage percentage (0-100) */
  readonly memory: number;
  /** Active connections count */
  readonly activeConnections: number;
  /** Request rate per second */
  readonly requestRate: number;
  /** Error rate percentage (0-100) */
  readonly errorRate: number;
}

/**
 * Full realtime health status (optimized payload)
 * Note: This is the optimized Socket.IO payload format with shortened keys
 */
export interface RealtimeHealthStatusPayload {
  /** Timestamp */
  readonly t: string;
  /** Overall status */
  readonly o: RealtimeHealthStatus;
  /** Services (only changed services) */
  readonly s: Record<string, ServiceHealthStatus>;
  /** Endpoints (only if changed) */
  readonly e?: Record<string, EndpointHealthStatus>;
  /** System metrics (only if threshold breach) */
  readonly sys?: RealtimeSystemMetrics;
  /** Uptime in seconds */
  readonly u: number;
}

/**
 * Heartbeat payload (minimal)
 */
export interface HealthHeartbeat {
  /** Timestamp */
  readonly t: string;
  /** Overall status only */
  readonly o: RealtimeHealthStatus;
}

/**
 * Incremental update payload
 */
export interface HealthUpdate {
  /** Timestamp */
  readonly t: string;
  /** Update type */
  readonly ty: 'service' | 'endpoint' | 'system';
  /** Service/endpoint ID */
  readonly id: string;
  /** Status */
  readonly st: RealtimeHealthStatus | 'up' | 'down' | 'slow';
  /** Response time (if applicable) */
  readonly rt?: number;
  /** Additional data */
  readonly d?: Record<string, unknown>;
}

/**
 * Health change detection result
 */
export interface HealthChange {
  /** Service/endpoint name */
  readonly service: string;
  /** Previous status */
  readonly previousStatus: RealtimeHealthStatus | 'up' | 'down' | 'slow';
  /** Current status */
  readonly currentStatus: RealtimeHealthStatus | 'up' | 'down' | 'slow';
  /** Change type */
  readonly changeType: 'status' | 'performance' | 'metric';
  /** Severity */
  readonly severity: 'critical' | 'warning' | 'info';
  /** Timestamp */
  readonly timestamp: string;
}

/**
 * Health check result (for realtime checkers)
 * Note: Different from HealthCheckResult in common.types.ts which is for overall health responses
 */
export interface RealtimeHealthCheckResult {
  /** Service name */
  readonly service: string;
  /** Status */
  readonly status: RealtimeHealthStatus;
  /** Response time in milliseconds */
  readonly responseTime: number;
  /** Error message if failed */
  readonly error?: string;
  /** Additional details */
  readonly details?: Record<string, unknown>;
}

/**
 * Aggregated health status (for realtime monitoring)
 */
export interface AggregatedHealthStatus {
  /** Overall status */
  readonly overall: RealtimeHealthStatus;
  /** Services */
  readonly services: Record<string, ServiceHealthStatus>;
  /** Endpoints */
  readonly endpoints: Record<string, EndpointHealthStatus>;
  /** System metrics */
  readonly system: RealtimeSystemMetrics;
  /** Uptime in seconds */
  readonly uptime: number;
  /** Timestamp */
  readonly timestamp: string;
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  /** Check interval in milliseconds */
  readonly interval: number;
  /** Cache TTL in milliseconds */
  readonly cacheTTL: number;
  /** Timeout in milliseconds */
  readonly timeout: number;
  /** Priority tier */
  readonly tier: 1 | 2 | 3 | 4 | 5;
}
