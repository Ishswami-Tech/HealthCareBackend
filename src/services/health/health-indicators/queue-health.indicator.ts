/**
 * Queue Health Indicator for Health Module
 * @class QueueHealthIndicator
 * @description Health indicator for queue service using @nestjs/terminus
 * Follows SOLID, DRY, and KISS principles
 */

import { Injectable, Optional } from '@nestjs/common';
import { HealthIndicatorResult } from '@nestjs/terminus';
import { QueueHealthMonitorService } from '@infrastructure/queue';
import type { QueueHealthMonitorStatus } from '@core/types';
import { BaseHealthIndicator } from './base-health.indicator';

@Injectable()
export class QueueHealthIndicator extends BaseHealthIndicator<QueueHealthMonitorStatus> {
  constructor(@Optional() private readonly queueHealthMonitor?: QueueHealthMonitorService) {
    super();
  }

  protected isServiceAvailable(): boolean {
    return this.queueHealthMonitor !== undefined && this.queueHealthMonitor !== null;
  }

  protected getServiceName(): string {
    return 'Queue';
  }

  protected async getHealthStatus(): Promise<QueueHealthMonitorStatus> {
    if (!this.queueHealthMonitor) {
      throw new Error('Queue health monitor not available');
    }
    return await this.queueHealthMonitor.getHealthStatus();
  }

  protected formatResult(key: string, status: QueueHealthMonitorStatus): HealthIndicatorResult {
    return this.getStatus(key, status.healthy, {
      healthy: status.healthy,
      connection: status.connection,
      metrics: status.metrics,
      performance: status.performance,
    });
  }

  protected extractIsHealthy(status: QueueHealthMonitorStatus): boolean {
    return status.healthy;
  }
}
