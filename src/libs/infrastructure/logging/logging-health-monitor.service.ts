/**
 * Logging Health Monitor Service
 * @class LoggingHealthMonitorService
 * @description Monitors logging service health with optimized checks for frequent monitoring
 * Follows Single Responsibility Principle - only handles health monitoring
 * Optimized for frequent checks (every 10-30 seconds) without performance impact
 */

import { Injectable, Inject, forwardRef, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@config';
import { LoggingService } from './logging.service';
import { LogType, LogLevel } from '@core/types';
import type { LoggingHealthMonitorStatus } from '@core/types';
import { CircuitBreakerService } from '@core/resilience';
import axios from 'axios';

@Injectable()
export class LoggingHealthMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly serviceName = 'LoggingHealthMonitorService';
  private healthCheckInterval?: NodeJS.Timeout;
  // Background monitoring interval: 10-30 seconds (configurable, default 20 seconds)
  // Optimized for 10M+ users - frequent enough for real-time status, not too frequent to cause load
  private readonly CHECK_INTERVAL_MS = parseInt(
    process.env['LOGGING_HEALTH_CHECK_INTERVAL_MS'] || '20000',
    10
  ); // Default 20 seconds (within 10-30 range)
  private cachedHealthStatus: LoggingHealthMonitorStatus | null = null;
  private lastHealthCheckTime = 0;
  private readonly CACHE_TTL_MS = 10000; // Cache health status for 10 seconds to avoid excessive queries
  private readonly HEALTH_CHECK_TIMEOUT_MS = 2000; // Max 2 seconds for health check (non-blocking)
  private lastExpensiveCheckTime = 0;
  private readonly EXPENSIVE_CHECK_INTERVAL_MS = 60000; // Run expensive checks every 60 seconds only
  private isHealthCheckInProgress = false; // Prevent concurrent health checks
  // Circuit breaker name for health checks (prevents CPU load when logging is down)
  private readonly HEALTH_CHECK_CIRCUIT_BREAKER_NAME = 'logging-health-check';

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    private readonly circuitBreakerService: CircuitBreakerService
  ) {
    // Circuit breaker is managed by CircuitBreakerService using named instances
    // The service will automatically track failures and open/close the circuit
    // Prevents excessive health checks when logging is down (saves CPU for 10M+ users)
  }

  onModuleInit(): void {
    this.startHealthMonitoring();
  }

  /**
   * Get comprehensive logging health status
   * Uses caching, timeout protection, and non-blocking execution
   * Optimized for frequent checks (every 10-30 seconds) without performance impact
   */
  async getHealthStatus(): Promise<LoggingHealthMonitorStatus> {
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
  private async executeHealthCheckWithTimeout(): Promise<LoggingHealthMonitorStatus> {
    this.isHealthCheckInProgress = true;

    try {
      // Race between health check and timeout
      const healthCheckPromise = this.performHealthCheckInternal();
      const timeoutPromise = new Promise<LoggingHealthMonitorStatus>(resolve => {
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
  private async performHealthCheckInternal(): Promise<LoggingHealthMonitorStatus> {
    const issues: string[] = [];
    const status: LoggingHealthMonitorStatus = {
      healthy: true,
      service: {
        available: false,
      },
      endpoint: {
        accessible: false,
      },
      metrics: {
        totalLogs: 0,
        errorRate: 0,
        averageResponseTime: 0,
      },
      performance: {},
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
      // Fast path: Essential service availability check only (always runs)
      // Uses lightweight service check - fastest possible logging check
      const serviceHealth = await this.checkServiceHealthWithTimeout();
      status.service = serviceHealth;
      if (!serviceHealth.available) {
        issues.push('Logging service not available');
        status.healthy = false;
        // Circuit breaker will track failures automatically
      }

      // Fast path: Endpoint accessibility check (always runs)
      const endpointHealth = await this.checkEndpointHealthWithTimeout();
      status.endpoint = endpointHealth;
      if (!endpointHealth.accessible) {
        issues.push('Logging endpoint not accessible');
        status.healthy = false;
      }

      // Expensive checks only run periodically (every 60 seconds) to avoid performance impact
      // These are non-blocking and won't affect CPU load for frequent health checks
      if (shouldRunExpensiveChecks && status.service.available) {
        this.lastExpensiveCheckTime = now;

        // Run expensive checks in background (non-blocking) - update cached status when complete
        // This ensures they don't block the health check response (fast path returns immediately)
        void Promise.all([
          // Get logging metrics (expensive - runs periodically, non-blocking)
          Promise.race([
            Promise.resolve(this.getLoggingMetricsAsync()),
            new Promise<null>(
              resolve => setTimeout(() => resolve(null), 1000) // 1 second timeout
            ),
          ]).catch(() => null),
        ])
          .then(([metrics]) => {
            // Update cached status with expensive check results (non-blocking)
            if (
              this.cachedHealthStatus &&
              metrics &&
              typeof metrics === 'object' &&
              'totalLogs' in metrics
            ) {
              const typedMetrics = metrics as {
                totalLogs?: number;
                errorRate?: number;
                averageResponseTime?: number;
              };
              this.cachedHealthStatus.metrics.totalLogs = typedMetrics.totalLogs || 0;
              this.cachedHealthStatus.metrics.errorRate = typedMetrics.errorRate || 0;
              this.cachedHealthStatus.metrics.averageResponseTime =
                typedMetrics.averageResponseTime || 0;
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
  private getDefaultUnhealthyStatus(issues: string[] = []): LoggingHealthMonitorStatus {
    return {
      healthy: false,
      service: {
        available: false,
      },
      endpoint: {
        accessible: false,
      },
      metrics: {
        totalLogs: 0,
        errorRate: 0,
        averageResponseTime: 0,
      },
      performance: {},
      issues,
    };
  }

  /**
   * Check logging service health with timeout protection
   * Uses lightweight service check for minimal overhead
   * Non-blocking: Times out after 1.5 seconds
   * Optimized for 10M+ users - minimal CPU load, fastest possible check
   */
  private async checkServiceHealthWithTimeout(): Promise<{
    available: boolean;
    latency?: number;
    serviceName?: string;
  }> {
    const start = Date.now();
    const QUERY_TIMEOUT_MS = 1500; // 1.5 seconds max for service check (fast enough for 10M+ users)

    try {
      // Use lightweight service check - just verify service exists and log method is callable
      const checkPromise = Promise.resolve(
        this.loggingService && typeof this.loggingService.log === 'function'
      );

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Logging service check timeout')), QUERY_TIMEOUT_MS);
      });

      const isAvailable = await Promise.race([checkPromise, timeoutPromise]);
      const latency = Date.now() - start;

      return {
        available: isAvailable,
        latency,
        serviceName: this.loggingService?.constructor?.name || 'LoggingService',
      };
    } catch (_error) {
      // Service check failed - return false with latency measurement
      return {
        available: false,
        latency: Date.now() - start,
      };
    }
  }

  /**
   * Check logging endpoint health with timeout protection
   * Uses lightweight HTTP check for minimal overhead
   * Non-blocking: Times out after 1.5 seconds
   * Optimized for 10M+ users - minimal CPU load, fastest possible check
   */
  private async checkEndpointHealthWithTimeout(): Promise<{
    accessible: boolean;
    latency?: number;
    url?: string;
    port?: number;
    statusCode?: number;
  }> {
    const start = Date.now();
    const QUERY_TIMEOUT_MS = 1500; // 1.5 seconds max for endpoint check (fast enough for 10M+ users)

    try {
      const loggerBaseUrl =
        this.configService?.get<string>('API_URL') ||
        process.env['API_URL'] ||
        'http://localhost:8088';
      const loggerPort =
        this.configService?.get<number | string>('PORT') ||
        process.env['PORT'] ||
        process.env['VIRTUAL_PORT'] ||
        8088;
      const loggerUrl = `${loggerBaseUrl}/health`;

      // Use lightweight HTTP check - just verify endpoint responds (even 404 means service is responding)
      const httpCheckPromise = axios.get(loggerUrl, {
        timeout: QUERY_TIMEOUT_MS,
        validateStatus: () => true, // Accept any status code < 500
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Logging endpoint check timeout')), QUERY_TIMEOUT_MS);
      });

      const response = await Promise.race([httpCheckPromise, timeoutPromise]);
      const latency = Date.now() - start;
      const isAccessible = response.status < 500; // Any status < 500 means endpoint is accessible

      return {
        accessible: isAccessible,
        latency,
        url: loggerUrl,
        port: typeof loggerPort === 'number' ? loggerPort : parseInt(String(loggerPort), 10),
        statusCode: response.status,
      };
    } catch (_error) {
      // Endpoint check failed - return false with latency measurement
      return {
        accessible: false,
        latency: Date.now() - start,
      };
    }
  }

  /**
   * Get logging metrics asynchronously (expensive operation)
   * Runs periodically in background, non-blocking
   */
  private getLoggingMetricsAsync(): {
    totalLogs: number;
    errorRate: number;
    averageResponseTime: number;
  } {
    // For now, return default metrics
    // In the future, this could query actual logging metrics from database/cache
    return {
      totalLogs: 0,
      errorRate: 0,
      averageResponseTime: 0,
    };
  }

  /**
   * Get lightweight health status (service only, no endpoint query)
   * Use this for very frequent checks (e.g., every second) to avoid query overhead
   */
  getLightweightHealthStatus(): {
    healthy: boolean;
    service: {
      available: boolean;
      latency?: number;
    };
    lastCheck: Date;
  } {
    // Return lightweight status based on cached data
    // This doesn't query the endpoint, just returns service status
    if (this.cachedHealthStatus) {
      return {
        healthy: this.cachedHealthStatus.healthy,
        service: this.cachedHealthStatus.service,
        lastCheck: new Date(this.lastHealthCheckTime),
      };
    }

    // Fallback if no cached data
    return {
      healthy: false,
      service: {
        available: false,
      },
      lastCheck: new Date(),
    };
  }

  /**
   * Start health monitoring
   * Runs every 10-30 seconds (configurable via LOGGING_HEALTH_CHECK_INTERVAL_MS)
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
            'Logging health check failed',
            this.serviceName,
            {
              issues: status.issues,
              serviceAvailable: status.service.available,
              endpointAccessible: status.endpoint.accessible,
              latency: status.service.latency || status.endpoint.latency,
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
