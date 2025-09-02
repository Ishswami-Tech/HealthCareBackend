export interface ServiceHealth {
  status: 'healthy' | 'unhealthy';
  details?: string;
  error?: string;
  responseTime: number;
  lastChecked: string;
}

export interface SystemMetrics {
  uptime: number;
  memoryUsage: {
    heapTotal: number;
    heapUsed: number;
    rss: number;
    external: number;
    systemTotal: number;
    systemFree: number;
    systemUsed: number;
  };
  cpuUsage: {
    user: number;
    system: number;
    cpuCount: number;
    cpuModel: string;
    cpuSpeed: number;
  };
}

export interface DatabaseMetrics {
  queryResponseTime: number;
  activeConnections: number;
  maxConnections: number;
  connectionUtilization: number;
}

export interface RedisMetrics {
  connectedClients: number;
  usedMemory: number;
  totalKeys: number;
  lastSave: string;
}

// Basic health check response used by app controller
export interface HealthCheckResponse {
  status: 'healthy' | 'degraded';
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
  status: 'healthy' | 'unhealthy';
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