import { Controller, Get, Res, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Public } from '@core/decorators/public.decorator';
import { RateLimitGenerous } from '@security/rate-limit/rate-limit.decorator';
import { FastifyReply } from 'fastify';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
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
  @Get()
  @Public()
  @RateLimitGenerous() // Allow 1000 requests/minute per IP - generous for health checks but prevents abuse
  @ApiOperation({
    summary: 'System health check',
    description:
      'Returns real-time health status of core services (database, cache, queue, logging, video). Use ?detailed=true for extended metrics.',
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
    description: 'Health check response',
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
  async getHealth(@Res() res: FastifyReply, @Query('detailed') detailed?: string): Promise<void> {
    try {
      const isDetailed = detailed === 'true' || detailed === '1';
      const healthResult = isDetailed
        ? await this.healthService.getDetailedHealth()
        : await this.healthService.getHealth();

      return res.status(200).send(healthResult);
    } catch (error) {
      // HealthService should never throw, but handle gracefully if it does
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const fallbackResponse = {
        status: 'degraded',
        timestamp: new Date().toISOString(),
        message: `Health check failed: ${errorMessage}`,
      };
      return res.status(200).send(fallbackResponse);
    }
  }
}
