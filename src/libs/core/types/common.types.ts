/**
 * Common Types - Consolidated utility types
 * This file consolidates common utility types used across the application including:
 * - Health check types
 * - Email types
 * - Queue types
 * - Request/Context types
 * - Business rules types
 * These are shared utility types that don't belong to a specific domain.
 */

// ============================================================================
// HEALTH CHECK TYPES
// ============================================================================

/**
 * Represents the health status of a service
 * @interface ServiceHealth
 * @description Contains health check information for individual services
 */
export interface ServiceHealth {
  /** Health status of the service */
  readonly status: 'healthy' | 'unhealthy';
  /** Optional additional details */
  readonly details?: string;
  /** Optional error message if unhealthy */
  readonly error?: string;
  /** Response time in milliseconds */
  readonly responseTime: number;
  /** Timestamp of last health check */
  readonly lastChecked: string;
  /** Optional service-specific metrics */
  readonly metrics?: Record<string, unknown>;
}

/**
 * Represents system performance metrics
 * @interface SystemMetrics
 * @description Contains comprehensive system performance data
 */
export interface SystemMetrics {
  /** System uptime in seconds */
  readonly uptime: number;
  /** Memory usage statistics */
  readonly memoryUsage: {
    /** Total heap memory in bytes */
    readonly heapTotal: number;
    /** Used heap memory in bytes */
    readonly heapUsed: number;
    /** Resident set size in bytes */
    readonly rss: number;
    /** External memory in bytes */
    readonly external: number;
    /** Total system memory in bytes */
    readonly systemTotal: number;
    /** Free system memory in bytes */
    readonly systemFree: number;
    /** Used system memory in bytes */
    readonly systemUsed: number;
  };
  /** CPU usage statistics */
  readonly cpuUsage: {
    /** User CPU time */
    readonly user: number;
    /** System CPU time */
    readonly system: number;
    /** Number of CPU cores */
    readonly cpuCount: number;
    /** CPU model name */
    readonly cpuModel: string;
    /** CPU speed in MHz */
    readonly cpuSpeed: number;
  };
}

/**
 * Database performance metrics (health check version - simplified)
 * @interface DatabaseHealthMetrics
 * @description Simplified database metrics for health checks
 * For comprehensive database metrics, use DatabaseMetrics from @core/types/database.types
 */
export interface DatabaseHealthMetrics {
  /** Average query response time in milliseconds */
  readonly queryResponseTime: number;
  /** Number of active database connections */
  readonly activeConnections: number;
  /** Maximum allowed database connections */
  readonly maxConnections: number;
  /** Connection utilization percentage (0-1) */
  readonly connectionUtilization: number;
}

// Removed duplicate DatabaseMetrics export - use DatabaseMetrics from @core/types/database.types instead

/**
 * Represents Redis performance metrics
 * @interface RedisMetrics
 * @description Contains Redis-specific performance and usage data
 */
export interface RedisMetrics {
  /** Number of connected Redis clients */
  readonly connectedClients: number;
  /** Used memory in bytes */
  readonly usedMemory: number;
  /** Total number of keys in Redis */
  readonly totalKeys: number;
  /** Timestamp of last Redis save operation */
  readonly lastSave: string;
}

// Basic health check response used by app controller
export interface HealthCheckResponse {
  status: 'healthy' | 'degraded';
  timestamp: string;
  environment: string;
  version: string;
  systemMetrics: SystemMetrics;
  services: {
    api: ServiceHealth;
    database: ServiceHealth;
    cache: ServiceHealth;
    queue: ServiceHealth;
    logger: ServiceHealth;
    communication: ServiceHealth;
  };
}

// Detailed health check response with all services
export interface DetailedHealthCheckResponse extends HealthCheckResponse {
  services: {
    api: ServiceHealth;
    database: ServiceHealth;
    cache: ServiceHealth;
    queue: ServiceHealth;
    logger: ServiceHealth;
    communication: ServiceHealth;
    prismaStudio?: ServiceHealth;
    redisCommander?: ServiceHealth;
  };
  processInfo: {
    pid: number;
    ppid: number;
    platform: string;
    versions: Record<string, string>;
    cluster?: {
      isPrimary: boolean;
      isWorker: boolean;
      workerId: string | number | undefined;
      instanceId: string;
      nodeName: string;
      hostname: string;
      cpuCount: number;
      totalWorkers?: number;
      activeWorkers?: number;
    };
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
  };
  cpu: {
    user: number;
    system: number;
  };
}

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  timestamp: Date;
  services: {
    api: ServiceHealth;
    database: ServiceHealth;
    cache: ServiceHealth;
    queue: ServiceHealth;
    logger: ServiceHealth;
    socket: ServiceHealth;
    email: ServiceHealth;
    prismaStudio?: ServiceHealth;
    redisCommander?: ServiceHealth;
  };
  version: string;
  uptime: number;
}

