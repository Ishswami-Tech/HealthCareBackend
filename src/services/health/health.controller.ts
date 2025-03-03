import { Controller, Get, ServiceUnavailableException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { RedisService } from '../../shared/cache/redis/redis.service';
import { KafkaService } from '../../shared/messaging/kafka/kafka.service';
import { HealthCheckResponse, ServiceHealth, SystemMetrics, RedisMetrics, DatabaseMetrics, KafkaMetrics } from '../../libs/types/health.types';
import { ConfigService } from '@nestjs/config';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem, freemem } from 'node:os';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private startTime: number;
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly kafka: KafkaService,
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
    description: 'Returns the health status of all system components including API, database, Redis, and Kafka. No parameters required.'
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
            redis: { type: 'object', description: 'Redis service health and metrics' },
            kafka: { type: 'object', description: 'Kafka service health and metrics' }
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
        kafka: { status: 'unknown' },
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

    // Check Kafka
    const kafkaHealth = await this.checkServiceHealth<KafkaMetrics>('Kafka', async () => {
      const admin = this.kafka.admin();
      await admin.connect();
      
      const [topics, groups] = await Promise.all([
        admin.listTopics(),
        admin.listGroups(),
      ]);
      
      const topicMetadata = await admin.fetchTopicMetadata({ topics });
      const partitionCount = topicMetadata.topics.reduce(
        (sum, topic) => sum + topic.partitions.length,
        0
      );

      const brokerCount = (await admin.describeCluster()).brokers.length;
      
      await admin.disconnect();
      
      return {
        metrics: {
          brokers: brokerCount,
          topics: topics.length,
          partitions: partitionCount,
          consumerGroups: groups.groups.length,
        },
      };
    });
    health.services.kafka = kafkaHealth;

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
} 