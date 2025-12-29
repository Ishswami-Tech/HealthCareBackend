/**
 * Logging Health Indicator for Health Module
 * @class LoggingHealthIndicator
 * @description Health indicator for logging service using @nestjs/terminus
 * Follows SOLID, DRY, and KISS principles
 */

import { Injectable, Optional } from '@nestjs/common';
import { HealthIndicatorResult } from '@nestjs/terminus';
import { LoggingHealthMonitorService } from '@infrastructure/logging/logging-health-monitor.service';
import type { LoggingHealthMonitorStatus } from '@core/types';
import { BaseHealthIndicator } from './base-health.indicator';

@Injectable()
export class LoggingHealthIndicator extends BaseHealthIndicator<LoggingHealthMonitorStatus> {
  constructor(@Optional() private readonly loggingHealthMonitor?: LoggingHealthMonitorService) {
    super();
  }

  protected isServiceAvailable(): boolean {
    return this.loggingHealthMonitor !== undefined && this.loggingHealthMonitor !== null;
  }

  protected getServiceName(): string {
    return 'Logging';
  }

  protected async getHealthStatus(): Promise<LoggingHealthMonitorStatus> {
    if (!this.loggingHealthMonitor) {
      throw new Error('Logging health monitor not available');
    }
    return await this.loggingHealthMonitor.getHealthStatus();
  }

  protected formatResult(key: string, status: LoggingHealthMonitorStatus): HealthIndicatorResult {
    return this.getStatus(key, status.healthy, {
      healthy: status.healthy,
      service: status.service,
      endpoint: status.endpoint,
      metrics: status.metrics,
    });
  }

  protected extractIsHealthy(status: LoggingHealthMonitorStatus): boolean {
    return status.healthy;
  }
}
