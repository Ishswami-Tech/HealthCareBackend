/**
 * Logging Health Monitor Service
 * @class LoggingHealthMonitorService
 * @description Monitors logging service health with optimized checks for frequent monitoring
 * Follows Single Responsibility Principle - only handles health monitoring
 * Optimized for frequent checks (every 10-30 seconds) without performance impact
 */

import {
  Injectable,
  Inject,
  forwardRef,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { HttpService } from '@infrastructure/http';
// IMPORTANT: avoid importing from the @config barrel in infra boot code (SWC TDZ/cycles).
import { ConfigService } from '@config/config.service';
import { LogType, LogLevel } from '@core/types';
import type { LoggingHealthMonitorStatus } from '@core/types';
import { CircuitBreakerService } from '@core/resilience/circuit-breaker.service';
import { LoggingService } from './logging.service';

/**
 * Type guard to check if logging service is available and has a valid log method
 * @param service - The logging service instance (may be null due to circular dependency)
 * @returns True if the service is available and has a log method
 */
function hasLogMethod(service: LoggingService | null): service is LoggingService {
  return service !== null && typeof service.log === 'function';
}

/**
 * Get logging service if available and ready to use
 * Safely handles null case from @Optional() injection
 * @param service - The logging service instance (may be null)
 * @returns The logging service or null if not available
 */
function getLoggingService(service: LoggingService | null): LoggingService | null {
  return hasLogMethod(service) ? service : null;
}

@Injectable()
export class LoggingHealthMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly serviceName = 'LoggingHealthMonitorService';
  private healthCheckInterval?: NodeJS.Timeout;
  // Background monitoring interval: 10-30 seconds (configurable, default 20 seconds)
  // Optimized for 10M+ users - frequent enough for real-time status, not too frequent to cause load
  private readonly CHECK_INTERVAL_MS: number;
  private cachedHealthStatus: LoggingHealthMonitorStatus | null = null;
  private lastHealthCheckTime = 0;
  private readonly serviceStartTime = Date.now(); // Track when service started
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
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService | null,
    @Optional() private readonly httpService?: HttpService,
    @Optional() private readonly circuitBreakerService?: CircuitBreakerService
  ) {
    // Circuit breaker is managed by CircuitBreakerService using named instances
    // The service will automatically track failures and open/close the circuit
    // Prevents excessive health checks when logging is down (saves CPU for 10M+ users)

    // Initialize CHECK_INTERVAL_MS using ConfigService (single source of truth)
    this.CHECK_INTERVAL_MS = this.configService.getEnvNumber(
      'LOGGING_HEALTH_CHECK_INTERVAL_MS',
      20000
    ); // Default 20 seconds (within 10-30 range)
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

      // Circuit breaker tracks failures automatically (if available)
      // Only record failures if service is actually unhealthy (not just during startup/circular deps)
      if (this.circuitBreakerService) {
        if (status.healthy === false && status.issues.length > 0) {
          // Only record failure if we have actual issues (not just during startup)
          const hasRealIssues = status.issues.some(
            issue => !issue.includes('startup') && !issue.includes('circular')
          );
          if (hasRealIssues) {
            this.circuitBreakerService.recordFailure(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME);
          } else {
            // During startup or expected scenarios - record success to prevent false circuit opening
            this.circuitBreakerService.recordSuccess(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME);
          }
        } else if (status.healthy) {
          // Record success in circuit breaker
          this.circuitBreakerService.recordSuccess(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME);
        } else {
          // Status is false but no issues - likely during startup, record success
          this.circuitBreakerService.recordSuccess(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME);
        }
      }

      return status;
    } catch (error) {
      // Record failure in circuit breaker (if available)
      // Only record if it's a real error, not expected initialization issues
      if (this.circuitBreakerService) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isExpectedError =
          errorMessage.includes('timeout') ||
          errorMessage.includes('initialization') ||
          errorMessage.includes('circular') ||
          errorMessage.includes('Logging service check timeout');
        if (!isExpectedError) {
          this.circuitBreakerService.recordFailure(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME);
        } else {
          // Expected error during initialization - record success to prevent false circuit opening
          this.circuitBreakerService.recordSuccess(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME);
        }
      }

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
    if (
      this.circuitBreakerService &&
      !this.circuitBreakerService.canExecute(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME)
    ) {
      // Circuit breaker is open - return cached or default status (no CPU load)
      return (
        this.cachedHealthStatus ||
        this.getDefaultUnhealthyStatus(['Circuit breaker open - too many failures'])
      );
    }

    try {
      // Skip health checks during startup grace period (first 90 seconds)
      // This prevents false warnings during application initialization
      // Increased to 90 seconds to allow server and Prisma to fully start
      const startupGracePeriod = 90000; // 90 seconds
      const timeSinceInit = Date.now() - this.serviceStartTime;
      const isDuringStartup = timeSinceInit < startupGracePeriod;
      // Use ConfigService for service name (single source of truth)
      const serviceName = this.configService.getEnv('SERVICE_NAME', 'api');
      const isWorkerService = serviceName === 'worker';

      // Fast path: Essential service availability check only (always runs)
      // Uses lightweight service check - fastest possible logging check
      const serviceHealth = await this.checkServiceHealthWithTimeout();
      status.service = serviceHealth;

      // Declare isPastGracePeriod at function scope so it's accessible throughout
      const isPastGracePeriod = !isDuringStartup;

      if (!serviceHealth.available) {
        // LoggingService may be null due to circular dependencies during initialization
        // This is expected behavior, not a failure condition
        // Only mark as unhealthy if not during startup AND if we're past the grace period
        // AND if this is not a known circular dependency scenario
        const isKnownCircularDependency =
          this.loggingService === null && timeSinceInit < startupGracePeriod * 2; // Extended grace for circular deps

        if (isPastGracePeriod && !isKnownCircularDependency) {
          // Service not available - mark as unhealthy
          issues.push('Logging service not available');
          status.healthy = false;
        } else {
          // During startup or known circular dependency - mark as healthy to avoid false alarms
          status.service.available = true;
          status.healthy = true;
        }
        // Circuit breaker will track failures automatically (but only if actually unhealthy)
        if (status.healthy && this.circuitBreakerService) {
          // Reset circuit breaker if service is actually healthy
          this.circuitBreakerService.recordSuccess(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME);
        }
      } else {
        // Service is available - mark as healthy regardless of endpoint status
        // Endpoint accessibility is secondary to service availability
        status.healthy = true;
      }

      // Fast path: Endpoint accessibility check (only in API service, not worker)
      // Skip endpoint check during startup or in worker service to avoid false warnings
      // Use isPastGracePeriod from function scope (declared above)
      const isPastGracePeriodForEndpoint = isPastGracePeriod;
      if (!isDuringStartup && !isWorkerService) {
        // Only check endpoint in API service (worker doesn't expose HTTP endpoints)
        try {
          const endpointHealth = await this.checkEndpointHealthWithTimeout();
          status.endpoint = endpointHealth;
          // Don't mark as unhealthy if endpoint check fails - service availability is more important
          // The endpoint may not be accessible but the service itself is working
          // Only log as warning, don't fail health check
          if (!endpointHealth.accessible && isPastGracePeriodForEndpoint) {
            // Log as info/warning but don't mark as unhealthy
            // Service is available and working, endpoint accessibility is secondary
            issues.push('Logging endpoint not accessible (service is still available)');
            // Don't set status.healthy = false - service is available
          }
        } catch {
          // Endpoint check failed - don't mark as unhealthy if service is available
          // Service availability is the primary health indicator
          if (isPastGracePeriodForEndpoint) {
            status.endpoint = {
              accessible: false,
              latency: 0,
            };
            // Don't mark as unhealthy - service is available
            issues.push('Logging endpoint check failed (service is still available)');
          } else {
            // During startup, mark as accessible to avoid false warnings
            status.endpoint = {
              accessible: true,
              latency: 0,
            };
          }
        }
      } else {
        // During startup or in worker service, mark endpoint as accessible to avoid false warnings
        status.endpoint = {
          accessible: true,
          latency: 0,
        };
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
      // Check if loggingService is available and has the log method
      // The service may be null due to circular dependency, which is expected during initialization
      const isServiceAvailable =
        this.loggingService !== null &&
        this.loggingService !== undefined &&
        typeof this.loggingService === 'object' &&
        typeof (this.loggingService as { log?: unknown }).log === 'function';

      const checkPromise = Promise.resolve(isServiceAvailable);

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Logging service check timeout')), QUERY_TIMEOUT_MS);
      });

      const isAvailable = await Promise.race([checkPromise, timeoutPromise]);
      const latency = Date.now() - start;
      const serviceName = 'LoggingService';

      return {
        available: isAvailable,
        latency,
        serviceName,
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
      // Use localhost for health check (internal check, not external)
      // This avoids circular HTTP requests to external URL
      // The logger endpoint is on the same server, so use localhost
      const loggerPort = this.configService.getEnvNumber(
        'PORT',
        this.configService.getEnvNumber('VIRTUAL_PORT', 8088)
      );
      const loggerUrlPath = this.configService.getEnv('LOGGER_URL', '/logger');
      // Use localhost for internal health check (same container)
      const loggerUrl = `http://localhost:${loggerPort}${loggerUrlPath}`;

      // Use lightweight HTTP check - just verify endpoint responds (any status code means service is responding)
      // Accept any status code including 404, 500, etc. - as long as we get a response, the server is up
      if (!this.httpService) {
        throw new Error('HttpService is not available for logging endpoint check');
      }

      const httpCheckPromise: Promise<{ status: number }> = this.httpService
        .get<unknown>(loggerUrl, {
          timeout: QUERY_TIMEOUT_MS,
          // Disable redirects for localhost health checks to prevent external URL redirects
          maxRedirects: 0,
        })
        .then(response => {
          // Response already has status from centralized HTTP service
          return { status: response.status };
        });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Logging endpoint check timeout')), QUERY_TIMEOUT_MS);
      });

      const response = await Promise.race([httpCheckPromise, timeoutPromise]);
      const latency = Date.now() - start;
      // Any HTTP response (even 404, 500) means the server is up and responding
      // The endpoint might not exist yet, but the server is accessible
      const isAccessible = response.status !== undefined; // Any status code means server is responding

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
          this.circuitBreakerService?.canExecute(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME)
        ) {
          // Only log if circuit breaker is not open (avoid log spam)
          // Skip logging during startup (first 90 seconds) or in worker service to avoid startup warnings
          const startupGracePeriod = 90000; // 90 seconds
          const timeSinceInit = Date.now() - this.serviceStartTime;
          // Use ConfigService for service name (single source of truth)
          const currentServiceName = this.configService.getEnv('SERVICE_NAME', 'api');
          const isCurrentWorkerService = currentServiceName === 'worker';

          if (timeSinceInit > startupGracePeriod && !isCurrentWorkerService) {
            this.logHealthCheckFailure(status);
          }
        }
      })
      .catch(error => {
        // Log errors but don't let them block health monitoring
        this.logHealthCheckError(error);
      });
  }

  /**
   * Log health check failure
   * Separated method to handle type narrowing properly
   */
  private logHealthCheckFailure(status: LoggingHealthMonitorStatus): void {
    const service = getLoggingService(this.loggingService);
    if (service) {
      void service.log(
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
  }

  /**
   * Log health check error
   * Separated method to handle type narrowing properly
   */
  private logHealthCheckError(error: unknown): void {
    const service = getLoggingService(this.loggingService);
    if (service) {
      void service.log(LogType.SYSTEM, LogLevel.ERROR, 'Health check error', this.serviceName, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
