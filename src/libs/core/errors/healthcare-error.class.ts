import { HttpStatus } from "@nestjs/common";
import { ErrorCode } from "./error-codes.enum";
import { ErrorMessages } from "./error-messages.constant";

/**
 * Custom Healthcare Error class that extends the standard Error
 * Provides structured error handling with codes, messages, and metadata
 */
export class HealthcareError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: HttpStatus;
  public readonly timestamp: string;
  public readonly metadata?: Record<string, unknown>;
  public readonly isOperational: boolean;
  public readonly context?: string;

  constructor(
    code: ErrorCode,
    message?: string,
    statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    metadata?: Record<string, unknown>,
    context?: string,
  ) {
    const errorMessage = message || ErrorMessages[code];
    super(errorMessage);

    this.name = "HealthcareError";
    this.code = code;
    this.statusCode = statusCode;
    this.timestamp = new Date().toISOString();
    this.metadata = metadata;
    this.isOperational = true;
    this.context = context;

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, HealthcareError);
  }

  /**
   * Convert error to JSON format for logging and API responses
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
   */
  toApiResponse(): Record<string, unknown> {
    const response: Record<string, unknown> = {
      error: {
        code: this.code,
        message: this.message,
        timestamp: this.timestamp,
      },
    };

    // Add metadata if it's safe to expose
    if (this.metadata && this.isMetadataSafe()) {
      (response.error as Record<string, unknown>).metadata = this.metadata;
    }

    return response;
  }

  /**
   * Check if metadata is safe to expose in API responses
   */
  private isMetadataSafe(): boolean {
    if (!this.metadata) return false;

    // List of sensitive fields that should not be exposed
    const sensitiveFields = [
      "password",
      "token",
      "secret",
      "key",
      "credential",
      "ssn",
      "social_security",
      "credit_card",
      "bank_account",
    ];

    const metadataString = JSON.stringify(this.metadata).toLowerCase();
    return !sensitiveFields.some((field) => metadataString.includes(field));
  }

  /**
   * Create a new HealthcareError with additional context
   */
  withContext(context: string): HealthcareError {
    return new HealthcareError(
      this.code,
      this.message,
      this.statusCode,
      this.metadata,
      context,
    );
  }

  /**
   * Create a new HealthcareError with additional metadata
   */
  withMetadata(metadata: Record<string, unknown>): HealthcareError {
    return new HealthcareError(
      this.code,
      this.message,
      this.statusCode,
      { ...this.metadata, ...(metadata || {}) },
      this.context,
    );
  }
}
