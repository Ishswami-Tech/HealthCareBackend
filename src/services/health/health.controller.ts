import { Controller, Get, Res, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { HealthCheckResponse, DetailedHealthCheckResponse } from '@core/types/common.types';
import { Public } from '@core/decorators/public.decorator';
import { FastifyReply } from 'fastify';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {
    // Defensive check: ensure healthService is injected
    if (!this.healthService) {
      console.error('[HealthController] HealthService is not injected!');
    }
  }

  /**
   * Basic Health Check Endpoint
   *
   * Returns lightweight health status of core services.
   * Uses smart caching (15-30s freshness) to avoid excessive requests.
   * Perfect for load balancers, monitoring tools, and quick status checks.
   */
  @Get()
  @Public()
  @ApiOperation({
    summary: 'Get basic health status of core services',
    description:
      'Lightweight health check with smart caching. Returns cached status if fresh (< 30s), otherwise performs quick checks. Perfect for load balancers and monitoring.',
  })
  @ApiResponse({
    status: 200,
    description: 'Basic health check successful',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
        timestamp: { type: 'string', format: 'date-time' },
        environment: { type: 'string' },
        version: { type: 'string' },
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
                responseTime: { type: 'number' },
                lastChecked: { type: 'string', format: 'date-time' },
              },
            },
            cache: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                responseTime: { type: 'number' },
                lastChecked: { type: 'string', format: 'date-time' },
              },
            },
            queue: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                responseTime: { type: 'number' },
                lastChecked: { type: 'string', format: 'date-time' },
              },
            },
            logger: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                responseTime: { type: 'number' },
                lastChecked: { type: 'string', format: 'date-time' },
              },
            },
            socket: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                responseTime: { type: 'number' },
                lastChecked: { type: 'string', format: 'date-time' },
              },
            },
            email: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                responseTime: { type: 'number' },
                lastChecked: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
  })
  async getHealth(@Res() res: FastifyReply): Promise<void> {
    try {
      // Ensure healthService is available
      if (!this.healthService) {
        throw new Error('HealthService is not available');
      }
      const health = await this.healthService.getHealth();
      return res.status(200).send(health);
    } catch (error) {
      // Fallback: return degraded status if health check fails
      // IMPORTANT: If we can return this response, the API is healthy!
      const errorMessage = error instanceof Error ? error.message : 'Health check failed';
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
            status: 'healthy' as const, // API is healthy if we can respond
            responseTime: 10,
            lastChecked: new Date().toISOString(),
            details: 'API service is running and responding',
          },
          database: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          },
          cache: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          },
          queue: {
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

  /**
   * Test individual service health
   * Useful for debugging which service is failing
   */
  @Get('test/:service')
  @Public()
  @ApiOperation({
    summary: 'Test individual service health',
    description: 'Test a specific service health check (database, cache, queue, logger, socket, email)',
  })
  async testService(@Param('service') service: string, @Res() res: FastifyReply): Promise<void> {
    try {
      if (!this.healthService) {
        return res.status(500).send({ error: 'HealthService is not available' });
      }

      let result: { service: string; status: string; details: string; error?: string };
      
              switch (service.toLowerCase()) {
                case 'database':
                  result = await this.healthService.checkDatabaseHealth().then(health => {
                    const baseResult = {
                      service: 'database',
                      status: health.status,
                      details: health.details || 'No details available',
                    };
                    return health.error ? { ...baseResult, error: health.error } : baseResult;
                  });
                  break;
                case 'cache':
                case 'redis':
                  result = await this.healthService.checkRedisHealth().then(health => {
                    const baseResult = {
                      service: 'cache',
                      status: health.status,
                      details: health.details || 'No details available',
                    };
                    return health.error ? { ...baseResult, error: health.error } : baseResult;
                  });
                  break;
                case 'queue':
                  result = await this.healthService.checkQueueHealth().then(health => {
                    const baseResult = {
                      service: 'queue',
                      status: health.status,
                      details: health.details || 'No details available',
                    };
                    return health.error ? { ...baseResult, error: health.error } : baseResult;
                  });
                  break;
                case 'logger':
                  result = await this.healthService.checkLoggerHealth().then(health => {
                    const baseResult = {
                      service: 'logger',
                      status: health.status,
                      details: health.details || 'No details available',
                    };
                    return health.error ? { ...baseResult, error: health.error } : baseResult;
                  });
                  break;
                case 'socket':
                  result = await this.healthService.checkSocketHealth().then(health => {
                    const baseResult = {
                      service: 'socket',
                      status: health.status,
                      details: health.details || 'No details available',
                    };
                    return health.error ? { ...baseResult, error: health.error } : baseResult;
                  });
                  break;
                case 'email':
                  result = await this.healthService.checkEmailHealth().then(health => {
                    const baseResult = {
                      service: 'email',
                      status: health.status,
                      details: health.details || 'No details available',
                    };
                    return health.error ? { ...baseResult, error: health.error } : baseResult;
                  });
                  break;
        default:
          return res.status(400).send({
            error: 'Invalid service name',
            availableServices: ['database', 'cache', 'queue', 'logger', 'socket', 'email'],
          });
      }

      return res.status(200).send(result);
    } catch (error) {
      return res.status(500).send({
        service,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Detailed Health Check Endpoint
   *
   * Returns comprehensive health status with detailed metrics.
   * Includes system metrics, process info, and extended service details.
   * Uses smart caching but may perform fresh checks if cache is stale.
   */
  @Get('detailed')
  @Public()
  @ApiOperation({
    summary: 'Get detailed health status with comprehensive metrics',
    description:
      'Comprehensive health check with detailed metrics, system information, and extended service status. Uses smart caching for performance.',
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
      const health = await this.healthService.getDetailedHealth();
      return res.status(200).send(health);
    } catch (_error) {
      // Fallback: try to get basic health first
      let baseHealth: HealthCheckResponse;
      try {
        baseHealth = await this.healthService.getHealth();
      } catch (_fallbackError) {
        // If basic health also fails, create minimal fallback
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
              status: 'healthy' as const, // API is healthy if we can respond
              responseTime: 10,
              lastChecked: new Date().toISOString(),
              details: 'API service is running and responding',
            },
            database: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            },
            cache: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            },
            queue: {
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
}
