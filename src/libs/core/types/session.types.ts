/**
 * Session Management Types
 * @module SessionTypes
 * @description Types for session management, authentication, and security
 */

/**
 * Session data structure for session management
 * @interface SessionData
 * @description Defines the structure of session data with healthcare-specific fields
 */
export interface SessionData {
  /** Unique session identifier */
  readonly sessionId: string;
  /** User ID associated with the session */
  readonly userId: string;
  /** Optional clinic ID for multi-tenant sessions */
  readonly clinicId?: string;
  /** User agent string from the client */
  readonly userAgent?: string;
  /** IP address of the client */
  readonly ipAddress?: string;
  /** Device identifier for device tracking */
  readonly deviceId?: string;
  /** Timestamp when the session was created */
  readonly loginTime: Date;
  /** Timestamp of the last activity */
  lastActivity: Date;
  /** Timestamp when the session expires */
  expiresAt: Date;
  /** Whether the session is currently active */
  isActive: boolean;
  /** Additional metadata for the session */
  metadata: Record<string, unknown>;
}

/**
 * Configuration for session management
 * @interface SessionConfig
 * @description Defines session management behavior and limits for 10M+ users
 */
export interface SessionConfig {
  /** Maximum number of concurrent sessions per user */
  readonly maxSessionsPerUser: number;
  /** Session timeout in seconds */
  readonly sessionTimeout: number;
  /** Whether to extend session on activity */
  readonly extendOnActivity: boolean;
  /** Whether to use secure cookies */
  readonly secureCookies: boolean;
  /** SameSite cookie attribute */
  readonly sameSite: 'strict' | 'lax' | 'none';
  /** Whether to use distributed session storage */
  readonly distributed: boolean;
  /** Number of partitions for distributed storage */
  readonly partitions: number;
}

/**
 * Data transfer object for creating a new session
 * @interface CreateSessionDto
 * @description Contains the data needed to create a new user session
 */
export interface CreateSessionDto {
  /** User ID for the session */
  readonly userId: string;
  /** Optional clinic ID for multi-tenant sessions */
  readonly clinicId?: string;
  /** User agent string from the client */
  readonly userAgent?: string;
  /** IP address of the client */
  readonly ipAddress?: string;
  /** Device identifier for device tracking */
  readonly deviceId?: string;
  /** Additional metadata for the session */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Summary statistics for session management
 * @interface SessionSummary
 * @description Contains aggregated session statistics and metrics
 */
export interface SessionSummary {
  /** Total number of sessions */
  readonly totalSessions: number;
  /** Number of currently active sessions */
  readonly activeSessions: number;
  /** Number of expired sessions */
  readonly expiredSessions: number;
  /** Sessions count per user ID */
  readonly sessionsPerUser: Record<string, number>;
  /** Sessions count per clinic ID */
  readonly sessionsPerClinic: Record<string, number>;
  /** Most recent session activities */
  readonly recentActivity: SessionData[];
}

/**
 * Session data structure for Redis storage (legacy/simplified format)
 * @interface RedisSessionData
 * @description Defines the structure of session data stored in Redis for JWT auth
 */
export interface RedisSessionData {
  readonly sessionId: string;
  readonly isActive: boolean;
  readonly lastActivityAt: string;
  readonly deviceFingerprint: string;
  readonly deviceInfo: {
    readonly userAgent: string;
  };
  readonly ipAddress: string;
}

/**
 * Lockout status interface for security features
 * @interface LockoutStatus
 * @description Defines the structure of account lockout status
 */
export interface LockoutStatus {
  readonly isLocked: boolean;
  readonly remainingMinutes: number;
}
