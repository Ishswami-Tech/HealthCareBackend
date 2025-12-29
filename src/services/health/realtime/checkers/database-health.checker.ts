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
      // Lightweight check: Simple query
      await Promise.race([
        this.databaseService.executeHealthcareRead(async prisma => {
          await prisma.$queryRaw`SELECT 1`;
        }),
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
