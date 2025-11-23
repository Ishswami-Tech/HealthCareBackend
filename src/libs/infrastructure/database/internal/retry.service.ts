/**
 * Retry Service
 * @class RetryService
 * @description Provides retry logic with exponential backoff for database operations
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
  onRetry?: (attempt: number, error: Error) => void;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
}

/**
 * Retry service with exponential backoff
 * @internal
 */
@Injectable()
export class RetryService {
  private readonly serviceName = 'RetryService';
  private readonly defaultMaxAttempts = 3;
  private readonly defaultInitialDelay = 100; // milliseconds
  private readonly defaultMaxDelay = 5000; // milliseconds
  private readonly defaultBackoffMultiplier = 2;

  // Common retryable database errors
  private readonly defaultRetryableErrors = [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNRESET',
    'EPIPE',
    'ConnectionError',
    'TimeoutError',
    'QueryTimeoutError',
    'ConnectionPoolExhausted',
    'DatabaseUnavailable',
  ];

  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Execute operation with retry logic
   * @param operation - The operation to retry
   * @param options - Retry configuration options
   * @returns Promise resolving to retry result
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<RetryResult<T>> {
    const maxAttempts = options.maxAttempts ?? this.defaultMaxAttempts;
    const initialDelay = options.initialDelay ?? this.defaultInitialDelay;
    const maxDelay = options.maxDelay ?? this.defaultMaxDelay;
    const backoffMultiplier = options.backoffMultiplier ?? this.defaultBackoffMultiplier;
    const retryableErrors = options.retryableErrors ?? this.defaultRetryableErrors;

    let lastError: Error | undefined;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;

      try {
        const result = await operation();

        // Log success if retried
        if (attempt > 1) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.INFO,
            `Operation succeeded after ${attempt} attempts`,
            this.serviceName,
            { attempts: attempt, maxAttempts }
          );
        }

        return {
          success: true,
          result,
          attempts: attempt,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errorName = lastError.name || '';
        const errorMessage = lastError.message || '';

        // Check if error is retryable
        const isRetryable = retryableErrors.some(
          retryableError =>
            errorName.includes(retryableError) || errorMessage.includes(retryableError)
        );

        // If not retryable or last attempt, return error
        if (!isRetryable || attempt >= maxAttempts) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.ERROR,
            `Operation failed after ${attempt} attempts${!isRetryable ? ' (non-retryable error)' : ''}`,
            this.serviceName,
            {
              attempts: attempt,
              maxAttempts,
              error: lastError.message,
              errorName: lastError.name,
              isRetryable,
            }
          );

          return {
            success: false,
            error: lastError,
            attempts: attempt,
          };
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(initialDelay * Math.pow(backoffMultiplier, attempt - 1), maxDelay);

        // Log retry attempt
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Operation failed, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`,
          this.serviceName,
          {
            attempt,
            maxAttempts,
            delay,
            error: lastError.message,
            errorName: lastError.name,
          }
        );

        // Call onRetry callback if provided
        if (options.onRetry) {
          try {
            options.onRetry(attempt, lastError);
          } catch (callbackError) {
            void this.loggingService.log(
              LogType.DATABASE,
              LogLevel.ERROR,
              `onRetry callback failed: ${callbackError instanceof Error ? callbackError.message : String(callbackError)}`,
              this.serviceName,
              {
                error: callbackError instanceof Error ? callbackError.stack : String(callbackError),
              }
            );
          }
        }

        // Wait before retrying
        await this.delay(delay);
      }
    }

    // Should never reach here, but TypeScript needs this
    return {
      success: false,
      error: lastError || new Error('Unknown error'),
      attempts: attempt,
    };
  }

  /**
   * Check if an error is retryable
   */
  isRetryableError(error: Error, retryableErrors?: string[]): boolean {
    const errors = retryableErrors ?? this.defaultRetryableErrors;
    const errorName = error.name || '';
    const errorMessage = error.message || '';

    return errors.some(
      retryableError => errorName.includes(retryableError) || errorMessage.includes(retryableError)
    );
  }

  /**
   * Calculate delay for retry attempt
   */
  calculateDelay(
    attempt: number,
    initialDelay: number = this.defaultInitialDelay,
    maxDelay: number = this.defaultMaxDelay,
    backoffMultiplier: number = this.defaultBackoffMultiplier
  ): number {
    return Math.min(initialDelay * Math.pow(backoffMultiplier, attempt - 1), maxDelay);
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
