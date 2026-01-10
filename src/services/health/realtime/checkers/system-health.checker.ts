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

  // Real-time CPU tracking
  private previousCpuUsage: NodeJS.CpuUsage | null = null;
  private previousCpuTimestamp: number = Date.now();

  constructor(
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  /**
   * Get system metrics with real-time CPU calculation
   */
  getSystemMetrics(): RealtimeSystemMetrics {
    try {
      const cpuCount = cpus().length;
      const now = Date.now();
      const currentCpuUsage = process.cpuUsage();

      // Calculate real-time CPU percentage using delta between measurements
      let cpuPercent = 0;

      if (this.previousCpuUsage !== null) {
        // Calculate CPU time delta (microseconds)
        const cpuDelta = {
          user: currentCpuUsage.user - this.previousCpuUsage.user,
          system: currentCpuUsage.system - this.previousCpuUsage.system,
        };
        const totalCpuDelta = cpuDelta.user + cpuDelta.system;

        // Calculate time delta (milliseconds -> seconds)
        const timeDelta = (now - this.previousCpuTimestamp) / 1000;

        // Real-time CPU percentage: (cpu_time_delta / time_delta / cpu_count) * 100
        // cpu_time_delta is in microseconds, convert to seconds by dividing by 1,000,000
        if (timeDelta > 0 && cpuCount > 0) {
          cpuPercent = (totalCpuDelta / 1000000 / timeDelta / cpuCount) * 100;
          // Cap at 100% per core (can exceed 100% if using multiple cores, but cap for display)
          cpuPercent = Math.min(100, Math.max(0, cpuPercent));
        }
      } else {
        // First call: use average CPU since process start (fallback)
        const uptime = process.uptime();
        if (uptime > 0 && cpuCount > 0) {
          cpuPercent =
            ((currentCpuUsage.user + currentCpuUsage.system) / 1000000 / uptime / cpuCount) * 100;
          cpuPercent = Math.min(100, Math.max(0, cpuPercent));
        }
      }

      // Update previous values for next calculation
      this.previousCpuUsage = currentCpuUsage;
      this.previousCpuTimestamp = now;

      // Memory usage
      const totalMem = totalmem();
      const freeMem = freemem();
      const usedMem = totalMem - freeMem;
      const memoryPercent = (usedMem / totalMem) * 100;

      // Request rate (simplified - would need actual request tracking)
      // Reuse 'now' variable from above
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
