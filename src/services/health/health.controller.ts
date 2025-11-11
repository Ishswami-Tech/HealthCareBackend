import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { HealthCheckResponse, DetailedHealthCheckResponse } from '@core/types/common.types';
import { Public } from '@core/decorators/public.decorator';
import { FastifyReply } from 'fastify';
import { HealthcareErrorsService } from '@core/errors';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly errors: HealthcareErrorsService
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Get basic health status of core services' })
  @ApiResponse({
    status: 200,
    description: 'Basic health check successful',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['healthy', 'degraded'] },
        timestamp: { type: 'string', format: 'date-time' },
        environment: { type: 'string' },
        version: { type: 'string' },
        systemMetrics: {
          type: 'object',
          properties: {
            uptime: { type: 'number' },
            memoryUsage: {
              type: 'object',
              properties: {
                heapTotal: { type: 'number' },
                heapUsed: { type: 'number' },
                rss: { type: 'number' },
                external: { type: 'number' },
                systemTotal: { type: 'number' },
                systemFree: { type: 'number' },
                systemUsed: { type: 'number' },
              },
            },
            cpuUsage: {
              type: 'object',
              properties: {
                user: { type: 'number' },
                system: { type: 'number' },
                cpuCount: { type: 'number' },
                cpuModel: { type: 'string' },
                cpuSpeed: { type: 'number' },
              },
            },
          },
        },
        services: {
          type: 'object',
          properties: {
            api: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                responseTime: { type: 'number' },
                lastChecked: { type: 'string', format: 'date-time' },
              },
            },
            database: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                details: { type: 'string' },
                responseTime: { type: 'number' },
                lastChecked: { type: 'string', format: 'date-time' },
                metrics: {
                  type: 'object',
                  properties: {
                    queryResponseTime: { type: 'number' },
                    activeConnections: { type: 'number' },
                    maxConnections: { type: 'number' },
                    connectionUtilization: { type: 'number' },
                  },
                },
              },
            },
            redis: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                details: { type: 'string' },
                responseTime: { type: 'number' },
                lastChecked: { type: 'string', format: 'date-time' },
                metrics: {
                  type: 'object',
                  properties: {
                    connectedClients: { type: 'number' },
                    usedMemory: { type: 'number' },
                    totalKeys: { type: 'number' },
                    lastSave: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  async getHealth(@Res() res: FastifyReply): Promise<void> {
    try {
      const health = await this.healthService.checkHealth();
      return res.status(200).send(health);
    } catch (error) {
      // Fallback health response if health check fails
      const fallbackResponse: HealthCheckResponse = {
        status: 'degraded',
        timestamp: new Date().toISOString(),
        environment: process.env['NODE_ENV'] || 'development',
        version: process.env['npm_package_version'] || '0.0.1',
        systemMetrics: {
          uptime: process.uptime(),
          memoryUsage: {
            heapTotal: 0,
            heapUsed: 0,
            rss: 0,
            external: 0,
            systemTotal: 0,
            systemFree: 0,
            systemUsed: 0,
          },
          cpuUsage: {
            user: 0,
            system: 0,
            cpuCount: 0,
            cpuModel: 'unknown',
            cpuSpeed: 0,
          },
        },
        services: {
          api: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Health check failed',
          },
          database: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            metrics: {
              queryResponseTime: 0,
              activeConnections: 0,
              maxConnections: 0,
              connectionUtilization: 0,
            },
          },
          redis: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            metrics: {
              connectedClients: 0,
              usedMemory: 0,
              totalKeys: 0,
              lastSave: new Date().toISOString(),
            },
          },
          queues: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          },
          logger: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          },
          socket: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          },
          email: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          },
        },
      };
      return res.status(200).send(fallbackResponse);
    }
  }

  @Get('detailed')
  @ApiOperation({
    summary: 'Get detailed health status of all services with additional metrics',
  })
  @ApiResponse({
    status: 200,
    description: 'Detailed health check successful',
    schema: {
      allOf: [
        { $ref: '#/components/schemas/HealthCheckResponse' },
        {
          type: 'object',
          properties: {
            services: {
              type: 'object',
              properties: {
                queues: { $ref: '#/components/schemas/ServiceHealth' },
                logger: { $ref: '#/components/schemas/ServiceHealth' },
                socket: { $ref: '#/components/schemas/ServiceHealth' },
                prismaStudio: { $ref: '#/components/schemas/ServiceHealth' },
                redisCommander: { $ref: '#/components/schemas/ServiceHealth' },
                pgAdmin: { $ref: '#/components/schemas/ServiceHealth' },
              },
            },
            processInfo: {
              type: 'object',
              properties: {
                pid: { type: 'number' },
                ppid: { type: 'number' },
                platform: { type: 'string' },
                versions: {
                  type: 'object',
                  additionalProperties: { type: 'string' },
                },
              },
            },
            memory: {
              type: 'object',
              properties: {
                heapUsed: { type: 'number' },
                heapTotal: { type: 'number' },
                external: { type: 'number' },
                arrayBuffers: { type: 'number' },
              },
            },
            cpu: {
              type: 'object',
              properties: {
                user: { type: 'number' },
                system: { type: 'number' },
              },
            },
          },
        },
      ],
    },
  })
  async getDetailedHealth(@Res() res: FastifyReply): Promise<void> {
    try {
      const health = await this.healthService.checkDetailedHealth();
      return res.status(200).send(health);
    } catch (_error) {
      // Fallback detailed health response if health check fails
      let baseHealth: HealthCheckResponse;
      try {
        baseHealth = await this.healthService.checkHealth();
      } catch (_fallbackError) {
        // If getHealth also fails, create minimal fallback
        baseHealth = {
          status: 'degraded',
          timestamp: new Date().toISOString(),
          environment: process.env['NODE_ENV'] || 'development',
          version: process.env['npm_package_version'] || '0.0.1',
          systemMetrics: {
            uptime: process.uptime(),
            memoryUsage: {
              heapTotal: 0,
              heapUsed: 0,
              rss: 0,
              external: 0,
              systemTotal: 0,
              systemFree: 0,
              systemUsed: 0,
            },
            cpuUsage: {
              user: 0,
              system: 0,
              cpuCount: 0,
              cpuModel: 'unknown',
              cpuSpeed: 0,
            },
          },
          services: {
            api: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
              error: 'Health check service unavailable',
            },
            database: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
              metrics: {
                queryResponseTime: 0,
                activeConnections: 0,
                maxConnections: 0,
                connectionUtilization: 0,
              },
            },
            redis: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
              metrics: {
                connectedClients: 0,
                usedMemory: 0,
                totalKeys: 0,
                lastSave: new Date().toISOString(),
              },
            },
            queues: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            },
            logger: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            },
            socket: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            },
            email: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            },
          },
        };
      }
      const fallbackResponse: DetailedHealthCheckResponse = {
        ...baseHealth,
        services: {
          ...baseHealth.services,
          queues: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          },
          logger: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          },
          socket: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
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
          heapUsed: 0,
          heapTotal: 0,
          external: 0,
          arrayBuffers: 0,
        },
        cpu: {
          user: 0,
          system: 0,
        },
      };
      return res.status(200).send(fallbackResponse);
    }
  }

  @Get('/api-health')
  @Public()
  async apiHealth(@Res() res: FastifyReply) {
    try {
      const health = await this.healthService.checkHealth();
      return res.send(health);
    } catch (error) {
      const fallbackResponse: HealthCheckResponse = {
        status: 'degraded',
        timestamp: new Date().toISOString(),
        environment: process.env['NODE_ENV'] || 'development',
        version: process.env['npm_package_version'] || '0.0.1',
        systemMetrics: {
          uptime: process.uptime(),
          memoryUsage: {
            heapTotal: 0,
            heapUsed: 0,
            rss: 0,
            external: 0,
            systemTotal: 0,
            systemFree: 0,
            systemUsed: 0,
          },
          cpuUsage: {
            user: 0,
            system: 0,
            cpuCount: 0,
            cpuModel: 'unknown',
            cpuSpeed: 0,
          },
        },
        services: {
          api: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Health check failed',
          },
          database: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            metrics: {
              queryResponseTime: 0,
              activeConnections: 0,
              maxConnections: 0,
              connectionUtilization: 0,
            },
          },
          redis: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            metrics: {
              connectedClients: 0,
              usedMemory: 0,
              totalKeys: 0,
              lastSave: new Date().toISOString(),
            },
          },
          queues: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          },
          logger: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          },
          socket: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          },
          email: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          },
        },
      };
      return res.send(fallbackResponse);
    }
  }

  @Get('/api')
  @Public()
  async apiStatus(@Res() res: FastifyReply) {
    try {
      return res.send({
        status: 'ok',
        message: 'API is running',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Log any error that occurs in this simple endpoint
      const errorMsg = error instanceof Error ? error.message : String(error);
      return res.status(200).send({
        status: 'ok',
        message: 'API is running',
        timestamp: new Date().toISOString(),
        debug: errorMsg,
      });
    }
  }

  @Get('/favicon.ico')
  @Public()
  async favicon(@Res() res: FastifyReply) {
    return res.status(204).send();
  }
}
