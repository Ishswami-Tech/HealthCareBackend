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

      // Application is healthy only if database and overall health are healthy.
      // Database status comes from DatabaseService.getHealthStatus() via DatabaseHealthIndicator.
      const isDatabaseHealthy = databaseStatus?.status === 'healthy';
      const isOverallHealthy = healthResult.status === 'healthy';

      if (isDatabaseHealthy && isOverallHealthy) {
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
}
