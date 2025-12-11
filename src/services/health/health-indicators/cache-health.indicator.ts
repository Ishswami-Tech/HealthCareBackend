/**
 * Cache Health Indicator for Health Module
 * @class CacheHealthIndicator
 * @description Health indicator for cache service using @nestjs/terminus
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { CacheService } from '@infrastructure/cache';
import { CacheHealthMonitorService } from '@infrastructure/cache/services/cache-health-monitor.service';

@Injectable()
export class CacheHealthIndicator extends HealthIndicator {
  constructor(
    @Optional()
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService?: CacheService,
    @Optional()
    @Inject(forwardRef(() => CacheHealthMonitorService))
    private readonly cacheHealthMonitor?: CacheHealthMonitorService
  ) {
    super();
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    try {
      if (!this.cacheHealthMonitor) {
        return this.getStatus(key, true, {
          message: 'Cache health monitor not available',
        });
      }

      const healthStatus = await this.cacheHealthMonitor.getHealthStatus();

      const result = this.getStatus(key, healthStatus.healthy, {
        healthy: healthStatus.healthy,
        connection: healthStatus.connection,
        latency: healthStatus.connection.latency,
        provider: healthStatus.connection.provider,
      });

      if (!healthStatus.healthy) {
        throw new HealthCheckError('Cache service is unhealthy', result);
      }

      return result;
    } catch (error) {
      const result = this.getStatus(key, false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new HealthCheckError('Cache service health check failed', result);
    }
  }
}
