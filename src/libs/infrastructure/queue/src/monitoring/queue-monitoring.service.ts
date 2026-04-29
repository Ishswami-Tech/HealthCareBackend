import { nowIso } from '@utils/date-time.util';
import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { EventService } from '@infrastructure/events/event.service';
// Internal imports - Infrastructure
import { LoggingService } from '@infrastructure/logging';

// Internal imports - Types
import type { ExtendedQueueMetrics, QueueAlert, QueuePerformanceReport } from '@core/types';

// Internal imports - Core
import {
  LogType,
  LogLevel,
  type IEventService,
  isEventService,
  EventCategory,
  EventPriority,
} from '@core/types';
import type { EnterpriseEventPayload } from '@core/types/event.types';

export interface ManualQueueAlertCreateInput {
  id?: string;
  queueName: string;
  type: QueueAlert['type'];
  severity: QueueAlert['severity'];
  message: string;
  threshold: number;
  currentValue: number;
  resolved?: boolean;
}

export interface ManualQueueAlertUpdateInput {
  queueName?: string;
  type?: QueueAlert['type'];
  severity?: QueueAlert['severity'];
  message?: string;
  threshold?: number;
  currentValue?: number;
  resolved?: boolean;
}

const MANUAL_ALERT_TYPES = [
  'error_rate_high',
  'throughput_low',
  'queue_size_large',
  'processing_time_high',
  'health_degraded',
] as const satisfies readonly QueueAlert['type'][];

const MANUAL_ALERT_SEVERITIES = [
  'low',
  'medium',
  'high',
  'critical',
] as const satisfies readonly QueueAlert['severity'][];

/**
 * Enterprise Queue Monitoring Service
 *
 * Provides comprehensive monitoring, alerting, and performance analytics
 * for the queue infrastructure with real-time metrics and health checks.
 */
@Injectable()
export class QueueMonitoringService {
  private metrics: Map<string, ExtendedQueueMetrics> = new Map<string, ExtendedQueueMetrics>();
  private alerts: Map<string, QueueAlert> = new Map<string, QueueAlert>();
  private performanceHistory: ExtendedQueueMetrics[] = [];
  private typedEventService?: IEventService;
  private readonly ALERT_THRESHOLDS = {
    errorRate: 5, // 5%
    throughput: 10, // 10 jobs per minute
    queueSize: 1000, // 1000 jobs
    processingTime: 300000, // 5 minutes
    healthCheckInterval: 30000, // 30 seconds
  };

  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,

