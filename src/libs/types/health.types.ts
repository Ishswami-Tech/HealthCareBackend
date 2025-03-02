export interface ServiceHealth {
  status: 'healthy' | 'unhealthy' | 'unknown';
  details?: string;
  error?: string;
  responseTime?: number;
  lastChecked?: string;
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
  activeConnections: number;
  maxConnections: number;
  connectionUtilization: number;
  queryResponseTime?: number;
}

export interface RedisMetrics {
  connectedClients: number;
  usedMemory: number;
  totalKeys: number;
  lastSave?: string;
}

export interface KafkaMetrics {
  brokers: number;
  topics: number;
  partitions: number;
  consumerGroups: number;
  messageRate?: number;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded';
  timestamp: string;
  environment: string;
  version: string;
  systemMetrics: SystemMetrics;
  services: {
    api: ServiceHealth;
    database: ServiceHealth & { metrics?: DatabaseMetrics };
    redis: ServiceHealth & { metrics?: RedisMetrics };
    kafka: ServiceHealth & { metrics?: KafkaMetrics };
  };
} 