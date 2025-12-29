/**
 * System Health Checker
 * Collects CPU, memory, and connection metrics
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { cpus, totalmem, freemem } from 'node:os';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { RealtimeSystemMetrics } from '@core/types';

@Injectable()
export class SystemHealthChecker {
  private readonly serviceStartTime = Date.now();
  private requestCount = 0;
  private errorCount = 0;
  private lastRequestTime = Date.now();

  constructor(
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  /**
   * Get system metrics
   */
  getSystemMetrics(): RealtimeSystemMetrics {
    try {
      // CPU usage (simplified - actual CPU usage requires more complex calculation)
      const cpuCount = cpus().length;
      const cpuUsage = process.cpuUsage();
      const cpuPercent =
        ((cpuUsage.user + cpuUsage.system) / 1000000 / cpuCount / process.uptime()) * 100;

      // Memory usage
      const totalMem = totalmem();
      const freeMem = freemem();
      const usedMem = totalMem - freeMem;
      const memoryPercent = (usedMem / totalMem) * 100;

      // Request rate (simplified - would need actual request tracking)
      const now = Date.now();
      const timeDiff = (now - this.lastRequestTime) / 1000; // seconds
      const requestRate = timeDiff > 0 ? this.requestCount / timeDiff : 0;
      this.requestCount = 0;
      this.lastRequestTime = now;

      // Error rate
      const errorRate = this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0;
      this.errorCount = 0;

      return {
        cpu: Math.min(100, Math.max(0, cpuPercent)),
        memory: Math.min(100, Math.max(0, memoryPercent)),
        activeConnections: 0, // Would need to track from Socket.IO
        requestRate: Math.max(0, requestRate),
        errorRate: Math.min(100, Math.max(0, errorRate)),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `System metrics collection failed: ${errorMessage}`,
        'SystemHealthChecker',
        { error: errorMessage }
      );

      // Return default metrics on error
      return {
        cpu: 0,
        memory: 0,
        activeConnections: 0,
        requestRate: 0,
        errorRate: 0,
      };
    }
  }

  /**
   * Get uptime
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.serviceStartTime) / 1000);
  }

  /**
   * Increment request count (for rate calculation)
   */
  incrementRequest(): void {
    this.requestCount++;
  }

  /**
   * Increment error count (for error rate calculation)
   */
  incrementError(): void {
    this.errorCount++;
  }
}
