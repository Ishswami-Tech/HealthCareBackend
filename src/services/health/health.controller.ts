import { Controller, Get, ServiceUnavailableException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { RedisService } from '../../shared/cache/redis/redis.service';
import { HealthCheckResponse, ServiceHealth, SystemMetrics, RedisMetrics, DatabaseMetrics } from '../../libs/types/health.types';
import { ConfigService } from '@nestjs/config';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem, freemem } from 'node:os';
import { Public } from '../../libs/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private startTime: number;
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.startTime = Date.now();
  }

  private getSystemMetrics(): SystemMetrics {
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

  private async checkServiceHealth<T>(
    name: string,
    check: () => Promise<{ metrics?: T }>
  ): Promise<ServiceHealth & { metrics?: T }> {
    const startTime = performance.now();
    try {
      const result = await check();
      return {
        status: 'healthy',
        details: `${name} connected`,
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
        metrics: result.metrics,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  @Get()
  @ApiOperation({ 
    summary: 'Get system health status',
    description: 'Returns the health status of all system components including API, database, and Redis. No parameters required.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Health check response with detailed metrics for all services',
    schema: {
      type: 'object',
      properties: {
        status: { 
          type: 'string', 
          enum: ['healthy', 'degraded'],
          description: 'Overall system health status'
        },
        timestamp: { 
          type: 'string', 
          format: 'date-time',
          description: 'Time when the health check was performed'
        },
        environment: { 
          type: 'string',
          description: 'Current environment (development, production, etc.)'
        },
        version: { 
          type: 'string',
          description: 'API version'
        },
        systemMetrics: {
          type: 'object',
          description: 'System-level performance metrics',
          properties: {
            uptime: { type: 'number', description: 'System uptime in seconds' },
            memoryUsage: { type: 'object', description: 'Memory usage statistics' },
            cpuUsage: { type: 'object', description: 'CPU usage statistics' }
          }
        },
        services: {
          type: 'object',
          description: 'Health status of individual services',
          properties: {
            api: { type: 'object', description: 'API service health' },
            database: { type: 'object', description: 'Database service health and metrics' },
            redis: { type: 'object', description: 'Redis service health and metrics' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 503, description: 'Service unavailable - One or more critical services are unhealthy' })
  async getHealth(): Promise<HealthCheckResponse> {
    const health: HealthCheckResponse = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: this.config.get('NODE_ENV', 'development'),
      version: process.env.npm_package_version || '1.0.0',
      systemMetrics: this.getSystemMetrics(),
      services: {
        api: {
          status: 'healthy',
          responseTime: 0,
          lastChecked: new Date().toISOString(),
        },
        database: { status: 'unknown' },
        redis: { status: 'unknown' },
      },
    };

    // Check Database
    const dbHealth = await this.checkServiceHealth<DatabaseMetrics>('PostgreSQL', async () => {
      const startQuery = performance.now();
      await this.prisma.$queryRaw`SELECT 1 as test`;
      const queryTime = Math.round(performance.now() - startQuery);
      
      return {
        metrics: {
          queryResponseTime: queryTime,
          activeConnections: 1, // This would need to be fetched from Prisma if possible
          maxConnections: 100, // This would need to be fetched from Prisma if possible
          connectionUtilization: 1, // This would need to be fetched from Prisma if possible
        },
      };
    });
    health.services.database = dbHealth;

    // Check Redis
    const redisHealth = await this.checkServiceHealth<RedisMetrics>('Redis', async () => {
      const info = await this.redis.getCacheDebug();
      const { dbSize, memoryInfo } = info.info;
      
      return {
        metrics: {
          connectedClients: 1, // This would need to be parsed from info
          usedMemory: memoryInfo?.usedMemory || 0,
          totalKeys: dbSize || 0,
          lastSave: new Date().toISOString(),
        },
      };
    });
    health.services.redis = redisHealth;

    // Update overall status if any service is unhealthy
    if (Object.values(health.services).some(service => service.status === 'unhealthy')) {
      health.status = 'degraded';
    }

    return health;
  }

  @Get('redis')
  @ApiOperation({ 
    summary: 'Check Redis health',
    description: 'Returns detailed health information about the Redis service. No parameters required.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Redis health check successful',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        info: { 
          type: 'object',
          description: 'Detailed Redis information',
          properties: {
            dbSize: { type: 'number', description: 'Number of keys in the Redis database' },
            memoryInfo: { 
              type: 'object', 
              description: 'Redis memory usage information',
              properties: {
                usedMemory: { type: 'number', description: 'Used memory in bytes' },
                usedMemoryHuman: { type: 'string', description: 'Human-readable used memory' },
                maxMemory: { type: 'number', description: 'Maximum memory limit in bytes' },
                maxMemoryHuman: { type: 'string', description: 'Human-readable maximum memory' }
              }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 503, description: 'Service unavailable - Redis health check failed' })
  async checkRedis() {
    try {
      const isHealthy = await this.redis.healthCheck();
      if (!isHealthy) {
        throw new Error('Redis health check failed');
      }
      
      const info = await this.redis.getCacheDebug();
      return {
        status: 'ok',
        info: info.info
      };
    } catch (error) {
      this.logger.error('Redis health check failed:', error);
      throw new ServiceUnavailableException('Redis health check failed');
    }
  }

  @Get('services')
  @Public()
  @ApiOperation({ 
    summary: 'Get services status for dashboard',
    description: 'Returns the status of all services for the dashboard display.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Services status data'
  })
  async getServicesStatus() {
    const baseUrl = this.config.get('BASE_URL', 'http://localhost:8088');
    
    // Get health data
    const health = await this.getHealth();
    
    // Define services with their status
    const services = [
      {
        name: 'API Documentation',
        description: 'Swagger API documentation and testing interface.',
        url: `${baseUrl}/docs`,
        active: health.status === 'healthy',
        category: 'Documentation'
      },
      {
        name: 'Bull Board',
        description: 'Queue management and monitoring dashboard.',
        url: `${baseUrl}/queue-dashboard`,
        active: health.status === 'healthy',
        category: 'Monitoring'
      },
      {
        name: 'Socket.IO Admin',
        description: 'WebSocket monitoring dashboard. To connect: 1) Go to admin.socket.io 2) Enter Server URL: http://localhost:8088 3) Use credentials below',
        url: 'https://admin.socket.io',
        credentials: 'Username: admin, Password: admin',
        active: health.status === 'healthy',
        category: 'Monitoring'
      },
      {
        name: 'Redis Commander',
        description: 'Redis database management interface.',
        url: 'http://localhost:8082',
        credentials: 'Username: admin, Password: admin',
        active: health.services.redis.status === 'healthy',
        category: 'Database'
      },
      {
        name: 'Prisma Studio',
        description: 'PostgreSQL database management through Prisma.',
        url: 'http://localhost:5555',
        active: health.services.database.status === 'healthy',
        category: 'Database'
      },
      {
        name: 'pgAdmin',
        description: 'PostgreSQL database management interface.',
        url: 'http://localhost:5050',
        credentials: 'Email: admin@admin.com, Password: admin',
        active: health.services.database.status === 'healthy',
        category: 'Database'
      },
      {
        name: 'Logger API',
        description: 'Application logs and error tracking interface.',
        url: `${baseUrl}/logger`,
        active: health.status === 'healthy',
        category: 'Monitoring'
      },
      {
        name: 'Health Check',
        description: 'API health status and metrics dashboard.',
        url: `${baseUrl}/health`,
        active: health.status === 'healthy',
        category: 'Monitoring'
      },
    ];

    return services;
  }
} 