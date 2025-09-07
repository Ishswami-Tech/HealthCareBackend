import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface QueueMetrics {
  queueName: string;
  domain: string;
  totalJobs: number;
  waitingJobs: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  delayedJobs: number;
  pausedJobs: number;
  processedJobs: number;
  throughput: number; // jobs per minute
  averageProcessingTime: number; // milliseconds
  errorRate: number; // percentage
  lastActivity: Date;
  health: 'healthy' | 'degraded' | 'unhealthy';
}

export interface QueueAlert {
  id: string;
  queueName: string;
  type: 'error_rate_high' | 'throughput_low' | 'queue_size_large' | 'processing_time_high' | 'health_degraded';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  threshold: number;
  currentValue: number;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
}

export interface QueuePerformanceReport {
  period: string;
  startDate: Date;
  endDate: Date;
  queues: QueueMetrics[];
  summary: {
    totalQueues: number;
    healthyQueues: number;
    degradedQueues: number;
    unhealthyQueues: number;
    totalJobs: number;
    totalThroughput: number;
    averageErrorRate: number;
  };
  alerts: QueueAlert[];
  recommendations: string[];
}

/**
 * Enterprise Queue Monitoring Service
 * 
 * Provides comprehensive monitoring, alerting, and performance analytics
 * for the queue infrastructure with real-time metrics and health checks.
 */
@Injectable()
export class QueueMonitoringService {
  private readonly logger = new Logger(QueueMonitoringService.name);
  private metrics = new Map<string, QueueMetrics>();
  private alerts = new Map<string, QueueAlert>();
  private performanceHistory: QueueMetrics[] = [];
  private readonly ALERT_THRESHOLDS = {
    errorRate: 5, // 5%
    throughput: 10, // 10 jobs per minute
    queueSize: 1000, // 1000 jobs
    processingTime: 300000, // 5 minutes
    healthCheckInterval: 30000 // 30 seconds
  };

  constructor(private eventEmitter: EventEmitter2) {
    this.startHealthMonitoring();
  }

  /**
   * Update queue metrics
   */
  async updateMetrics(queueName: string, domain: string, metrics: Partial<QueueMetrics>): Promise<void> {
    try {
      const existingMetrics = this.metrics.get(queueName) || this.createDefaultMetrics(queueName, domain);
      
      const updatedMetrics: QueueMetrics = {
        ...existingMetrics,
        ...metrics,
        lastActivity: new Date(),
        health: this.calculateHealth(metrics)
      };

      this.metrics.set(queueName, updatedMetrics);
      this.performanceHistory.push({ ...updatedMetrics });

      // Check for alerts
      await this.checkAlerts(updatedMetrics);

      // Emit metrics update event
      await this.eventEmitter.emitAsync('queue.metrics.updated', {
        queueName,
        domain,
        metrics: updatedMetrics
      });

      this.logger.debug(`📊 Updated metrics for queue ${queueName}: ${JSON.stringify(updatedMetrics)}`);
    } catch (error) {
      this.logger.error(`❌ Failed to update metrics for queue ${queueName}:`, error);
    }
  }

  /**
   * Get current metrics for a queue
   */
  getQueueMetrics(queueName: string): QueueMetrics | undefined {
    return this.metrics.get(queueName);
  }

