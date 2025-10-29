/**
 * Represents the health status of a service
 * @interface ServiceHealth
 * @description Contains health check information for individual services
 * @example
 * ```typescript
 * const health: ServiceHealth = {
 *   status: "healthy",
 *   details: "All systems operational",
 *   responseTime: 45,
 *   lastChecked: "2024-01-15T10:30:00Z"
 * };
 * ```
 */
export interface ServiceHealth {
  /** Health status of the service */
  readonly status: "healthy" | "unhealthy";
  /** Optional additional details */
  readonly details?: string;
  /** Optional error message if unhealthy */
  readonly error?: string;
  /** Response time in milliseconds */
  readonly responseTime: number;
  /** Timestamp of last health check */
  readonly lastChecked: string;
}

/**
 * Represents system performance metrics
 * @interface SystemMetrics
 * @description Contains comprehensive system performance data
 * @example
 * ```typescript
 * const metrics: SystemMetrics = {
 *   uptime: 86400,
 *   memoryUsage: {
 *     heapTotal: 1024 * 1024 * 1024,
 *     heapUsed: 512 * 1024 * 1024,
 *     rss: 256 * 1024 * 1024,
 *     external: 64 * 1024 * 1024,
 *     systemTotal: 8 * 1024 * 1024 * 1024,
 *     systemFree: 4 * 1024 * 1024 * 1024,
 *     systemUsed: 4 * 1024 * 1024 * 1024
 *   },
 *   cpuUsage: {
 *     user: 0.5,
 *     system: 0.2,
 *     cpuCount: 8,
 *     cpuModel: "Intel Core i7",
 *     cpuSpeed: 3200
 *   }
 * };
 * ```
 */
export interface SystemMetrics {
  /** System uptime in seconds */
  readonly uptime: number;
  /** Memory usage statistics */
  readonly memoryUsage: {
    /** Total heap memory in bytes */
    readonly heapTotal: number;
    /** Used heap memory in bytes */
    readonly heapUsed: number;
    /** Resident set size in bytes */
    readonly rss: number;
    /** External memory in bytes */
    readonly external: number;
    /** Total system memory in bytes */
    readonly systemTotal: number;
    /** Free system memory in bytes */
    readonly systemFree: number;
    /** Used system memory in bytes */
    readonly systemUsed: number;
  };
  /** CPU usage statistics */
  readonly cpuUsage: {
    /** User CPU time */
    readonly user: number;
    /** System CPU time */
    readonly system: number;
    /** Number of CPU cores */
    readonly cpuCount: number;
    /** CPU model name */
    readonly cpuModel: string;
    /** CPU speed in MHz */
    readonly cpuSpeed: number;
  };
}

/**
 * Represents database performance metrics
 * @interface DatabaseMetrics
 * @description Contains database-specific performance and connection data
 * @example
 * ```typescript
 * const dbMetrics: DatabaseMetrics = {
 *   queryResponseTime: 25,
 *   activeConnections: 5,
 *   maxConnections: 20,
 *   connectionUtilization: 0.25
 * };
 * ```
 */
export interface DatabaseMetrics {
  /** Average query response time in milliseconds */
  readonly queryResponseTime: number;
  /** Number of active database connections */
  readonly activeConnections: number;
  /** Maximum allowed database connections */
  readonly maxConnections: number;
  /** Connection utilization percentage (0-1) */
  readonly connectionUtilization: number;
}

/**
 * Represents Redis performance metrics
 * @interface RedisMetrics
 * @description Contains Redis-specific performance and usage data
 * @example
 * ```typescript
 * const redisMetrics: RedisMetrics = {
 *   connectedClients: 10,
 *   usedMemory: 1024 * 1024 * 100, // 100MB
 *   totalKeys: 5000,
 *   lastSave: "2024-01-15T10:30:00Z"
 * };
 * ```
 */
export interface RedisMetrics {
  /** Number of connected Redis clients */
  readonly connectedClients: number;
  /** Used memory in bytes */
  readonly usedMemory: number;
  /** Total number of keys in Redis */
  readonly totalKeys: number;
  /** Timestamp of last Redis save operation */
  readonly lastSave: string;
}

// Basic health check response used by app controller
export interface HealthCheckResponse {
  status: "healthy" | "degraded";
  timestamp: string;
  environment: string;
  version: string;
  systemMetrics: SystemMetrics;
  services: {
    api: ServiceHealth;
    database: ServiceHealth & { metrics: DatabaseMetrics };
    redis: ServiceHealth & { metrics: RedisMetrics };
    queues: ServiceHealth;
    logger: ServiceHealth;
    socket: ServiceHealth;
    email: ServiceHealth;
  };
}

// Detailed health check response with all services
export interface DetailedHealthCheckResponse extends HealthCheckResponse {
  services: {
    api: ServiceHealth;
    database: ServiceHealth & { metrics: DatabaseMetrics };
    redis: ServiceHealth & { metrics: RedisMetrics };
    queues: ServiceHealth;
    logger: ServiceHealth;
    socket: ServiceHealth;
    email: ServiceHealth;
    prismaStudio?: ServiceHealth;
    redisCommander?: ServiceHealth;
    pgAdmin?: ServiceHealth;
  };
  processInfo: {
    pid: number;
    ppid: number;
    platform: string;
    versions: Record<string, string>;
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
  };
  cpu: {
    user: number;
    system: number;
  };
}

export interface HealthCheckResult {
  status: "healthy" | "unhealthy";
  timestamp: Date;
  services: {
    api: ServiceHealth;
    database: ServiceHealth & { metrics?: DatabaseMetrics };
    redis: ServiceHealth & { metrics?: RedisMetrics };
    queues: ServiceHealth;
    logger: ServiceHealth;
    socket: ServiceHealth;
    email: ServiceHealth;
    prismaStudio?: ServiceHealth;
    redisCommander?: ServiceHealth;
    pgAdmin?: ServiceHealth;
  };
  version: string;
  uptime: number;
}

export interface DetailedHealthCheckResult extends HealthCheckResult {
  environment: string;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
  };
  cpu: {
    user: number;
    system: number;
  };
  processInfo: {
    pid: number;
    ppid: number;
    platform: string;
    versions: Record<string, string>;
  };
}
