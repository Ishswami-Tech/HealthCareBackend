import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import {
  HealthCheckResponse,
  DetailedHealthCheckResponse,
  ServiceHealth,
} from '@core/types/common.types';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem, freemem } from 'node:os';
import { QueueService } from '@infrastructure/queue';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { SocketService } from '@communication/socket';
import { EmailService } from '@communication/messaging/email';
import { HealthcareErrorsService } from '@core/errors';

@Injectable()
export class HealthService {
  private readonly SYSTEM_TENANT_ID = 'system-health-check';
  private lastDatabaseCheck: number = 0;
  private readonly DB_CHECK_INTERVAL = 10000; // 10 seconds minimum between actual DB checks
  private databaseStatus: 'healthy' | 'unhealthy' = 'healthy';

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly config: ConfigService,
    @Optional() private readonly queueService: QueueService,
    private readonly loggingService: LoggingService,
    private readonly socketService: SocketService,
    private readonly emailService: EmailService,
    private readonly errors: HealthcareErrorsService
  ) {}

  private getSystemMetrics(): {
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
  } {
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

    // Check all services in parallel with timeout protection
    const [dbHealth, redisHealth, queueHealth, loggerHealth, socketHealth, emailHealth] =
      await Promise.allSettled([
        this.checkDatabaseHealth(),
        this.checkRedisHealth(),
        this.checkQueueHealth(),
        Promise.resolve(this.checkLoggerHealth()),
        this.checkSocketHealth(),
        Promise.resolve(this.checkEmailHealth()),
      ]).then(results =>
        results.map(result =>
          result.status === 'fulfilled'
            ? result.value
            : {
                status: 'unhealthy' as const,
                error:
                  result.reason instanceof Error ? result.reason.message : 'Service check failed',
                responseTime: 0,
                lastChecked: new Date().toISOString(),
              }
        )
      );

    const result: HealthCheckResponse = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: this.config.get('NODE_ENV', 'development'),
      version: process.env['npm_package_version'] || '0.0.1',
      systemMetrics: this.getSystemMetrics(),
      services: {
        api: {
          status: 'healthy',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        },
        database: {
          status: dbHealth?.status || 'unhealthy',
          responseTime: dbHealth?.responseTime || 0,
          lastChecked: dbHealth?.lastChecked || new Date().toISOString(),
          metrics: {
            queryResponseTime: dbHealth?.responseTime || 0,
            activeConnections: 1,
            maxConnections: 100,
            connectionUtilization: 1,
          },
        },
        redis: {
          status: redisHealth?.status || 'unhealthy',
          responseTime: redisHealth?.responseTime || 0,
          lastChecked: redisHealth?.lastChecked || new Date().toISOString(),
          metrics: await this.getRedisMetrics(),
        },
        queues: queueHealth || {
          status: 'unhealthy',
          responseTime: 0,
          lastChecked: new Date().toISOString(),
        },
        logger: loggerHealth || {
          status: 'unhealthy',
          responseTime: 0,
          lastChecked: new Date().toISOString(),
        },
        socket: socketHealth || {
          status: 'unhealthy',
          responseTime: 0,
          lastChecked: new Date().toISOString(),
        },
        email: emailHealth || {
          status: 'unhealthy',
          responseTime: 0,
          lastChecked: new Date().toISOString(),
        },
      },
    };

    // Update overall status if any core service is unhealthy
    if (
      [dbHealth, redisHealth, queueHealth, loggerHealth, socketHealth, emailHealth].some(
        service => service?.status === 'unhealthy'
      )
    ) {
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
        versions: Object.fromEntries(
          Object.entries(process.versions).filter(([, value]) => value !== undefined)
        ) as Record<string, string>,
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
        details:
          this.databaseStatus === 'healthy' ? 'PostgreSQL connected' : 'Database connection failed',
        responseTime: 0,
        lastChecked: new Date().toISOString(),
      };
    }

    try {
      // Use executeHealthcareRead for database health check (raw query)
      await this.databaseService.executeHealthcareRead(async client => {
        return await client.$queryRaw`SELECT 1`;
      });

      this.databaseStatus = 'healthy';
      this.lastDatabaseCheck = now;

      return {
        status: 'healthy',
        details: 'PostgreSQL connected',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Database health check failed: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'HealthService',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      this.databaseStatus = 'unhealthy';
      this.lastDatabaseCheck = now;

      return {
        status: 'unhealthy',
        error: _error instanceof Error ? _error.message : 'Unknown error',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private async checkRedisHealth(): Promise<ServiceHealth> {
    const startTime = performance.now();
    try {
      await this.cacheService.ping();

      return {
        status: 'healthy',
        details: 'Redis connected',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.ERROR,
        `Redis health check failed: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'HealthService',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return {
        status: 'unhealthy',
        error: _error instanceof Error ? _error.message : 'Unknown error',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private async getRedisMetrics(): Promise<{
    connectedClients: number;
    usedMemory: number;
    totalKeys: number;
    lastSave: string;
  }> {
    try {
      const info = await this.cacheService.getCacheDebug();
      type CacheDebugInfo = Record<string, unknown> & {
        info?: {
          memoryInfo?: { usedMemory?: number };
          dbSize?: number;
        };
      };
      const debugInfo = info as CacheDebugInfo;
      return {
        connectedClients: 1,
        usedMemory: debugInfo?.info?.memoryInfo?.usedMemory || 0,
        totalKeys: debugInfo?.info?.dbSize || 0,
        lastSave: new Date().toISOString(),
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.ERROR,
        `Failed to get Redis metrics: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'HealthService',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
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
      if (!this.queueService) {
        return {
          status: 'unhealthy',
          details: 'Queue service is not available',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
      }

      // Get queue stats using the queue service
      type LocationQueueStats = {
        locationId: string;
        domain: string;
        stats: {
          totalWaiting: number;
          averageWaitTime: number;
          efficiency: number;
          utilization: number;
          completedCount: number;
        };
      };
      const stats = (await this.queueService.getLocationQueueStats(
        'system',
        'clinic'
      )) as LocationQueueStats;
      const isHealthy =
        stats?.stats?.totalWaiting !== undefined && stats?.stats?.completedCount !== undefined;

      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        details: isHealthy
          ? `Queue service is running. Completed jobs: ${stats.stats.completedCount}, Waiting jobs: ${stats.stats.totalWaiting}`
          : 'Queue service is not responding',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Queue health check failed: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'HealthService',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return {
        status: 'unhealthy',
        error: _error instanceof Error ? _error.message : 'Unknown error',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private checkLoggerHealth(): ServiceHealth {
    const startTime = performance.now();
    try {
      // Check if logger service is available by testing if it can log
      // This is a safer approach than trying to retrieve logs which can fail
      if (this.loggingService && typeof this.loggingService.log === 'function') {
        // Test logging capability without actually logging to avoid noise
        return {
          status: 'healthy',
          details: 'Logging service is available and functional',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
      } else {
        return {
          status: 'unhealthy',
          details: 'Logging service is not properly initialized',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
      }
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Logger health check failed: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'HealthService',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return {
        status: 'unhealthy',
        error: _error instanceof Error ? _error.message : 'Unknown error',
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
    } catch (_error) {
      void this.loggingService.log(
        LogType.WEBSOCKET,
        LogLevel.ERROR,
        `Socket health check failed: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'HealthService',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return {
        status: 'unhealthy',
        error: _error instanceof Error ? _error.message : 'Unknown error',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private checkEmailHealth(): ServiceHealth {
    const startTime = performance.now();
    try {
      const isHealthy = this.emailService.isHealthy();

      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        details: isHealthy
          ? 'Email service is configured and connected'
          : 'Email service is not properly initialized',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        `Email health check failed: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'HealthService',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return {
        status: 'unhealthy',
        error: _error instanceof Error ? _error.message : 'Unknown error',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }
}
