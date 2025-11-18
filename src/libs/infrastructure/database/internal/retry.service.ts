/**
 * Retry Service
 * @class RetryService
 * @description Centralized retry logic with exponential backoff for database operations
 * Follows DRY principle - single implementation used across all database services
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryableErrors?: Array<new (...args: unknown[]) => Error>;
  onRetry?: (attempt: number, error: Error) => void;
}

@Injectable()
export class RetryService {
  private readonly serviceName = 'RetryService';

  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Execute operation with retry logic and exponential backoff
   */
  async executeWithRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const {
      maxRetries = 3,
      initialDelay = 1000,
      maxDelay = 30000,
      backoffMultiplier = 2,
      retryableErrors = [],
      onRetry,
    } = options;

    let lastError: Error | undefined;
    let delay = initialDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable
        if (!this.isRetryableError(error, retryableErrors)) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt >= maxRetries) {
          break;
        }

        // Call onRetry callback if provided
        if (onRetry && error instanceof Error) {
          onRetry(attempt + 1, error);
        }

        // Log retry attempt
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Operation failed, retrying (attempt ${attempt + 1}/${maxRetries})`,
          this.serviceName,
          {
            attempt: attempt + 1,
            maxRetries,
            delay,
            error: error instanceof Error ? error.message : String(error),
          }
        );

        // Wait with exponential backoff
        await this.delay(Math.min(delay, maxDelay));
        delay *= backoffMultiplier;
      }
    }

    // All retries exhausted
    const errorMessage = lastError
      ? lastError instanceof Error
        ? lastError.message
        : String(lastError)
      : 'Unknown error';
    throw new HealthcareError(
      ErrorCode.DATABASE_QUERY_FAILED,
      `Operation failed after ${maxRetries} retries: ${errorMessage}`,
      undefined,
      {
        maxRetries,
        lastError: errorMessage,
      },
      this.serviceName
    );
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(
    error: unknown,
    retryableErrors: Array<new (...args: unknown[]) => Error>
  ): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    // Check against custom retryable errors
    if (retryableErrors.length > 0) {
      return retryableErrors.some(ErrorClass => error instanceof ErrorClass);
    }

    // Default retryable error patterns
    const message = error.message.toLowerCase();
    const retryablePatterns = [
      'connection',
      'timeout',
      'network',
      'econnreset',
      'econnrefused',
      'etimedout',
      'deadlock',
      'lock wait timeout',
      'temporary',
      'transient',
    ];

    return retryablePatterns.some(pattern => message.includes(pattern));
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