export interface DetailedHealthCheckResult extends HealthCheckResult {
  environment: string;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
  };
  cpu: {
    user: number;
    system: number;
  };
  processInfo: {
    pid: number;
    ppid: number;
    platform: string;
    versions: Record<string, string>;
  };
}

// ============================================================================
// EMAIL TYPES
// ============================================================================

/**
 * Email template types for the healthcare application
 * @enum EmailTemplate
 * @description Defines all available email templates for user communications
 */
export enum EmailTemplate {
  /** Email verification template */
  VERIFICATION = 'VERIFICATION',
  /** Password reset request template */
  PASSWORD_RESET = 'PASSWORD_RESET',
  /** Password reset confirmation template */
  PASSWORD_RESET_CONFIRMATION = 'PASSWORD_RESET_CONFIRMATION',
  /** OTP login template */
  OTP_LOGIN = 'OTP_LOGIN',
  /** Magic link login template */
  MAGIC_LINK = 'MAGIC_LINK',
  /** Security alert template */
  SECURITY_ALERT = 'SECURITY_ALERT',
  /** Suspicious activity notification template */
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  /** Welcome email template */
  WELCOME = 'WELCOME',
  /** Login notification template */
  LOGIN_NOTIFICATION = 'LOGIN_NOTIFICATION',
  /** Appointment reminder template */
  APPOINTMENT_REMINDER = 'APPOINTMENT_REMINDER',
}

/**
 * Base email context interface
 * @interface EmailContext
 * @description Generic context object for email template variables
 */
export interface EmailContext {
  /** Dynamic key-value pairs for email template variables */
  readonly [key: string]: string | number | boolean | undefined;
}

/**
 * Email context for verification emails
 * @interface VerificationEmailContext
 * @description Context specific to email verification templates
 */
export interface VerificationEmailContext extends EmailContext {
  /** URL for email verification */
  readonly verificationUrl: string;
}

export interface PasswordResetEmailContext extends EmailContext {
  name?: string;
  resetUrl: string;
  expiryTime?: string;
}

export interface OTPEmailContext extends EmailContext {
  name?: string;
  otp: string;
}

export interface MagicLinkEmailContext extends EmailContext {
  name: string;
  loginUrl: string;
  expiryTime: string;
}

export interface WelcomeEmailContext extends EmailContext {
  name?: string;
  role?: string;
  loginUrl?: string;
  dashboardUrl?: string;
  supportEmail?: string;
  isGoogleAccount?: boolean;
}

export interface LoginNotificationEmailContext extends EmailContext {
  name?: string;
  time: string;
  device?: string;
  browser?: string;
  operatingSystem?: string;
  ipAddress?: string;
  location?: string;
}

export interface SecurityAlertEmailContext extends EmailContext {
  name?: string;
  time: string;
  action?: string;
}

export interface SuspiciousActivityEmailContext extends EmailContext {
  name?: string;
  time: string;
  supportEmail?: string;
}

/**
 * Email sending options
 * @interface EmailOptions
 * @description Configuration for sending emails with templates
 */
export interface EmailOptions {
  /** Recipient email address */
  readonly to: string;
  /** Email subject line */
  readonly subject: string;
  /** Email template to use */
  readonly template: EmailTemplate;
  /** Context variables for template */
  readonly context: EmailContext;
  /** Optional plain text content */
  readonly text?: string;
  /** Optional HTML content */
  readonly html?: string;
  /** Optional clinic ID for multi-tenant email routing */
  readonly clinicId?: string;
}

// ============================================================================
// QUEUE TYPES
// ============================================================================

/**
 * Represents a patient's position in the queue
 * @interface QueuePosition
 * @description Contains queue position and wait time information
 */
export interface QueuePosition {
  /** Current position in the queue */
  readonly position: number;
  /** Estimated wait time in minutes */
  readonly estimatedWaitTime: number;
  /** Number of patients ahead */
  readonly totalAhead: number;
}

/**
 * Represents queue statistics
 * @interface QueueStats
 * @description Contains comprehensive queue performance metrics
 */
export interface QueueStats {
  /** Number of patients waiting */
  readonly waiting: number;
  /** Number of patients currently being served */
  readonly active: number;
  /** Number of completed appointments */
  readonly completed: number;
  /** Number of failed appointments */
  readonly failed: number;
  /** Average wait time in minutes */
  readonly avgWaitTime: number;
  /** Current estimated wait time in minutes */
  readonly estimatedWaitTime: number;
}

/**
 * Represents queue statistics for a specific location
 * @interface LocationQueueStats
 * @description Extends QueueStats with location-specific data and doctor statistics
 */
