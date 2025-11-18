/**
 * Database Alert Service
 * @class DatabaseAlertService
 * @description Generates alerts for database issues
 * Follows Single Responsibility Principle - only handles alert generation
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';
import { LogType, LogLevel } from '@core/types';
import { EventCategory, EventPriority } from '@core/types';
import type { Alert } from '@core/types/database.types';

@Injectable()
export class DatabaseAlertService {
  private readonly serviceName = 'DatabaseAlertService';
  private readonly alerts: Alert[] = [];
  private readonly MAX_ALERTS = 1000;

  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => EventService))
    private readonly eventService: EventService
  ) {}

  /**
   * Generate alert
   */
  generateAlert(alert: Alert): void {
    // Add to alerts list
    this.alerts.push(alert);
    if (this.alerts.length > this.MAX_ALERTS) {
      this.alerts.shift(); // Remove oldest
    }

    // Log alert
    const logLevel = alert.severity === 'critical' ? LogLevel.ERROR : LogLevel.WARN;
    void this.loggingService.log(
      LogType.DATABASE,
      logLevel,
      `Database alert: ${alert.message}`,
      this.serviceName,
      {
        type: alert.type,
        severity: alert.severity,
        metric: alert.metric,
        value: alert.value,
        threshold: alert.threshold,
      }
    );

    // Emit event
    const eventPriority =
      alert.severity === 'critical' ? EventPriority.CRITICAL : EventPriority.HIGH;
    void this.eventService.emitEnterprise(
      `database.alert.${alert.type.toLowerCase()}`,
      {
        eventId: `alert-${Date.now()}-${Math.random()}`,
        eventType: `database.alert.${alert.type.toLowerCase()}`,
        category: EventCategory.DATABASE,
        priority: eventPriority,
        timestamp: alert.timestamp.toISOString(),
        source: this.serviceName,
        version: '1.0.0',
        correlationId: `alert-${Date.now()}`,
        traceId: `trace-${Date.now()}`,
        payload: {
          type: alert.type,
          severity: alert.severity,
          message: alert.message,
          metric: alert.metric,
          value: alert.value,
          threshold: alert.threshold,
          timestamp: alert.timestamp.toISOString(),
        },
      },
      {
        priority: eventPriority,
        async: true,
      }
    );
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit: number = 100): Alert[] {
    return this.alerts.slice(-limit);
  }

  /**
   * Get alerts by type
   */
  getAlertsByType(type: Alert['type']): Alert[] {
    return this.alerts.filter(alert => alert.type === type);
  }

  /**
   * Get critical alerts
   */
  getCriticalAlerts(): Alert[] {
    return this.alerts.filter(alert => alert.severity === 'critical');
  }

  /**
   * Clear alerts
   */
  clearAlerts(): void {
    this.alerts.length = 0;
  }
}
