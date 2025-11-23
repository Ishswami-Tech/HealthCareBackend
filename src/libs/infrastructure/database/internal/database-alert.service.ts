/**
 * Database Alert Service
 * @class DatabaseAlertService
 * @description Provides alerting for critical database issues
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertType =
  | 'CONNECTION_POOL_EXHAUSTED'
  | 'SLOW_QUERY'
  | 'ERROR_RATE_SPIKE'
  | 'CONNECTION_LEAK'
  | 'DATABASE_UNAVAILABLE'
  | 'QUERY_TIMEOUT'
  | 'HIGH_ERROR_RATE'
  | 'CACHE_FAILURE'
  | 'REPLICA_LAG';

export interface DatabaseAlert {
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Database alert service
 * @internal
 */
@Injectable()
export class DatabaseAlertService {
  private readonly serviceName = 'DatabaseAlertService';
  private readonly alerts: DatabaseAlert[] = [];
  private readonly maxAlerts = 1000; // Keep last 1000 alerts
  private readonly alertCooldowns = new Map<AlertType, Date>();

  // Alert thresholds
  private readonly connectionPoolExhaustedThreshold = 0.95; // 95%
  private readonly slowQueryThreshold = 5000; // 5 seconds
  private readonly errorRateThreshold = 0.1; // 10%
  private readonly alertCooldownMs = 60000; // 1 minute between same type alerts

  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Alert on connection pool exhaustion
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  alertConnectionPoolExhausted(
    poolUsage: number,
    totalConnections: number,
    maxConnections: number
  ): void {
    if (poolUsage >= this.connectionPoolExhaustedThreshold) {
      this.createAlert(
        'CONNECTION_POOL_EXHAUSTED',
        'critical',
        `Connection pool exhausted: ${totalConnections}/${maxConnections} connections in use (${(poolUsage * 100).toFixed(1)}%)`,
        {
          poolUsage,
          totalConnections,
          maxConnections,
          usagePercentage: poolUsage * 100,
        }
      );
    }
  }

