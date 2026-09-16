/**
 * Cache Health Checker
 * Lightweight cache connectivity check
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { RealtimeHealthCheckResult } from '@core/types';

@Injectable()
export class CacheHealthChecker {
  private readonly TIMEOUT_MS = 3000; // 3 seconds
  private readonly TEST_KEY = 'health:ping';

  constructor(
    @Optional()
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService?: CacheService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  /**
   * Check cache health
   */
  async check(): Promise<RealtimeHealthCheckResult> {
    const startTime = Date.now();

    if (!this.cacheService) {
      return {
        service: 'cache',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: 'CacheService not available',
      };
    }

    try {
      // Use PING for health check — avoids key-prefix issues and reduces latency
      // compared to a set/get roundtrip, especially on a shared Dragonfly instance.
      await Promise.race([
        (async () => {
          if (this.cacheService) {
            await this.cacheService.ping();
          }
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Cache check timeout')), this.TIMEOUT_MS)
        ),
      ]);

      const responseTime = Date.now() - startTime;

      return {
        service: 'cache',
        status: responseTime < 100 ? 'healthy' : responseTime < 500 ? 'degraded' : 'unhealthy',
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Cache health check failed: ${errorMessage}`,
        'CacheHealthChecker',
        { error: errorMessage, responseTime }
      );

      return {
        service: 'cache',
        status: 'unhealthy',
        responseTime,
        error: errorMessage,
      };
    }
  }
}
