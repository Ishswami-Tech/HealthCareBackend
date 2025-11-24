/**
 * Metrics Query Middleware
 * @class MetricsQueryMiddleware
 * @description Tracks query metrics
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { BaseQueryMiddleware, type QueryMiddlewareContext } from './base-query.middleware';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { DatabaseMetricsService } from '../../internal/database-metrics.service';

/**
 * Metrics query middleware - tracks query metrics
 */
@Injectable()
export class MetricsQueryMiddleware extends BaseQueryMiddleware {
  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => DatabaseMetricsService))
    private readonly metricsService: DatabaseMetricsService
  ) {
    super();
  }

  protected processBefore(context: QueryMiddlewareContext): QueryMiddlewareContext {
    // Start time is already set in context
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.DEBUG,
      `Starting metrics tracking for: ${context.operation}`,
      'MetricsQueryMiddleware'
    );
    return context;
  }

  protected processAfter<T>(context: QueryMiddlewareContext, result: T): T {
    const executionTime = Date.now() - context.startTime;

    // Record metrics
    void this.metricsService.recordQueryExecution(
      context.operation,
      executionTime,
      true,
      context.clinicId,
      context.userId
    );

    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.DEBUG,
      `Query metrics recorded: ${context.operation} (${executionTime}ms)`,
      'MetricsQueryMiddleware'
    );

    return result;
  }

  protected processError(context: QueryMiddlewareContext, error: Error): Error {
    const executionTime = Date.now() - context.startTime;

    // Record error metrics
    void this.metricsService.recordQueryExecution(
      context.operation,
      executionTime,
      false,
      context.clinicId,
      context.userId
    );

    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.ERROR,
      `Query error metrics recorded: ${context.operation} (${executionTime}ms)`,
      'MetricsQueryMiddleware',
      {
        error: error.stack,
      }
    );

    return error;
  }
}
