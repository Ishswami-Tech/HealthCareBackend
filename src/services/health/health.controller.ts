import { nowIso } from '@utils/date-time.util';
import { Controller, Get, Res, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Public } from '@core/decorators/public.decorator';
import { RateLimitGenerous } from '@security/rate-limit/rate-limit.decorator';
import { FastifyReply } from 'fastify';
import { HealthService } from './health.service';

/**
 * Health controller uses HealthService only.
 * Database readiness comes from DatabaseService.getHealthStatus() via DatabaseHealthIndicator.
 */
@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Unified Health Check Endpoint using HealthService
   *
   * Returns real-time health status of core services using health indicators.
   * Always performs fresh health checks for accurate status.
   * Includes realtime status from realtime health monitoring system.
   * Uses only LoggingService (per .ai-rules/ coding standards).
   * Perfect for load balancers, monitoring tools, and real-time status checks.
   *
   * Query Parameters:
   * - detailed: boolean - If true, includes system metrics, process info, and extended details
   *
   * Examples:
   * - GET /health - Basic health check (includes realtime status)
   * - GET /health?detailed=true - Detailed health check with system metrics (includes realtime status)
   */
  @Get('health')
  @Public()
  @RateLimitGenerous() // Allow 1000 requests/minute per IP - generous for health checks but prevents abuse
  @ApiOperation({
    summary: 'System health check (requires database connection)',
    description:
      'Returns real-time health status of core services. Requires actual database connection. Returns 200 when ready, 503 when not ready. Use ?detailed=true for extended metrics.',
  })
  @ApiQuery({
    name: 'detailed',
    required: false,
    type: String,
    description: 'If true, includes system metrics, process info, and extended details',
    example: 'true',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is healthy and ready to serve traffic (database connected)',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'healthy' },
        timestamp: { type: 'string', example: '2025-12-31T19:00:00.000Z' },
        environment: { type: 'string', example: 'production' },
        services: {
          type: 'object',
          properties: {
            database: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'healthy' },
                responseTime: { type: 'number', example: 45 },
              },
            },
            cache: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'healthy' },
                responseTime: { type: 'number', example: 2 },
              },
            },
            queue: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'healthy' },
                responseTime: { type: 'number', example: 1 },
              },
            },
            logging: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'healthy' },
                responseTime: { type: 'number', example: 1 },
              },
            },
            video: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'healthy' },
                primaryProvider: { type: 'string', example: 'cloudflare' },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Application is not ready (database not connected or services unhealthy)',
  })
  async getHealth(@Res() res: FastifyReply, @Query('detailed') detailed?: string): Promise<void> {
    try {
      const isDetailed = detailed === 'true' || detailed === '1';
      const healthResult = isDetailed
        ? await this.healthService.getDetailedHealth()
        : await this.healthService.getHealth();

      const databaseStatus = healthResult.services?.database as
        | { status?: string; details?: unknown }
        | undefined;

      // Application is healthy when core services (database, cache, logging) are healthy.
      // Queue/RabbitMQ is non-blocking — it runs in the worker process, so queue
      // issues don't affect the API's ability to serve requests.
      const isDatabaseHealthy = databaseStatus?.status === 'healthy';
      const coreStatus = healthResult.status;
      const isCoreHealthy = coreStatus === 'healthy' || coreStatus === 'degraded';

      if (isDatabaseHealthy && isCoreHealthy) {
        return res.status(200).send(healthResult);
      }

      return res.status(503).send({
        status: 'unhealthy',
        timestamp: nowIso(),
        message: 'Application is not ready - database connection in progress or services unhealthy',
        database: {
          healthStatus: databaseStatus?.status,
          details: databaseStatus?.details,
        },
        services: healthResult.services,
      });
    } catch (error) {
      // If health check fails, return 503
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return res.status(503).send({
        status: 'unhealthy',
        timestamp: nowIso(),
        message: `Health check failed: ${errorMessage}`,
      });
    }
  }

  /**
   * Lightweight infrastructure liveness endpoint.
   *
   * This endpoint intentionally avoids database, cache, queue, and logging
   * dependencies so it can be used by Coolify, Traefik, and deploy-time health
   * gates without changing the existing `/health` contract.
   */
  @Get('infra-health')
  @Public()
  @RateLimitGenerous()
  @ApiOperation({
    summary: 'Infrastructure liveness check',
    description:
      'Returns a lightweight 200 OK response that is safe for load balancers, reverse proxies, and deploy-time readiness checks. Does not perform dependency checks.',
  })
  @ApiResponse({
    status: 200,
    description: 'Infrastructure is up and accepting traffic',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'healthy' },
        timestamp: { type: 'string', example: '2025-12-31T19:00:00.000Z' },
        service: { type: 'string', example: 'infrastructure' },
        message: {
          type: 'string',
          example: 'Infrastructure is ready to receive traffic',
        },
      },
    },
  })
  getInfraHealth(@Res() res: FastifyReply): void {
    res.status(200).send({
      status: 'healthy',
      timestamp: nowIso(),
      service: 'infrastructure',
      message: 'Infrastructure is ready to receive traffic',
    });
  }

  /**
   * Build / version endpoint.
   *
   * Returns the GIT_SHA, GIT_REF, BUILD_TIMESTAMP, and NODE_ENV that the
   * currently running container was built with. Used to verify which image
   * is actually deployed (compare the returned gitSha to the latest commit
   * on the preprod/main branch).
   */
  @Get('version')
  @Public()
  @RateLimitGenerous()
  @ApiOperation({
    summary: 'Build / version info',
    description:
      'Returns the GIT_SHA, GIT_REF, BUILD_TIMESTAMP, environment, and service metadata of the running image. Compare gitSha to the latest commit on the deployed branch to verify which build is actually live.',
  })
  @ApiResponse({
    status: 200,
    description: 'Running image build metadata',
    schema: {
      type: 'object',
      properties: {
        service: { type: 'string', example: 'healthcare-api' },
        environment: { type: 'string', example: 'production' },
        version: { type: 'string', example: '1.0.0' },
        gitSha: { type: 'string', example: 'abc1234567890abcdef' },
        gitRef: { type: 'string', example: 'refs/heads/preprod' },
        buildTimestamp: { type: 'string', example: '2026-08-16T03:54:28.000Z' },
        nodeVersion: { type: 'string', example: '22.23.2' },
        uptime: { type: 'number', example: 3600 },
        imageName: {
          type: 'string',
          example: 'ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:preprod-abc123',
        },
        pid: { type: 'number', example: 42 },
        platform: { type: 'string', example: 'linux' },
        arch: { type: 'string', example: 'x64' },
        featureFlags: {
          type: 'object',
          properties: {
            whatsappEnabled: { type: 'boolean' },
            videoEnabled: { type: 'boolean' },
            paymentEnabled: { type: 'boolean' },
            cacheEnabled: { type: 'boolean' },
            auditLogsEnabled: { type: 'boolean' },
            swaggerEnabled: { type: 'boolean' },
          },
        },
        config: {
          type: 'object',
          properties: {
            apiPrefix: { type: 'string', example: '/api/v1' },
            corsOrigins: { type: 'string', example: 'https://www.viddhakarma.com' },
            frontendUrl: { type: 'string', example: 'https://www.viddhakarma.com' },
            apiDomain: { type: 'string', example: 'backend-service-v1.ishswami.in' },
            databaseProvider: { type: 'string', example: 'postgresql' },
            cacheProvider: { type: 'string', example: 'dragonfly' },
            videoProvider: { type: 'string', example: 'daily' },
            timezone: { type: 'string', example: 'Asia/Kolkata' },
          },
        },
        timestamp: { type: 'string', example: '2026-08-16T04:00:00.000Z' },
      },
    },
  })
  getVersion(@Res() res: FastifyReply): void {
    const gitSha = process.env['GIT_SHA'] || 'unknown';
    const gitRef = process.env['GIT_REF'] || 'unknown';
    const buildTimestamp = process.env['BUILD_TIMESTAMP'] || 'unknown';
    const environment = process.env['NODE_ENV'] || 'development';
    const version = process.env['npm_package_version'] || '0.0.0';

    const corsOrigins = process.env['CORS_ORIGIN'] || '';
    const frontendUrl = process.env['FRONTEND_URL'] || '';
    const apiDomain = process.env['API_DOMAIN'] || '';
    const databaseUrl = process.env['DIRECT_URL'] || process.env['DATABASE_URL'] || '';
    const databaseProvider =
      databaseUrl.includes('postgresql') || databaseUrl.includes('postgres')
        ? 'postgresql'
        : databaseUrl.includes('mysql')
          ? 'mysql'
          : 'unknown';
    const cacheProvider = (
      process.env['CACHE_PROVIDER'] || process.env['DRAGONFLY_ENABLED'] === 'true'
        ? 'dragonfly'
        : 'unknown'
    ).toLowerCase();
    const videoProvider = (process.env['VIDEO_PROVIDER'] || 'unknown').toLowerCase();

    res.status(200).send({
      service: 'healthcare-api',
      environment,
      version,
      gitSha,
      gitRef,
      buildTimestamp,
      nodeVersion: process.version,
      uptime: Math.floor(process.uptime()),
      imageName: process.env['HOSTNAME'] || 'unknown',
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      featureFlags: {
        whatsappEnabled: process.env['WHATSAPP_ENABLED'] === 'true',
        videoEnabled: process.env['VIDEO_ENABLED'] === 'true',
        paymentEnabled: process.env['PAYMENT_ENABLED_PROVIDERS']
          ? process.env['PAYMENT_ENABLED_PROVIDERS'].split(',').length > 0
          : false,
        cacheEnabled: process.env['CACHE_ENABLED'] === 'true',
        auditLogsEnabled: process.env['ENABLE_AUDIT_LOGS'] === 'true',
        swaggerEnabled: process.env['API_DOCS_ENABLED'] !== 'false',
      },
      config: {
        apiPrefix: process.env['API_PREFIX'] || '/api/v1',
        corsOrigins: corsOrigins
          ? corsOrigins.split(',')[0] +
            (corsOrigins.includes(',') ? ` (+${corsOrigins.split(',').length - 1} more)` : '')
          : '',
        frontendUrl,
        apiDomain,
        databaseProvider,
        cacheProvider,
        videoProvider,
        timezone: process.env['TZ'] || 'UTC',
      },
      timestamp: nowIso(),
    });
  }
}
