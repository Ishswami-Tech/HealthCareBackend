/**
 * Database Health Checker
 * Lightweight database connectivity check
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { RealtimeHealthCheckResult } from '@core/types';

@Injectable()
export class DatabaseHealthChecker {
  private readonly TIMEOUT_MS = 5000; // 5 seconds

  constructor(
    @Optional()
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService?: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  /**
   * Check database health
   */
  async check(): Promise<RealtimeHealthCheckResult> {
    const startTime = Date.now();

    if (!this.databaseService) {
      return {
        service: 'database',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: 'DatabaseService not available',
      };
    }

    try {
      // Lightweight check: ping the dedicated health-check pool instead of
      // executeHealthcareRead's main pool, which this leader-elected check would otherwise
      // send across the mesh to the primary on every tick (see DatabaseService.pingHealthCheckPool).
      await Promise.race([
        this.databaseService.pingHealthCheckPool(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Database check timeout')), this.TIMEOUT_MS)
        ),
      ]);

      const responseTime = Date.now() - startTime;

      return {
        service: 'database',
        status: responseTime < 1000 ? 'healthy' : responseTime < 3000 ? 'degraded' : 'unhealthy',
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Database health check failed: ${errorMessage}`,
        'DatabaseHealthChecker',
        { error: errorMessage, responseTime }
      );

      return {
        service: 'database',
        status: 'unhealthy',
        responseTime,
        error: errorMessage,
      };
    }
  }
}
