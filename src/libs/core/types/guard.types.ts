/**
 * Guard Types
 * @module GuardTypes
 * @description Types for authentication and authorization guards
 */

import type { ClinicContext } from './clinic.types';

/**
 * Authenticated user information
 * @interface AuthenticatedUser
 * @description Defines the structure of authenticated user information in guards
 */
export interface AuthenticatedUser {
  readonly id?: string;
  readonly sub?: string;
  readonly role?: string;
  readonly clinicId?: string;
  readonly locationId?: string;
  readonly [key: string]: unknown;
}

/**
 * User interface for JWT authentication guard
 * @interface JwtGuardUser
 * @description Defines the structure of user information in JWT guard
 */
export interface JwtGuardUser {
  readonly id?: string;
  readonly email?: string;
  readonly role?: string;
  readonly sessionId?: string;
  readonly sub?: string;
  readonly jti?: string;
  readonly [key: string]: unknown;
}

/**
 * Request headers interface for clinic-specific headers
 * @interface ClinicRequestHeaders
 * @description Defines the structure of request headers including clinic-specific ones
 */
export interface ClinicRequestHeaders {
  readonly 'x-clinic-id'?: string;
  readonly 'clinic-id'?: string;
  readonly 'x-location-id'?: string;
  readonly 'location-id'?: string;
  readonly [key: string]: string | undefined;
}

/**
 * Request headers interface for JWT authentication
 * @interface JwtRequestHeaders
 * @description Defines the structure of request headers for JWT authentication
 */
export interface JwtRequestHeaders {
  readonly authorization?: string;
  readonly 'x-session-id'?: string;
  readonly 'x-forwarded-for'?: string;
  readonly 'user-agent'?: string;
  readonly 'content-type'?: string;
  readonly origin?: string;
  readonly accept?: string;
  readonly host?: string;
  readonly [key: string]: string | string[] | undefined;
}

/**
 * Query parameters interface for clinic requests
 * @interface ClinicQueryParams
 * @description Defines the structure of query parameters for clinic requests
 */
export interface ClinicQueryParams {
  readonly clinicId?: string;
  readonly clinic_id?: string;
  readonly locationId?: string;
  readonly location_id?: string;
  readonly [key: string]: unknown;
}

/**
 * Route parameters interface for clinic requests
 * @interface ClinicRouteParams
 * @description Defines the structure of route parameters for clinic requests
 */
export interface ClinicRouteParams {
  readonly clinicId?: string;
  readonly clinic_id?: string;
  readonly locationId?: string;
  readonly location_id?: string;
  readonly [key: string]: unknown;
}

/**
 * Request body interface for clinic requests
 * @interface ClinicRequestBody
 * @description Defines the structure of request body for clinic requests
 */
export interface ClinicRequestBody {
  readonly clinicId?: string;
  readonly [key: string]: unknown;
}

/**
 * Clinic context interface for request context
 * @interface ClinicRequestContext
 * @description Defines the structure of clinic context in requests
 */
export interface ClinicRequestContext {
  readonly clinicName?: string;
  readonly [key: string]: unknown;
}

/**
 * Clinic request interface with healthcare-specific properties
 * @interface ClinicRequest
 * @description Enhanced request interface for clinic-specific operations
 */
export interface ClinicRequest {
  readonly url: string;
  readonly method: string;
  readonly user?: AuthenticatedUser;
  readonly headers: ClinicRequestHeaders;
  readonly query?: ClinicQueryParams;
  readonly params?: ClinicRouteParams;
  readonly body?: ClinicRequestBody;
  clinicId?: string;
  locationId?: string;
  clinicContext?: ClinicRequestContext;
}

/**
 * Clinic validation result interface
 * @interface ClinicValidationResult
 * @description Defines the structure of clinic validation results
 */
export interface ClinicValidationResult {
  readonly success: boolean;
  readonly error?: string;
  readonly clinicContext?: ClinicContext;
}

/**
 * Fastify session interface
 * @interface FastifySession
 * @description Session data stored in Fastify session
 */
export interface FastifySession {
  sessionId?: string;
  userId?: string;
  clinicId?: string;
  userAgent?: string;
  ipAddress?: string;
  loginTime?: Date;
  lastActivity?: Date;
  expiresAt?: Date;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Fastify request interface with user context
 * @interface FastifyRequestWithUser
 * @description Enhanced request interface for JWT authentication with Fastify session support
 */
export interface FastifyRequestWithUser {
  user?: JwtGuardUser;
  session?: FastifySession;
  readonly ip?: string;
  readonly headers: JwtRequestHeaders;
  readonly method: string;
  readonly raw: {
    readonly url: string;
  };
  readonly body: unknown;
  readonly query: unknown;
  readonly params: unknown;
}

/**
 * JWT payload interface
 * @interface JwtPayload
 * @description Defines the structure of JWT token payload
 */
export interface JwtPayload {
  readonly sub?: string;
  readonly sessionId?: string;
  readonly jti?: string;
  readonly [key: string]: unknown;
}

/**
 * Request with user interface for roles guard
 * @interface RequestWithUser
 * @description Defines the structure of request with user information
 */
export interface RequestWithUser {
  readonly user?: {
    readonly role?: string;
    readonly [key: string]: unknown;
  };
}

/**
 * Request with auth interface for RBAC guard
 * @interface RequestWithAuth
 * @description Defines the structure of request with authentication information
 */
export interface RequestWithAuth {
  url: string;
  method: string;
  user?: {
    id?: string;
    clinicId?: string;
    [key: string]: unknown;
  };
  params?: {
    [key: string]: unknown;
  };
  body?: {
    [key: string]: unknown;
  };
  query?: {
    [key: string]: unknown;
  };
  headers: {
    [key: string]: string | undefined;
  };
  ip?: string;
  connection?: {
    remoteAddress?: string;
  };
  socket?: {
    remoteAddress?: string;
  };
}
