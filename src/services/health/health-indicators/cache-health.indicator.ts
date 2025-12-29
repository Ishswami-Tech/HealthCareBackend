/**
 * Cache Health Indicator for Health Module
 * @class CacheHealthIndicator
 * @description Health indicator for cache service using @nestjs/terminus
 * Follows SOLID, DRY, and KISS principles
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { HealthIndicatorResult } from '@nestjs/terminus';
import { CacheService } from '@infrastructure/cache';
import { CacheHealthMonitorService } from '@infrastructure/cache/services/cache-health-monitor.service';
import type { CacheHealthMonitorStatus } from '@core/types';
import { BaseHealthIndicator } from './base-health.indicator';

@Injectable()
export class CacheHealthIndicator extends BaseHealthIndicator<CacheHealthMonitorStatus> {
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

  protected isServiceAvailable(): boolean {
    return this.cacheHealthMonitor !== undefined && this.cacheHealthMonitor !== null;
  }

  protected getServiceName(): string {
    return 'Cache';
  }

  protected getUnavailableMessage(): string {
    return 'Cache health monitor not available';
  }

  protected async getHealthStatus(): Promise<CacheHealthMonitorStatus> {
    if (!this.cacheHealthMonitor) {
      throw new Error('Cache health monitor not available');
    }
    return await this.cacheHealthMonitor.getHealthStatus();
  }

  protected formatResult(key: string, status: CacheHealthMonitorStatus): HealthIndicatorResult {
    return this.getStatus(key, status.healthy, {
      healthy: status.healthy,
      connection: status.connection,
      latency: status.connection.latency,
      provider: status.connection.provider,
    });
  }

  protected extractIsHealthy(status: CacheHealthMonitorStatus): boolean {
    return status.healthy;
  }
}
