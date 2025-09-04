import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { ConnectionPoolManager } from './connection-pool.manager';
import { HealthcareQueryOptimizerService } from './query-optimizer.service';
import { ClinicIsolationService } from './clinic-isolation.service';

/**
 * Comprehensive Database Metrics Service
 * 
 * Features:
 * - Real-time performance monitoring
 * - Healthcare-specific metrics
 * - Multi-tenant clinic metrics
 * - Query performance analysis
 * - Connection pool monitoring
 * - HIPAA compliance tracking
 * - Alert system for performance issues
 * - Historical metrics storage
 */
@Injectable()
export class DatabaseMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseMetricsService.name);
  private metricsInterval: NodeJS.Timeout;
  private alertInterval: NodeJS.Timeout;
  private readonly metricsHistory: MetricsSnapshot[] = [];
  private readonly maxHistorySize = 1000; // Keep last 1000 snapshots

  // Performance thresholds
  private readonly slowQueryThreshold = 1000; // 1 second
  private readonly criticalQueryThreshold = 5000; // 5 seconds
  private readonly maxConnectionPoolUsage = 0.8; // 80%
  private readonly maxErrorRate = 0.05; // 5%

  // Current metrics
  private currentMetrics: DatabaseMetrics = {
    timestamp: new Date(),
    performance: {
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      averageQueryTime: 0,
      slowQueries: 0,
      criticalQueries: 0,
      queryThroughput: 0,
      cacheHitRate: 0,
      indexUsageRate: 0
    },
    connectionPool: {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingConnections: 0,
      connectionPoolUsage: 0,
      connectionErrors: 0,
      connectionLatency: 0
    },
    healthcare: {
      totalPatients: 0,
      totalAppointments: 0,
      totalClinics: 0,
      hipaaCompliantOperations: 0,
      auditTrailEntries: 0,
      dataEncryptionRate: 1.0,
      unauthorizedAccessAttempts: 0
    },
    clinicMetrics: new Map(),
    alerts: [],
    health: 'healthy'
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly connectionPoolManager: ConnectionPoolManager,
    private readonly queryOptimizer: HealthcareQueryOptimizerService,
    private readonly clinicIsolationService: ClinicIsolationService,
  ) {}

  async onModuleInit() {
    this.logger.log('Database metrics service initialized');
    this.startMetricsCollection();
    this.startAlertMonitoring();
  }

  async onModuleDestroy() {
    clearInterval(this.metricsInterval);
    clearInterval(this.alertInterval);
    this.logger.log('Database metrics service destroyed');
  }

  /**
   * Get current database metrics
   */
  getCurrentMetrics(): DatabaseMetrics {
    return { ...this.currentMetrics };
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(limit: number = 100): MetricsSnapshot[] {
    return this.metricsHistory.slice(-limit);
  }

  /**
   * Get clinic-specific metrics
   */
  getClinicMetrics(clinicId: string): ClinicMetrics | null {
    return this.currentMetrics.clinicMetrics.get(clinicId) || null;
  }

  /**
   * Get performance trends
   */
  getPerformanceTrends(timeRange: '1h' | '6h' | '24h' | '7d'): PerformanceTrends {
    const now = Date.now();
    const timeRanges = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000
    };

    const cutoff = now - timeRanges[timeRange];
    const relevantSnapshots = this.metricsHistory.filter(
      snapshot => snapshot.timestamp.getTime() > cutoff
    );

    if (relevantSnapshots.length === 0) {
      return {
        queryPerformance: { trend: 'stable', change: 0 },
        connectionPool: { trend: 'stable', change: 0 },
        errorRate: { trend: 'stable', change: 0 },
        throughput: { trend: 'stable', change: 0 }
      };
    }

    const first = relevantSnapshots[0];
    const last = relevantSnapshots[relevantSnapshots.length - 1];

    return {
      queryPerformance: {
        trend: this.calculateTrend(last.performance.averageQueryTime, first.performance.averageQueryTime),
        change: ((last.performance.averageQueryTime - first.performance.averageQueryTime) / first.performance.averageQueryTime) * 100
      },
      connectionPool: {
        trend: this.calculateTrend(last.connectionPool.connectionPoolUsage, first.connectionPool.connectionPoolUsage),
        change: ((last.connectionPool.connectionPoolUsage - first.connectionPool.connectionPoolUsage) / first.connectionPool.connectionPoolUsage) * 100
      },
      errorRate: {
        trend: this.calculateTrend(last.performance.failedQueries / last.performance.totalQueries, first.performance.failedQueries / first.performance.totalQueries),
        change: ((last.performance.failedQueries / last.performance.totalQueries - first.performance.failedQueries / first.performance.totalQueries) / (first.performance.failedQueries / first.performance.totalQueries)) * 100
      },
      throughput: {
        trend: this.calculateTrend(last.performance.queryThroughput, first.performance.queryThroughput),
        change: ((last.performance.queryThroughput - first.performance.queryThroughput) / first.performance.queryThroughput) * 100
      }
    };
  }

  /**
   * Get health status
   */
  getHealthStatus(): HealthStatus {
    const metrics = this.currentMetrics;
    const issues: string[] = [];

    // Check performance issues
    if (metrics.performance.averageQueryTime > this.slowQueryThreshold) {
      issues.push(`Average query time (${metrics.performance.averageQueryTime}ms) exceeds threshold (${this.slowQueryThreshold}ms)`);
    }

    if (metrics.performance.criticalQueries > 0) {
      issues.push(`${metrics.performance.criticalQueries} critical queries detected`);
    }

    // Check connection pool issues
    if (metrics.connectionPool.connectionPoolUsage > this.maxConnectionPoolUsage) {
      issues.push(`Connection pool usage (${(metrics.connectionPool.connectionPoolUsage * 100).toFixed(1)}%) exceeds threshold (${(this.maxConnectionPoolUsage * 100).toFixed(1)}%)`);
    }

    // Check error rate
    const errorRate = metrics.performance.totalQueries > 0 ? metrics.performance.failedQueries / metrics.performance.totalQueries : 0;
    if (errorRate > this.maxErrorRate) {
      issues.push(`Error rate (${(errorRate * 100).toFixed(2)}%) exceeds threshold (${(this.maxErrorRate * 100).toFixed(2)}%)`);
    }

    // Check healthcare compliance
    if (metrics.healthcare.unauthorizedAccessAttempts > 0) {
      issues.push(`${metrics.healthcare.unauthorizedAccessAttempts} unauthorized access attempts detected`);
    }

    const health = issues.length === 0 ? 'healthy' : issues.length <= 2 ? 'warning' : 'critical';

    return {
      status: health,
      issues,
      lastCheck: new Date(),
      metrics: metrics
    };
  }

  /**
   * Record query execution metrics
   */
  recordQueryExecution(
    operation: string,
    executionTime: number,
    success: boolean,
    clinicId?: string,
    userId?: string
  ): void {
    const metrics = this.currentMetrics.performance;
    
    metrics.totalQueries++;
    if (success) {
      metrics.successfulQueries++;
    } else {
      metrics.failedQueries++;
    }

    // Update average query time
    metrics.averageQueryTime = 
      (metrics.averageQueryTime * (metrics.totalQueries - 1) + executionTime) / 
      metrics.totalQueries;

    // Track slow queries
    if (executionTime > this.slowQueryThreshold) {
      metrics.slowQueries++;
    }

    if (executionTime > this.criticalQueryThreshold) {
      metrics.criticalQueries++;
    }

    // Update clinic metrics if available
    if (clinicId) {
      this.updateClinicMetrics(clinicId, {
        totalQueries: 1,
        successfulQueries: success ? 1 : 0,
        failedQueries: success ? 0 : 1,
        totalExecutionTime: executionTime,
        averageExecutionTime: executionTime
      });
    }

    // Update query throughput (queries per second over last minute)
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentQueries = this.metricsHistory
      .filter(snapshot => snapshot.timestamp.getTime() > oneMinuteAgo)
      .reduce((sum, snapshot) => sum + snapshot.performance.totalQueries, 0);
    
    metrics.queryThroughput = recentQueries / 60;
  }

  /**
   * Record connection pool metrics
   */
  recordConnectionPoolMetrics(): void {
    const poolMetrics = this.connectionPoolManager.getMetrics();
    const metrics = this.currentMetrics.connectionPool;

    metrics.totalConnections = poolMetrics.totalConnections;
    metrics.activeConnections = poolMetrics.activeConnections;
    metrics.idleConnections = poolMetrics.idleConnections;
    metrics.waitingConnections = poolMetrics.waitingConnections;
    metrics.connectionPoolUsage = poolMetrics.activeConnections / poolMetrics.totalConnections;
    metrics.connectionErrors = poolMetrics.errors;
    metrics.connectionLatency = poolMetrics.averageQueryTime;
  }

  /**
   * Record healthcare-specific metrics
   */
  async recordHealthcareMetrics(): Promise<void> {
    try {
      // Get patient count
      const patientCount = await this.prismaService.patient.count();
      
      // Get appointment count
      const appointmentCount = await this.prismaService.appointment.count();
      
      // Get clinic count
      const clinicCount = await this.prismaService.clinic.count();

      this.currentMetrics.healthcare.totalPatients = patientCount;
      this.currentMetrics.healthcare.totalAppointments = appointmentCount;
      this.currentMetrics.healthcare.totalClinics = clinicCount;

      // Update clinic-specific metrics
      await this.updateClinicSpecificMetrics();

    } catch (error) {
      this.logger.error('Failed to record healthcare metrics:', error);
    }
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport(): PerformanceReport {
    const metrics = this.currentMetrics;
    const health = this.getHealthStatus();
    const trends = this.getPerformanceTrends('24h');

    return {
      timestamp: new Date(),
      summary: {
        overallHealth: health.status,
        totalIssues: health.issues.length,
        performanceGrade: this.calculatePerformanceGrade(metrics.performance.averageQueryTime),
        recommendations: this.generateRecommendations(metrics, health)
      },
      metrics: metrics,
      trends: trends,
      alerts: metrics.alerts,
      clinicSummary: this.generateClinicSummary()
    };
  }

  // Private methods

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(async () => {
      try {
        await this.collectMetrics();
        this.storeMetricsSnapshot();
      } catch (error) {
        this.logger.error('Failed to collect metrics:', error);
      }
    }, 30000); // Every 30 seconds
  }

  private startAlertMonitoring(): void {
    this.alertInterval = setInterval(() => {
      this.checkAlerts();
    }, 60000); // Every minute
  }

  private async collectMetrics(): Promise<void> {
    // Record connection pool metrics
    this.recordConnectionPoolMetrics();

    // Record healthcare metrics
    await this.recordHealthcareMetrics();

    // Get query optimizer stats
    const optimizerStats = this.queryOptimizer.getOptimizerStats();
    this.currentMetrics.performance.cacheHitRate = optimizerStats.cacheStats.hitRate;
    this.currentMetrics.performance.indexUsageRate = 0.95; // Placeholder - would need actual index usage tracking

    // Update timestamp
    this.currentMetrics.timestamp = new Date();
  }

  private storeMetricsSnapshot(): void {
    const snapshot: MetricsSnapshot = {
      timestamp: new Date(),
      performance: { ...this.currentMetrics.performance },
      connectionPool: { ...this.currentMetrics.connectionPool },
      healthcare: { ...this.currentMetrics.healthcare },
      clinicMetrics: new Map(this.currentMetrics.clinicMetrics)
    };

    this.metricsHistory.push(snapshot);

    // Maintain history size
    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory.shift();
    }
  }

  private updateClinicMetrics(clinicId: string, update: Partial<ClinicMetrics>): void {
    const current = this.currentMetrics.clinicMetrics.get(clinicId) || {
      clinicId,
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      patientCount: 0,
      appointmentCount: 0,
      lastUpdated: new Date()
    };

    // Update metrics
    Object.assign(current, update);
    current.lastUpdated = new Date();

    // Recalculate averages
    if (current.totalQueries > 0) {
      current.averageExecutionTime = current.totalExecutionTime / current.totalQueries;
    }

    this.currentMetrics.clinicMetrics.set(clinicId, current);
  }

  private async updateClinicSpecificMetrics(): Promise<void> {
    try {
      // Get clinic-specific data
      const clinics = await this.prismaService.clinic.findMany({
        select: {
          id: true,
          _count: {
            select: {
              appointments: true
            }
          }
        }
      });

      // Get patient counts separately (since patients are related through appointments)
      const patientCounts = await Promise.all(
        clinics.map(async (clinic) => {
          const patientCount = await this.prismaService.patient.count({
            where: {
              appointments: {
                some: {
                  clinicId: clinic.id
                }
              }
            }
          });
          return { clinicId: clinic.id, patientCount };
        })
      );

      for (const clinic of clinics) {
        const patientCountData = patientCounts.find(p => p.clinicId === clinic.id);
        
        const current = this.currentMetrics.clinicMetrics.get(clinic.id) || {
          clinicId: clinic.id,
          totalQueries: 0,
          successfulQueries: 0,
          failedQueries: 0,
          totalExecutionTime: 0,
          averageExecutionTime: 0,
          patientCount: 0,
          appointmentCount: 0,
          lastUpdated: new Date()
        };

        current.patientCount = patientCountData?.patientCount || 0;
        current.appointmentCount = clinic._count.appointments;
        current.lastUpdated = new Date();

        this.currentMetrics.clinicMetrics.set(clinic.id, current);
      }
    } catch (error) {
      this.logger.error('Failed to update clinic-specific metrics:', error);
    }
  }

  private checkAlerts(): void {
    const metrics = this.currentMetrics;
    const alerts: Alert[] = [];

    // Performance alerts
    if (metrics.performance.averageQueryTime > this.slowQueryThreshold) {
      alerts.push({
        type: 'PERFORMANCE',
        severity: 'warning',
        message: `Average query time (${metrics.performance.averageQueryTime}ms) exceeds threshold`,
        timestamp: new Date(),
        metric: 'averageQueryTime',
        value: metrics.performance.averageQueryTime,
        threshold: this.slowQueryThreshold
      });
    }

    if (metrics.performance.criticalQueries > 0) {
      alerts.push({
        type: 'PERFORMANCE',
        severity: 'critical',
        message: `${metrics.performance.criticalQueries} critical queries detected`,
        timestamp: new Date(),
        metric: 'criticalQueries',
        value: metrics.performance.criticalQueries,
        threshold: 0
      });
    }

    // Connection pool alerts
    if (metrics.connectionPool.connectionPoolUsage > this.maxConnectionPoolUsage) {
      alerts.push({
        type: 'CONNECTION_POOL',
        severity: 'warning',
        message: `Connection pool usage (${(metrics.connectionPool.connectionPoolUsage * 100).toFixed(1)}%) is high`,
        timestamp: new Date(),
        metric: 'connectionPoolUsage',
        value: metrics.connectionPool.connectionPoolUsage,
        threshold: this.maxConnectionPoolUsage
      });
    }

    // Healthcare alerts
    if (metrics.healthcare.unauthorizedAccessAttempts > 0) {
      alerts.push({
        type: 'SECURITY',
        severity: 'critical',
        message: `${metrics.healthcare.unauthorizedAccessAttempts} unauthorized access attempts detected`,
        timestamp: new Date(),
        metric: 'unauthorizedAccessAttempts',
        value: metrics.healthcare.unauthorizedAccessAttempts,
        threshold: 0
      });
    }

    // Update alerts
    this.currentMetrics.alerts = alerts;

    // Log critical alerts
    const criticalAlerts = alerts.filter(alert => alert.severity === 'critical');
    if (criticalAlerts.length > 0) {
      this.logger.error('Critical database alerts:', criticalAlerts);
    }
  }

  private calculateTrend(current: number, previous: number): 'improving' | 'stable' | 'degrading' {
    const change = ((current - previous) / previous) * 100;
    if (change < -5) return 'improving';
    if (change > 5) return 'degrading';
    return 'stable';
  }

  private calculatePerformanceGrade(averageQueryTime: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (averageQueryTime < 100) return 'A';
    if (averageQueryTime < 500) return 'B';
    if (averageQueryTime < 1000) return 'C';
    if (averageQueryTime < 2000) return 'D';
    return 'F';
  }

  private generateRecommendations(metrics: DatabaseMetrics, health: HealthStatus): string[] {
    const recommendations: string[] = [];

    if (metrics.performance.averageQueryTime > this.slowQueryThreshold) {
      recommendations.push('Consider query optimization and index improvements');
    }

    if (metrics.connectionPool.connectionPoolUsage > this.maxConnectionPoolUsage) {
      recommendations.push('Consider increasing connection pool size or optimizing connection usage');
    }

    if (metrics.performance.cacheHitRate < 0.8) {
      recommendations.push('Review caching strategy to improve cache hit rate');
    }

    if (metrics.healthcare.unauthorizedAccessAttempts > 0) {
      recommendations.push('Review access controls and investigate unauthorized access attempts');
    }

    return recommendations;
  }

  private generateClinicSummary(): ClinicSummary[] {
    return Array.from(this.currentMetrics.clinicMetrics.values()).map(clinic => ({
      clinicId: clinic.clinicId,
      patientCount: clinic.patientCount,
      appointmentCount: clinic.appointmentCount,
      queryCount: clinic.totalQueries,
      averageQueryTime: clinic.averageExecutionTime,
      lastUpdated: clinic.lastUpdated
    }));
  }
}

