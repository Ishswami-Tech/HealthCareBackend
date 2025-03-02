import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { RedisService } from '../../shared/cache/redis/redis.service';
import { KafkaService } from '../../shared/messaging/kafka/kafka.service';
import { HealthCheckResponse, ServiceHealth, SystemMetrics } from '../../libs/types/health.types';
import { ConfigService } from '@nestjs/config';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem, freemem } from 'node:os';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private startTime: number;

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

  private async checkServiceHealth(
    name: string,
    check: () => Promise<any>
  ): Promise<ServiceHealth> {
    const startTime = performance.now();
    try {
      await check();
      return {
        status: 'healthy',
        details: `${name} connected`,
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
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
  @ApiOperation({ summary: 'Get system health status' })
  @ApiResponse({ status: 200, type: Object, description: 'Health check response' })
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
    const dbHealth = await this.checkServiceHealth('PostgreSQL', async () => {
      const startQuery = performance.now();
      await this.prisma.$queryRaw`SELECT 1 as test`;
      const queryTime = Math.round(performance.now() - startQuery);
      
      return {
        metrics: {
          queryResponseTime: queryTime,
        },
      };
    });
    health.services.database = dbHealth;

    // Check Redis
    const redisHealth = await this.checkServiceHealth('Redis', async () => {
      const info = await this.redis.getClient().info();
      const metrics = {
        connectedClients: parseInt(info.match(/connected_clients:(\d+)/)?.[1] || '0'),
        usedMemory: parseInt(info.match(/used_memory:(\d+)/)?.[1] || '0'),
        totalKeys: (await this.redis.keys('*')).length,
        lastSave: new Date(parseInt(info.match(/rdb_last_save_time:(\d+)/)?.[1] || '0') * 1000).toISOString(),
      };
      return { metrics };
    });
    health.services.redis = redisHealth;

    // Check Kafka
    const kafkaHealth = await this.checkServiceHealth('Kafka', async () => {
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
} 