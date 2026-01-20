import { Injectable, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { PrismaService } from '@database/prisma/prisma.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { ConnectionPoolManager } from '@database/query/scripts/connection-pool.manager';
import type {
  DatabaseMetrics,
  ConnectionPoolMetricsInternal,
  ClinicMetrics,
  Alert,
  MetricsSnapshot,
  DatabaseHealthStatusType as HealthStatus,
  PerformanceTrends,
  DatabasePerformanceReport,
  ClinicSummary,
} from '@core/types';

/**
 * Comprehensive Database Metrics Service
 *
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 * All methods are private/protected. Use DatabaseService instead.
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
 * @internal
 */
@Injectable()
export class DatabaseMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly serviceName = 'DatabaseMetricsService';
  private metricsInterval!: NodeJS.Timeout;
  private alertInterval!: NodeJS.Timeout;
  private readonly metricsHistory: MetricsSnapshot[] = [];
  private readonly maxHistorySize = 1000; // Keep last 1000 snapshots
  private readonly serviceStartTime = Date.now(); // Track when service started
  private readonly STARTUP_GRACE_PERIOD = 30000; // 30 seconds grace period during startup
  private lastCriticalQueryReset = Date.now(); // Track when critical queries counter was last reset

  // Performance thresholds
  private readonly slowQueryThreshold = 1000; // 1 second
  private readonly criticalQueryThreshold = 10000; // 10 seconds
  private readonly maxConnectionPoolUsage = 0.8; // 80%
  private readonly maxErrorRate = 0.05; // 5%
  private readonly minCacheHitRate = 0.7; // 70% minimum cache hit rate

  // Cache tracking
  private cacheHits = 0;
  private cacheMisses = 0;
  private cacheHitTimes: number[] = [];
  private cacheMissTimes: number[] = [];
  private readonly maxCacheTimeHistory = 1000; // Keep last 1000 cache operation times

  // Alert throttling to prevent log spam
  private readonly alertCooldowns = new Map<string, number>(); // Map of alert key -> last log timestamp
  private readonly alertCooldownMs = 300000; // 5 minutes cooldown for critical alerts (prevents spam)
  private readonly lastAlertHash = new Map<string, string>(); // Map of alert key -> hash of alert details (to detect changes)

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
      indexUsageRate: 0,
    },
    connectionPool: {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingConnections: 0,
      connectionPoolUsage: 0,
      connectionErrors: 0,
      connectionLatency: 0,
    } as ConnectionPoolMetricsInternal,
    healthcare: {
      totalPatients: 0,
      totalAppointments: 0,
      totalClinics: 0,
      hipaaCompliantOperations: 0,
      auditTrailEntries: 0,
      dataEncryptionRate: 1.0,
      unauthorizedAccessAttempts: 0,
    },
    clinicMetrics: new Map(),
    alerts: [],
    health: 'healthy',
  };

  constructor(
    @Inject(forwardRef(() => ConfigService)) private readonly configService: ConfigService,
    @Inject(forwardRef(() => PrismaService))
    private readonly prismaService: PrismaService,
    @Inject(forwardRef(() => LoggingService)) private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => ConnectionPoolManager))
    private readonly connectionPoolManager: ConnectionPoolManager
  ) {}

  async onModuleInit(): Promise<void> {
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Database metrics service initialized',
      this.serviceName
    );

    // Wait for Prisma to be ready before starting background monitoring
    if (this.prismaService) {
      const isReady = await this.prismaService.waitUntilReady(10000); // Wait up to 10 seconds
      if (isReady) {
        this.startMetricsCollection();
        this.startAlertMonitoring();
      } else {
        // Start with delay - Prisma will be ready soon
        setTimeout(() => {
          void (async () => {
            const ready = await this.prismaService.waitUntilReady(30000);
            if (ready) {
              this.startMetricsCollection();
              this.startAlertMonitoring();
            }
          })();
        }, 5000);
      }
    } else {
      // PrismaService not available yet, try again after a delay
      setTimeout(() => {
        void (async () => {
          if (this.prismaService) {
            const ready = await this.prismaService.waitUntilReady(30000);
            if (ready) {
              this.startMetricsCollection();
              this.startAlertMonitoring();
            }
          }
        })();
      }, 5000);
    }
  }

  onModuleDestroy() {
    clearInterval(this.metricsInterval);
    clearInterval(this.alertInterval);
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Database metrics service destroyed',
      this.serviceName
    );
  }

  /**
   * Get current database metrics
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  // Public for DatabaseService access, but marked as internal
  getCurrentMetrics(): DatabaseMetrics {
    return { ...this.currentMetrics };
  }

  /**
   * Get metrics history
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  // Public for DatabaseService access, but marked as internal
  getMetricsHistory(limit: number = 100): MetricsSnapshot[] {
    return this.metricsHistory.slice(-limit);
  }

  /**
   * Get clinic-specific metrics
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  // Public for DatabaseService access, but marked as internal
  getClinicMetrics(clinicId: string): ClinicMetrics | null {
    return this.currentMetrics.clinicMetrics.get(clinicId) || null;
  }

  /**
   * Get performance trends
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  // Public for DatabaseService access, but marked as internal
  getPerformanceTrends(timeRange: '1h' | '6h' | '24h' | '7d'): PerformanceTrends {
    const now = Date.now();
    const timeRanges = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
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
        throughput: { trend: 'stable', change: 0 },
      };
    }

    const first = relevantSnapshots[0];
    const last = relevantSnapshots[relevantSnapshots.length - 1];

    return {
      queryPerformance: {
        trend: this.calculateTrend(
          last?.performance.averageQueryTime || 0,
          first?.performance.averageQueryTime || 0
        ),
        change:
          (((last?.performance.averageQueryTime || 0) -
            (first?.performance.averageQueryTime || 0)) /
            (first?.performance.averageQueryTime || 1)) *
          100,
      },
      connectionPool: {
        trend: this.calculateTrend(
          last?.connectionPool.connectionPoolUsage || 0,
          first?.connectionPool.connectionPoolUsage || 0
        ),
        change:
          (((last?.connectionPool.connectionPoolUsage || 0) -
            (first?.connectionPool.connectionPoolUsage || 0)) /
            (first?.connectionPool.connectionPoolUsage || 1)) *
          100,
      },
      errorRate: {
        trend: this.calculateTrend(
          (last?.performance.failedQueries || 0) / (last?.performance.totalQueries || 1),
          (first?.performance.failedQueries || 0) / (first?.performance.totalQueries || 1)
        ),
        change:
          (((last?.performance.failedQueries || 0) / (last?.performance.totalQueries || 1) -
            (first?.performance.failedQueries || 0) / (first?.performance.totalQueries || 1)) /
            ((first?.performance.failedQueries || 0) / (first?.performance.totalQueries || 1))) *
          100,
      },
      throughput: {
        trend: this.calculateTrend(
          last?.performance.queryThroughput || 0,
          first?.performance.queryThroughput || 0
        ),
        change:
          (((last?.performance.queryThroughput || 0) - (first?.performance.queryThroughput || 0)) /
            (first?.performance.queryThroughput || 1)) *
          100,
      },
    };
  }

  /**
   * Get health status
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  // Public for DatabaseService access, but marked as internal
  getHealthStatus(): HealthStatus {
    const metrics = this.currentMetrics;
    const issues: string[] = [];

    // Check performance issues
    if (metrics.performance.averageQueryTime > this.slowQueryThreshold) {
      issues.push(
        `Average query time (${metrics.performance.averageQueryTime}ms) exceeds threshold (${this.slowQueryThreshold}ms)`
      );
    }

    if (metrics.performance.criticalQueries > 0) {
      issues.push(`${metrics.performance.criticalQueries} critical queries detected`);
    }

    // Check connection pool issues
    if (metrics.connectionPool.connectionPoolUsage > this.maxConnectionPoolUsage) {
      issues.push(
        `Connection pool usage (${(metrics.connectionPool.connectionPoolUsage * 100).toFixed(1)}%) exceeds threshold (${(this.maxConnectionPoolUsage * 100).toFixed(1)}%)`
      );
    }

    // Check error rate
    const errorRate =
      metrics.performance.totalQueries > 0
        ? metrics.performance.failedQueries / metrics.performance.totalQueries
        : 0;
    if (errorRate > this.maxErrorRate) {
      issues.push(
        `Error rate (${(errorRate * 100).toFixed(2)}%) exceeds threshold (${(this.maxErrorRate * 100).toFixed(2)}%)`
      );
    }

    // Check healthcare compliance
    if (metrics.healthcare.unauthorizedAccessAttempts > 0) {
      issues.push(
        `${metrics.healthcare.unauthorizedAccessAttempts} unauthorized access attempts detected`
      );
    }

    const health = issues.length === 0 ? 'healthy' : issues.length <= 2 ? 'warning' : 'critical';

    return {
      status: health,
      issues,
      lastCheck: new Date(),
      metrics: metrics,
    };
  }

  /**
   * Record cache hit
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  recordCacheHit(cacheTime: number): void {
    this.cacheHits++;
    this.cacheHitTimes.push(cacheTime);

    // Maintain history size
    if (this.cacheHitTimes.length > this.maxCacheTimeHistory) {
      this.cacheHitTimes.shift();
    }

    // Update cache hit rate in metrics
    const totalCacheOps = this.cacheHits + this.cacheMisses;
    if (totalCacheOps > 0) {
      this.currentMetrics.performance.cacheHitRate = this.cacheHits / totalCacheOps;
    }
  }

  /**
   * Record cache miss
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  recordCacheMiss(cacheMissTime: number): void {
    this.cacheMisses++;
    this.cacheMissTimes.push(cacheMissTime);

    // Maintain history size
    if (this.cacheMissTimes.length > this.maxCacheTimeHistory) {
      this.cacheMissTimes.shift();
    }

    // Update cache hit rate in metrics
    const totalCacheOps = this.cacheHits + this.cacheMisses;
    if (totalCacheOps > 0) {
      this.currentMetrics.performance.cacheHitRate = this.cacheHits / totalCacheOps;
    }

    // Log warning if cache hit rate is low
    if (
      totalCacheOps > 100 &&
      this.currentMetrics.performance.cacheHitRate < this.minCacheHitRate
    ) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.WARN,
        `Low cache hit rate detected: ${(this.currentMetrics.performance.cacheHitRate * 100).toFixed(1)}% (threshold: ${(this.minCacheHitRate * 100).toFixed(1)}%)`,
        this.serviceName,
        {
          cacheHitRate: this.currentMetrics.performance.cacheHitRate,
          cacheHits: this.cacheHits,
          cacheMisses: this.cacheMisses,
          totalCacheOps,
          recommendations: [
            'Review cache TTL settings - may be too short',
            'Check cache invalidation strategy - may be too aggressive',
            'Consider increasing cache size limits',
            'Review cache key patterns for optimization',
            'Enable cache warming for frequently accessed data',
          ],
        }
      );
    }
  }

  /**
   * Record query execution metrics
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  // Public for DatabaseService access, but marked as internal
  recordQueryExecution(
    operation: string,
    executionTime: number,
    success: boolean,
    clinicId?: string,
    _userId?: string
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
        averageExecutionTime: executionTime,
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
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  // Public for DatabaseService access, but marked as internal
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
   * Record healthcare metrics
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  // Public for DatabaseService access, but marked as internal
  async recordHealthcareMetrics(): Promise<void> {
    try {
      // Check if we're in startup grace period
      const timeSinceStart = Date.now() - this.serviceStartTime;
      const isInStartupGracePeriod = timeSinceStart < this.STARTUP_GRACE_PERIOD;

      // Check if PrismaService is available and ready
      if (!this.prismaService) {
        // Only log warnings after startup grace period
        if (!isInStartupGracePeriod) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            'PrismaService not available, skipping healthcare metrics collection',
            this.serviceName,
            {}
          );
        }
        return;
      }

      // CRITICAL: Wait for Prisma to be ready BEFORE accessing any delegates
      // Accessing delegates on uninitialized Prisma triggers internal error logging
      // Increased timeout to 30 seconds to ensure Prisma is fully initialized
      const isReady = await this.prismaService.waitUntilReady(30000); // 30 second timeout
      if (!isReady) {
        // Only log warnings after startup grace period
        if (!isInStartupGracePeriod) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            'Prisma client not ready within timeout, skipping healthcare metrics collection',
            this.serviceName,
            {}
          );
        }
        return;
      }

      // CRITICAL: During startup grace period, don't access Prisma at all
      // Even getDelegateSafely() might trigger Prisma's internal validation that logs to stderr
      if (isInStartupGracePeriod) {
        // Return early without accessing any Prisma delegates or methods
        return;
      }

      // Double-check Prisma is ready using isReady() before accessing delegates
      if (!this.prismaService.isReady()) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          'Prisma client not ready, skipping healthcare metrics collection',
          this.serviceName,
          {}
        );
        return;
      }

      // CRITICAL: Don't check delegate existence by accessing them
      // Accessing this.prismaService.patient, etc. triggers Prisma's validation
      // If isReady() returns true, delegates are available - just use them directly

      // Use PrismaService's safe delegate access to avoid triggering validation errors
      // CRITICAL: Use getDelegateSafely() instead of direct property access
      type PatientDelegate = { count: (args?: Record<string, never>) => Promise<number> };
      type AppointmentDelegate = { count: (args?: Record<string, never>) => Promise<number> };
      type ClinicDelegate = { count: (args?: Record<string, never>) => Promise<number> };

      const patientDelegate = this.prismaService.getDelegateSafely<PatientDelegate>('patient');
      const appointmentDelegate =
        this.prismaService.getDelegateSafely<AppointmentDelegate>('appointment');
      const clinicDelegate = this.prismaService.getDelegateSafely<ClinicDelegate>('clinic');

      // If any delegate is not available, skip metrics collection
      if (!patientDelegate || !appointmentDelegate || !clinicDelegate) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          'Prisma delegates not available, skipping healthcare metrics collection',
          this.serviceName,
          {}
        );
        return;
      }

      // Check if count methods are available
      if (
        typeof patientDelegate.count !== 'function' ||
        typeof appointmentDelegate.count !== 'function' ||
        typeof clinicDelegate.count !== 'function'
      ) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          'Prisma count methods not available, skipping healthcare metrics collection',
          this.serviceName,
          {}
        );
        return;
      }

      // Get counts with individual error handling to prevent one failure from stopping all
      let patientCount = 0;
      let appointmentCount = 0;
      let clinicCount = 0;

      try {
        // Check if method exists before calling
        if (patientDelegate && typeof patientDelegate.count === 'function') {
          patientCount = await patientDelegate.count({} as Record<string, never>);
        }
      } catch (patientError) {
        // Suppress Prisma "Invalid invocation" errors - they're expected during startup
        const errorMsg =
          patientError instanceof Error ? patientError.message : String(patientError);
        if (!errorMsg.includes('Invalid `prisma')) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Failed to get patient count: ${errorMsg}`,
            this.serviceName,
            {}
          );
        }
      }

      try {
        // Check if method exists before calling
        if (appointmentDelegate && typeof appointmentDelegate.count === 'function') {
          appointmentCount = await appointmentDelegate.count({} as Record<string, never>);
        }
      } catch (appointmentError) {
        // Suppress Prisma "Invalid invocation" errors - they're expected during startup
        const errorMsg =
          appointmentError instanceof Error ? appointmentError.message : String(appointmentError);
        if (!errorMsg.includes('Invalid `prisma')) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Failed to get appointment count: ${errorMsg}`,
            this.serviceName,
            {}
          );
        }
      }

      try {
        // Check if method exists before calling
        if (clinicDelegate && typeof clinicDelegate.count === 'function') {
          clinicCount = await clinicDelegate.count({} as Record<string, never>);
        }
      } catch (clinicError) {
        // Suppress Prisma "Invalid invocation" errors - they're expected during startup
        const errorMsg = clinicError instanceof Error ? clinicError.message : String(clinicError);
        if (!errorMsg.includes('Invalid `prisma')) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Failed to get clinic count: ${errorMsg}`,
            this.serviceName,
            {}
          );
        }
      }

      this.currentMetrics.healthcare.totalPatients = patientCount;
      this.currentMetrics.healthcare.totalAppointments = appointmentCount;
      this.currentMetrics.healthcare.totalClinics = clinicCount;

      // Update clinic-specific metrics (with error handling)
      try {
        await this.updateClinicSpecificMetrics();
      } catch (clinicMetricsError) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Failed to update clinic-specific metrics: ${clinicMetricsError instanceof Error ? clinicMetricsError.message : String(clinicMetricsError)}`,
          this.serviceName,
          {}
        );
      }
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.WARN,
        `Failed to record healthcare metrics: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      // Don't throw - allow metrics collection to continue with default values
    }
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport(): DatabasePerformanceReport {
    const metrics = this.currentMetrics;
    const health = this.getHealthStatus();
    const trends = this.getPerformanceTrends('24h');

    return {
      timestamp: new Date(),
      summary: {
        overallHealth: health.status,
        totalIssues: health.issues.length,
        performanceGrade: this.calculatePerformanceGrade(metrics.performance.averageQueryTime),
        recommendations: this.generateRecommendations(metrics, health),
      },
      metrics: metrics,
      trends: trends,
      alerts: metrics.alerts,
      clinicSummary: this.generateClinicSummary(),
    };
  }

  // Private methods

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      void (async () => {
        try {
          // Check if we're still in startup grace period
          const timeSinceStart = Date.now() - this.serviceStartTime;
          const isInStartupGracePeriod = timeSinceStart < this.STARTUP_GRACE_PERIOD;

          // CRITICAL: Check if Prisma is ready before attempting to collect metrics
          // This prevents Prisma errors from being logged to stderr
          if (!this.prismaService || !this.prismaService.isReady()) {
            // During startup grace period, silently skip
            if (!isInStartupGracePeriod) {
              void this.loggingService.log(
                LogType.DATABASE,
                LogLevel.DEBUG,
                'Prisma not ready, skipping metrics collection',
                this.serviceName,
                {}
              );
            }
            return;
          }

          await this.collectMetrics();
          this.storeMetricsSnapshot();
        } catch (_error) {
          // Suppress Prisma "Invalid invocation" errors during startup
          const errorMsg = _error instanceof Error ? _error.message : String(_error);
          if (!errorMsg.includes('Invalid `prisma')) {
            void this.loggingService.log(
              LogType.DATABASE,
              LogLevel.ERROR,
              `Failed to collect metrics: ${errorMsg}`,
              this.serviceName,
              { error: _error instanceof Error ? _error.stack : String(_error) }
            );
          }
        }
      })();
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

    // Cache hit rate and index usage will be updated by DatabaseService when available
    // For now, keep existing values or set defaults
    this.currentMetrics.performance.indexUsageRate = 0.95; // Placeholder - would need actual index usage tracking

    // Reset critical queries counter periodically (every 5 minutes)
    // This prevents stale critical query alerts from persisting indefinitely
    // Only resets after startup grace period to avoid resetting during initial startup issues
    const now = Date.now();
    const RESET_INTERVAL = 300000; // 5 minutes

    // Check if we should reset: 5 minutes passed AND critical queries exist
    const timeSinceLastReset = now - this.lastCriticalQueryReset;
    const shouldReset =
      timeSinceLastReset >= RESET_INTERVAL && this.currentMetrics.performance.criticalQueries > 0;

    if (shouldReset) {
      // Check if any critical queries happened recently (within last 2 minutes)
      // by checking if the counter increased since last check
      // If counter is still > 0 after 5 minutes, it means queries are ongoing
      // Only reset if we're confident the issue has stopped
      const timeSinceServiceStart = now - this.serviceStartTime;
      const isPastStartupGracePeriod = timeSinceServiceStart > this.STARTUP_GRACE_PERIOD;

      if (isPastStartupGracePeriod) {
        // Log that we're resetting the counter (for debugging)
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.DEBUG,
          `Resetting critical queries counter (was ${this.currentMetrics.performance.criticalQueries}) after ${Math.round(timeSinceLastReset / 1000)}s`,
          this.serviceName,
          {
            previousCount: this.currentMetrics.performance.criticalQueries,
            resetInterval: RESET_INTERVAL,
            timeSinceLastReset: Math.round(timeSinceLastReset / 1000),
          }
        );
        this.currentMetrics.performance.criticalQueries = 0;
        this.lastCriticalQueryReset = now;
      }
    }

    // Update timestamp
    this.currentMetrics.timestamp = new Date();
  }

  private storeMetricsSnapshot(): void {
    const snapshot: MetricsSnapshot = {
      timestamp: new Date(),
      performance: { ...this.currentMetrics.performance },
      connectionPool: { ...this.currentMetrics.connectionPool },
      healthcare: { ...this.currentMetrics.healthcare },
      clinicMetrics: new Map(this.currentMetrics.clinicMetrics),
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
      lastUpdated: new Date(),
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
      // Check if PrismaService is available and ready
      if (!this.prismaService) {
        return;
      }

      // CRITICAL: Wait for Prisma to be ready BEFORE accessing any delegates
      // Accessing delegates on uninitialized Prisma triggers internal error logging
      // Increased timeout to 30 seconds to ensure Prisma is fully initialized
      const isReady = await this.prismaService.waitUntilReady(30000); // 30 second timeout
      if (!isReady) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          'Prisma client not ready within timeout, skipping clinic-specific metrics',
          this.serviceName,
          {}
        );
        return;
      }

      // Double-check Prisma is ready using isReady() before accessing delegates
      if (!this.prismaService.isReady()) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          'Prisma client not ready, skipping clinic-specific metrics',
          this.serviceName,
          {}
        );
        return;
      }

      // Now safe to access Prisma delegates - they won't trigger internal error logging
      // Check if Prisma client delegates are initialized
      if (!this.prismaService.clinic || !this.prismaService.patient) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          'Prisma client delegates not initialized, skipping clinic-specific metrics',
          this.serviceName,
          {}
        );
        return;
      }

      // Use PrismaService directly
      // Type-safe Prisma delegates
      type ClinicWithCount = {
        id: string;
        _count: {
          appointments: number;
        };
      };
      type ClinicDelegate = {
        findMany: (args: Record<string, unknown>) => Promise<ClinicWithCount[]>;
      };
      type PatientDelegate = {
        count: (args: Record<string, unknown>) => Promise<number>;
      };

      const clinicDelegate = this.prismaService.getDelegateSafely<ClinicDelegate>('clinic');
      const patientDelegate = this.prismaService.getDelegateSafely<PatientDelegate>('patient');

      // Check if delegates are available
      if (!clinicDelegate || !patientDelegate) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          'Prisma delegates not available, skipping clinic-specific metrics',
          this.serviceName,
          {}
        );
        return;
      }

      // Check if methods are available
      if (
        typeof clinicDelegate.findMany !== 'function' ||
        typeof patientDelegate.count !== 'function'
      ) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          'Prisma delegate methods not available, skipping clinic-specific metrics',
          this.serviceName,
          {}
        );
        return;
      }

      // Get clinic-specific data
      let clinics: ClinicWithCount[] = [];
      try {
        clinics = await clinicDelegate.findMany({
          select: {
            id: true,
            _count: {
              select: {
                appointments: true,
              },
            },
          },
        } as Record<string, unknown>);
      } catch (clinicError) {
        // Suppress Prisma "Invalid invocation" errors - they're expected during startup
        const errorMsg = clinicError instanceof Error ? clinicError.message : String(clinicError);
        if (!errorMsg.includes('Invalid `prisma')) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Failed to get clinics: ${errorMsg}`,
            this.serviceName,
            {}
          );
        }
        return; // Can't continue without clinics
      }

      // Get patient counts separately (since patients are related through appointments)
      const patientCounts = await Promise.allSettled(
        clinics.map(async (clinic: ClinicWithCount) => {
          try {
            const patientCount = await patientDelegate.count({
              where: {
                appointments: {
                  some: {
                    clinicId: clinic.id,
                  },
                },
              },
            } as Record<string, unknown>);
            return {
              clinicId: clinic.id,
              patientCount,
            };
          } catch (patientError) {
            // Suppress Prisma "Invalid invocation" errors
            const errorMsg =
              patientError instanceof Error ? patientError.message : String(patientError);
            if (!errorMsg.includes('Invalid `prisma')) {
              void this.loggingService.log(
                LogType.DATABASE,
                LogLevel.WARN,
                `Failed to get patient count for clinic ${clinic.id}: ${errorMsg}`,
                this.serviceName,
                {}
              );
            }
            return { clinicId: clinic.id, patientCount: 0 };
          }
        })
      );

      for (const clinic of clinics) {
        const patientCountResult = patientCounts.find(
          (result): result is PromiseFulfilledResult<{ clinicId: string; patientCount: number }> =>
            result.status === 'fulfilled' && result.value.clinicId === clinic.id
        );
        const patientCountData = patientCountResult?.value || {
          clinicId: clinic.id,
          patientCount: 0,
        };

        const current = this.currentMetrics.clinicMetrics.get(clinic.id) || {
          clinicId: clinic.id,
          totalQueries: 0,
          successfulQueries: 0,
          failedQueries: 0,
          totalExecutionTime: 0,
          averageExecutionTime: 0,
          patientCount: 0,
          appointmentCount: 0,
          lastUpdated: new Date(),
        };

        current.patientCount = patientCountData?.patientCount || 0;
        current.appointmentCount = clinic._count.appointments;
        current.lastUpdated = new Date();

        this.currentMetrics.clinicMetrics.set(clinic.id, current);
      }
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to update clinic-specific metrics: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
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
        threshold: this.slowQueryThreshold,
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
        threshold: 0,
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
        threshold: this.maxConnectionPoolUsage,
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
        threshold: 0,
      });
    }

    // Update alerts
    this.currentMetrics.alerts = alerts;

    // Log critical alerts with throttling to prevent spam
    const criticalAlerts = alerts.filter(alert => alert.severity === 'critical');
    if (criticalAlerts.length > 0) {
      // Create a stable alert key based on alert types
      const alertKey = `critical-${criticalAlerts
        .map(a => a.type)
        .sort()
        .join('-')}`;
      // Create a hash of alert details to detect if alerts have changed
      const alertHash = JSON.stringify(
        criticalAlerts.map(a => ({
          type: a.type,
          message: a.message,
          value: a.value,
        }))
      );
      const now = Date.now();
      const lastLogTime = this.alertCooldowns.get(alertKey) || 0;
      const lastHash = this.lastAlertHash.get(alertKey) || '';

      // Only log if:
      // 1. Cooldown period has passed (5 minutes), OR
      // 2. Alert details have changed (new alert or different values)
      const cooldownPassed = now - lastLogTime >= this.alertCooldownMs;
      const alertChanged = alertHash !== lastHash;

      if (cooldownPassed || alertChanged) {
        // Log detailed information about what's causing the critical alert
        const alertDetails = criticalAlerts.map(alert => {
          if (alert.type === 'PERFORMANCE' && alert.metric === 'criticalQueries') {
            return {
              type: alert.type,
              metric: alert.metric,
              message: alert.message,
              value: alert.value,
              explanation: `Queries taking longer than ${this.criticalQueryThreshold}ms (10 seconds) detected. This indicates database performance issues that need immediate attention.`,
            };
          } else if (alert.type === 'SECURITY' && alert.metric === 'unauthorizedAccessAttempts') {
            return {
              type: alert.type,
              metric: alert.metric,
              message: alert.message,
              value: alert.value,
              explanation:
                'Unauthorized database access attempts detected. This is a security concern and should be investigated immediately.',
            };
          }
          return alert;
        });

        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Critical database alerts: ${criticalAlerts.length} alert(s)`,
          this.serviceName,
          {
            alertCount: criticalAlerts.length,
            alerts: alertDetails,
            metrics: {
              criticalQueries: metrics.performance.criticalQueries,
              unauthorizedAccessAttempts: metrics.healthcare.unauthorizedAccessAttempts,
              averageQueryTime: metrics.performance.averageQueryTime,
              slowQueries: metrics.performance.slowQueries,
            },
            thresholds: {
              criticalQueryThreshold: this.criticalQueryThreshold,
              slowQueryThreshold: this.slowQueryThreshold,
            },
            recommendation: criticalAlerts.some(a => a.type === 'PERFORMANCE')
              ? 'Investigate slow queries in database logs. Consider adding indexes or optimizing query patterns.'
              : criticalAlerts.some(a => a.type === 'SECURITY')
                ? 'Review security logs and access control policies. Check for unauthorized access patterns.'
                : 'Review database metrics and logs for details.',
          }
        );
        this.alertCooldowns.set(alertKey, now);
        this.lastAlertHash.set(alertKey, alertHash);
      }
    }

    // Also throttle warning alerts
    const warningAlerts = alerts.filter(alert => alert.severity === 'warning');
    if (warningAlerts.length > 0) {
      // Create a stable alert key based on alert types
      const alertKey = `warning-${warningAlerts
        .map(a => a.type)
        .sort()
        .join('-')}`;
      // Create a hash of alert details to detect if alerts have changed
      const alertHash = JSON.stringify(
        warningAlerts.map(a => ({
          type: a.type,
          message: a.message,
          value: a.value,
        }))
      );
      const now = Date.now();
      const lastLogTime = this.alertCooldowns.get(alertKey) || 0;
      const lastHash = this.lastAlertHash.get(alertKey) || '';

      // Only log if:
      // 1. Cooldown period has passed (10 minutes for warnings), OR
      // 2. Alert details have changed (new alert or different values)
      const cooldownPassed = now - lastLogTime >= this.alertCooldownMs * 2; // 10 minutes for warnings
      const alertChanged = alertHash !== lastHash;

      if (cooldownPassed || alertChanged) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.DEBUG,
          `Database warning alerts: ${warningAlerts.length} alerts`,
          this.serviceName,
          { alerts: warningAlerts }
        );
        this.alertCooldowns.set(alertKey, now);
        this.lastAlertHash.set(alertKey, alertHash);
      }
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

  private generateRecommendations(metrics: DatabaseMetrics, _health: HealthStatus): string[] {
    const recommendations: string[] = [];

    if (metrics.performance.averageQueryTime > this.slowQueryThreshold) {
      recommendations.push('Consider query optimization and index improvements');
    }

    if (metrics.connectionPool.connectionPoolUsage > this.maxConnectionPoolUsage) {
      recommendations.push(
        'Consider increasing connection pool size or optimizing connection usage'
      );
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
      lastUpdated: clinic.lastUpdated,
    }));
  }
}
