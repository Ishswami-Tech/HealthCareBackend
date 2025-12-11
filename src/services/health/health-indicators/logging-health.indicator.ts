/**
 * Logging Health Indicator for Health Module
 * @class LoggingHealthIndicator
 * @description Health indicator for logging service using @nestjs/terminus
 */

import { Injectable, Optional } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { LoggingHealthMonitorService } from '@infrastructure/logging/logging-health-monitor.service';

@Injectable()
export class LoggingHealthIndicator extends HealthIndicator {
  constructor(@Optional() private readonly loggingHealthMonitor?: LoggingHealthMonitorService) {
    super();
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    try {
      if (!this.loggingHealthMonitor) {
        return this.getStatus(key, true, {
          message: 'Logging health monitor not available',
        });
      }

      const healthStatus = await this.loggingHealthMonitor.getHealthStatus();

      const result = this.getStatus(key, healthStatus.healthy, {
        healthy: healthStatus.healthy,
        service: healthStatus.service,
        endpoint: healthStatus.endpoint,
        metrics: healthStatus.metrics,
      });

      if (!healthStatus.healthy) {
        throw new HealthCheckError('Logging service is unhealthy', result);
      }

      return result;
    } catch (error) {
      const result = this.getStatus(key, false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new HealthCheckError('Logging service health check failed', result);
    }
  }
}