export interface LocationQueueStats extends QueueStats {
  /** Location identifier */
  readonly locationId: string;
  /** Statistics per doctor */
  readonly doctorStats: {
    /** Doctor ID to statistics mapping */
    readonly [doctorId: string]: {
      /** Number of patients waiting for this doctor */
      readonly waiting: number;
      /** Number of patients currently being served by this doctor */
      readonly active: number;
      /** Average wait time for this doctor in minutes */
      readonly avgWaitTime: number;
    };
  };
}

/**
 * Represents queue statistics for a specific doctor
 * @interface DoctorQueueStats
 * @description Contains doctor-specific queue metrics and next appointment information
 */
export interface DoctorQueueStats {
  /** Number of patients waiting for this doctor */
  readonly waiting: number;
  /** Number of patients currently being served by this doctor */
  readonly active: number;
  /** Number of completed appointments for this doctor */
  readonly completed: number;
  /** Average wait time for this doctor in minutes */
  readonly avgWaitTime: number;
  /** Optional next appointment information */
  readonly nextAppointment?: {
    /** Appointment ID */
    readonly id: string;
    /** Patient name */
    readonly patientName: string;
    /** Scheduled time */
    readonly scheduledTime: string;
  };
}

// ============================================================================
// REQUEST AND CONTEXT TYPES
// ============================================================================

/**
 * Base request with user information (general-purpose, non-Fastify)
 * @interface AuthenticatedRequest
 * @description Represents a general authenticated HTTP request with user and clinic context
 * For Fastify-specific requests with clinic context, use ClinicAuthenticatedRequest from clinic.types
 * @example
 * ```typescript
 * const request: AuthenticatedRequest = {
 *   user: { id: "user-123", email: "user@example.com", role: "DOCTOR" },
 *   ip: "192.168.1.1",
 *   url: "/api/appointments",
 *   method: "GET",
 *   headers: {},
 *   clinicContext: { clinicId: "clinic-456", clinicName: "Downtown Clinic" }
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
  readonly clinicContext?: import('./clinic.types').ClinicContext;
}

/**
 * Clinic context for multi-tenant requests
 */
export type { ClinicContext } from './clinic.types';

/**
 * Rate limit context information
 * @interface RateLimitContext
 * @description Contains rate limiting information for requests
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

// ============================================================================
// BUSINESS RULES TYPES
// ============================================================================

export type RuleConditionType =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'contains'
  | 'not_contains'
  | 'in_range'
  | 'is_empty'
  | 'is_not_empty'
  | 'custom';

export type RuleActionType =
  | 'block'
  | 'allow'
  | 'warn'
  | 'log'
  | 'notify'
  | 'auto_correct'
  | 'require_approval'
  | 'custom';

export type RuleSeverity = 'low' | 'medium' | 'high' | 'critical';

export type RuleCategory =
  | 'appointment_creation'
  | 'appointment_update'
  | 'appointment_cancellation'
  | 'user_access'
  | 'data_integrity'
  | 'billing'
  | 'prescription'
  | 'patient_safety'
  | 'compliance'
  | 'audit'
  | 'custom';

export interface RuleCondition {
  readonly type: RuleConditionType;
  readonly field: string;
  readonly value: unknown;
  readonly customFunction?: string;
  readonly operator?: 'AND' | 'OR';
}

export interface RuleAction {
  readonly type: RuleActionType;
  readonly message: string;
  readonly severity: RuleSeverity;
  readonly customFunction?: string;
  readonly parameters?: Record<string, unknown>;
}

export interface RuleContext {
  readonly appointmentId?: string;
  readonly userId: string;
  readonly clinicId?: string;
  readonly data: Record<string, unknown>;
  readonly metadata?: {
    readonly userRole?: string;
    readonly userPermissions?: readonly string[];
    readonly requestSource?: string;
    readonly timestamp?: Date;
  };
}

export interface RuleResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
  readonly warnings: readonly string[];
  readonly actions: readonly RuleAction[];
  readonly metadata?: {
    readonly evaluatedRules: readonly string[];
    readonly executionTime: number;
    readonly timestamp: Date;
  };
}

export interface RuleStats {
  totalRules: number;
  passedRules: number;
  failedRules: number;
  warningRules: number;
  averageExecutionTime: number;
}

export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly suggestions: readonly string[];
  readonly metadata?: {
    readonly validatedAt: Date;
    readonly validatedBy: string;
    readonly validationDuration: number;
  };
}

export interface ExecutionContext extends RuleContext {
  readonly sessionId: string;
  readonly requestId: string;
  readonly environment: 'development' | 'staging' | 'production' | 'local-prod';
  readonly additionalData?: Record<string, unknown>;
}

export interface RulePerformanceMetrics {
  readonly ruleId: string;
  readonly averageExecutionTime: number;
  readonly totalExecutions: number;
  readonly successRate: number;
  readonly lastExecuted: Date;
  readonly trend: 'improving' | 'stable' | 'degrading';
}
