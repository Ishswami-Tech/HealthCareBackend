/**
 * Queue Health Indicator for Health Module
 * @class QueueHealthIndicator
 * @description Health indicator for queue service (no Terminus dependency)
 * Uses only LoggingService (per .ai-rules/ coding standards)
 * Follows SOLID, DRY, and KISS principles
 */

import { Injectable, Optional } from '@nestjs/common';
import { HealthIndicatorResult } from './types';
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

    // Queue processing runs on worker containers only.
    // On API instances, queue health is expected to be unavailable — return not-applicable
    // rather than failing the overall health check.
    const appMode = process.env['APP_MODE'];
    if (appMode === 'api') {
      return {
        healthy: true,
        connection: { connected: false },
        metrics: {
          totalJobs: 0,
          activeJobs: 0,
          waitingJobs: 0,
          failedJobs: 0,
          completedJobs: 0,
          errorRate: 0,
        },
        performance: { averageProcessingTime: 0, throughputPerMinute: 0 },
        queues: [],
        issues: ['Queue health checked on worker container, not API'],
      };
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
