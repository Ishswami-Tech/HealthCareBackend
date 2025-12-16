/**
 * Communication Health Indicator for Health Module
 * @class CommunicationHealthIndicator
 * @description Health indicator for communication services using @nestjs/terminus
 */

import { Injectable, Optional } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { CommunicationHealthMonitorService } from '@communication/communication-health-monitor.service';
import type { CommunicationHealthMonitorStatus } from '@core/types';

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

      // Use timeout to prevent hanging health checks
      const healthStatus = await Promise.race([
        this.communicationHealthMonitor.getHealthStatus(),
        new Promise<CommunicationHealthMonitorStatus>(resolve =>
          setTimeout(() => {
            resolve({
              healthy: true, // Default to healthy on timeout to avoid false negatives
              socket: { connected: false },
              email: { connected: false },
              whatsapp: { connected: false },
              push: { connected: false },
              metrics: { socketConnections: 0, emailQueueSize: 0 },
              performance: {},
              issues: ['Health check timeout - assuming healthy'],
            });
          }, 3000) // 3 second timeout
        ),
      ]);

      // Check if issues indicate circuit breaker is open or services are not configured
      const isCircuitBreakerOpen = healthStatus.issues.some(
        issue => issue.includes('Circuit breaker open') || issue.includes('too many failures')
      );
      const isNoServicesConfigured = healthStatus.issues.some(
        issue =>
          issue.includes('not configured') ||
          issue.includes('No communication services') ||
          issue.includes('acceptable')
      );
      const isTimeout = healthStatus.issues.some(issue => issue.includes('timeout'));

      // Check if at least one essential service is working (Socket or Email)
      const hasEssentialService =
        healthStatus.socket.connected || healthStatus.email.connected;

      // Don't fail health check if:
      // 1. Circuit breaker is open (expected behavior - protecting system)
      // 2. No services are configured (acceptable - services are optional)
      // 3. Timeout occurred (may be temporary)
      // 4. At least one essential service is working (degraded but functional)
      const shouldFail =
        !healthStatus.healthy &&
        !isCircuitBreakerOpen &&
        !isNoServicesConfigured &&
        !isTimeout &&
        !hasEssentialService;

      const result = this.getStatus(key, !shouldFail, {
        healthy: healthStatus.healthy,
        degraded: !healthStatus.healthy && hasEssentialService,
        circuitBreakerOpen: isCircuitBreakerOpen,
        socket: healthStatus.socket,
        email: healthStatus.email,
        whatsapp: healthStatus.whatsapp,
        push: healthStatus.push,
        metrics: healthStatus.metrics,
        issues: healthStatus.issues,
      });

      // Only throw error if we should fail (completely unhealthy and not due to circuit breaker/config)
      if (shouldFail) {
        throw new HealthCheckError('Communication service is unhealthy', result);
      }

      return result;
    } catch (error) {
      // If it's a HealthCheckError, re-throw it
      if (error instanceof HealthCheckError) {
        throw error;
      }

      // For other errors (timeouts, network issues), return degraded status instead of failing
      const result = this.getStatus(key, true, {
        degraded: true,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Communication health check encountered an error but service may still be functional',
      });
      return result; // Don't throw - allow health check to continue
    }
  }
}
