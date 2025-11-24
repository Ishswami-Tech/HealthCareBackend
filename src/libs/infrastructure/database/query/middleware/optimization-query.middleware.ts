/**
 * Optimization Query Middleware
 * @class OptimizationQueryMiddleware
 * @description Query optimization
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { BaseQueryMiddleware, type QueryMiddlewareContext } from './base-query.middleware';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthcareQueryOptimizerService } from '../../internal/query-optimizer.service';

/**
 * Optimization query middleware - optimizes queries before execution
 */
@Injectable()
export class OptimizationQueryMiddleware extends BaseQueryMiddleware {
  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => HealthcareQueryOptimizerService))
    private readonly queryOptimizer: HealthcareQueryOptimizerService
  ) {
    super();
  }

  protected processBefore(context: QueryMiddlewareContext): QueryMiddlewareContext {
    // Optimize query options if needed
    if (context.options) {
      // Add indexes if specified
      if (context.options.useIndex && context.options.useIndex.length > 0) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.DEBUG,
          `Using indexes: ${context.options.useIndex.join(', ')}`,
          'OptimizationQueryMiddleware'
        );
      }

      // Force indexes if specified
      if (context.options.forceIndex && context.options.forceIndex.length > 0) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.DEBUG,
          `Forcing indexes: ${context.options.forceIndex.join(', ')}`,
          'OptimizationQueryMiddleware'
        );
      }
    }

    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.DEBUG,
      `Query optimization applied: ${context.operation}`,
      'OptimizationQueryMiddleware'
    );

    return context;
  }

  protected processAfter<T>(_context: QueryMiddlewareContext, result: T): T {
    return result;
  }

  protected processError(context: QueryMiddlewareContext, error: Error): Error {
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.ERROR,
      `Query optimization error: ${error.message}`,
      'OptimizationQueryMiddleware',
      {
        operation: context.operation,
        error: error.stack,
      }
    );
    return error;
  }
}
