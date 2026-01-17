/**
 * Health Aggregator Service
 * Aggregates health check results from HealthService into unified status
 * Uses HealthService as the single source of truth (no Terminus dependency)
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthService } from '../../health.service';
import { SystemHealthChecker } from '../checkers/system-health.checker';
import { SocketHealthChecker } from '../checkers/socket-health.checker';
import type {
  AggregatedHealthStatus,
  ServiceHealthStatus,
  RealtimeSystemMetrics,
  RealtimeHealthStatus,
  RealtimeHealthCheckResult,
} from '@core/types';
import { Server } from 'socket.io';

@Injectable()
export class HealthAggregatorService {
  // Real-time CPU tracking for dynamic calculation
  private previousCpuUsage: { user: number; system: number } | null = null;
  private previousCpuTimestamp: number = Date.now();

  constructor(
    private readonly healthService: HealthService,
    private readonly systemChecker: SystemHealthChecker,
    private readonly socketChecker: SocketHealthChecker,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  /**
   * Aggregate all health checks into unified status using HealthService
   * HealthService uses health indicators with LoggingService, ensuring consistency across all health checks
   */
  async aggregateHealth(socketServer?: Server): Promise<AggregatedHealthStatus> {
    const startTime = Date.now();

    try {
      // Get health status from HealthService (no Terminus dependency)
      const healthResponse = await this.healthService.getHealth();

      // Transform HealthService response to AggregatedHealthStatus format
      const services: Record<string, ServiceHealthStatus> = {};

      // Map HealthService services to AggregatedHealthStatus format
      if (healthResponse.services) {
        // Database
        const databaseService = healthResponse.services['database'];
        if (databaseService) {
          services['database'] = this.transformServiceHealth(databaseService);
        }

        // Cache
        const cacheService = healthResponse.services['cache'];
        if (cacheService) {
          services['cache'] = this.transformServiceHealth(cacheService);
        }

        // Queue
        const queueService = healthResponse.services['queue'];
        if (queueService) {
          services['queue'] = this.transformServiceHealth(queueService);
        }

        // Logger (service key is 'logging' in HealthService, but response uses 'logger')
        const loggerService =
          healthResponse.services['logger'] ||
          (healthResponse.services as Record<string, unknown>)['logging'];
        if (loggerService) {
          services['logger'] = this.transformServiceHealth(loggerService);
        }

        // Video (same pattern as other services)
        const videoService = healthResponse.services['video'];
        if (videoService) {
          services['video'] = this.transformServiceHealth(videoService);
        }
      }

      // Check socket health separately
      let socketHealth: ServiceHealthStatus;
      try {
        const socketResult = await this.socketChecker.check(socketServer);
        socketHealth = this.transformRealtimeCheckResult(socketResult);
      } catch {
        socketHealth = {
          status: 'unhealthy',
          responseTime: 0,
          timestamp: new Date().toISOString(),
          error: 'Socket health check failed',
        };
      }
      services['socket'] = socketHealth;

      // Get system metrics (SystemHealthChecker now provides real-time CPU)
      const systemMetrics = this.systemChecker.getSystemMetrics();

      // Use real-time CPU from SystemHealthChecker (already calculated dynamically)
      // SystemHealthChecker tracks previous CPU usage and calculates delta over time
      let cpuValue = systemMetrics.cpu;

      // If we have system metrics from HealthService, we can also calculate real-time CPU here
      // as a fallback or verification
      if (healthResponse.systemMetrics) {
        const now = Date.now();
        const userMicroseconds = healthResponse.systemMetrics.cpuUsage.user;
        const systemMicroseconds = healthResponse.systemMetrics.cpuUsage.system;
        const cpuCount = healthResponse.systemMetrics.cpuUsage.cpuCount;

        // Calculate real-time CPU using delta method (more accurate than cumulative average)
        if (this.previousCpuUsage !== null && cpuCount > 0) {
          const timeDelta = (now - this.previousCpuTimestamp) / 1000; // seconds

          if (timeDelta > 0) {
            // Calculate CPU time delta
            const cpuDelta = {
              user: userMicroseconds - this.previousCpuUsage.user,
              system: systemMicroseconds - this.previousCpuUsage.system,
            };
            const totalCpuDelta = cpuDelta.user + cpuDelta.system;

            // Real-time CPU: (cpu_delta_seconds / time_delta / cpu_count) * 100
            const realtimeCpu = (totalCpuDelta / 1000000 / timeDelta / cpuCount) * 100;

            // Use real-time calculation if valid, otherwise use SystemHealthChecker value
            if (realtimeCpu >= 0 && realtimeCpu <= 100) {
              cpuValue = Math.min(100, Math.max(0, realtimeCpu));
            }
          }
        }

        // Update previous values for next calculation
        this.previousCpuUsage = {
          user: userMicroseconds,
          system: systemMicroseconds,
        };
        this.previousCpuTimestamp = now;

        // Calculate memory percentage correctly
        const memoryValue =
          healthResponse.systemMetrics.memoryUsage.systemTotal > 0
            ? Math.min(
                100,
                Math.max(
                  0,
                  (healthResponse.systemMetrics.memoryUsage.systemUsed /
                    healthResponse.systemMetrics.memoryUsage.systemTotal) *
                    100
                )
              )
            : systemMetrics.memory;

        // CRITICAL: Cap CPU at 100% - values over 100% indicate calculation error
        // This prevents false "degraded" status when CPU calculation is wrong
        const safeCpuValue = Math.min(100, Math.max(0, cpuValue));

        // Create new object with updated values (read-only properties)
        Object.assign(systemMetrics, {
          cpu: safeCpuValue,
          memory: memoryValue,
        });
      } else {
        // Reset tracking if no system metrics available
        this.previousCpuUsage = null;

        // If no system metrics from HealthService, ensure CPU is capped at 100%
        if (systemMetrics.cpu > 100) {
          Object.assign(systemMetrics, { cpu: 100 });
        }
      }

      // Calculate overall status
      const overall = this.calculateOverallStatus(services, systemMetrics);

      // Get uptime
      const uptime = healthResponse.systemMetrics?.uptime || this.systemChecker.getUptime();

      const timestamp = healthResponse.timestamp || new Date().toISOString();

      return {
        overall,
        services,
        endpoints: {}, // Endpoints would be populated by endpoint checker
        system: systemMetrics,
        uptime,
        timestamp,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to aggregate health: ${errorMessage}`,
        'HealthAggregatorService',
        { error: errorMessage, duration: Date.now() - startTime }
      );

      // Return unhealthy status on error
      return {
        overall: 'unhealthy',
        services: {},
        endpoints: {},
        system: {
          cpu: 0,
          memory: 0,
          activeConnections: 0,
          requestRate: 0,
          errorRate: 100,
        },
        uptime: this.systemChecker.getUptime(),
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Transform HealthService ServiceHealth to AggregatedHealthStatus ServiceHealthStatus
   */
  private transformServiceHealth(service: {
    status: 'healthy' | 'unhealthy' | 'degraded';
    responseTime?: number;
    lastChecked?: string;
    details?: string;
  }): ServiceHealthStatus {
    return {
      status:
        service.status === 'healthy'
          ? 'healthy'
          : service.status === 'degraded'
            ? 'degraded'
            : 'unhealthy',
      responseTime: service.responseTime || 0,
      timestamp: service.lastChecked || new Date().toISOString(),
      ...(service.details && {
        details:
          typeof service.details === 'string'
            ? { message: service.details }
            : (service.details as Record<string, unknown>),
      }),
    };
  }

  /**
   * Transform RealtimeHealthCheckResult to ServiceHealthStatus
   */
  private transformRealtimeCheckResult(result: RealtimeHealthCheckResult): ServiceHealthStatus {
    return {
      status: result.status,
      responseTime: result.responseTime,
      timestamp: new Date().toISOString(),
      ...(result.error && { error: result.error }),
      ...(result.details && {
        details: typeof result.details === 'string' ? { message: result.details } : result.details,
      }),
    };
  }

  /**
   * Calculate overall status from services and system metrics
   * Overall status should primarily reflect service health, not system metrics
   */
  private calculateOverallStatus(
    services: Record<string, ServiceHealthStatus>,
    system: RealtimeSystemMetrics
  ): RealtimeHealthStatus {
    // Check for any unhealthy services
    const hasUnhealthy = Object.values(services).some(s => s.status === 'unhealthy');

    if (hasUnhealthy) {
      return 'unhealthy';
    }

    // Check for degraded services
    const hasDegraded = Object.values(services).some(s => s.status === 'degraded');

    // System metrics should only affect status if CRITICAL (not just high usage)
    // High CPU/memory usage is normal under load - only mark degraded if critical
    // Critical thresholds: CPU > 95%, Memory > 95%, Error rate > 10%
    // IMPORTANT: Ignore system metrics if CPU > 100% (indicates calculation error)
    // If all services are healthy, system should be healthy regardless of metrics
    const systemCritical =
      (system.cpu > 0 && system.cpu <= 100 && system.cpu >= 95) ||
      system.memory >= 95 ||
      system.errorRate >= 10;

    // PRIORITY: If all services are healthy, system should be healthy
    // Only mark as degraded if services are actually degraded OR system is critical
    // Normal high usage (80-95%) should not affect overall status if services are healthy
    if (hasDegraded || systemCritical) {
      return 'degraded';
    }

    // All services healthy and system not critical = healthy
    return 'healthy';
  }

  /**
   * Create error result for failed check
   */
  private createErrorResult(service: string): RealtimeHealthCheckResult {
    return {
      service,
      status: 'unhealthy',
      responseTime: 0,
      error: 'Health check failed',
    };
  }
}