  /**
   * Alert on slow queries
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  alertSlowQuery(queryTime: number, query: string, clinicId?: string): void {
    if (queryTime > this.slowQueryThreshold) {
      this.createAlert(
        'SLOW_QUERY',
        'warning',
        `Slow query detected: ${queryTime}ms (threshold: ${this.slowQueryThreshold}ms)`,
        {
          queryTime,
          threshold: this.slowQueryThreshold,
          query: query.substring(0, 200), // Truncate long queries
          clinicId,
        }
      );
    }
  }

  /**
   * Alert on error rate spike
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  alertErrorRateSpike(errorRate: number, totalQueries: number, failedQueries: number): void {
    if (errorRate > this.errorRateThreshold) {
      this.createAlert(
        'ERROR_RATE_SPIKE',
        'critical',
        `High error rate detected: ${(errorRate * 100).toFixed(2)}% (${failedQueries}/${totalQueries} queries failed)`,
        {
          errorRate,
          threshold: this.errorRateThreshold,
          totalQueries,
          failedQueries,
          errorPercentage: errorRate * 100,
        }
      );
    }
  }

  /**
   * Alert on connection leak
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  alertConnectionLeak(leakInfo: {
    activeConnections: number;
    totalConnections: number;
    maxConnections: number;
  }): void {
    this.createAlert(
      'CONNECTION_LEAK',
      'critical',
      `Connection leak detected: ${leakInfo.totalConnections}/${leakInfo.maxConnections} connections in use`,
      leakInfo
    );
  }

  /**
   * Alert on database unavailable
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  alertDatabaseUnavailable(reason: string, error?: Error): void {
    this.createAlert('DATABASE_UNAVAILABLE', 'critical', `Database unavailable: ${reason}`, {
      reason,
      error: error?.message,
      errorStack: error?.stack,
    });
  }

  /**
   * Alert on query timeout
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  alertQueryTimeout(query: string, timeout: number, clinicId?: string): void {
    this.createAlert('QUERY_TIMEOUT', 'warning', `Query timeout: exceeded ${timeout}ms`, {
      timeout,
      query: query.substring(0, 200), // Truncate long queries
      clinicId,
    });
  }

  /**
   * Alert on high error rate
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  alertHighErrorRate(errorRate: number, timeWindow: string): void {
    this.createAlert(
      'HIGH_ERROR_RATE',
      'critical',
      `High error rate in ${timeWindow}: ${(errorRate * 100).toFixed(2)}%`,
      {
        errorRate,
        timeWindow,
        errorPercentage: errorRate * 100,
      }
    );
  }

  /**
   * Alert on cache failure
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  alertCacheFailure(operation: string, error: Error): void {
    this.createAlert('CACHE_FAILURE', 'warning', `Cache operation failed: ${operation}`, {
      operation,
      error: error.message,
      errorStack: error.stack,
    });
  }

  /**
   * Alert on replica lag
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  alertReplicaLag(replicaId: string, lagMs: number, threshold: number): void {
    if (lagMs > threshold) {
      this.createAlert(
        'REPLICA_LAG',
        'warning',
        `Replica lag detected on ${replicaId}: ${lagMs}ms (threshold: ${threshold}ms)`,
        {
          replicaId,
          lagMs,
          threshold,
        }
      );
    }
  }

  /**
   * Get recent alerts
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  getRecentAlerts(limit: number = 100, severity?: AlertSeverity): DatabaseAlert[] {
    let alerts = this.alerts;

    if (severity) {
      alerts = alerts.filter(alert => alert.severity === severity);
    }

    return alerts.slice(-limit);
  }

  /**
   * Get alert statistics
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  getAlertStats(): {
    totalAlerts: number;
    criticalAlerts: number;
    warningAlerts: number;
    infoAlerts: number;
    alertsByType: Record<AlertType, number>;
  } {
    const stats = {
      totalAlerts: this.alerts.length,
      criticalAlerts: 0,
      warningAlerts: 0,
      infoAlerts: 0,
      alertsByType: {} as Record<AlertType, number>,
    };

    for (const alert of this.alerts) {
      if (alert.severity === 'critical') stats.criticalAlerts++;
      else if (alert.severity === 'warning') stats.warningAlerts++;
      else if (alert.severity === 'info') stats.infoAlerts++;

      stats.alertsByType[alert.type] = (stats.alertsByType[alert.type] || 0) + 1;
    }

    return stats;
  }

  /**
   * Create alert with cooldown
   */
  private createAlert(
    type: AlertType,
    severity: AlertSeverity,
    message: string,
    metadata?: Record<string, unknown>
  ): void {
    // Check cooldown
    const lastAlert = this.alertCooldowns.get(type);
    const now = new Date();
    if (
      lastAlert &&
      now.getTime() - lastAlert.getTime() < this.alertCooldownMs &&
      severity !== 'critical'
    ) {
      // Skip alert if within cooldown (except critical)
      return;
    }

    const alert: DatabaseAlert = {
      type,
      severity,
      message,
      timestamp: now,
      ...(metadata && { metadata }),
    };

    this.alerts.push(alert);
    this.alertCooldowns.set(type, now);

    // Maintain alert history size
    if (this.alerts.length > this.maxAlerts) {
      this.alerts.shift();
    }

    // Log alert
    const logLevel =
      severity === 'critical'
        ? LogLevel.ERROR
        : severity === 'warning'
          ? LogLevel.WARN
          : LogLevel.INFO;

    void this.loggingService.log(LogType.DATABASE, logLevel, message, this.serviceName, {
      alertType: type,
      severity,
      ...metadata,
    });
  }

  /**
   * Clear alerts
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  clearAlerts(): void {
    this.alerts.length = 0;
    this.alertCooldowns.clear();
  }
}
