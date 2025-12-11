/**
 * Communication Health Indicator for Health Module
 * @class CommunicationHealthIndicator
 * @description Health indicator for communication services using @nestjs/terminus
 */

import { Injectable, Optional } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { CommunicationHealthMonitorService } from '@communication/communication-health-monitor.service';

@Injectable()
export class CommunicationHealthIndicator extends HealthIndicator {
  constructor(
    @Optional() private readonly communicationHealthMonitor?: CommunicationHealthMonitorService
  ) {
    super();
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    try {
      if (!this.communicationHealthMonitor) {
        return this.getStatus(key, true, {
          message: 'Communication health monitor not available',
        });
      }

      const healthStatus = await this.communicationHealthMonitor.getHealthStatus();

      const result = this.getStatus(key, healthStatus.healthy, {
        healthy: healthStatus.healthy,
        socket: healthStatus.socket,
        email: healthStatus.email,
        whatsapp: healthStatus.whatsapp,
        push: healthStatus.push,
        metrics: healthStatus.metrics,
      });

      if (!healthStatus.healthy) {
        throw new HealthCheckError('Communication service is unhealthy', result);
      }

      return result;
    } catch (error) {
      const result = this.getStatus(key, false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new HealthCheckError('Communication service health check failed', result);
    }
  }
}
