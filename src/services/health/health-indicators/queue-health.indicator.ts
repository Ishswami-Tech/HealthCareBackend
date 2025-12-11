/**
 * Queue Health Indicator for Health Module
 * @class QueueHealthIndicator
 * @description Health indicator for queue service using @nestjs/terminus
 */

import { Injectable, Optional } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { QueueHealthMonitorService } from '@infrastructure/queue';

@Injectable()
export class QueueHealthIndicator extends HealthIndicator {
  constructor(@Optional() private readonly queueHealthMonitor?: QueueHealthMonitorService) {
    super();
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    try {
      if (!this.queueHealthMonitor) {
        return this.getStatus(key, true, {
          message: 'Queue health monitor not available',
        });
      }

      const healthStatus = await this.queueHealthMonitor.getHealthStatus();

      const result = this.getStatus(key, healthStatus.healthy, {
        healthy: healthStatus.healthy,
        connection: healthStatus.connection,
        metrics: healthStatus.metrics,
        performance: healthStatus.performance,
      });

      if (!healthStatus.healthy) {
        throw new HealthCheckError('Queue service is unhealthy', result);
      }

      return result;
    } catch (error) {
      const result = this.getStatus(key, false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new HealthCheckError('Queue service health check failed', result);
    }
  }
}
