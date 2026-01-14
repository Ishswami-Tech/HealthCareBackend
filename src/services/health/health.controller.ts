import { Controller, Get, Res, Query, Inject, Optional, forwardRef } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Public } from '@core/decorators/public.decorator';
import { RateLimitGenerous } from '@security/rate-limit/rate-limit.decorator';
import { FastifyReply } from 'fastify';
import { HealthService } from './health.service';
import { PrismaService } from '@infrastructure/database/prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    @Optional()
    @Inject(forwardRef(() => PrismaService))
    private readonly prismaService?: PrismaService
  ) {}

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
  @Get()
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
                primaryProvider: { type: 'string', example: 'openvidu' },
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
      // CRITICAL: Check Prisma connection directly - requires actual database connection
      // This ensures database is ACTUALLY connected before returning healthy
      const isDatabaseConnected = this.prismaService?.isReady() ?? false;

      const isDetailed = detailed === 'true' || detailed === '1';
      const healthResult = isDetailed
        ? await this.healthService.getDetailedHealth()
        : await this.healthService.getHealth();

      const databaseStatus = healthResult.services?.database;

      // Application is healthy only if:
      // 1. Prisma is actually connected (isReady() returns true)
      // 2. Health check shows database as healthy
      // 3. Overall health status is healthy
      if (
        isDatabaseConnected &&
        databaseStatus?.status === 'healthy' &&
        healthResult.status === 'healthy'
      ) {
        // Database is connected and all services are healthy - return 200
        return res.status(200).send(healthResult);
      } else {
        // Database not connected or services unhealthy - return 503
        return res.status(503).send({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          message:
            'Application is not ready - database connection in progress or services unhealthy',
          database: {
            connected: isDatabaseConnected,
            healthStatus: databaseStatus?.status,
            details: databaseStatus?.details,
          },
          services: healthResult.services,
        });
      }
    } catch (error) {
      // If health check fails, return 503
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return res.status(503).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        message: `Health check failed: ${errorMessage}`,
      });
    }
  }
}
