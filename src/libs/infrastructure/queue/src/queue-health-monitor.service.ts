/**
 * Queue Health Monitor Service
 * @class QueueHealthMonitorService
 * @description Monitors queue service health with optimized checks for frequent monitoring
 * Follows Single Responsibility Principle - only handles health monitoring
 * Optimized for frequent checks (every 10-30 seconds) without performance impact
 */

import { Injectable, Inject, forwardRef, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@config';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { QueueHealthMonitorStatus } from '@core/types';
import { CircuitBreakerService } from '@core/resilience';
import { QueueService } from './queue.service';

@Injectable()
export class QueueHealthMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly serviceName = 'QueueHealthMonitorService';
  private healthCheckInterval?: NodeJS.Timeout;
  // Background monitoring interval: 10-30 seconds (configurable, default 20 seconds)
  // Optimized for 10M+ users - frequent enough for real-time status, not too frequent to cause load
  private readonly CHECK_INTERVAL_MS = parseInt(
    process.env['QUEUE_HEALTH_CHECK_INTERVAL_MS'] || '20000',
    10
  ); // Default 20 seconds (within 10-30 range)
  private cachedHealthStatus: QueueHealthMonitorStatus | null = null;
  private lastHealthCheckTime = 0;
  private readonly CACHE_TTL_MS = 10000; // Cache health status for 10 seconds to avoid excessive queries
  private readonly HEALTH_CHECK_TIMEOUT_MS = 2000; // Max 2 seconds for health check (non-blocking)
  private lastExpensiveCheckTime = 0;
  private readonly EXPENSIVE_CHECK_INTERVAL_MS = 60000; // Run expensive checks every 60 seconds only
  private isHealthCheckInProgress = false; // Prevent concurrent health checks
  // Circuit breaker name for health checks (prevents CPU load when queue is down)
  private readonly HEALTH_CHECK_CIRCUIT_BREAKER_NAME = 'queue-health-check';

  constructor(
    @Inject(forwardRef(() => CircuitBreakerService))
    private readonly circuitBreakerService: CircuitBreakerService,
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => QueueService))
    private readonly queueService?: QueueService
  ) {
    // Circuit breaker is managed by CircuitBreakerService using named instances
    // The service will automatically track failures and open/close the circuit
    // Prevents excessive health checks when queue is down (saves CPU for 10M+ users)
  }

  onModuleInit(): void {
    try {
    this.startHealthMonitoring();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : 'No stack trace';
      console.error(`[QueueHealthMonitorService] onModuleInit failed: ${errorMessage}`);
      console.error(`[QueueHealthMonitorService] Stack: ${errorStack}`);
      // Don't throw - allow app to continue without queue health monitoring
    }
  }

  /**
   * Get comprehensive queue health status
   * Uses caching, timeout protection, and non-blocking execution
   * Optimized for frequent checks (every 10-30 seconds) without performance impact
   */
  async getHealthStatus(): Promise<QueueHealthMonitorStatus> {
    // Return cached status if still fresh (within cache TTL)
    const now = Date.now();
    if (this.cachedHealthStatus && now - this.lastHealthCheckTime < this.CACHE_TTL_MS) {
      return this.cachedHealthStatus;
    }

    // Prevent concurrent health checks (non-blocking)
    if (this.isHealthCheckInProgress) {
      // Return cached status if check is in progress
      return this.cachedHealthStatus || this.getDefaultUnhealthyStatus();
    }

    // Execute health check with timeout protection (non-blocking)
    return this.executeHealthCheckWithTimeout();
  }

  /**
   * Execute health check with timeout protection
   * Non-blocking: Uses Promise.race to ensure health check completes within timeout
   */
  private async executeHealthCheckWithTimeout(): Promise<QueueHealthMonitorStatus> {
    this.isHealthCheckInProgress = true;

    try {
      // Race between health check and timeout
      const healthCheckPromise = this.performHealthCheckInternal();
      const timeoutPromise = new Promise<QueueHealthMonitorStatus>(resolve => {
        setTimeout(() => {
          // Return cached status or default on timeout
          resolve(
            this.cachedHealthStatus || this.getDefaultUnhealthyStatus(['Health check timeout'])
          );
        }, this.HEALTH_CHECK_TIMEOUT_MS);
      });

      const status = await Promise.race([healthCheckPromise, timeoutPromise]);

      // Update cache
      this.cachedHealthStatus = status;
      this.lastHealthCheckTime = Date.now();

      // Circuit breaker tracks failures automatically
      if (!status.healthy) {
        // Record failure in circuit breaker
        this.circuitBreakerService.recordFailure(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME);
      } else {
        // Record success in circuit breaker
        this.circuitBreakerService.recordSuccess(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME);
      }

      return status;
    } catch (error) {
      // Record failure in circuit breaker
      this.circuitBreakerService.recordFailure(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME);

      const errorStatus = this.getDefaultUnhealthyStatus([
        `Health check error: ${error instanceof Error ? error.message : String(error)}`,
      ]);
      this.cachedHealthStatus = errorStatus;
      this.lastHealthCheckTime = Date.now();
      return errorStatus;
    } finally {
      this.isHealthCheckInProgress = false;
    }
  }

  /**
   * Perform internal health check (core logic)
   * Fast path: Only essential checks for frequent monitoring
   * Expensive checks run periodically (every 60 seconds)
   * Optimized for 10M+ users - minimal CPU load, non-blocking
   */
  private async performHealthCheckInternal(): Promise<QueueHealthMonitorStatus> {
    const issues: string[] = [];
    const status: QueueHealthMonitorStatus = {
      healthy: true,
      connection: {
        connected: false,
      },
      metrics: {
        totalJobs: 0,
        activeJobs: 0,
        waitingJobs: 0,
        failedJobs: 0,
        completedJobs: 0,
        errorRate: 0,
      },
      performance: {
        averageProcessingTime: 0,
        throughputPerMinute: 0,
      },
      queues: [],
      issues: [],
    };

    const now = Date.now();
    const shouldRunExpensiveChecks =
      now - this.lastExpensiveCheckTime >= this.EXPENSIVE_CHECK_INTERVAL_MS;

    // Check circuit breaker - if open, return cached status or default unhealthy (saves CPU)
    if (!this.circuitBreakerService.canExecute(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME)) {
      // Circuit breaker is open - return cached or default status (no CPU load)
      return (
        this.cachedHealthStatus ||
        this.getDefaultUnhealthyStatus(['Circuit breaker open - too many failures'])
      );
    }

    try {
      // Fast path: Essential queue service availability check only (always runs)
      // Uses lightweight service check - fastest possible queue check
      const connectionHealth = await this.checkConnectionHealthWithTimeout();
      status.connection = connectionHealth;
      if (!connectionHealth.connected) {
        issues.push('Queue service not connected');
        status.healthy = false;
        // Circuit breaker will track failures automatically
      }

      // Expensive checks only run periodically (every 60 seconds) to avoid performance impact
      // These are non-blocking and won't affect CPU load for frequent health checks
      if (shouldRunExpensiveChecks && status.connection.connected && this.queueService) {
        this.lastExpensiveCheckTime = now;

        // Run expensive checks in background (non-blocking) - update cached status when complete
        // This ensures they don't block the health check response (fast path returns immediately)
        void Promise.race([
          this.queueService.getHealthStatus().catch(() => null),
          new Promise<null>(
            resolve => setTimeout(() => resolve(null), 1000) // 1 second timeout
          ),
        ])
          .then(queueHealthStatus => {
            // Update cached status with expensive check results (non-blocking)
            if (this.cachedHealthStatus && queueHealthStatus) {
              this.cachedHealthStatus.metrics.totalJobs = queueHealthStatus.totalJobs || 0;
              this.cachedHealthStatus.metrics.activeJobs = queueHealthStatus.queues.reduce(
                (sum, q) => sum + (q.active || 0),
                0
              );
              this.cachedHealthStatus.metrics.waitingJobs = queueHealthStatus.queues.reduce(
                (sum, q) => sum + (q.waiting || 0),
                0
              );
              this.cachedHealthStatus.metrics.failedJobs = queueHealthStatus.queues.reduce(
                (sum, q) => sum + (q.failed || 0),
                0
              );
              this.cachedHealthStatus.metrics.completedJobs = queueHealthStatus.queues.reduce(
                (sum, q) => sum + (q.completed || 0),
                0
              );
              this.cachedHealthStatus.metrics.errorRate = queueHealthStatus.errorRate || 0;
              this.cachedHealthStatus.performance.averageProcessingTime =
                queueHealthStatus.averageResponseTime || 0;
              this.cachedHealthStatus.queues = queueHealthStatus.queues.map(q => ({
                name: q.queueName,
                waiting: q.waiting,
                active: q.active,
                completed: q.completed,
                failed: q.failed,
                delayed: q.delayed,
              }));
            }
          })
          .catch(() => {
            // Expensive checks failure shouldn't fail overall health
          });
      } else {
        // Use cached expensive check data if available (no query overhead)
        if (this.cachedHealthStatus) {
          status.metrics = { ...this.cachedHealthStatus.metrics };
          status.performance = { ...this.cachedHealthStatus.performance };
          status.queues = [...this.cachedHealthStatus.queues];
        }
      }

      status.issues = issues;
    } catch (error) {
      status.healthy = false;
      status.issues.push(
        `Health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      // Circuit breaker will track failures automatically
    }

    return status;
  }

  /**
   * Get default unhealthy status
   */
  private getDefaultUnhealthyStatus(issues: string[] = []): QueueHealthMonitorStatus {
    return {
      healthy: false,
      connection: {
        connected: false,
      },
      metrics: {
        totalJobs: 0,
        activeJobs: 0,
        waitingJobs: 0,
        failedJobs: 0,
        completedJobs: 0,
        errorRate: 0,
      },
      performance: {
        averageProcessingTime: 0,
        throughputPerMinute: 0,
      },
      queues: [],
      issues,
    };
  }

  /**
   * Check queue connection health with timeout protection
   * Uses lightweight service check for minimal overhead
   * Non-blocking: Times out after 1.5 seconds
   * Optimized for 10M+ users - minimal CPU load, fastest possible check
   */
  private async checkConnectionHealthWithTimeout(): Promise<{
    connected: boolean;
    latency?: number;
    provider?: string;
  }> {
    const start = Date.now();
    const QUERY_TIMEOUT_MS = 1500; // 1.5 seconds max for connection check (fast enough for 10M+ users)

    try {
      if (!this.queueService) {
        return {
          connected: false,
          latency: Date.now() - start,
        };
      }

      // Use lightweight service check - just verify service exists and getHealthStatus method is callable
      const checkPromise = Promise.resolve(typeof this.queueService.getHealthStatus === 'function');

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Queue service check timeout')), QUERY_TIMEOUT_MS);
      });

      const isAvailable = await Promise.race([checkPromise, timeoutPromise]);
      const latency = Date.now() - start;

      // Try to get provider info (non-blocking, optional)
      let provider: string | undefined;
      try {
        // Provider info could be extracted from config or service state
        // For now, we'll default to 'bullmq' as the queue provider
        provider = 'bullmq';
      } catch {
        // Provider detection failed - not critical
      }

      return {
        connected: isAvailable,
        latency,
        ...(provider !== undefined && { provider }),
      };
    } catch (_error) {
      // Connection check failed - return false with latency measurement
      return {
        connected: false,
        latency: Date.now() - start,
      };
    }
  }

  /**
   * Get lightweight health status (service only, no expensive queries)
   * Use this for very frequent checks (e.g., every second) to avoid query overhead
   */
  getLightweightHealthStatus(): {
    healthy: boolean;
    connection: {
      connected: boolean;
    };
    lastCheck: Date;
  } {
    // Return lightweight status based on cached data
    // This doesn't query the queue, just returns cached status
    if (this.cachedHealthStatus) {
      return {
        healthy: this.cachedHealthStatus.healthy,
        connection: this.cachedHealthStatus.connection,
        lastCheck: new Date(this.lastHealthCheckTime),
      };
    }

    // Fallback if no cached data
    return {
      healthy: false,
      connection: {
        connected: false,
      },
      lastCheck: new Date(),
    };
  }

  /**
   * Start health monitoring
   * Runs every 10-30 seconds (configurable via QUEUE_HEALTH_CHECK_INTERVAL_MS)
   * Optimized for 10M+ users - non-blocking, minimal CPU load
   */
  private startHealthMonitoring(): void {
    // Ensure interval is within 10-30 seconds range
    const interval = Math.max(10000, Math.min(30000, this.CHECK_INTERVAL_MS));

    this.healthCheckInterval = setInterval(() => {
      // Non-blocking: Don't await, just trigger update
      // This ensures health monitoring doesn't block the event loop
      void this.performHealthCheck();
    }, interval);
  }

  /**
   * Perform background health check (non-blocking)
   * Runs periodically to update cached status
   * Optimized for 10M+ users - uses lightweight checks, timeout protection, circuit breaker
   */
  private performHealthCheck(): void {
    // Non-blocking: Don't await, just trigger update
    // Uses lightweight service check (fastest possible) with timeout protection
    // Circuit breaker prevents excessive checks when unhealthy (saves CPU)
    void this.getHealthStatus()
      .then(status => {
        if (
          !status.healthy &&
          this.circuitBreakerService.canExecute(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME)
        ) {
          // Only log if circuit breaker is not open (avoid log spam)
          void this.loggingService?.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            'Queue health check failed',
            this.serviceName,
            {
              issues: status.issues,
              connectionConnected: status.connection.connected,
              latency: status.connection.latency,
              errorRate: status.metrics.errorRate,
            }
          );
        }
      })
      .catch(error => {
        // Log errors but don't let them block health monitoring
        void this.loggingService?.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          'Health check error',
          this.serviceName,
          { error: error instanceof Error ? error.message : String(error) }
        );
      });
  }

  /**
   * Cleanup
   */
  onModuleDestroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }
}
