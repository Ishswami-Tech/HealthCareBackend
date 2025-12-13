/**
 * Metrics Cache Middleware
 * @class MetricsCacheMiddleware
 * @description Tracks cache metrics
 */

import { Injectable, Inject } from '@nestjs/common';
import { BaseCacheMiddleware } from './base-cache.middleware';
import type { CacheMiddlewareContext } from './cache-middleware.interface';
import { LogType, LogLevel } from '@core/types';

interface LoggerLike {
  log(
    type: LogType,
    level: LogLevel,
    message: string,
    source: string,
    metadata?: Record<string, unknown>
  ): Promise<void>;
}

/**
 * Metrics middleware for cache operations
 */
@Injectable()
export class MetricsCacheMiddleware extends BaseCacheMiddleware {
  private readonly metrics = {
    totalOperations: 0,
    successfulOperations: 0,
    failedOperations: 0,
    totalLatency: 0,
  };

  constructor(
    // Use string token to avoid importing logging module/service (prevents SWC TDZ circular-import issues)
    @Inject('LOGGING_SERVICE')
    private readonly loggingService: LoggerLike
  ) {
    super();
    // LoggingService injected via forwardRef
  }

  protected processBefore(context: CacheMiddlewareContext): CacheMiddlewareContext {
    this.metrics.totalOperations++;
    context.metadata = {
      ...context.metadata,
      startTime: Date.now(),
    };
    return context;
  }

  protected processAfter<T>(context: CacheMiddlewareContext, result: T): T {
    this.metrics.successfulOperations++;
    const startTime = context.metadata?.['startTime'] as number | undefined;
    if (startTime) {
      const latency = Date.now() - startTime;
      this.metrics.totalLatency += latency;
    }

    return result;
  }

  protected async processError(context: CacheMiddlewareContext, error: Error): Promise<Error> {
    this.metrics.failedOperations++;
    const startTime = context.metadata?.['startTime'] as number | undefined;
    if (startTime) {
      const latency = Date.now() - startTime;
      this.metrics.totalLatency += latency;
    }

    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.ERROR,
      'Cache operation failed',
      'MetricsCacheMiddleware',
      {
        key: context.key,
        error: error.message,
      }
    );

    return error;
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      averageLatency:
        this.metrics.totalOperations > 0
          ? this.metrics.totalLatency / this.metrics.totalOperations
          : 0,
      successRate:
        this.metrics.totalOperations > 0
          ? this.metrics.successfulOperations / this.metrics.totalOperations
          : 0,
    };
  }
}
