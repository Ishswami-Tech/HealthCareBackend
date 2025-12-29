/**
 * Change Detector Service
 * Detects health status changes for efficient broadcasting
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { HealthChange, RealtimeSystemMetrics } from '@core/types';
import type {
  AggregatedHealthStatus,
  RealtimeHealthStatus,
} from '@core/types/realtime-health.types';

@Injectable()
export class ChangeDetectorService {
  private previousStatus: AggregatedHealthStatus | null = null;

  constructor(
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  /**
   * Type guard to validate AggregatedHealthStatus
   */
  private isValidAggregatedHealthStatus(value: unknown): value is AggregatedHealthStatus {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const obj = value as Record<string, unknown>;

    // Check required properties
    if (
      !('overall' in obj) ||
      !('services' in obj) ||
      !('system' in obj) ||
      !('uptime' in obj) ||
      !('timestamp' in obj)
    ) {
      return false;
    }

    // Validate overall status
    const overall = obj['overall'];
    if (
      typeof overall !== 'string' ||
      (overall !== 'healthy' && overall !== 'degraded' && overall !== 'unhealthy')
    ) {
      return false;
    }

    // Validate services is an object
    if (!obj['services'] || typeof obj['services'] !== 'object') {
      return false;
    }

    // Validate system is an object
    if (!obj['system'] || typeof obj['system'] !== 'object') {
      return false;
    }

    // Validate uptime is a number
    if (typeof obj['uptime'] !== 'number') {
      return false;
    }

    // Validate timestamp is a string
    if (typeof obj['timestamp'] !== 'string') {
      return false;
    }

    return true;
  }

  /**
   * Extract RealtimeHealthStatus from unknown value
   */
  private extractRealtimeStatus(value: unknown): RealtimeHealthStatus | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    if (value === 'healthy' || value === 'degraded' || value === 'unhealthy') {
      return value;
    }

    return undefined;
  }

  /**
   * Type guard to validate RealtimeSystemMetrics
   */
  private isValidRealtimeSystemMetrics(value: unknown): value is RealtimeSystemMetrics {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const obj = value as Record<string, unknown>;

    return (
      typeof obj['cpu'] === 'number' &&
      typeof obj['memory'] === 'number' &&
      typeof obj['activeConnections'] === 'number' &&
      typeof obj['requestRate'] === 'number' &&
      typeof obj['errorRate'] === 'number'
    );
  }

  /**
   * Detect changes between previous and current status
   */
  detectChanges(current: AggregatedHealthStatus): HealthChange[] {
    const changes: HealthChange[] = [];

    try {
      if (!this.previousStatus) {
        // First check - no previous status to compare
        this.previousStatus = { ...current };
        return changes;
      }

      const previous = this.previousStatus;

      // Type guard to ensure previous is valid AggregatedHealthStatus
      if (!this.isValidAggregatedHealthStatus(previous)) {
        this.previousStatus = { ...current };
        return changes;
      }

      // Check overall status change
      const prevOverallValue = previous.overall;
      const currOverallValue = current.overall;
      const previousOverall =
        typeof prevOverallValue === 'string' &&
        (prevOverallValue === 'healthy' ||
          prevOverallValue === 'degraded' ||
          prevOverallValue === 'unhealthy')
          ? prevOverallValue
          : undefined;
      const currentOverall =
        typeof currOverallValue === 'string' &&
        (currOverallValue === 'healthy' ||
          currOverallValue === 'degraded' ||
          currOverallValue === 'unhealthy')
          ? currOverallValue
          : undefined;

      if (!previousOverall || !currentOverall) {
        this.previousStatus = { ...current };
        return changes;
      }
      if (previousOverall !== currentOverall) {
        changes.push({
          service: 'overall',
          previousStatus: previousOverall,
          currentStatus: currentOverall,
          changeType: 'status',
          severity: this.getSeverity(previousOverall, currentOverall),
          timestamp: current.timestamp,
        });
      }

      // Check service status changes
      const currentServices = current.services;
      const previousServices = previous.services;
      if (currentServices && typeof currentServices === 'object') {
        for (const [serviceName, currentService] of Object.entries(currentServices)) {
          if (
            !currentService ||
            typeof currentService !== 'object' ||
            !('status' in currentService)
          ) {
            continue;
          }

          const previousService = previousServices?.[serviceName];

          if (!previousService) {
            // New service
            const currentStatus = this.extractRealtimeStatus(currentService.status);
            if (currentStatus) {
              changes.push({
                service: serviceName,
                previousStatus: 'healthy',
                currentStatus,
                changeType: 'status',
                severity: 'info',
                timestamp: current.timestamp,
              });
            }
            continue;
          }

          // Status change
          const prevStatusValue = previousService.status;
          const currStatusValue = currentService.status;
          const prevStatus =
            typeof prevStatusValue === 'string' &&
            (prevStatusValue === 'healthy' ||
              prevStatusValue === 'degraded' ||
              prevStatusValue === 'unhealthy')
              ? prevStatusValue
              : undefined;
          const currStatus =
            typeof currStatusValue === 'string' &&
            (currStatusValue === 'healthy' ||
              currStatusValue === 'degraded' ||
              currStatusValue === 'unhealthy')
              ? currStatusValue
              : undefined;

          if (!prevStatus || !currStatus) {
            continue;
          }
          if (prevStatus !== currStatus) {
            changes.push({
              service: serviceName,
              previousStatus: prevStatus,
              currentStatus: currStatus,
              changeType: 'status',
              severity: this.getSeverity(prevStatus, currStatus),
              timestamp: current.timestamp,
            });
          }

          // Performance degradation (> 50% slower)
          const prevResponseTime = previousService.responseTime;
          const currResponseTime = currentService.responseTime;
          if (
            typeof prevResponseTime === 'number' &&
            typeof currResponseTime === 'number' &&
            currResponseTime > prevResponseTime * 1.5
          ) {
            changes.push({
              service: serviceName,
              previousStatus: prevStatus,
              currentStatus: currStatus,
              changeType: 'performance',
              severity: 'warning',
              timestamp: current.timestamp,
            });
          }
        }
      }

      // Check system metrics threshold breaches
      const previousSystem = previous.system;
      const currentSystem = current.system;
      if (
        this.isValidRealtimeSystemMetrics(previousSystem) &&
        this.isValidRealtimeSystemMetrics(currentSystem)
      ) {
        // Type guards ensure both are RealtimeSystemMetrics
        // Use validated values directly - type guard narrows the type
        const systemChanges = this.detectSystemChanges(
          previousSystem,
          currentSystem,
          current.timestamp
        );
        // Type guard ensures systemChanges is HealthChange[]
        if (Array.isArray(systemChanges) && systemChanges.length > 0) {
          for (const change of systemChanges) {
            if (
              change &&
              typeof change === 'object' &&
              'service' in change &&
              'timestamp' in change &&
              'changeType' in change &&
              'severity' in change
            ) {
              changes.push(change);
            }
          }
        }
      }

      // Update previous status
      this.previousStatus = { ...current };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to detect changes: ${errorMessage}`,
        'ChangeDetectorService',
        { error: errorMessage }
      );
    }

    return changes;
  }

  /**
   * Extract numeric metric value safely
   */
  private extractMetricValue(
    metrics: RealtimeSystemMetrics,
    key: keyof RealtimeSystemMetrics
  ): number {
    // Access property safely - type guard ensures RealtimeSystemMetrics structure
    // Use Record type to safely access property (convert through unknown first)
    const metricsRecord = metrics as unknown as Record<string, unknown>;
    const value: unknown = metricsRecord[key as string];
    return typeof value === 'number' ? value : 0;
  }

  /**
   * Detect system metric threshold breaches
   */
  private detectSystemChanges(
    previous: RealtimeSystemMetrics,
    current: RealtimeSystemMetrics,
    timestamp: string
  ): HealthChange[] {
    const changes: HealthChange[] = [];

    // CPU threshold breach (> 80%)
    const prevCpu = this.extractMetricValue(previous, 'cpu');
    const currCpu = this.extractMetricValue(current, 'cpu');
    if (prevCpu < 80 && currCpu >= 80) {
      changes.push({
        service: 'system:cpu',
        previousStatus: 'healthy',
        currentStatus: 'degraded',
        changeType: 'metric',
        severity: 'warning',
        timestamp,
      });
    }

    // Memory threshold breach (> 80%)
    const prevMemory = this.extractMetricValue(previous, 'memory');
    const currMemory = this.extractMetricValue(current, 'memory');
    if (prevMemory < 80 && currMemory >= 80) {
      changes.push({
        service: 'system:memory',
        previousStatus: 'healthy',
        currentStatus: 'degraded',
        changeType: 'metric',
        severity: 'warning',
        timestamp,
      });
    }

    // Error rate threshold breach (> 5%)
    const prevErrorRate = this.extractMetricValue(previous, 'errorRate');
    const currErrorRate = this.extractMetricValue(current, 'errorRate');
    if (prevErrorRate < 5 && currErrorRate >= 5) {
      changes.push({
        service: 'system:errors',
        previousStatus: 'healthy',
        currentStatus: 'degraded',
        changeType: 'metric',
        severity: 'critical',
        timestamp,
      });
    }

    return changes;
  }

  /**
   * Get severity based on status transition
   */
  private getSeverity(
    previous: 'healthy' | 'degraded' | 'unhealthy',
    current: 'healthy' | 'degraded' | 'unhealthy'
  ): 'critical' | 'warning' | 'info' {
    // Critical: healthy -> unhealthy
    if (previous === 'healthy' && current === 'unhealthy') {
      return 'critical';
    }

    // Warning: healthy -> degraded
    if (previous === 'healthy' && current === 'degraded') {
      return 'warning';
    }

    // Info: degraded -> healthy, unhealthy -> degraded
    return 'info';
  }

  /**
   * Reset previous status (for testing or manual refresh)
   */
  reset(): void {
    this.previousStatus = null;
  }
}
