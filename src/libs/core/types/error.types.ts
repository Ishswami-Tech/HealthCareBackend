/**
 * Error Types
 * @module ErrorTypes
 * @description Types for error handling and healthcare error system
 */

import type { ErrorCode } from '@core/errors/error-codes.enum';

/**
 * Error metadata interface for structured error information
 * @interface ErrorMetadata
 * @description Defines the structure for error metadata
 */
export interface ErrorMetadata {
  readonly [key: string]: unknown;
}

/**
 * API response error structure
 * @interface ApiErrorResponse
 * @description Defines the structure for API error responses
 */
export interface ApiErrorResponse {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly timestamp: string;
    readonly metadata?: ErrorMetadata;
  };
}

/**
 * Prisma database error structure
 * @interface PrismaDatabaseError
 * @description Defines the structure for Prisma database errors
 */
export interface PrismaDatabaseError extends Error {
  /** Prisma error code (e.g., 'P2025', 'P2002') */
  readonly code?: string;
  /** Error metadata from Prisma */
  readonly meta?: {
    readonly target?: readonly string[];
    readonly [key: string]: unknown;
  };
  /** Error name */
  readonly name: string;
  /** Error message */
  readonly message: string;
}

/**
 * Type guard to check if an error is a Prisma database error
 * @function isPrismaDatabaseError
 * @param error - The error to check
 * @returns True if the error is a Prisma database error
 */
export function isPrismaDatabaseError(error: unknown): error is PrismaDatabaseError {
  return (
    error instanceof Error &&
    error.name === 'PrismaClientKnownRequestError' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}
