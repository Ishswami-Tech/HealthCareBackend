/**
 * Database Health Monitor Service
 * @class DatabaseHealthMonitorService
 * @description Monitors database health with advanced checks
 * Follows Single Responsibility Principle - only handles health monitoring
 */

import { Injectable, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@config';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { DatabaseHealthMonitorStatus } from '@core/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DatabaseHealthMonitorService implements OnModuleInit {
  private readonly serviceName = 'DatabaseHealthMonitorService';
  private healthCheckInterval?: NodeJS.Timeout;
  private readonly CHECK_INTERVAL_MS = 30000; // 30 seconds
  private cachedHealthStatus: DatabaseHealthMonitorStatus | null = null;
  private lastHealthCheckTime = 0;
  private readonly CACHE_TTL_MS = 10000; // Cache health status for 10 seconds to avoid excessive queries
  private readonly HEALTH_CHECK_TIMEOUT_MS = 2000; // Max 2 seconds for health check (non-blocking)
  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private lastExpensiveCheckTime = 0;
  private readonly EXPENSIVE_CHECK_INTERVAL_MS = 60000; // Run expensive checks every 60 seconds only
  private isHealthCheckInProgress = false; // Prevent concurrent health checks

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
    // Note: We don't inject PrismaService instance - we use static getHealthCheckClient()
    // This ensures health checks use a dedicated connection pool that won't exhaust the main pool
  ) {}

  onModuleInit(): void {
    this.startHealthMonitoring();
  }

  /**
   * Get comprehensive health status
   * Uses caching, timeout protection, and non-blocking execution
   * Optimized for frequent checks (every 10-30 seconds) without performance impact
   */
  async getHealthStatus(): Promise<DatabaseHealthMonitorStatus> {
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
  private async executeHealthCheckWithTimeout(): Promise<DatabaseHealthMonitorStatus> {
    this.isHealthCheckInProgress = true;

    try {
      // Race between health check and timeout
      const healthCheckPromise = this.performHealthCheckInternal();
      const timeoutPromise = new Promise<DatabaseHealthMonitorStatus>(resolve => {
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

      // Reset failure counter on success
      if (status.healthy) {
        this.consecutiveFailures = 0;
      } else {
        this.consecutiveFailures++;
      }

      return status;
    } catch (error) {
      this.consecutiveFailures++;
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
   */
  private async performHealthCheckInternal(): Promise<DatabaseHealthMonitorStatus> {
    const issues: string[] = [];
    const status: DatabaseHealthMonitorStatus = {
      healthy: true,
      primary: {
        connected: false,
      },
      replicas: [],
      connectionPool: {
        total: 0,
        active: 0,
        idle: 0,
        utilization: 0,
      },
      issues: [],
    };

    const now = Date.now();
    const shouldRunExpensiveChecks =
      now - this.lastExpensiveCheckTime >= this.EXPENSIVE_CHECK_INTERVAL_MS;

    try {
      // Fast path: Essential connectivity check only (always runs)
      const primaryHealth = await this.checkPrimaryHealthWithTimeout();
      status.primary = primaryHealth;
      if (!primaryHealth.connected) {
        issues.push('Primary database not connected');
        status.healthy = false;
        this.consecutiveFailures++;
      } else {
        // Only reset failures if primary is connected
        if (this.consecutiveFailures > 0) {
          this.consecutiveFailures = Math.max(0, this.consecutiveFailures - 1);
        }
      }

      // Connection pool metrics (no query needed - uses internal metrics)
      status.connectionPool = {
        total: 0, // Will be populated by caller if ConnectionPoolManager is available
        active: 0,
        idle: 0,
        utilization: 0,
      };

      // Expensive checks only run periodically (every 60 seconds) to avoid performance impact
      if (shouldRunExpensiveChecks) {
        this.lastExpensiveCheckTime = now;

        // Disk space check (expensive - runs periodically)
        try {
          const diskSpace = await Promise.race([
            this.checkDiskSpace(),
            new Promise<null>(
              resolve => setTimeout(() => resolve(null), 1000) // 1 second timeout for disk check
            ),
          ]);
          if (diskSpace) {
            status.diskSpace = diskSpace;
            if (diskSpace.percentage > 90) {
              issues.push(`Disk space critical: ${diskSpace.percentage}% used`);
              status.healthy = false;
            }
          }
        } catch (_error) {
          // Disk space check failure shouldn't fail overall health
        }

        // Replication lag check (expensive - runs periodically)
        try {
          const replicationLag = await Promise.race([
            this.checkReplicationLag(),
            new Promise<undefined>(
              resolve => setTimeout(() => resolve(undefined), 1000) // 1 second timeout
            ),
          ]);
          if (replicationLag !== undefined) {
            status.replicationLag = replicationLag;
            if (replicationLag > 10000) {
              issues.push(`High replication lag: ${replicationLag}ms`);
            }
          }
        } catch (_error) {
          // Replication lag check failure shouldn't fail overall health
        }

        // Locks check (expensive - runs periodically)
        try {
          const locks = await Promise.race([
            this.checkLocks(),
            new Promise<null>(
              resolve => setTimeout(() => resolve(null), 1000) // 1 second timeout
            ),
          ]);
          if (locks) {
            status.locks = locks;
            if (locks.blocking > 10) {
              issues.push(`High number of blocking locks: ${locks.blocking}`);
            }
          }
        } catch (_error) {
          // Lock check failure shouldn't fail overall health
        }
      } else {
        // Use cached expensive check data if available
        if (this.cachedHealthStatus) {
          if (this.cachedHealthStatus.diskSpace) {
            status.diskSpace = this.cachedHealthStatus.diskSpace;
          }
          if (this.cachedHealthStatus.replicationLag !== undefined) {
            status.replicationLag = this.cachedHealthStatus.replicationLag;
          }
          if (this.cachedHealthStatus.locks) {
            status.locks = this.cachedHealthStatus.locks;
          }
        }
      }

      status.issues = issues;
    } catch (error) {
      status.healthy = false;
      status.issues.push(
        `Health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      this.consecutiveFailures++;
    }

    return status;
  }

  /**
   * Get default unhealthy status
   */
  private getDefaultUnhealthyStatus(issues: string[] = []): DatabaseHealthMonitorStatus {
    return {
      healthy: false,
      primary: {
        connected: false,
      },
      replicas: [],
      connectionPool: {
        total: 0,
        active: 0,
        idle: 0,
        utilization: 0,
      },
      issues,
    };
  }

  /**
   * Get lightweight health status (connection pool metrics only, no DB query)
   * Use this for very frequent checks (e.g., every second) to avoid query overhead
   */
  getLightweightHealthStatus(): {
    healthy: boolean;
    connectionPool: {
      total: number;
      active: number;
      idle: number;
      utilization: number;
    };
    lastCheck: Date;
  } {
    // Return lightweight status based on cached data or pool metrics only
    // This doesn't query the database, just returns pool status
    if (this.cachedHealthStatus) {
      return {
        healthy: this.cachedHealthStatus.healthy,
        connectionPool: this.cachedHealthStatus.connectionPool,
        lastCheck: new Date(this.lastHealthCheckTime),
      };
    }

    // Fallback if no cached data
    return {
      healthy: false,
      connectionPool: {
        total: 0,
        active: 0,
        idle: 0,
        utilization: 0,
      },
      lastCheck: new Date(),
    };
  }

  /**
   * Check primary database health with timeout protection
   * Uses dedicated health check client to avoid exhausting connection pool
   * Uses lightweight SELECT 1 query for minimal overhead
   * Non-blocking: Times out after 1.5 seconds
   */
  private async checkPrimaryHealthWithTimeout(): Promise<{
    connected: boolean;
    version?: string;
    latency?: number;
  }> {
    const start = Date.now();
    const QUERY_TIMEOUT_MS = 1500; // 1.5 seconds max for connectivity check

    try {
      // Use dedicated health check client (connection_limit=2, separate pool)
      // This prevents health checks from exhausting the main connection pool
      const client = PrismaService.getHealthCheckClient();

      // Race between query and timeout
      const queryPromise = (
        client as unknown as {
          $queryRaw: (query: TemplateStringsArray) => Promise<unknown>;
        }
      ).$queryRaw`SELECT 1`;

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Health check query timeout')), QUERY_TIMEOUT_MS);
      });

      await Promise.race([queryPromise, timeoutPromise]);

      const latency = Date.now() - start;

      return {
        connected: true,
        latency,
      };
    } catch (_error) {
      // Check if it's a circuit breaker scenario (too many failures)
      if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        void this.loggingService?.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Health check circuit breaker: ${this.consecutiveFailures} consecutive failures`,
          this.serviceName
        );
      }

      return {
        connected: false,
        latency: Date.now() - start,
      };
    }
  }

  /**
   * Check disk space (PostgreSQL specific)
   * Uses dedicated health check client to avoid exhausting connection pool
   */
  private async checkDiskSpace(): Promise<{
    used: number;
    available: number;
    percentage: number;
  } | null> {
    try {
      // Use dedicated health check client (connection_limit=2, separate pool)
      const client = PrismaService.getHealthCheckClient();
      const result = await (
        client as unknown as {
          $queryRaw: (query: TemplateStringsArray) => Promise<
            Array<{
              used?: number;
              available?: number;
              percentage?: number;
            }>
          >;
        }
      ).$queryRaw`
        SELECT 
          pg_database_size(current_database()) as used,
          (SELECT setting::bigint FROM pg_settings WHERE name = 'data_directory') as available,
          (pg_database_size(current_database())::float / 
           (SELECT setting::bigint FROM pg_settings WHERE name = 'data_directory')::float * 100) as percentage
      `;

      if (result[0]) {
        return {
          used: result[0].used ?? 0,
          available: result[0].available ?? 0,
          percentage: result[0].percentage ?? 0,
        };
      }
    } catch (_error) {
      // Disk space check may not be available or may require special permissions
    }
    return null;
  }

  /**
   * Check replication lag
   * Uses dedicated health check client to avoid exhausting connection pool
   */
  private async checkReplicationLag(): Promise<number | undefined> {
    try {
      // Use dedicated health check client (connection_limit=2, separate pool)
      const client = PrismaService.getHealthCheckClient();
      const result = await (
        client as unknown as {
          $queryRaw: (query: TemplateStringsArray) => Promise<Array<{ lag?: number }>>;
        }
      ).$queryRaw`
        SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 as lag
        WHERE pg_is_in_recovery()
      `;

      return result[0]?.lag;
    } catch (_error) {
      // Replication lag check may not be available
      return undefined;
    }
  }

  /**
   * Check database locks
   * Uses dedicated health check client to avoid exhausting connection pool
   */
  private async checkLocks(): Promise<{ count: number; blocking: number } | null> {
    try {
      // Use dedicated health check client (connection_limit=2, separate pool)
      const client = PrismaService.getHealthCheckClient();
      const result = await (
        client as unknown as {
          $queryRaw: (
            query: TemplateStringsArray
          ) => Promise<Array<{ count?: number; blocking?: number }>>;
        }
      ).$queryRaw`
        SELECT 
          COUNT(*) as count,
          COUNT(*) FILTER (WHERE NOT granted) as blocking
        FROM pg_locks
      `;

      if (result[0]) {
        return {
          count: result[0].count ?? 0,
          blocking: result[0].blocking ?? 0,
        };
      }
    } catch (_error) {
      // Lock check may not be available
    }
    return null;
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      void this.performHealthCheck();
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Perform background health check (non-blocking)
   * Runs periodically to update cached status
   */
  private performHealthCheck(): void {
    // Non-blocking: Don't await, just trigger update
    void this.getHealthStatus()
      .then(status => {
        if (!status.healthy) {
          void this.loggingService?.log(
            LogType.DATABASE,
            LogLevel.WARN,
            'Database health check failed',
            this.serviceName,
            { issues: status.issues, consecutiveFailures: this.consecutiveFailures }
          );
        }
      })
      .catch(error => {
        void this.loggingService?.log(
          LogType.DATABASE,
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
