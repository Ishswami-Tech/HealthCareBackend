/**
 * Queue Health Checker
 * Lightweight queue connectivity check
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { QueueService } from '@infrastructure/queue';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { RealtimeHealthCheckResult } from '@core/types';

@Injectable()
export class QueueHealthChecker {
  private readonly TIMEOUT_MS = 4000; // 4 seconds

  constructor(
    @Optional()
    @Inject(forwardRef(() => QueueService))
    private readonly queueService?: QueueService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  /**
   * Check queue health
   */
  async check(): Promise<RealtimeHealthCheckResult> {
    const startTime = Date.now();

    if (!this.queueService) {
      return {
        service: 'queue',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: 'QueueService not available',
      };
    }

    try {
      // Lightweight check: Get queue metrics (connection check)
      // Use a default queue name for health check
      const defaultQueueName = 'health-check';
      await Promise.race([
        this.queueService.getQueueMetrics(defaultQueueName),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Queue check timeout')), this.TIMEOUT_MS)
        ),
      ]);

      const responseTime = Date.now() - startTime;

      return {
        service: 'queue',
        status: responseTime < 200 ? 'healthy' : responseTime < 1000 ? 'degraded' : 'unhealthy',
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Queue health check failed: ${errorMessage}`,
        'QueueHealthChecker',
        { error: errorMessage, responseTime }
      );

      return {
        service: 'queue',
        status: 'unhealthy',
        responseTime,
        error: errorMessage,
      };
    }
  }
}
