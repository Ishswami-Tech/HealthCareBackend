/**
 * Core types for the healthcare application
 * @module CoreTypes
 * @description Central type definitions for authentication, user management, and system operations
 */

/**
 * Authentication response interface
 * @interface AuthResponse
 * @description Response structure for authentication operations
 * @example
 * ```typescript
 * const authResponse: AuthResponse = {
 *   success: true,
 *   user: userData,
 *   tokens: { accessToken: "token123", refreshToken: "refresh456" },
 *   sessionId: "session-789",
 *   message: "Login successful"
 * };
 * ```
 */
export interface AuthResponse {
  /** Whether the authentication was successful */
  readonly success: boolean;
  /** Optional user data */
  readonly user?: unknown;
  /** Optional authentication tokens */
  readonly tokens?: AuthTokens;
  /** Optional session ID (legacy field) */
  readonly session_id?: string;
  /** Optional session ID */
  readonly sessionId?: string;
  /** Optional success/error message */
  readonly message?: string;
  /** Optional error message */
  readonly error?: string;
}

/**
 * Authentication tokens interface
 * @interface AuthTokens
 * @description Contains JWT tokens and session information
 * @example
 * ```typescript
 * const tokens: AuthTokens = {
 *   accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
 *   refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
 *   expiresIn: 3600,
 *   sessionId: "session-123",
 *   tokenType: "Bearer"
 * };
 * ```
 */
export interface AuthTokens {
  /** JWT access token */
  readonly accessToken: string;
  /** JWT refresh token */
  readonly refreshToken: string;
  /** Token expiration time in seconds */
  readonly expiresIn: number;
  /** Session identifier */
  readonly sessionId: string;
  /** Optional token type (default: Bearer) */
  readonly tokenType?: string;
}

export interface OTPResult {
  success: boolean;
  message: string;
  expiresIn?: number;
  method?: "sms" | "email";
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role?: string;
  clinicId?: string;
  phone?: string;
  avatar?: string;
  lastLogin?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PasswordResetResult {
  success: boolean;
  message: string;
  token?: string;
}

export interface MagicLinkResult {
  success: boolean;
  message: string;
  linkId?: string;
  linkSent?: boolean;
  expiresIn?: number;
}

export interface SessionData {
  sessionId: string;
  userId: string;
  clinicId?: string;
  domain?: string;
  createdAt: Date;
  expiresAt: Date;
  lastActivity: Date;
  userAgent?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

export interface TokenPayload {
  sub: string;
  email: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  clinicId?: string;
  domain?: string;
  sessionId?: string;
  iat?: number;
  exp?: number;
  jti?: string; // JWT ID for blacklist tracking
  deviceFingerprint?: string; // Device fingerprint for security
  userAgent?: string; // User agent for security tracking
  ipAddress?: string; // IP address for security validation
}

export interface AuthenticatedRequest {
  user: TokenPayload & { id?: string };
  sessionId?: string;
  clinicId?: string;
  // Basic Express Request properties needed
  params?: unknown;
  query?: unknown;
  body?: unknown;
  headers?: unknown;
}

export interface DomainValidationResult {
  isValid: boolean;
  message?: string;
  errors?: string[];
  metadata?: Record<string, unknown>;
}

// Health Check Types
export interface HealthCheckResponse {
  status: "healthy" | "unhealthy" | "degraded";
  timestamp: string;
  environment: string;
  version: string;
  systemMetrics: SystemMetrics;
  services: Record<string, ServiceHealth>;
}

export interface DetailedHealthCheckResponse extends HealthCheckResponse {
  processInfo: ProcessInfo;
  memory: MemoryInfo;
  cpu: CpuInfo;
}

export interface ServiceHealth {
  status: "healthy" | "unhealthy";
  details?: string;
  error?: string;
  responseTime: number;
  lastChecked: string;
  metrics?: Record<string, unknown>;
}

export interface SystemMetrics {
  uptime: number;
  memoryUsage: {
    heapTotal: number;
    heapUsed: number;
    rss: number;
    external: number;
    systemTotal: number;
    systemFree: number;
    systemUsed: number;
  };
  cpuUsage: {
    user: number;
    system: number;
    cpuCount: number;
    cpuModel: string;
    cpuSpeed: number;
  };
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  platform: string;
  versions: Record<string, string>;
}

export interface MemoryInfo {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

export interface CpuInfo {
  user: number;
  system: number;
}
