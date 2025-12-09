/**
 * Cache Health Monitor Service
 * @class CacheHealthMonitorService
 * @description Monitors cache health with optimized checks for frequent monitoring
 * Follows Single Responsibility Principle - only handles health monitoring
 * Optimized for frequent checks (every 10-30 seconds) without performance impact
 */

import { Injectable, Inject, forwardRef, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@config';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { CacheHealthMonitorStatus } from '@core/types';
import { CircuitBreakerService } from '@core/resilience';
import { CacheService } from '@cache/cache.service';
import { CacheProviderFactory } from '@cache/providers/cache-provider.factory';

@Injectable()
export class CacheHealthMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly serviceName = 'CacheHealthMonitorService';
  private healthCheckInterval?: NodeJS.Timeout;
  // Background monitoring interval: 10-30 seconds (configurable, default 20 seconds)
  // Optimized for 10M+ users - frequent enough for real-time status, not too frequent to cause load
  // Note: Will be initialized in constructor using ConfigService
  private CHECK_INTERVAL_MS = 20000; // Default 20 seconds (within 10-30 range)
  private cachedHealthStatus: CacheHealthMonitorStatus | null = null;
  private lastHealthCheckTime = 0;
  private readonly CACHE_TTL_MS = 10000; // Cache health status for 10 seconds to avoid excessive queries
  private readonly HEALTH_CHECK_TIMEOUT_MS = 2000; // Max 2 seconds for health check (non-blocking)
  private lastExpensiveCheckTime = 0;
  private readonly EXPENSIVE_CHECK_INTERVAL_MS = 60000; // Run expensive checks every 60 seconds only
  private isHealthCheckInProgress = false; // Prevent concurrent health checks
  // Circuit breaker name for health checks (prevents CPU load when cache is down)
  private readonly HEALTH_CHECK_CIRCUIT_BREAKER_NAME = 'cache-health-check';

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => CacheProviderFactory))
    private readonly providerFactory: CacheProviderFactory,
    private readonly circuitBreakerService: CircuitBreakerService
  ) {
    // Circuit breaker is managed by CircuitBreakerService using named instances
    // The service will automatically track failures and open/close the circuit
    // Prevents excessive health checks when cache is down (saves CPU for 10M+ users)
  }

  onModuleInit(): void {
    this.startHealthMonitoring();
  }

  /**
   * Get comprehensive cache health status
   * Uses caching, timeout protection, and non-blocking execution
   * Optimized for frequent checks (every 10-30 seconds) without performance impact
   */
  async getHealthStatus(): Promise<CacheHealthMonitorStatus> {
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
  private async executeHealthCheckWithTimeout(): Promise<CacheHealthMonitorStatus> {
    this.isHealthCheckInProgress = true;

    try {
      // Race between health check and timeout
      const healthCheckPromise = this.performHealthCheckInternal();
      const timeoutPromise = new Promise<CacheHealthMonitorStatus>(resolve => {
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
  private async performHealthCheckInternal(): Promise<CacheHealthMonitorStatus> {
    const issues: string[] = [];
    const status: CacheHealthMonitorStatus = {
      healthy: true,
      connection: {
        connected: false,
      },
      metrics: {
        hitRate: 0,
        missRate: 0,
        totalKeys: 0,
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
      // Fast path: Essential connectivity check only (always runs)
      // Uses lightweight PING command - fastest possible cache check (like SELECT 1 for database)
      const connectionHealth = await this.checkConnectionHealthWithTimeout();
      status.connection = connectionHealth;
      if (!connectionHealth.connected) {
        issues.push('Cache connection not available');
        status.healthy = false;
        // Circuit breaker will track failures automatically
      }

      // Expensive checks only run periodically (every 60 seconds) to avoid performance impact
      // These are non-blocking and won't affect CPU load for frequent health checks
      if (shouldRunExpensiveChecks && status.connection.connected) {
        this.lastExpensiveCheckTime = now;

        // Run expensive checks in background (non-blocking) - update cached status when complete
        // This ensures they don't block the health check response (fast path returns immediately)
        void Promise.all([
          // Get cache metrics (expensive - runs periodically, non-blocking)
          Promise.race([
            this.cacheService.getCacheMetricsAsync().catch(() => null),
            new Promise<null>(
              resolve => setTimeout(() => resolve(null), 1000) // 1 second timeout
            ),
          ]),
          // Get cache stats (expensive - runs periodically, non-blocking)
          Promise.race([
            this.cacheService.getCacheStats().catch(() => null),
            new Promise<null>(
              resolve => setTimeout(() => resolve(null), 1000) // 1 second timeout
            ),
          ]),
        ])
          .then(([metrics, stats]) => {
            // Update cached status with expensive check results (non-blocking)
            if (this.cachedHealthStatus) {
              if (metrics) {
                this.cachedHealthStatus.metrics.hitRate = metrics.hitRate || 0;
                this.cachedHealthStatus.metrics.missRate = 100 - (metrics.hitRate || 0);
                this.cachedHealthStatus.metrics.totalKeys = metrics.keys || 0;
                if (metrics.memory) {
                  this.cachedHealthStatus.metrics.memoryUsed = metrics.memory.used;
                  this.cachedHealthStatus.metrics.memoryAvailable = metrics.memory.peak || 0;
                  if (metrics.memory.peak && metrics.memory.peak > 0) {
                    this.cachedHealthStatus.metrics.memoryPercentage =
                      (metrics.memory.used / metrics.memory.peak) * 100;
                  }
                }
              }
              if (stats) {
                const totalOps = stats.hits + stats.misses;
                if (totalOps > 0) {
                  this.cachedHealthStatus.metrics.hitRate = (stats.hits / totalOps) * 100;
                  this.cachedHealthStatus.metrics.missRate = (stats.misses / totalOps) * 100;
                }
              }
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
  private getDefaultUnhealthyStatus(issues: string[] = []): CacheHealthMonitorStatus {
    return {
      healthy: false,
      connection: {
        connected: false,
      },
      metrics: {
        hitRate: 0,
        missRate: 0,
        totalKeys: 0,
      },
      performance: {},
      issues,
    };
  }

  /**
   * Get cache provider type (Redis, Dragonfly, etc.)
   */
  private getProviderType(): 'redis' | 'dragonfly' | 'memcached' | 'memory' | 'unknown' {
    try {
      // Use ConfigService (which uses dotenv) for environment variable access
      const provider = this.configService.getCacheProvider();

      if (['redis', 'dragonfly', 'memcached', 'memory'].includes(provider)) {
        return provider as 'redis' | 'dragonfly' | 'memcached' | 'memory';
      }

      return 'unknown';
    } catch {
      // Fallback: use ConfigService (which uses dotenv) for environment variable access
      const provider = this.configService.getCacheProvider();
      if (['redis', 'dragonfly', 'memcached', 'memory'].includes(provider)) {
        return provider as 'redis' | 'dragonfly' | 'memcached' | 'memory';
      }
      return 'unknown';
    }
  }

  /**
   * Get provider version (if available)
   */
  private getProviderVersion(): string | undefined {
    try {
      // Try to get version from cache service (if available)
      // This is provider-specific and may not always be available
      // For now, return undefined - version detection can be added per provider
      // Redis/Dragonfly version can be obtained via INFO command, but that's expensive
      // We'll skip it for health checks to keep them lightweight
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Check cache connection health with timeout protection
   * Uses lightweight PING command for minimal overhead (like SELECT 1 for database)
   * Non-blocking: Times out after 1.5 seconds
   * Optimized for 10M+ users - minimal CPU load, fastest possible check
   */
  private async checkConnectionHealthWithTimeout(): Promise<{
    connected: boolean;
    latency?: number;
    provider?: 'redis' | 'dragonfly' | 'memcached' | 'memory' | 'unknown';
    providerStatus?: 'connected' | 'disconnected' | 'error';
    providerVersion?: string;
  }> {
    const start = Date.now();
    const QUERY_TIMEOUT_MS = 1500; // 1.5 seconds max for connectivity check (fast enough for 10M+ users)
    const providerType = this.getProviderType();

    try {
      // Use lightweight PING command (fastest possible cache check - equivalent to SELECT 1 for database)
      // PING is the lightest Redis/cache command - just checks connectivity, no data transfer
      const pingPromise = this.cacheService.ping();

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Cache health check query timeout')), QUERY_TIMEOUT_MS);
      });

      const pingResult = await Promise.race([pingPromise, timeoutPromise]);
      const latency = Date.now() - start;
      const isConnected = pingResult === 'PONG' || pingResult === 'pong';

      // Get provider version (non-blocking, may be undefined)
      const providerVersion = this.getProviderVersion();

      return {
        connected: isConnected,
        latency,
        provider: providerType,
        providerStatus: isConnected ? 'connected' : 'disconnected',
        ...(providerVersion !== undefined && { providerVersion }),
      };
    } catch (_error) {
      // Connection failed - return false with latency measurement
      return {
        connected: false,
        latency: Date.now() - start,
        provider: providerType,
        providerStatus: 'error',
      };
    }
  }

  /**
   * Get lightweight health status (connection only, no metrics query)
   * Use this for very frequent checks (e.g., every second) to avoid query overhead
   */
  getLightweightHealthStatus(): {
    healthy: boolean;
    connection: {
      connected: boolean;
      latency?: number;
    };
    lastCheck: Date;
  } {
    // Return lightweight status based on cached data
    // This doesn't query the cache, just returns connection status
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
   * Runs every 10-30 seconds (configurable via CACHE_HEALTH_CHECK_INTERVAL_MS)
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
   * Optimized for 10M+ users - uses lightweight PING, timeout protection, circuit breaker
   */
  private performHealthCheck(): void {
    // Non-blocking: Don't await, just trigger update
    // Uses lightweight PING command (fastest possible) with timeout protection
    // Circuit breaker prevents excessive checks when unhealthy (saves CPU)
    void this.getHealthStatus()
      .then(status => {
        if (
          !status.healthy &&
          this.circuitBreakerService.canExecute(this.HEALTH_CHECK_CIRCUIT_BREAKER_NAME)
        ) {
          // Only log if circuit breaker is not open (avoid log spam)
          void this.loggingService?.log(
            LogType.CACHE,
            LogLevel.WARN,
            'Cache health check failed',
            this.serviceName,
            {
              issues: status.issues,
              provider: status.connection.provider,
              providerStatus: status.connection.providerStatus,
              latency: status.connection.latency,
            }
          );
        }
      })
      .catch(error => {
        // Log errors but don't let them block health monitoring
        void this.loggingService?.log(
          LogType.CACHE,
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
