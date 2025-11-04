/**
 * Filter Types
 * @module FilterTypes
 * @description Types for HTTP exception filters and error handling
 */

// Import AuthenticatedUser from guard.types for consistency
import type { AuthenticatedUser } from './guard.types';

// Re-export AuthenticatedUser for convenience
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