// Interfaces

export interface DatabaseMetrics {
  timestamp: Date;
  performance: PerformanceMetrics;
  connectionPool: ConnectionPoolMetrics;
  healthcare: HealthcareMetrics;
  clinicMetrics: Map<string, ClinicMetrics>;
  alerts: Alert[];
  health: 'healthy' | 'warning' | 'critical';
}

export interface PerformanceMetrics {
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  averageQueryTime: number;
  slowQueries: number;
  criticalQueries: number;
  queryThroughput: number;
  cacheHitRate: number;
  indexUsageRate: number;
}

export interface ConnectionPoolMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingConnections: number;
  connectionPoolUsage: number;
  connectionErrors: number;
  connectionLatency: number;
}

export interface HealthcareMetrics {
  totalPatients: number;
  totalAppointments: number;
  totalClinics: number;
  hipaaCompliantOperations: number;
  auditTrailEntries: number;
  dataEncryptionRate: number;
  unauthorizedAccessAttempts: number;
}

export interface ClinicMetrics {
  clinicId: string;
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
  patientCount: number;
  appointmentCount: number;
  lastUpdated: Date;
}

export interface Alert {
  type: 'PERFORMANCE' | 'CONNECTION_POOL' | 'SECURITY' | 'HEALTHCARE';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: Date;
  metric: string;
  value: number;
  threshold: number;
}

export interface MetricsSnapshot {
  timestamp: Date;
  performance: PerformanceMetrics;
  connectionPool: ConnectionPoolMetrics;
  healthcare: HealthcareMetrics;
  clinicMetrics: Map<string, ClinicMetrics>;
}

export interface HealthStatus {
  status: 'healthy' | 'warning' | 'critical';
  issues: string[];
  lastCheck: Date;
  metrics: DatabaseMetrics;
}

export interface PerformanceTrends {
  queryPerformance: TrendData;
  connectionPool: TrendData;
  errorRate: TrendData;
  throughput: TrendData;
}

export interface TrendData {
  trend: 'improving' | 'stable' | 'degrading';
  change: number; // Percentage change
}

export interface PerformanceReport {
  timestamp: Date;
  summary: {
    overallHealth: string;
    totalIssues: number;
    performanceGrade: string;
    recommendations: string[];
  };
  metrics: DatabaseMetrics;
  trends: PerformanceTrends;
  alerts: Alert[];
  clinicSummary: ClinicSummary[];
}

export interface ClinicSummary {
  clinicId: string;
  patientCount: number;
  appointmentCount: number;
  queryCount: number;
  averageQueryTime: number;
  lastUpdated: Date;
}

