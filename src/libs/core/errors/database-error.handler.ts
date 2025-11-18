/**
 * Database Error Handler
 * @class DatabaseErrorHandler
 * @description Centralized error handling for database operations
 * Follows DRY principle - single implementation used across all database services
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

export enum DatabaseErrorType {
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  QUERY_ERROR = 'QUERY_ERROR',
  TRANSACTION_ERROR = 'TRANSACTION_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  CONSTRAINT_ERROR = 'CONSTRAINT_ERROR',
  DEADLOCK_ERROR = 'DEADLOCK_ERROR',
  PERMISSION_ERROR = 'PERMISSION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface ErrorContext {
  operation: string;
  query?: string;
  params?: unknown[];
  clinicId?: string;
  userId?: string;
  [key: string]: unknown;
}

@Injectable()
export class DatabaseErrorHandler {
  private readonly serviceName = 'DatabaseErrorHandler';

  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Classify database error type
   */
  classifyError(error: unknown): DatabaseErrorType {
    if (!(error instanceof Error)) {
      return DatabaseErrorType.UNKNOWN_ERROR;
    }

    const message = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();

    // Connection errors
    if (
      message.includes('connection') ||
      message.includes('connect') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('enotfound')
    ) {
      return DatabaseErrorType.CONNECTION_ERROR;
    }

    // Timeout errors
    if (
      message.includes('timeout') ||
      message.includes('etimedout') ||
      message.includes('query timeout')
    ) {
      return DatabaseErrorType.TIMEOUT_ERROR;
    }

    // Deadlock errors
    if (
      message.includes('deadlock') ||
      message.includes('lock wait timeout') ||
      message.includes('could not obtain lock')
    ) {
      return DatabaseErrorType.DEADLOCK_ERROR;
    }

    // Constraint errors
    if (
      message.includes('constraint') ||
      message.includes('unique constraint') ||
      message.includes('foreign key') ||
      message.includes('duplicate key')
    ) {
      return DatabaseErrorType.CONSTRAINT_ERROR;
    }

    // Permission errors
    if (
      message.includes('permission') ||
      message.includes('access denied') ||
      message.includes('unauthorized')
    ) {
      return DatabaseErrorType.PERMISSION_ERROR;
    }

    // Transaction errors
    if (
      message.includes('transaction') ||
      message.includes('rollback') ||
      errorName.includes('transaction')
    ) {
      return DatabaseErrorType.TRANSACTION_ERROR;
    }

    // Query errors
    if (message.includes('syntax') || message.includes('invalid') || message.includes('query')) {
      return DatabaseErrorType.QUERY_ERROR;
    }

    return DatabaseErrorType.UNKNOWN_ERROR;
  }

  /**
   * Handle database error
   */
  handleError(error: unknown, context: ErrorContext): HealthcareError {
    const errorType = this.classifyError(error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Log error
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.ERROR,
      `Database error: ${errorType}`,
      this.serviceName,
      {
        errorType,
        errorMessage,
        ...context,
        stack: error instanceof Error ? error.stack : undefined,
      }
    );

    // Create appropriate HealthcareError
    switch (errorType) {
      case DatabaseErrorType.CONNECTION_ERROR:
        return new HealthcareError(
          ErrorCode.DATABASE_CONNECTION_FAILED,
          'Database connection failed',
          undefined,
          context,
          this.serviceName
        );

      case DatabaseErrorType.TIMEOUT_ERROR:
        return new HealthcareError(
          ErrorCode.DATABASE_QUERY_TIMEOUT,
          'Database query timeout',
          undefined,
          context,
          this.serviceName
        );

      case DatabaseErrorType.DEADLOCK_ERROR:
        return new HealthcareError(
          ErrorCode.DATABASE_TRANSACTION_FAILED,
          'Database deadlock detected',
          undefined,
          context,
          this.serviceName
        );

      case DatabaseErrorType.CONSTRAINT_ERROR:
        return new HealthcareError(
          ErrorCode.DATABASE_CONSTRAINT_VIOLATION,
          'Database constraint violation',
          undefined,
          context,
          this.serviceName
        );

      case DatabaseErrorType.PERMISSION_ERROR:
        return new HealthcareError(
          ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
          'Database permission denied',
          undefined,
          context,
          this.serviceName
        );

      case DatabaseErrorType.TRANSACTION_ERROR:
        return new HealthcareError(
          ErrorCode.DATABASE_TRANSACTION_FAILED,
          'Database transaction failed',
          undefined,
          context,
          this.serviceName
        );

      case DatabaseErrorType.QUERY_ERROR:
        return new HealthcareError(
          ErrorCode.DATABASE_QUERY_FAILED,
          'Database query failed',
          undefined,
          context,
          this.serviceName
        );

      default:
        return new HealthcareError(
          ErrorCode.DATABASE_QUERY_FAILED,
          'Database operation failed',
          undefined,
          context,
          this.serviceName
        );
    }
  }

  /**
   * Handle error with graceful degradation
   */
  async handleWithFallback<T>(
    error: unknown,
    context: ErrorContext,
    fallback: () => Promise<T>
  ): Promise<T> {
    this.handleError(error, context);
    // Return fallback result
    return fallback();
  }
}
