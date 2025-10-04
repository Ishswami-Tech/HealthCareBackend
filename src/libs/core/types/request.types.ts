/**
 * REQUEST AND CONTEXT TYPE DEFINITIONS
 * ====================================
 * Proper TypeScript types for Express/Fastify requests, responses, and contexts
 */

// Base request with user information
export interface AuthenticatedRequest {
  user: {
    id: string;
    email?: string;
    role?: string;
    clinicId?: string;
    [key: string]: unknown;
  };
  ip: string;
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string | string[]>;
  clinicContext?: ClinicContext;
}

// Clinic context for multi-tenant requests
export interface ClinicContext {
  clinicId?: string;
  clinicName?: string;
  [key: string]: unknown;
}

// Rate limit context
export interface RateLimitContext {
  ttl: number;
  limit: number;
  remaining: number;
  resetTime: Date;
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
