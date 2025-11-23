/**
 * Connection Leak Detector Service
 * @class ConnectionLeakDetectorService
 * @description Monitors connection pool usage and detects leaked connections
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

export interface ConnectionLeakInfo {
  detected: boolean;
  activeConnections: number;
  idleConnections: number;
  totalConnections: number;
  leakThreshold: number;
  timestamp: Date;
}

/**
 * Connection leak detector service
 * @internal
 */
@Injectable()
export class ConnectionLeakDetectorService implements OnModuleInit {
  private readonly serviceName = 'ConnectionLeakDetectorService';
  private monitoringInterval!: NodeJS.Timeout;
  private readonly monitoringIntervalMs = 30000; // Check every 30 seconds
  private readonly leakThreshold = 0.9; // 90% of max connections
  private readonly maxIdleTime = 300000; // 5 minutes

  // Track connection states
  private connectionStates = new Map<string, { timestamp: Date; operation: string }>();
  private leakCount = 0;
  private lastLeakAlert: Date | null = null;
  private readonly leakAlertCooldown = 60000; // 1 minute between alerts

  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  onModuleInit(): void {
    this.startMonitoring();
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Connection leak detector service initialized',
      this.serviceName
    );
  }

  /**
   * Start monitoring connection pool
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      void this.checkForLeaks();
    }, this.monitoringIntervalMs);
  }

  /**
   * Check for connection leaks
   */
  private checkForLeaks(): void {
    try {
      // This will be called by ConnectionPoolManager to provide metrics
      // For now, we'll log that monitoring is active
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        'Connection leak check performed',
        this.serviceName
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to check for connection leaks: ${error instanceof Error ? error.message : String(error)}`,
        this.serviceName,
        { error: error instanceof Error ? error.stack : String(error) }
      );
    }
  }

  /**
   * Detect connection leaks based on pool metrics
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  detectLeaks(poolMetrics: {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    maxConnections: number;
  }): ConnectionLeakInfo {
    const { totalConnections, activeConnections, idleConnections, maxConnections } = poolMetrics;
    const connectionUsage = totalConnections / maxConnections;
    const detected = connectionUsage >= this.leakThreshold;

    if (detected) {
      this.leakCount++;

      // Alert only if cooldown period has passed
      const now = new Date();
      if (
        !this.lastLeakAlert ||
        now.getTime() - this.lastLeakAlert.getTime() > this.leakAlertCooldown
      ) {
        this.lastLeakAlert = now;

        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.ERROR,
          `Connection leak detected: ${totalConnections}/${maxConnections} connections in use (${(connectionUsage * 100).toFixed(1)}%)`,
          this.serviceName,
          {
            totalConnections,
            activeConnections,
            idleConnections,
            maxConnections,
            connectionUsage,
            leakThreshold: this.leakThreshold,
            leakCount: this.leakCount,
          }
        );
      }
    }

    return {
      detected,
      activeConnections,
      idleConnections,
      totalConnections,
      leakThreshold: this.leakThreshold,
      timestamp: new Date(),
    };
  }

  /**
   * Track connection acquisition
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  trackConnection(connectionId: string, operation: string): void {
    this.connectionStates.set(connectionId, {
      timestamp: new Date(),
      operation,
    });
  }

  /**
   * Track connection release
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  releaseConnection(connectionId: string): void {
    this.connectionStates.delete(connectionId);
  }

  /**
   * Clean up stale connections
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  cleanupStaleConnections(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [connectionId, state] of this.connectionStates.entries()) {
      const age = now - state.timestamp.getTime();
      if (age > this.maxIdleTime) {
        this.connectionStates.delete(connectionId);
        cleaned++;

        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Cleaned up stale connection: ${connectionId} (age: ${age}ms)`,
          this.serviceName,
          {
            connectionId,
            age,
            operation: state.operation,
          }
        );
      }
    }

    return cleaned;
  }

  /**
   * Get leak detection statistics
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  getLeakStats(): {
    totalLeaksDetected: number;
    trackedConnections: number;
    lastLeakAlert: Date | null;
  } {
    return {
      totalLeaksDetected: this.leakCount,
      trackedConnections: this.connectionStates.size,
      lastLeakAlert: this.lastLeakAlert,
    };
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }
}
