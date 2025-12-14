import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@config/config.service';
import { HealthService } from './health.service';
import { HealthCheckResponse, DetailedHealthCheckResponse } from '@core/types/common.types';
import { Public } from '@core/decorators/public.decorator';
import { RateLimitGenerous } from '@security/rate-limit/rate-limit.decorator';
import { FastifyReply } from 'fastify';
import { DatabaseHealthIndicator } from './health-indicators/database-health.indicator';
import { CacheHealthIndicator } from './health-indicators/cache-health.indicator';
import { QueueHealthIndicator } from './health-indicators/queue-health.indicator';
import { LoggingHealthIndicator } from './health-indicators/logging-health.indicator';
import { CommunicationHealthIndicator } from './health-indicators/communication-health.indicator';
import { VideoHealthIndicator } from './health-indicators/video-health.indicator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly configService: ConfigService,
    private readonly health: HealthCheckService,
    private readonly databaseHealthIndicator: DatabaseHealthIndicator,
    private readonly cacheHealthIndicator: CacheHealthIndicator,
    private readonly queueHealthIndicator: QueueHealthIndicator,
    private readonly loggingHealthIndicator: LoggingHealthIndicator,
    private readonly communicationHealthIndicator: CommunicationHealthIndicator,
    private readonly videoHealthIndicator: VideoHealthIndicator
  ) {
    // Defensive check: ensure healthService is injected
    // Note: This check is performed at construction time before LoggingService is available
    // Using console.error is acceptable here as it's a critical initialization error
    if (!this.healthService) {
      console.error('[HealthController] HealthService is not injected!');
    }
  }

  /**
   * Basic Health Check Endpoint using @nestjs/terminus
   *
   * Returns real-time health status of core services using Terminus health indicators.
   * Always performs fresh health checks for accurate status.
   * Uses robust database health check with dedicated connection pool.
   * Perfect for load balancers, monitoring tools, and real-time status checks.
   */
  @Get()
  @HealthCheck()
  @Public()
  @RateLimitGenerous() // Allow 1000 requests/minute per IP - generous for health checks but prevents abuse
  @ApiOperation({
    summary: 'Get real-time health status of core services using Terminus',
    description:
      "Real-time health check with fresh status using @nestjs/terminus. Always performs fresh checks for accurate status. Uses robust database health check with dedicated connection pool (won't exhaust main pool). Perfect for load balancers and monitoring.",
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
                details: { type: 'string' },
                queueHealth: {
                  type: 'object',
                  properties: {
                    healthy: { type: 'boolean' },
                    connection: {
                      type: 'object',
                      properties: {
                        connected: { type: 'boolean' },
                        latency: { type: 'number' },
                        provider: { type: 'string' },
                      },
                    },
                    metrics: {
                      type: 'object',
                      properties: {
                        totalJobs: { type: 'number' },
                        activeJobs: { type: 'number' },
                        waitingJobs: { type: 'number' },
                        failedJobs: { type: 'number' },
                        completedJobs: { type: 'number' },
                        errorRate: { type: 'number' },
                      },
                    },
                    performance: {
                      type: 'object',
                      properties: {
                        averageProcessingTime: { type: 'number' },
                        throughputPerMinute: { type: 'number' },
                      },
                    },
                    queues: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          waiting: { type: 'number' },
                          active: { type: 'number' },
                          completed: { type: 'number' },
                          failed: { type: 'number' },
                          delayed: { type: 'number' },
                        },
                      },
                    },
                    issues: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
            logger: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                responseTime: { type: 'number' },
                lastChecked: { type: 'string', format: 'date-time' },
                details: { type: 'string' },
                loggingHealth: {
                  type: 'object',
                  properties: {
                    healthy: { type: 'boolean' },
                    service: {
                      type: 'object',
                      properties: {
                        available: { type: 'boolean' },
                        latency: { type: 'number' },
                        serviceName: { type: 'string' },
                      },
                    },
                    endpoint: {
                      type: 'object',
                      properties: {
                        accessible: { type: 'boolean' },
                        latency: { type: 'number' },
                        url: { type: 'string' },
                        port: { type: 'number' },
                        statusCode: { type: 'number' },
                      },
                    },
                    metrics: {
                      type: 'object',
                      properties: {
                        totalLogs: { type: 'number' },
                        errorRate: { type: 'number' },
                        averageResponseTime: { type: 'number' },
                      },
                    },
                    performance: {
                      type: 'object',
                      properties: {
                        throughput: { type: 'number' },
                        bufferSize: { type: 'number' },
                        flushInterval: { type: 'number' },
                      },
                    },
                    issues: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
            communication: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                responseTime: { type: 'number' },
                lastChecked: { type: 'string', format: 'date-time' },
                details: { type: 'string' },
                communicationHealth: {
                  type: 'object',
                  properties: {
                    healthy: { type: 'boolean' },
                    socket: {
                      type: 'object',
                      properties: {
                        connected: { type: 'boolean' },
                        latency: { type: 'number' },
                        connectedClients: { type: 'number' },
                      },
                    },
                    email: {
                      type: 'object',
                      properties: {
                        connected: { type: 'boolean' },
                        latency: { type: 'number' },
                        provider: { type: 'string' },
                      },
                    },
                    whatsapp: {
                      type: 'object',
                      properties: {
                        connected: { type: 'boolean' },
                        latency: { type: 'number' },
                        enabled: { type: 'boolean' },
                      },
                    },
                    push: {
                      type: 'object',
                      properties: {
                        connected: { type: 'boolean' },
                        latency: { type: 'number' },
                        provider: { type: 'string' },
                      },
                    },
                    metrics: {
                      type: 'object',
                      properties: {
                        socketConnections: { type: 'number' },
                        emailQueueSize: { type: 'number' },
                      },
                    },
                    performance: {
                      type: 'object',
                      properties: {
                        socketThroughput: { type: 'number' },
                        emailThroughput: { type: 'number' },
                      },
                    },
                    issues: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  async getHealth(@Res() res: FastifyReply) {
    try {
      // Use Terminus health checks
      const healthCheckResult = await this.health.check([
        () => this.databaseHealthIndicator.check('database'),
        () => this.cacheHealthIndicator.check('cache'),
        () => this.queueHealthIndicator.check('queue'),
        () => this.loggingHealthIndicator.check('logging'),
        () => this.communicationHealthIndicator.check('communication'),
        () => this.videoHealthIndicator.check('video'),
      ]);

      return res.status(200).send(healthCheckResult);
    } catch (_error) {
      // Terminus throws when ANY indicator reports "down".
      // The error normally contains the structured health result in `causes` (HealthCheckError),
      // or in `response` (framework-wrapped exception). Return that instead of a generic payload.
      if (_error instanceof HealthCheckError) {
        const causes = _error.causes as Record<string, unknown> | undefined;
        if (typeof causes === 'object' && causes !== null) {
          return res.status(200).send(causes);
        }
      }
      if (typeof _error === 'object' && _error !== null) {
        const errRecord = _error as Record<string, unknown>;
        const causes = errRecord['causes'];
        if (typeof causes === 'object' && causes !== null) {
          return res.status(200).send(causes);
        }
        const response = errRecord['response'];
        if (typeof response === 'object' && response !== null) {
          return res.status(200).send(response);
        }
      }

      // Fallback: return degraded status if health check fails
      // IMPORTANT: If we can return this response, the API is healthy!
      // Use ConfigService (which uses dotenv) for environment variable access
      const fallbackResponse: HealthCheckResponse = {
        status: 'degraded',
        timestamp: new Date().toISOString(),
        environment: this.configService.getEnvironment(),
        version: this.configService.getEnv('npm_package_version') || '0.0.1',
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
          communication: {
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
   * Detailed Health Check Endpoint
   *
   * Returns comprehensive real-time health status with detailed metrics.
   * Includes system metrics, process info, and extended service details.
   * Always performs fresh health checks for accurate real-time status.
   */
  @Get('detailed')
  @Public()
  @RateLimitGenerous() // Allow 1000 requests/minute per IP - generous for health checks but prevents abuse
  @ApiOperation({
    summary: 'Get detailed real-time health status with comprehensive metrics',
    description:
      'Comprehensive real-time health check with detailed metrics, system information, and extended service status. Always performs fresh checks for accurate status. Uses robust database health check with dedicated connection pool.',
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
          environment: this.configService.getEnvironment(),
          version: this.configService.getEnv('npm_package_version') || '0.0.1',
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
            communication: {
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