  /**
   * Get metrics for all queues
   */
  getAllMetrics(): QueueMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get metrics by domain
   */
  getMetricsByDomain(domain: string): QueueMetrics[] {
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
  async resolveAlert(alertId: string): Promise<boolean> {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.resolved = true;
    alert.resolvedAt = new Date();
    this.alerts.set(alertId, alert);

    await this.eventEmitter.emitAsync('queue.alert.resolved', {
      alertId,
      queueName: alert.queueName,
      alert
    });

    this.logger.log(`✅ Resolved alert ${alertId} for queue ${alert.queueName}`);
    return true;
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
      const filteredMetrics = this.performanceHistory.filter(
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
        averageErrorRate: queues.reduce((sum, q) => sum + q.errorRate, 0) / queues.length
      };

      const recommendations = this.generateRecommendations(queues, alerts);

      const report: QueuePerformanceReport = {
        period,
        startDate,
        endDate,
        queues,
        summary,
        alerts,
        recommendations
      };

      await this.eventEmitter.emitAsync('queue.report.generated', {
        period,
        report
      });

      this.logger.log(`📋 Generated performance report for period ${period}`);
      return report;
    } catch (error) {
      this.logger.error(`❌ Failed to generate performance report:`, error);
      throw error;
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
    const queues = queueName ? [this.metrics.get(queueName)].filter(Boolean) : Array.from(this.metrics.values());
    
    return {
      healthy: queues.filter(q => q?.health === 'healthy').length,
      degraded: queues.filter(q => q?.health === 'degraded').length,
      unhealthy: queues.filter(q => q?.health === 'unhealthy').length,
      total: queues.length
    };
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    setInterval(async () => {
      try {
        await this.performHealthChecks();
      } catch (error) {
        this.logger.error('❌ Health monitoring error:', error);
      }
    }, this.ALERT_THRESHOLDS.healthCheckInterval);

    this.logger.log('🔍 Started queue health monitoring');
  }

  /**
   * Perform health checks on all queues
   */
  private async performHealthChecks(): Promise<void> {
    for (const [queueName, metrics] of this.metrics.entries()) {
      try {
        const health = this.calculateHealth(metrics);
        
        if (health !== metrics.health) {
          const updatedMetrics = { ...metrics, health };
          this.metrics.set(queueName, updatedMetrics);

          await this.eventEmitter.emitAsync('queue.health.changed', {
            queueName,
            oldHealth: metrics.health,
            newHealth: health,
            metrics: updatedMetrics
          });

          this.logger.log(`🏥 Queue ${queueName} health changed: ${metrics.health} → ${health}`);
        }
      } catch (error) {
        this.logger.error(`❌ Health check failed for queue ${queueName}:`, error);
      }
    }
  }

  /**
   * Check for alerts based on metrics
   */
  private async checkAlerts(metrics: QueueMetrics): Promise<void> {
    const alerts: QueueAlert[] = [];

    // Error rate alert
    if (metrics.errorRate > this.ALERT_THRESHOLDS.errorRate) {
      alerts.push(this.createAlert(
        metrics.queueName,
        'error_rate_high',
        'high',
        `Error rate is ${metrics.errorRate.toFixed(2)}%, above threshold of ${this.ALERT_THRESHOLDS.errorRate}%`,
        this.ALERT_THRESHOLDS.errorRate,
        metrics.errorRate
      ));
    }

    // Throughput alert
    if (metrics.throughput < this.ALERT_THRESHOLDS.throughput) {
      alerts.push(this.createAlert(
        metrics.queueName,
        'throughput_low',
        'medium',
        `Throughput is ${metrics.throughput.toFixed(2)} jobs/min, below threshold of ${this.ALERT_THRESHOLDS.throughput}`,
        this.ALERT_THRESHOLDS.throughput,
        metrics.throughput
      ));
    }

    // Queue size alert
    if (metrics.totalJobs > this.ALERT_THRESHOLDS.queueSize) {
      alerts.push(this.createAlert(
        metrics.queueName,
        'queue_size_large',
        'high',
        `Queue size is ${metrics.totalJobs}, above threshold of ${this.ALERT_THRESHOLDS.queueSize}`,
        this.ALERT_THRESHOLDS.queueSize,
        metrics.totalJobs
      ));
    }

    // Processing time alert
    if (metrics.averageProcessingTime > this.ALERT_THRESHOLDS.processingTime) {
      alerts.push(this.createAlert(
        metrics.queueName,
        'processing_time_high',
        'medium',
        `Average processing time is ${metrics.averageProcessingTime}ms, above threshold of ${this.ALERT_THRESHOLDS.processingTime}ms`,
        this.ALERT_THRESHOLDS.processingTime,
        metrics.averageProcessingTime
      ));
    }

    // Health alert
    if (metrics.health === 'unhealthy') {
      alerts.push(this.createAlert(
        metrics.queueName,
        'health_degraded',
        'critical',
        `Queue health is ${metrics.health}`,
        0,
        1
      ));
    }

    // Add new alerts
    for (const alert of alerts) {
      this.alerts.set(alert.id, alert);
      await this.eventEmitter.emitAsync('queue.alert.created', { alert });
      this.logger.warn(`🚨 New alert for queue ${metrics.queueName}: ${alert.message}`);
    }
  }

  /**
   * Create default metrics
   */
  private createDefaultMetrics(queueName: string, domain: string): QueueMetrics {
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
      health: 'healthy'
    };
  }

  /**
   * Calculate queue health
   */
  private calculateHealth(metrics: Partial<QueueMetrics>): 'healthy' | 'degraded' | 'unhealthy' {
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
      resolved: false
    };
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(queues: QueueMetrics[], alerts: QueueAlert[]): string[] {
    const recommendations: string[] = [];

    // High error rate recommendations
    const highErrorQueues = queues.filter(q => q.errorRate > 5);
    if (highErrorQueues.length > 0) {
      recommendations.push(`Consider investigating error patterns in queues: ${highErrorQueues.map(q => q.queueName).join(', ')}`);
    }

    // Low throughput recommendations
    const lowThroughputQueues = queues.filter(q => q.throughput < 10);
    if (lowThroughputQueues.length > 0) {
      recommendations.push(`Consider scaling workers for queues: ${lowThroughputQueues.map(q => q.queueName).join(', ')}`);
    }

    // Large queue size recommendations
    const largeQueues = queues.filter(q => q.totalJobs > 1000);
    if (largeQueues.length > 0) {
      recommendations.push(`Consider implementing queue prioritization for: ${largeQueues.map(q => q.queueName).join(', ')}`);
    }

    // Processing time recommendations
    const slowQueues = queues.filter(q => q.averageProcessingTime > 300000);
    if (slowQueues.length > 0) {
      recommendations.push(`Consider optimizing job processing for queues: ${slowQueues.map(q => q.queueName).join(', ')}`);
    }

    return recommendations;
  }
}
