import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { HealthCheckResponse, DetailedHealthCheckResponse } from '../../libs/types/health.types';
import { Public } from '../../libs/decorators/public.decorator';
import { FastifyReply } from 'fastify';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

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
                systemUsed: { type: 'number' }
              }
            },
            cpuUsage: {
              type: 'object',
              properties: {
                user: { type: 'number' },
                system: { type: 'number' },
                cpuCount: { type: 'number' },
                cpuModel: { type: 'string' },
                cpuSpeed: { type: 'number' }
              }
            }
          }
        },
        services: {
          type: 'object',
          properties: {
            api: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                responseTime: { type: 'number' },
                lastChecked: { type: 'string', format: 'date-time' }
              }
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
                    connectionUtilization: { type: 'number' }
                  }
                }
              }
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
                    lastSave: { type: 'string', format: 'date-time' }
                  }
                }
              }
            }
          }
        }
      }
    }
  })
  async getHealth(): Promise<HealthCheckResponse> {
    return this.healthService.checkHealth();
  }

  @Get('detailed')
  @ApiOperation({ summary: 'Get detailed health status of all services with additional metrics' })
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
                pgAdmin: { $ref: '#/components/schemas/ServiceHealth' }
              }
            },
            processInfo: {
              type: 'object',
              properties: {
                pid: { type: 'number' },
                ppid: { type: 'number' },
                platform: { type: 'string' },
                versions: { 
                  type: 'object',
                  additionalProperties: { type: 'string' }
                }
              }
            },
            memory: {
              type: 'object',
              properties: {
                heapUsed: { type: 'number' },
                heapTotal: { type: 'number' },
                external: { type: 'number' },
                arrayBuffers: { type: 'number' }
              }
            },
            cpu: {
              type: 'object', 
              properties: {
                user: { type: 'number' },
                system: { type: 'number' }
              }
            }
          }
        }
      ]
    }
  })
  async getDetailedHealth(): Promise<DetailedHealthCheckResponse> {
    return this.healthService.checkDetailedHealth();
  }

  @Get('/api-health')
  @Public()
  async apiHealth(@Res() res: FastifyReply) {
    const health = await this.getHealth();
    return res.send(health);
  }

  @Get('/api')
  @Public()
  async apiStatus(@Res() res: FastifyReply) {
    return res.send({ status: 'ok', message: 'API is running', timestamp: new Date().toISOString() });
  }
} 
