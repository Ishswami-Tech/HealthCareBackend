/**
 * Application Dashboard and UI Types
 * @module @core/types/app.types
 * @description Types for application dashboard, service information, and UI-related interfaces
 */

/**
 * Service information for dashboard display
 * @interface ServiceInfo
 */
export interface ServiceInfo {
  /** Service name */
  readonly name: string;
  /** Service description */
  readonly description: string;
  /** Service URL */
  readonly url: string;
  /** Whether the service is active */
  readonly active: boolean;
  /** Service category */
  readonly category: string;
  /** Optional credentials information */
  readonly credentials?: string;
  /** Whether this service is development-only */
  readonly devOnly?: boolean;
}

/**
 * Service performance metrics
 * @interface ServiceMetrics
 */
export interface ServiceMetrics {
  /** Query response time in milliseconds */
  readonly queryResponseTime?: number;
  /** Number of active connections */
  readonly activeConnections?: number;
  /** Maximum connections */
  readonly maxConnections?: number;
  /** Connection utilization percentage */
  readonly connectionUtilization?: number;
  /** Number of connected clients */
  readonly connectedClients?: number;
  /** Used memory in bytes */
  readonly usedMemory?: number;
  /** Total number of keys */
  readonly totalKeys?: number;
  /** Last save timestamp */
  readonly lastSave?: string;
  /** Additional metric properties */
  readonly [key: string]: string | number | boolean | undefined;
}

/**
 * Log entry for dashboard display
 * @interface DashboardLogEntry
 */
export interface DashboardLogEntry {
  /** Log timestamp */
  readonly timestamp: Date | string;
  /** Log level */
  readonly level: string;
  /** Log message */
  readonly message: string;
  /** Optional log type */
  readonly type?: string;
  /** Optional source */
  readonly source?: string;
  /** Optional metadata */
  readonly metadata?: unknown;
  /** Optional data */
  readonly data?: string;
}

/**
 * Logging service log entry
 * @interface LoggingServiceLogEntry
 */
export interface LoggingServiceLogEntry {
  /** Optional log ID */
  readonly id?: string;
  /** Optional log type */
  readonly type?: string;
  /** Optional log level */
  readonly level?: string;
  /** Optional message */
  readonly message?: string;
  /** Optional context */
  readonly context?: string;
  /** Optional metadata */
  readonly metadata?: unknown;
  /** Optional timestamp */
  readonly timestamp?: string;
  /** Optional user ID */
  readonly userId?: string;
  /** Optional IP address */
  readonly ipAddress?: string;
  /** Optional user agent */
  readonly userAgent?: string;
}

/**
 * Service status information
 * @interface ServiceStatus
 */
export interface ServiceStatus {
  /** Service ID */
  readonly id: string;
  /** Service name */
  readonly name: string;
  /** Service status */
  readonly status: string;
  /** Whether the service is healthy */
  readonly isHealthy: boolean;
  /** Response time in milliseconds */
  readonly responseTime: number;
  /** Status details */
  readonly details: string;
  /** Last checked timestamp */
  readonly lastChecked: string;
  /** Service metrics */
  readonly metrics: ServiceMetrics;
}

/**
 * Overall health information
 * @interface OverallHealth
 */
export interface OverallHealth {
  /** Health status */
  readonly status: string;
  /** Status text */
  readonly statusText: string;
  /** Number of healthy services */
  readonly healthyCount: number;
  /** Total number of services */
  readonly totalCount: number;
  /** Last checked timestamp */
  readonly lastChecked: string;
  /** Health details */
  readonly details: string;
}

/**
 * Dashboard data structure
 * @interface DashboardData
 */
export interface DashboardData {
  /** Overall system health */
  readonly overallHealth: OverallHealth;
  /** Array of service statuses */
  readonly services: readonly ServiceStatus[];
}
