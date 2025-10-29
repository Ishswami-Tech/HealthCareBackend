/**
 * REQUEST AND CONTEXT TYPE DEFINITIONS
 * ====================================
 * Proper TypeScript types for Express/Fastify requests, responses, and contexts
 */

/**
 * Base request with user information
 * @interface AuthenticatedRequest
 * @description Represents an authenticated HTTP request with user and clinic context
 * @example
 * ```typescript
 * const request: AuthenticatedRequest = {
 *   user: { id: "user-123", email: "user@clinic.com", role: "doctor" },
 *   ip: "192.168.1.1",
 *   url: "/api/appointments",
 *   method: "GET",
 *   headers: { "authorization": "Bearer token123" },
 *   clinicContext: { clinicId: "clinic-456" }
 * };
 * ```
 */
export interface AuthenticatedRequest {
  /** Authenticated user information */
  readonly user: {
    /** User ID */
    readonly id: string;
    /** Optional user email */
    readonly email?: string;
    /** Optional user role */
    readonly role?: string;
    /** Optional clinic ID */
    readonly clinicId?: string;
    /** Additional user properties */
    readonly [key: string]: unknown;
  };
  /** Client IP address */
  readonly ip: string;
  /** Request URL */
  readonly url: string;
  /** HTTP method */
  readonly method: string;
  /** Request headers */
  readonly headers: Record<string, string | string[] | undefined>;
  /** Optional request body */
  readonly body?: unknown;
  /** Optional URL parameters */
  readonly params?: Record<string, string>;
  /** Optional query parameters */
  readonly query?: Record<string, string | string[]>;
  /** Optional clinic context */
  readonly clinicContext?: ClinicContext;
}

/**
 * Clinic context for multi-tenant requests
 * @interface ClinicContext
 * @description Contains clinic-specific context information for multi-tenant operations
 * @example
 * ```typescript
 * const context: ClinicContext = {
 *   clinicId: "clinic-123",
 *   clinicName: "Downtown Medical Center"
 * };
 * ```
 */
export interface ClinicContext {
  /** Optional clinic ID */
  readonly clinicId?: string;
  /** Optional clinic name */
  readonly clinicName?: string;
  /** Additional clinic properties */
  readonly [key: string]: unknown;
}

/**
 * Rate limit context information
 * @interface RateLimitContext
 * @description Contains rate limiting information for requests
 * @example
 * ```typescript
 * const rateLimit: RateLimitContext = {
 *   ttl: 3600,
 *   limit: 100,
 *   remaining: 95,
 *   resetTime: new Date("2024-01-15T11:00:00Z")
 * };
 * ```
 */
export interface RateLimitContext {
  /** Time to live in seconds */
  readonly ttl: number;
  /** Maximum number of requests allowed */
  readonly limit: number;
  /** Number of requests remaining */
  readonly remaining: number;
  /** Time when the rate limit resets */
  readonly resetTime: Date;
}

// Worker process type
export interface WorkerProcess {
  process: {
    pid: number;
  };
  exitedAfterDisconnect: boolean;
  send?: (message: unknown) => void;
  kill?: (signal?: string) => void;
}

// Request serializer result
export interface SerializedRequest {
  method: string;
  url: string;
  headers?: Record<string, unknown>;
  skip?: boolean;
}

// Redis client types
export interface RedisClient {
  quit(): Promise<string>;
  disconnect(): Promise<void>;
  connect(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): this;
  [key: string]: unknown;
}

// Socket types
export interface SocketConnection {
  id: string;
  emit(event: string, data: unknown): void;
  on(event: string, callback: (data: unknown) => void): void;
  disconnect(): void;
  [key: string]: unknown;
}

// Fastify logger config
export interface FastifyLoggerConfig {
  level: string;
  serializers: {
    req: (req: Partial<AuthenticatedRequest>) => SerializedRequest;
    res: (res: { statusCode?: number }) => { statusCode?: number };
    err: (err: unknown) => unknown;
  };
  transport?: {
    target: string;
    options: Record<string, unknown>;
  };
  [key: string]: unknown;
}
