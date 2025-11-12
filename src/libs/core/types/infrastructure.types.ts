/**
 * Infrastructure Types - Consolidated
 * @module InfrastructureTypes
 * @description Types for infrastructure-level concerns including error handling, HTTP filters, and request/response types
 *
 * This file consolidates:
 * - Error handling types (ErrorMetadata, ApiErrorResponse, PrismaDatabaseError)
 * - HTTP exception filter types (RequestHeaders, CustomFastifyRequest, ErrorLog, ErrorResponse)
 * - Type guards for error handling
 */

import type { ErrorCode } from '@core/errors/error-codes.enum';
import type { AuthenticatedUser } from './guard.types';

// ============================================================================
// ERROR TYPES (consolidated from error.types.ts)
// ============================================================================

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

// ============================================================================
// FILTER TYPES (consolidated from filter.types.ts)
// ============================================================================

// Re-export AuthenticatedUser for convenience (imported from guard.types)
export type { AuthenticatedUser } from './guard.types';

/**
 * Request headers interface with healthcare-specific headers
 * @interface RequestHeaders
 * @description Defines the structure of request headers including healthcare-specific ones
 */
export interface RequestHeaders {
  readonly 'user-agent'?: string;
  readonly 'x-forwarded-for'?: string;
  readonly 'x-real-ip'?: string;
  readonly 'x-clinic-id'?: string;
  readonly authorization?: string;
  readonly cookie?: string;
  readonly [key: string]: string | undefined;
}

/**
 * Custom Fastify request interface with healthcare-specific properties
 * @interface CustomFastifyRequest
 * @description Enhanced request interface for healthcare applications
 */
export interface CustomFastifyRequest {
  readonly url: string;
  readonly method: string;
  readonly body?: unknown;
  readonly headers: RequestHeaders;
  readonly query?: Record<string, unknown>;
  readonly params?: Record<string, unknown>;
  readonly ip?: string;
  readonly user?: AuthenticatedUser;
}

/**
 * Error log structure for comprehensive error tracking
 * @interface ErrorLog
 * @description Defines the structure of error logs for debugging and monitoring
 */
export interface ErrorLog {
  readonly path: string;
  readonly method: string;
  readonly statusCode: number;
  readonly timestamp: string;
  readonly message: string;
  readonly stack?: string;
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, unknown>;
  readonly query?: Record<string, unknown>;
  readonly params?: Record<string, unknown>;
  readonly userAgent?: string;
  readonly ip?: string;
  readonly clinicId?: string;
  readonly errorType?: string;
  readonly userInfo?:
    | {
        readonly id: string;
        readonly role: string;
      }
    | 'unauthenticated';
}

/**
 * Error response structure for API responses
 * @interface ErrorResponse
 * @description Defines the structure of error responses sent to clients
 */
export interface ErrorResponse {
  readonly statusCode: number;
  readonly timestamp: string;
  readonly path: string;
  readonly method: string;
  readonly message?: string;
  readonly suggestion?: string;
  readonly [key: string]: unknown;
}
