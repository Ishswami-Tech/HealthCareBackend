import { Controller, Get, Res, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@core/decorators/public.decorator';
import { RateLimitGenerous } from '@security/rate-limit/rate-limit.decorator';
import { FastifyReply } from 'fastify';
import { HealthService } from './health.service';

// Exclude health controller from Swagger to avoid circular dependency with SystemMetrics
// Health endpoints are simple monitoring endpoints that don't need Swagger documentation
@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Unified Health Check Endpoint using HealthService (Terminus-based)
   *
   * Returns real-time health status of core services using Terminus health indicators.
   * Always performs fresh health checks for accurate status.
   * Includes realtime status from realtime health monitoring system.
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
  // Swagger decorators removed - health controller is excluded from Swagger to avoid circular dependency
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
