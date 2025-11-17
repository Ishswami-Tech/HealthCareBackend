/**
 * Cache Error Handler
 * @class CacheErrorHandler
 * @description Comprehensive error handling for cache operations
 */

import { Injectable } from '@nestjs/common';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from './healthcare-error.class';
import { ErrorCode } from './error-codes.enum';
import { LoggingService } from '@infrastructure/logging/logging.service';

/**
 * Cache error types
 */
export enum CacheErrorType {
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  SERIALIZATION_ERROR = 'SERIALIZATION_ERROR',
  DESERIALIZATION_ERROR = 'DESERIALIZATION_ERROR',
  KEY_ERROR = 'KEY_ERROR',
  TTL_ERROR = 'TTL_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Cache error handler
 */
@Injectable()
export class CacheErrorHandler {
  constructor(private readonly loggingService: LoggingService) {}

  /**
   * Classify error type
   */
  classifyError(error: unknown): CacheErrorType {
    if (!(error instanceof Error)) {
      return CacheErrorType.UNKNOWN_ERROR;
    }

    const message = error.message.toLowerCase();

    if (message.includes('connection') || message.includes('connect')) {
      return CacheErrorType.CONNECTION_ERROR;
    }
    if (message.includes('timeout')) {
      return CacheErrorType.TIMEOUT_ERROR;
    }
    if (message.includes('serialize') || message.includes('json')) {
      return CacheErrorType.SERIALIZATION_ERROR;
    }
    if (message.includes('key')) {
      return CacheErrorType.KEY_ERROR;
    }
    if (message.includes('ttl') || message.includes('expire')) {
      return CacheErrorType.TTL_ERROR;
    }

    return CacheErrorType.UNKNOWN_ERROR;
  }

  /**
   * Handle cache error
   */
  async handleError(
    error: unknown,
    context: { operation: string; key?: string; [key: string]: unknown }
  ): Promise<HealthcareError> {
    const errorType = this.classifyError(error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Log error
    await this.loggingService.log(
      LogType.ERROR,
      LogLevel.ERROR,
      `Cache error: ${errorType}`,
      'CacheErrorHandler',
      {
        errorType,
        errorMessage,
        ...context,
        stack: error instanceof Error ? error.stack : undefined,
      }
    );

    // Create appropriate HealthcareError
    switch (errorType) {
      case CacheErrorType.CONNECTION_ERROR:
        return new HealthcareError(
          ErrorCode.CACHE_CONNECTION_FAILED,
          'Cache connection failed',
          undefined,
          context,
          'CacheErrorHandler'
        );
      case CacheErrorType.TIMEOUT_ERROR:
        return new HealthcareError(
          ErrorCode.CACHE_TIMEOUT,
          'Cache operation timed out',
          undefined,
          context,
          'CacheErrorHandler'
        );
      case CacheErrorType.SERIALIZATION_ERROR:
        return new HealthcareError(
          ErrorCode.CACHE_SERIALIZATION_ERROR,
          'Cache serialization error',
          undefined,
          context,
          'CacheErrorHandler'
        );
      default:
        return new HealthcareError(
          ErrorCode.CACHE_OPERATION_FAILED,
          'Cache operation failed',
          undefined,
          context,
          'CacheErrorHandler'
        );
    }
  }

  /**
   * Handle error with graceful degradation
   */
  async handleWithFallback<T>(
    error: unknown,
    context: { operation: string; key?: string; [key: string]: unknown },
    fallback: () => Promise<T>
  ): Promise<T> {
    await this.handleError(error, context);
    // Return fallback result
    return fallback();
  }
}
