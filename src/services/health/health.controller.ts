import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
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

// Exclude health controller from Swagger to avoid circular dependency with SystemMetrics
// Health endpoints are simple monitoring endpoints that don't need Swagger documentation
@ApiExcludeController()
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
  // Swagger decorators removed - health controller is excluded from Swagger to avoid circular dependency
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
  // Swagger decorators removed - health controller is excluded from Swagger to avoid circular dependency
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