    @Inject(forwardRef(() => EventService))
    private readonly eventService: unknown
  ) {
    // Defensive check: ensure Maps are initialized (they should be, but check anyway)
    if (!this.metrics || typeof this.metrics.set !== 'function') {
      this.metrics = new Map<string, ExtendedQueueMetrics>();
    }
    if (!this.alerts || typeof this.alerts.set !== 'function') {
      this.alerts = new Map<string, QueueAlert>();
    }
    // Type guard ensures type safety when using the service
    if (isEventService(this.eventService)) {
      this.typedEventService = this.eventService;
    }
    this.startHealthMonitoring();
  }

  /**
   * Update queue metrics
   */
  updateMetrics(queueName: string, domain: string, metrics: Partial<ExtendedQueueMetrics>): void {
    try {
      const existingMetrics =
        this.metrics.get(queueName) || this.createDefaultMetrics(queueName, domain);

      const updatedMetrics: ExtendedQueueMetrics = {
        ...existingMetrics,
        ...metrics,
        lastActivity: new Date(),
        health: this.calculateHealth(metrics),
      };

      // Defensive check before calling .set()
      if (this.metrics && typeof this.metrics.set === 'function') {
        this.metrics.set(queueName, updatedMetrics);
      } else {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          'metrics Map is not properly initialized',
          'QueueMonitoringService',
          { queueName }
        );
      }
      this.performanceHistory.push({ ...updatedMetrics });

      // Check for alerts
      void this.checkAlerts(updatedMetrics);

      // Emit metrics update event via centralized EventService
      if (this.typedEventService) {
        void this.typedEventService.emitEnterprise('queue.metrics.updated', {
          eventId: `queue_metrics_${queueName}_${Date.now()}`,
          eventType: 'queue.metrics.updated',
          category: EventCategory.QUEUE,
          priority: EventPriority.LOW,
          timestamp: nowIso(),
          source: 'QueueMonitoringService',
          version: '1.0.0',
          payload: {
            queueName,
            domain,
            metrics: updatedMetrics,
          },
        } as EnterpriseEventPayload);
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.DEBUG,
        `Updated metrics for queue ${queueName}`,
        'QueueMonitoringService',
        { queueName, metrics: updatedMetrics }
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to update metrics for queue ${queueName}`,
        'QueueMonitoringService',
        { queueName, error: _error instanceof Error ? _error.message : String(_error) }
      );
    }
  }

  /**
   * Get current metrics for a queue
   */
  getQueueMetrics(queueName: string): ExtendedQueueMetrics | undefined {
    return this.metrics.get(queueName);
  }

  /**
   * Get metrics for all queues
   */
  getAllMetrics(): ExtendedQueueMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get metrics by domain
   */
  getMetricsByDomain(domain: string): ExtendedQueueMetrics[] {
    return Array.from(this.metrics.values()).filter(m => m.domain === domain);
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): QueueAlert[] {
    return Array.from(this.alerts.values()).filter(alert => !alert.resolved);
  }

  /**
   * Get alerts by queue
   */
  getAlertsByQueue(queueName: string): QueueAlert[] {
    return Array.from(this.alerts.values()).filter(alert => alert.queueName === queueName);
  }

  /**
   * Get alerts by severity
   */
  getAlertsBySeverity(severity: QueueAlert['severity']): QueueAlert[] {
    return Array.from(this.alerts.values()).filter(alert => alert.severity === severity);
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.resolved = true;
    alert.resolvedAt = new Date();
    // Defensive check before calling .set()
    if (this.alerts && typeof this.alerts.set === 'function') {
      this.alerts.set(alertId, alert);
    } else {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'alerts Map is not properly initialized',
        'QueueMonitoringService',
        { alertId }
      );
    }

    // Emit alert resolved event via centralized EventService
    if (this.typedEventService) {
      void this.typedEventService.emitEnterprise('queue.alert.resolved', {
        eventId: `queue_alert_resolved_${alertId}_${Date.now()}`,
        eventType: 'queue.alert.resolved',
        category: EventCategory.QUEUE,
        priority: EventPriority.NORMAL,
        timestamp: nowIso(),
        source: 'QueueMonitoringService',
        version: '1.0.0',
        payload: {
          alertId,
          queueName: alert.queueName,
          alert,
        },
      } as EnterpriseEventPayload);
    }

    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.INFO,
      `Resolved alert ${alertId} for queue ${alert.queueName}`,
      'QueueMonitoringService',
      { alertId, queueName: alert.queueName }
    );
    return true;
  }

  /**
   * Create a manual queue alert
   */
  async createAlertManual(input: ManualQueueAlertCreateInput): Promise<QueueAlert> {
    const queueName = this.requireString(input.queueName, 'queueName');
    const type = this.requireAlertType(input.type);
    const severity = this.requireAlertSeverity(input.severity);
    const message = this.requireString(input.message, 'message');
    const threshold = this.requireFiniteNumber(input.threshold, 'threshold', true);
    const currentValue = this.requireFiniteNumber(input.currentValue, 'currentValue');
    const id = this.pick(input.id, this.generateManualAlertId(queueName, type));

    if (this.alerts.has(id)) {
      throw new BadRequestException(`Alert ${id} already exists`);
    }

    const alert: QueueAlert = {
      id,
      queueName,
      type,
      severity,
      message,
      threshold,
      currentValue,
      timestamp: new Date(),
      resolved: Boolean(input.resolved),
      ...(input.resolved ? { resolvedAt: new Date() } : {}),
    };

    this.alerts.set(id, alert);
    await this.emitManualAlertEvent('queue.alert.manual.created', alert, 'created');

    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.INFO,
      `Created manual alert ${id} for queue ${queueName}`,
      'QueueMonitoringService',
      { alertId: id, queueName, type, severity }
    );

    return alert;
  }

  /**
   * Update a manual queue alert
   */
  async updateAlertManual(
    alertId: string,
    input: ManualQueueAlertUpdateInput
  ): Promise<QueueAlert> {
    const normalizedAlertId = this.requireString(alertId, 'alertId');
    const existingAlert = this.alerts.get(normalizedAlertId);
    if (!existingAlert) {
      throw new NotFoundException(`Alert ${normalizedAlertId} not found`);
    }

    const updatedAlert: QueueAlert = { ...existingAlert };
    let hasUpdates = false;

    if (typeof input.queueName !== 'undefined') {
      updatedAlert.queueName = this.requireString(input.queueName, 'queueName');
      hasUpdates = true;
    }
    if (typeof input.type !== 'undefined') {
      updatedAlert.type = this.requireAlertType(input.type);
      hasUpdates = true;
    }
    if (typeof input.severity !== 'undefined') {
      updatedAlert.severity = this.requireAlertSeverity(input.severity);
      hasUpdates = true;
    }
    if (typeof input.message !== 'undefined') {
      updatedAlert.message = this.requireString(input.message, 'message');
      hasUpdates = true;
    }
    if (typeof input.threshold !== 'undefined') {
      updatedAlert.threshold = this.requireFiniteNumber(input.threshold, 'threshold', true);
      hasUpdates = true;
    }
    if (typeof input.currentValue !== 'undefined') {
      updatedAlert.currentValue = this.requireFiniteNumber(input.currentValue, 'currentValue');
      hasUpdates = true;
    }

    if (typeof input.resolved !== 'undefined') {
      updatedAlert.resolved = input.resolved;
      if (input.resolved) {
        updatedAlert.resolvedAt = existingAlert.resolvedAt || new Date();
      } else {
        delete updatedAlert.resolvedAt;
      }
      hasUpdates = true;
    }

    if (!hasUpdates) {
      throw new BadRequestException('At least one alert field must be provided for update');
    }

    this.alerts.set(normalizedAlertId, updatedAlert);
    await this.emitManualAlertEvent(
      'queue.alert.manual.updated',
      updatedAlert,
      'updated',
      existingAlert
    );

    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.INFO,
      `Updated manual alert ${normalizedAlertId} for queue ${updatedAlert.queueName}`,
      'QueueMonitoringService',
      {
        alertId: normalizedAlertId,
        queueName: updatedAlert.queueName,
        type: updatedAlert.type,
        severity: updatedAlert.severity,
      }
    );

    return updatedAlert;
  }

  /**
   * Delete a manual queue alert
   */
  async deleteAlertManual(alertId: string): Promise<QueueAlert> {
    const normalizedAlertId = this.requireString(alertId, 'alertId');
    const existingAlert = this.alerts.get(normalizedAlertId);
    if (!existingAlert) {
      throw new NotFoundException(`Alert ${normalizedAlertId} not found`);
    }

    this.alerts.delete(normalizedAlertId);
    await this.emitManualAlertEvent('queue.alert.manual.deleted', existingAlert, 'deleted');

    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.INFO,
      `Deleted manual alert ${normalizedAlertId} for queue ${existingAlert.queueName}`,
      'QueueMonitoringService',
      { alertId: normalizedAlertId, queueName: existingAlert.queueName }
    );

    return existingAlert;
  }

  /**
   * Generate performance report
   */
  async generatePerformanceReport(
    period: string,
    startDate: Date,
    endDate: Date
  ): Promise<QueuePerformanceReport> {
    try {
      const _filteredMetrics = this.performanceHistory.filter(
        m => m.lastActivity >= startDate && m.lastActivity <= endDate
      );

      const queues = Array.from(this.metrics.values());
      const alerts = Array.from(this.alerts.values()).filter(
        a => a.timestamp >= startDate && a.timestamp <= endDate
      );

      const summary = {
        totalQueues: queues.length,
        healthyQueues: queues.filter(q => q.health === 'healthy').length,
        degradedQueues: queues.filter(q => q.health === 'degraded').length,
        unhealthyQueues: queues.filter(q => q.health === 'unhealthy').length,
        totalJobs: queues.reduce((sum, q) => sum + q.totalJobs, 0),
        totalThroughput: queues.reduce((sum, q) => sum + q.throughput, 0),
        averageErrorRate: queues.reduce((sum, q) => sum + q.errorRate, 0) / queues.length,
      };

      const recommendations = this.generateRecommendations(queues, alerts);

      const report: QueuePerformanceReport = {
        period,
        startDate,
        endDate,
        queues,
        summary,
        alerts,
        recommendations,
      };

      // Emit report generated event via centralized EventService
      if (this.typedEventService) {
        await this.typedEventService.emitEnterprise('queue.report.generated', {
          eventId: `queue_report_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          eventType: 'queue.report.generated',
          category: EventCategory.QUEUE,
          priority: EventPriority.NORMAL,
          timestamp: nowIso(),
          source: 'QueueMonitoringService',
          version: '1.0.0',
          payload: {
            period,
            report,
          },
        } as EnterpriseEventPayload);
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Generated performance report for period ${period}`,
        'QueueMonitoringService',
        { period }
      );
      return report;
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to generate performance report`,
        'QueueMonitoringService',
        { period, error: _error instanceof Error ? _error.message : String(_error) }
      );
      throw _error;
    }
  }

  /**
   * Get queue health status
   */
  getQueueHealth(queueName?: string): {
    healthy: number;
    degraded: number;
    unhealthy: number;
    total: number;
  } {
    const queues = queueName
      ? [this.metrics.get(queueName)].filter(Boolean)
      : Array.from(this.metrics.values());

    return {
      healthy: queues.filter(q => q?.health === 'healthy').length,
      degraded: queues.filter(q => q?.health === 'degraded').length,
      unhealthy: queues.filter(q => q?.health === 'unhealthy').length,
      total: queues.length,
    };
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    setInterval(() => {
      (() => {
        try {
          this.performHealthChecks();
        } catch (_error) {
          void this.loggingService.log(
            LogType.QUEUE,
            LogLevel.ERROR,
            'Health monitoring error',
            'QueueMonitoringService',
            { error: _error instanceof Error ? _error.message : String(_error) }
          );
        }
      })();
    }, this.ALERT_THRESHOLDS.healthCheckInterval);

    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.INFO,
      'Started queue health monitoring',
      'QueueMonitoringService',
      {}
    );
  }

  /**
   * Perform health checks on all queues
   */
  private performHealthChecks(): void {
    for (const [queueName, metrics] of Array.from(this.metrics.entries())) {
      try {
        const health = this.calculateHealth(metrics);

        if (health !== metrics.health) {
          const updatedMetrics = { ...metrics, health };
          // Defensive check before calling .set()
          if (this.metrics && typeof this.metrics.set === 'function') {
            this.metrics.set(queueName, updatedMetrics);
          }

          // Emit health changed event via centralized EventService
          if (this.typedEventService) {
            void this.typedEventService.emitEnterprise('queue.health.changed', {
              eventId: `queue_health_${queueName}_${Date.now()}`,
              eventType: 'queue.health.changed',
              category: EventCategory.QUEUE,
              priority: EventPriority.HIGH,
              timestamp: nowIso(),
              source: 'QueueMonitoringService',
              version: '1.0.0',
              payload: {
                queueName,
                oldHealth: metrics.health,
                newHealth: health,
                metrics: updatedMetrics,
              },
            } as EnterpriseEventPayload);
          }

          void this.loggingService.log(
            LogType.QUEUE,
            LogLevel.INFO,
            `Queue ${queueName} health changed: ${metrics.health} → ${health}`,
            'QueueMonitoringService',
            { queueName, oldHealth: metrics.health, newHealth: health }
          );
        }
      } catch (_error) {
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.ERROR,
          `Health check failed for queue ${queueName}`,
          'QueueMonitoringService',
          { queueName, error: _error instanceof Error ? _error.message : String(_error) }
        );
      }
    }
  }

  /**
   * Check for alerts based on metrics
   */
  private checkAlerts(metrics: ExtendedQueueMetrics): void {
    const alerts: QueueAlert[] = [];

    // Error rate alert
    if (metrics.errorRate > this.ALERT_THRESHOLDS.errorRate) {
      alerts.push(
        this.createAlert(
          metrics.queueName,
          'error_rate_high',
          'high',
          `Error rate is ${metrics.errorRate.toFixed(2)}%, above threshold of ${this.ALERT_THRESHOLDS.errorRate}%`,
          this.ALERT_THRESHOLDS.errorRate,
          metrics.errorRate
        )
      );
    }

    // Throughput alert
    if (metrics.throughput < this.ALERT_THRESHOLDS.throughput) {
      alerts.push(
        this.createAlert(
          metrics.queueName,
          'throughput_low',
          'medium',
          `Throughput is ${metrics.throughput.toFixed(2)} jobs/min, below threshold of ${this.ALERT_THRESHOLDS.throughput}`,
          this.ALERT_THRESHOLDS.throughput,
          metrics.throughput
        )
      );
    }

    // Queue size alert
    if (metrics.totalJobs > this.ALERT_THRESHOLDS.queueSize) {
      alerts.push(
        this.createAlert(
          metrics.queueName,
          'queue_size_large',
          'high',
          `Queue size is ${metrics.totalJobs}, above threshold of ${this.ALERT_THRESHOLDS.queueSize}`,
          this.ALERT_THRESHOLDS.queueSize,
          metrics.totalJobs
        )
      );
    }

    // Processing time alert
    if (metrics.averageProcessingTime > this.ALERT_THRESHOLDS.processingTime) {
      alerts.push(
        this.createAlert(
          metrics.queueName,
          'processing_time_high',
          'medium',
          `Average processing time is ${metrics.averageProcessingTime}ms, above threshold of ${this.ALERT_THRESHOLDS.processingTime}ms`,
          this.ALERT_THRESHOLDS.processingTime,
          metrics.averageProcessingTime
        )
      );
    }

    // Health alert
    if (metrics.health === 'unhealthy') {
      alerts.push(
        this.createAlert(
          metrics.queueName,
          'health_degraded',
          'critical',
          `Queue health is ${metrics.health}`,
          0,
          1
        )
      );
    }

    // Add new alerts
    for (const alert of alerts) {
      // Defensive check before calling .set()
      if (this.alerts && typeof this.alerts.set === 'function') {
        this.alerts.set(alert.id, alert);
      } else {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          'alerts Map is not properly initialized',
          'QueueMonitoringService',
          { alertId: alert.id }
        );
      }
      // Emit alert created event via centralized EventService
      if (this.typedEventService) {
        void this.typedEventService.emitEnterprise('queue.alert.created', {
          eventId: `queue_alert_${alert.id}_${Date.now()}`,
          eventType: 'queue.alert.created',
          category: EventCategory.QUEUE,
          priority: alert.severity === 'critical' ? EventPriority.CRITICAL : EventPriority.HIGH,
          timestamp: nowIso(),
          source: 'QueueMonitoringService',
          version: '1.0.0',
          payload: { alert },
        } as EnterpriseEventPayload);
      }
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.WARN,
        `New alert for queue ${metrics.queueName}: ${alert.message}`,
        'QueueMonitoringService',
        { queueName: metrics.queueName, alertId: alert.id, alertType: alert.type }
      );
    }
  }

  /**
   * Create default metrics
   */
  private createDefaultMetrics(queueName: string, domain: string): ExtendedQueueMetrics {
    return {
      queueName,
      domain,
      totalJobs: 0,
      waitingJobs: 0,
      activeJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      delayedJobs: 0,
      pausedJobs: 0,
      processedJobs: 0,
      throughput: 0,
      averageProcessingTime: 0,
      errorRate: 0,
      lastActivity: new Date(),
      health: 'healthy',
    };
  }

  /**
   * Calculate queue health
   */
  private calculateHealth(
    metrics: Partial<ExtendedQueueMetrics>
  ): 'healthy' | 'degraded' | 'unhealthy' {
    if (!metrics.errorRate && !metrics.throughput) {
      return 'healthy';
    }

    if ((metrics.errorRate || 0) > 10 || (metrics.throughput || 0) === 0) {
      return 'unhealthy';
    }

    if ((metrics.errorRate || 0) > 5 || (metrics.throughput || 0) < 5) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Create alert
   */
  private createAlert(
    queueName: string,
    type: QueueAlert['type'],
    severity: QueueAlert['severity'],
    message: string,
    threshold: number,
    currentValue: number
  ): QueueAlert {
    return {
      id: `${queueName}-${type}-${Date.now()}`,
      queueName,
      type,
      severity,
      message,
      threshold,
      currentValue,
      timestamp: new Date(),
      resolved: false,
    };
  }

  private async emitManualAlertEvent(
    eventType:
      | 'queue.alert.manual.created'
      | 'queue.alert.manual.updated'
      | 'queue.alert.manual.deleted',
    alert: QueueAlert,
    action: 'created' | 'updated' | 'deleted',
    previousAlert?: QueueAlert
  ): Promise<void> {
    if (!this.typedEventService) {
      return;
    }

    try {
      await this.typedEventService.emitEnterprise(eventType, {
        eventId: `queue_manual_alert_${action}_${alert.id}_${Date.now()}`,
        eventType,
        category: EventCategory.QUEUE,
        priority: this.mapSeverityToPriority(alert.severity),
        timestamp: nowIso(),
        source: 'QueueMonitoringService',
        version: '1.0.0',
        payload: {
          alert,
          ...(previousAlert ? { previousAlert } : {}),
          action,
          manual: true,
        },
      } as EnterpriseEventPayload);
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to emit ${eventType} event`,
        'QueueMonitoringService',
        {
          alertId: alert.id,
          queueName: alert.queueName,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
    }
  }

  private mapSeverityToPriority(severity: QueueAlert['severity']): EventPriority {
    if (severity === 'critical') return EventPriority.CRITICAL;
    if (severity === 'high') return EventPriority.HIGH;
    if (severity === 'medium') return EventPriority.NORMAL;
    return EventPriority.LOW;
  }

  private requireAlertType(value: QueueAlert['type']): QueueAlert['type'] {
    if (!MANUAL_ALERT_TYPES.includes(value)) {
      throw new BadRequestException(`Invalid alert type: ${value}`);
    }
    return value;
  }

  private requireAlertSeverity(value: QueueAlert['severity']): QueueAlert['severity'] {
    if (!MANUAL_ALERT_SEVERITIES.includes(value)) {
      throw new BadRequestException(`Invalid alert severity: ${value}`);
    }
    return value;
  }

  private requireFiniteNumber(value: number, fieldName: string, nonNegative = false): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(`${fieldName} must be a finite number`);
    }
    if (nonNegative && value < 0) {
      throw new BadRequestException(`${fieldName} must be greater than or equal to 0`);
    }
    return value;
  }

  private generateManualAlertId(queueName: string, type: QueueAlert['type']): string {
    return `manual-${queueName}-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private requireString(value: string | undefined, fieldName: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${fieldName} is required`);
    }
    return value.trim();
  }

  private pick(...values: Array<string | undefined>): string {
    const v = values.find(item => typeof item === 'string' && item.trim().length > 0);
    return v?.trim() || '';
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(queues: ExtendedQueueMetrics[], _alerts: QueueAlert[]): string[] {
    const recommendations: string[] = [];

    // High error rate recommendations
    const highErrorQueues = queues.filter(q => q.errorRate > 5);
    if (highErrorQueues.length > 0) {
      recommendations.push(
        `Consider investigating error patterns in queues: ${highErrorQueues.map(q => q.queueName).join(', ')}`
      );
    }

    // Low throughput recommendations
    const lowThroughputQueues = queues.filter(q => q.throughput < 10);
    if (lowThroughputQueues.length > 0) {
      recommendations.push(
        `Consider scaling workers for queues: ${lowThroughputQueues.map(q => q.queueName).join(', ')}`
      );
    }

    // Large queue size recommendations
    const largeQueues = queues.filter(q => q.totalJobs > 1000);
    if (largeQueues.length > 0) {
      recommendations.push(
        `Consider implementing queue prioritization for: ${largeQueues.map(q => q.queueName).join(', ')}`
      );
    }

    // Processing time recommendations
    const slowQueues = queues.filter(q => q.averageProcessingTime > 300000);
    if (slowQueues.length > 0) {
      recommendations.push(
        `Consider optimizing job processing for queues: ${slowQueues.map(q => q.queueName).join(', ')}`
      );
    }

    return recommendations;
  }
}
