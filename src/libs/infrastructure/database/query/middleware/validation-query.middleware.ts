/**
 * Validation Query Middleware
 * @class ValidationQueryMiddleware
 * @description Validates queries before execution
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { BaseQueryMiddleware, type QueryMiddlewareContext } from './base-query.middleware';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

/**
 * Validation query middleware - validates queries before execution
 */
@Injectable()
export class ValidationQueryMiddleware extends BaseQueryMiddleware {
  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    super();
  }

  protected processBefore(context: QueryMiddlewareContext): QueryMiddlewareContext {
    // Validate operation name
    if (!context.operation || typeof context.operation !== 'string') {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        'Invalid operation name in query context',
        'ValidationQueryMiddleware'
      );
      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        'Invalid operation name',
        undefined,
        { context },
        'ValidationQueryMiddleware'
      );
    }

    // Validate options
    if (context.options) {
      // Validate pagination
      if (context.options.page !== undefined && context.options.page < 1) {
        throw new HealthcareError(
          ErrorCode.DATABASE_QUERY_FAILED,
          'Page number must be >= 1',
          undefined,
          { page: context.options.page },
          'ValidationQueryMiddleware'
        );
      }

      if (context.options.limit !== undefined && context.options.limit < 1) {
        throw new HealthcareError(
          ErrorCode.DATABASE_QUERY_FAILED,
          'Limit must be >= 1',
          undefined,
          { limit: context.options.limit },
          'ValidationQueryMiddleware'
        );
      }

      // Validate timeout
      if (context.options.timeout !== undefined && context.options.timeout < 0) {
        throw new HealthcareError(
          ErrorCode.DATABASE_QUERY_FAILED,
          'Timeout must be >= 0',
          undefined,
          { timeout: context.options.timeout },
          'ValidationQueryMiddleware'
        );
      }
    }

    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.DEBUG,
      `Query validation passed: ${context.operation}`,
      'ValidationQueryMiddleware'
    );

    return context;
  }

  protected processAfter<T>(_context: QueryMiddlewareContext, result: T): T {
    return result;
  }

  protected processError(context: QueryMiddlewareContext, error: Error): Error {
    // Only log at DEBUG level to reduce log spam - main error is logged at DatabaseService level
    // Check if error is already marked as logged to prevent duplicate logging
    const errorAny = error as Error & { _loggedByMiddleware?: boolean };
    if (!errorAny._loggedByMiddleware) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Query validation error: ${error.message}`,
        'ValidationQueryMiddleware',
        {
          operation: context.operation,
          error: error.stack,
        }
      );
      errorAny._loggedByMiddleware = true;
    }
    return error;
  }
}
