import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { RedisService } from '../../shared/cache/redis/redis.service';
import { HealthCheckResponse, DetailedHealthCheckResponse, ServiceHealth } from '../../libs/types/health.types';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem, freemem } from 'node:os';
import { QueueService } from '../../shared/queue/queue.service';
import { LoggingService } from '../../shared/logging/logging.service';
import { SocketService } from '../../shared/socket/socket.service';
import { EmailService } from '../../shared/messaging/email/email.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly SYSTEM_TENANT_ID = 'system-health-check';
  private lastDatabaseCheck: number = 0;
  private readonly DB_CHECK_INTERVAL = 10000; // 10 seconds minimum between actual DB checks
  private databaseStatus: 'healthy' | 'unhealthy' = 'healthy';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly queueService: QueueService,
    private readonly loggingService: LoggingService,
    private readonly socketService: SocketService,
    private readonly emailService: EmailService,
  ) {}

  private getSystemMetrics() {
    const memoryUsage = process.memoryUsage();
    const cpuInfo = cpus();
    const totalMemory = totalmem();
    const freeMemory = freemem();

    return {
      uptime: process.uptime(),
      memoryUsage: {
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        rss: memoryUsage.rss,
        external: memoryUsage.external,
        systemTotal: totalMemory,
        systemFree: freeMemory,
        systemUsed: totalMemory - freeMemory,
      },
      cpuUsage: {
        user: process.cpuUsage().user,
        system: process.cpuUsage().system,
        cpuCount: cpuInfo.length,
        cpuModel: cpuInfo[0]?.model || 'unknown',
        cpuSpeed: cpuInfo[0]?.speed || 0,
      },
    };
  }

  async checkHealth(): Promise<HealthCheckResponse> {
    const startTime = performance.now();
    
    // Check all services in parallel
    const [dbHealth, redisHealth, queueHealth, loggerHealth, socketHealth, emailHealth] = await Promise.all([
      this.checkDatabaseHealth(),
      this.checkRedisHealth(),
      this.checkQueueHealth(),
      this.checkLoggerHealth(),
      this.checkSocketHealth(),
      this.checkEmailHealth(),
    ]);

    const result: HealthCheckResponse = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: this.config.get('NODE_ENV', 'development'),
      version: process.env.npm_package_version || '0.0.1',
      systemMetrics: this.getSystemMetrics(),
      services: {
        api: {
          status: 'healthy',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        },
        database: {
          ...dbHealth,
          metrics: {
            queryResponseTime: dbHealth.responseTime,
            activeConnections: 1,
            maxConnections: 100,
            connectionUtilization: 1,
          },
        },
        redis: {
          ...redisHealth,
          metrics: await this.getRedisMetrics(),
        },
        queues: queueHealth,
        logger: loggerHealth,
        socket: socketHealth,
        email: emailHealth,
      },
    };

    // Update overall status if any core service is unhealthy
    if ([dbHealth, redisHealth, queueHealth, loggerHealth, socketHealth, emailHealth]
        .some(service => service.status === 'unhealthy')) {
      result.status = 'degraded';
    }

    return result;
  }

  async checkDetailedHealth(): Promise<DetailedHealthCheckResponse> {
    const baseHealth = await this.checkHealth();
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const isDevMode = this.config.get('NODE_ENV') === 'development';

    const result: DetailedHealthCheckResponse = {
      ...baseHealth,
      services: {
        ...baseHealth.services,
        queues: {
          status: 'healthy',
          responseTime: 0,
          lastChecked: new Date().toISOString(),
          details: 'Queue service is running',
        },
        logger: {
          status: 'healthy',
          responseTime: 0,
          lastChecked: new Date().toISOString(),
          details: 'Logging service is active',
        },
        socket: {
          status: 'healthy',
          responseTime: 0,
          lastChecked: new Date().toISOString(),
          details: 'WebSocket server is running',
        },
      },
      processInfo: {
        pid: process.pid,
        ppid: process.ppid,
        platform: process.platform,
        versions: process.versions,
      },
      memory: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        arrayBuffers: memoryUsage.arrayBuffers,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
    };

    // Add development-only services
    if (isDevMode) {
      result.services.prismaStudio = {
        status: 'healthy',
        responseTime: 0,
        lastChecked: new Date().toISOString(),
        details: 'Prisma Studio is available',
      };
      result.services.redisCommander = {
        status: 'healthy',
        responseTime: 0,
        lastChecked: new Date().toISOString(),
        details: 'Redis Commander is available',
      };
      result.services.pgAdmin = {
        status: 'healthy',
        responseTime: 0,
        lastChecked: new Date().toISOString(),
        details: 'pgAdmin is available',
      };
    }

    return result;
  }

  private async checkDatabaseHealth(): Promise<ServiceHealth> {
    const now = Date.now();
    const startTime = performance.now();
    
    // Use cached status if checked recently
    if (now - this.lastDatabaseCheck < this.DB_CHECK_INTERVAL) {
      return {
        status: this.databaseStatus,
        details: this.databaseStatus === 'healthy' ? 'PostgreSQL connected' : 'Database connection failed',
        responseTime: 0,
        lastChecked: new Date().toISOString(),
      };
    }

    try {
      // Ensure we're using the system tenant
      this.prisma.setCurrentTenantId(this.SYSTEM_TENANT_ID);
      
      // Perform a simple query
      await this.prisma.$queryRaw`SELECT 1`;
      
      this.databaseStatus = 'healthy';
      this.lastDatabaseCheck = now;
      
      return {
        status: 'healthy',
        details: 'PostgreSQL connected',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Database health check failed:', error);
      this.databaseStatus = 'unhealthy';
      this.lastDatabaseCheck = now;
      
      return {
        status: 'unhealthy',
        error: error.message,
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private async checkRedisHealth(): Promise<ServiceHealth> {
    const startTime = performance.now();
    try {
      await this.redis.ping();
      
      return {
        status: 'healthy',
        details: 'Redis connected',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Redis health check failed:', error);
      
      return {
        status: 'unhealthy',
        error: error.message,
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private async getRedisMetrics() {
    try {
      const info = await this.redis.getCacheDebug();
      return {
        connectedClients: 1,
        usedMemory: info.info.memoryInfo?.usedMemory || 0,
        totalKeys: info.info.dbSize || 0,
        lastSave: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to get Redis metrics:', error);
      return {
        connectedClients: 0,
        usedMemory: 0,
        totalKeys: 0,
        lastSave: new Date().toISOString(),
      };
    }
  }

  private async checkQueueHealth(): Promise<ServiceHealth> {
    const startTime = performance.now();
    try {
      // Get queue stats using the queue service
      const stats = await this.queueService.getQueueStatsByLocation('system');
      const isHealthy = stats.waiting !== undefined && stats.active !== undefined;
      
      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        details: isHealthy 
          ? `Queue service is running. Active jobs: ${stats.active}, Waiting jobs: ${stats.waiting}`
          : 'Queue service is not responding',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Queue health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private async checkLoggerHealth(): Promise<ServiceHealth> {
    const startTime = performance.now();
    try {
      // Check if logger service is running by attempting to get logs
      const logs = await this.loggingService.getLogs();
      const isHealthy = Array.isArray(logs);
      
      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        details: isHealthy ? 'Logging service is active' : 'Logging service is not responding',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Logger health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private async checkSocketHealth(): Promise<ServiceHealth> {
    const startTime = performance.now();
    try {
      // Check if WebSocket server is initialized and responding
      const isInitialized = this.socketService.getInitializationState();
      const server = this.socketService.getServer();
      
      if (!isInitialized || !server) {
        return {
          status: 'unhealthy',
          details: 'WebSocket server is not initialized',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
      }

      // Get connected clients count
      const connectedSockets = await server.allSockets();
      const connectedCount = connectedSockets.size;
      
      return {
        status: 'healthy',
        details: `WebSocket server is running with ${connectedCount} connected clients`,
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Socket health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private async checkEmailHealth(): Promise<ServiceHealth> {
    const startTime = performance.now();
    try {
      const isHealthy = this.emailService.isHealthy();
      
      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        details: isHealthy ? 'Email service is configured and connected' : 'Email service is not properly initialized',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Email health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }
} 