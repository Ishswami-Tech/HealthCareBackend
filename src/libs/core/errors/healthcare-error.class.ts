import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes.enum';
import { ErrorMessages } from './error-messages.constant';
import type { ErrorMetadata, ApiErrorResponse } from '@core/types/infrastructure.types';

// Re-export types for backward compatibility
export type { ErrorMetadata, ApiErrorResponse } from '@core/types/infrastructure.types';

/**
 * Custom Healthcare Error class that extends the standard Error
 * Provides structured error handling with codes, messages, and metadata
 *
 * @class HealthcareError
 * @extends Error
 * @description Comprehensive error class for healthcare applications
 * @example
 * ```typescript
 * throw new HealthcareError(
 *   ErrorCode.USER_NOT_FOUND,
 *   'User not found',
 *   HttpStatus.NOT_FOUND,
 *   { userId: '123' },
 *   'UserService.findUser'
 * );
 * ```
 */
export class HealthcareError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: HttpStatus;
  public readonly timestamp: string;
  public readonly metadata?: ErrorMetadata;
  public readonly isOperational: boolean;
  public readonly context?: string;

  /**
   * Creates a new HealthcareError instance
   *
   * @param code - The error code from ErrorCode enum
   * @param message - Optional custom error message (defaults to ErrorMessages[code])
   * @param statusCode - HTTP status code (defaults to INTERNAL_SERVER_ERROR)
   * @param metadata - Optional metadata object for additional context
   * @param context - Optional context string for debugging
   */
  constructor(
    code: ErrorCode,
    message?: string,
    statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    metadata?: ErrorMetadata,
    context?: string
  ) {
    const errorMessage = message || ErrorMessages[code];
    super(errorMessage);

    this.name = 'HealthcareError';
    this.code = code;
    this.statusCode = statusCode;
    this.timestamp = new Date().toISOString();
    this.metadata = metadata || {};
    this.isOperational = true;
    this.context = context || '';

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, HealthcareError);
  }

  /**
   * Convert error to JSON format for logging and API responses
   *
   * @returns JSON representation of the error with all properties
   * @example
   * ```typescript
   * const error = new HealthcareError(ErrorCode.USER_NOT_FOUND);
   * console.log(error.toJSON());
   * ```
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      metadata: this.metadata,
      context: this.context,
      stack: this.stack,
    };
  }

  /**
   * Convert error to API response format (without sensitive information)
   *
   * @returns API response format with sanitized error information
   * @example
   * ```typescript
   * const error = new HealthcareError(ErrorCode.USER_NOT_FOUND);
   * return error.toApiResponse();
   * ```
   */
  toApiResponse(): ApiErrorResponse {
    const errorResponse: {
      code: ErrorCode;
      message: string;
      timestamp: string;
      metadata?: ErrorMetadata;
    } = {
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
    };

    // Add metadata if it's safe to expose
    if (this.metadata && this.isMetadataSafe()) {
      errorResponse.metadata = this.metadata;
    }

    return {
      error: errorResponse,
    };
  }

  /**
   * Check if metadata is safe to expose in API responses
   *
   * @returns True if metadata doesn't contain sensitive information
   * @private
   */
  private isMetadataSafe(): boolean {
    if (!this.metadata) return false;

    // List of sensitive fields that should not be exposed
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'key',
      'credential',
      'ssn',
      'social_security',
      'credit_card',
      'bank_account',
    ];

    const metadataString = JSON.stringify(this.metadata).toLowerCase();
    return !sensitiveFields.some(field => metadataString.includes(field));
  }

  /**
   * Create a new HealthcareError with additional context
   *
   * @param context - Additional context string for debugging
   * @returns New HealthcareError instance with updated context
   * @example
   * ```typescript
   * const error = new HealthcareError(ErrorCode.USER_NOT_FOUND);
   * const contextualError = error.withContext('UserService.findUser');
   * ```
   */
  withContext(context: string): HealthcareError {
    return new HealthcareError(this.code, this.message, this.statusCode, this.metadata, context);
  }

  /**
   * Create a new HealthcareError with additional metadata
   *
   * @param metadata - Additional metadata to merge with existing metadata
   * @returns New HealthcareError instance with merged metadata
   * @example
   * ```typescript
   * const error = new HealthcareError(ErrorCode.USER_NOT_FOUND);
   * const detailedError = error.withMetadata({ userId: '123', operation: 'find' });
   * ```
   */
  withMetadata(metadata: ErrorMetadata): HealthcareError {
    return new HealthcareError(
      this.code,
      this.message,
      this.statusCode,
      { ...this.metadata, ...(metadata || {}) },
      this.context
    );
  }
}
