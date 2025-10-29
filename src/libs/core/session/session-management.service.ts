import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "../../infrastructure/cache/redis/redis.service";
import {
  LoggingService,
  LogType,
  LogLevel,
} from "../../infrastructure/logging/logging.service";
import { DatabaseService } from "../../infrastructure/database";
import { JwtService } from "@nestjs/jwt";
import * as crypto from "crypto";

/**
 * Represents session data structure
 * @interface SessionData
 * @description Contains all information about a user session
 * @example
 * ```typescript
 * const sessionData: SessionData = {
 *   sessionId: "abc123...",
 *   userId: "user-123",
 *   clinicId: "clinic-456",
 *   userAgent: "Mozilla/5.0...",
 *   ipAddress: "192.168.1.1",
 *   deviceId: "device-789",
 *   loginTime: new Date(),
 *   lastActivity: new Date(),
 *   expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
 *   isActive: true,
 *   metadata: { source: "web" }
 * };
 * ```
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
 * @description Defines session management behavior and limits
 * @example
 * ```typescript
 * const config: SessionConfig = {
 *   maxSessionsPerUser: 5,
 *   sessionTimeout: 86400, // 24 hours
 *   extendOnActivity: true,
 *   secureCookies: true,
 *   sameSite: "strict",
 *   distributed: true,
 *   partitions: 16
 * };
 * ```
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
  readonly sameSite: "strict" | "lax" | "none";
  /** Whether to use distributed session storage */
  readonly distributed: boolean;
  /** Number of partitions for distributed storage */
  readonly partitions: number;
}

/**
 * Data transfer object for creating a new session
 * @interface CreateSessionDto
 * @description Contains the data needed to create a new user session
 * @example
 * ```typescript
 * const createSessionDto: CreateSessionDto = {
 *   userId: "user-123",
 *   clinicId: "clinic-456",
 *   userAgent: "Mozilla/5.0...",
 *   ipAddress: "192.168.1.1",
 *   deviceId: "device-789",
 *   metadata: { source: "web" }
 * };
 * ```
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
 * @example
 * ```typescript
 * const summary: SessionSummary = {
 *   totalSessions: 1000,
 *   activeSessions: 750,
 *   expiredSessions: 250,
 *   sessionsPerUser: { "user-1": 2, "user-2": 1 },
 *   sessionsPerClinic: { "clinic-1": 500, "clinic-2": 250 },
 *   recentActivity: [sessionData1, sessionData2]
 * };
 * ```
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
 * Session Management Service for Healthcare Backend
 * @class SessionManagementService
 * @description Provides comprehensive session management for 1M+ users with distributed storage,
 * security monitoring, and automatic cleanup. Supports multi-tenant sessions, device tracking,
 * and suspicious activity detection.
 * @implements OnModuleInit
 * @example
 * ```typescript
 * // Create a new session
 * const session = await sessionService.createSession({
 *   userId: "user-123",
 *   clinicId: "clinic-456",
 *   userAgent: "Mozilla/5.0...",
 *   ipAddress: "192.168.1.1"
 * });
 *
 * // Get session data
 * const sessionData = await sessionService.getSession(session.sessionId);
 *
 * // Update session activity
 * await sessionService.updateSessionActivity(session.sessionId, { page: "dashboard" });
 * ```
 */
@Injectable()
export class SessionManagementService implements OnModuleInit {
  private readonly logger = new Logger(SessionManagementService.name);
  private config!: SessionConfig;

  private readonly SESSION_PREFIX = "session:";
  private readonly USER_SESSIONS_PREFIX = "user_sessions:";
  private readonly BLACKLIST_PREFIX = "blacklist:";

  /**
   * Creates an instance of SessionManagementService
   * @constructor
   * @param configService - Configuration service for environment variables
   * @param redis - Redis service for distributed session storage
   * @param logging - Logging service for security and audit logs
   * @param prisma - Prisma service for database operations
   * @param jwtService - JWT service for token operations
   */
  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly logging: LoggingService,
    private readonly databaseService: DatabaseService,
    private readonly jwtService: JwtService,
  ) {
    this.initializeConfig();
  }

  onModuleInit() {
    this.initialize();
  }

  /**
   * Initialize session management service
   * @description Sets up cleanup jobs, monitoring, and logging for session management
   * @returns void
   * @throws Error if initialization fails
   */
  initialize(): void {
    try {
      this.logger.log("Initializing Session Management Service for 1M+ users");

      // Setup cleanup intervals
      this.setupCleanupJobs();

      // Initialize session monitoring
      this.setupSessionMonitoring();

      this.logger.log("Session Management Service initialized successfully", {
        maxSessionsPerUser: this.config.maxSessionsPerUser,
        sessionTimeout: this.config.sessionTimeout,
        distributed: this.config.distributed,
        partitions: this.config.partitions,
      });
    } catch (_error) {
      this.logger.error(
        "Failed to initialize Session Management Service",
        (_error as Error).stack,
      );
      throw _error;
    }
  }

  /**
   * Create new session
   * @description Creates a new user session with distributed storage and security monitoring
   * @param createSessionDto - Data for creating the session
   * @returns Promise<SessionData> - The created session data
   * @throws Error if session creation fails
   * @example
   * ```typescript
   * const session = await sessionService.createSession({
   *   userId: "user-123",
   *   clinicId: "clinic-456",
   *   userAgent: "Mozilla/5.0...",
   *   ipAddress: "192.168.1.1"
   * });
   * ```
   */
  async createSession(
    createSessionDto: CreateSessionDto,
  ): Promise<SessionData> {
    try {
      const sessionId = this.generateSessionId();
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + this.config.sessionTimeout * 1000,
      );

      const sessionData: SessionData = {
        sessionId,
        userId: createSessionDto.userId,
        ...(createSessionDto.clinicId
          ? { clinicId: createSessionDto.clinicId }
          : {}),
        ...(createSessionDto.userAgent
          ? { userAgent: createSessionDto.userAgent }
          : {}),
        ...(createSessionDto.ipAddress
          ? { ipAddress: createSessionDto.ipAddress }
          : {}),
        ...(createSessionDto.deviceId
          ? { deviceId: createSessionDto.deviceId }
          : {}),
        loginTime: now,
        lastActivity: now,
        expiresAt,
        isActive: true,
        metadata: createSessionDto.metadata || {},
      };

      // Check and enforce session limits
      await this.enforceSessionLimits(createSessionDto.userId);

      // Store session data
      await this.storeSession(sessionData);

      // Add to user sessions index
      await this.addUserSession(createSessionDto.userId, sessionId);

      // Log session creation
      await this.logging.log(
        LogType.SECURITY,
        LogLevel.INFO,
        "Session created",
        "SessionManagementService",
        {
          sessionId,
          userId: createSessionDto.userId,
          clinicId: createSessionDto.clinicId,
          ipAddress: createSessionDto.ipAddress,
          userAgent: createSessionDto.userAgent,
        },
      );

      return sessionData;
    } catch (_error) {
      this.logger.error(
        `Failed to create session for user ${createSessionDto.userId}`,
        (_error as Error).stack,
      );
      throw _error;
    }
  }

  /**
   * Get session by ID
   * @description Retrieves session data by session ID with expiration and blacklist checks
   * @param sessionId - The session ID to retrieve
   * @returns Promise<SessionData | null> - Session data or null if not found/expired
   * @example
   * ```typescript
   * const session = await sessionService.getSession("session-123");
   * if (session) {
   *   console.log(`User ${session.userId} is active`);
   * }
   * ```
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    try {
      const sessionKey = this.getSessionKey(sessionId);
      const sessionData = await this.redis.get<SessionData>(sessionKey);

      if (!sessionData) {
        return null;
      }

      // Check if session is expired
      if (new Date() > new Date(sessionData.expiresAt)) {
        await this.invalidateSession(sessionId);
        return null;
      }

      // Check if session is blacklisted
      if (await this.isSessionBlacklisted(sessionId)) {
        return null;
      }

      return sessionData;
    } catch (_error) {
      this.logger.error(
        `Failed to get session ${sessionId}`,
        (_error as Error).stack,
      );
      return null;
    }
  }

  /**
   * Update session activity
   * @description Updates session activity timestamp and optionally extends session expiration
   * @param sessionId - The session ID to update
   * @param metadata - Optional metadata to add to the session
   * @returns Promise<boolean> - True if update was successful, false otherwise
   * @example
   * ```typescript
   * const updated = await sessionService.updateSessionActivity("session-123", {
   *   lastPage: "dashboard",
   *   action: "view"
   * });
   * ```
   */
  async updateSessionActivity(
    sessionId: string,
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        return false;
      }

      const now = new Date();
      session.lastActivity = now;

      // Extend session if configured
      if (this.config.extendOnActivity) {
        session.expiresAt = new Date(
          now.getTime() + this.config.sessionTimeout * 1000,
        );
      }

      // Update metadata
      if (metadata) {
        const currentMetadata =
          (session as { metadata?: Record<string, unknown> }).metadata || {};
        (session as { metadata?: Record<string, unknown> }).metadata = {
          ...currentMetadata,
          ...metadata,
        };
      }

      await this.storeSession(session);
      return true;
    } catch (_error) {
      this.logger.error(
        `Failed to update session activity ${sessionId}`,
        (_error as Error).stack,
      );
      return false;
    }
  }

  /**
   * Invalidate session
   */
  async invalidateSession(sessionId: string): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        return false;
      }

      // Remove session data
      const sessionKey = this.getSessionKey(sessionId);
      await this.redis.del(sessionKey);

      // Remove from user sessions index
      await this.removeUserSession(session.userId, sessionId);

      // Add to blacklist for security
      await this.blacklistSession(sessionId);

      // Log session invalidation
      await this.logging.log(
        LogType.SECURITY,
        LogLevel.INFO,
        "Session invalidated",
        "SessionManagementService",
        {
          sessionId,
          userId: session.userId,
          clinicId: session.clinicId,
        },
      );

      return true;
    } catch (_error) {
      this.logger.error(
        `Failed to invalidate session ${sessionId}`,
        (_error as Error).stack,
      );
      return false;
    }
  }

  /**
   * Get user sessions
   */
  async getUserSessions(userId: string): Promise<SessionData[]> {
    try {
      const userSessionsKey = this.getUserSessionsKey(userId);
      const sessionIds = await this.redis.sMembers(userSessionsKey);

      if (sessionIds.length === 0) {
        return [];
      }

      const sessions: SessionData[] = [];
      for (const sessionId of sessionIds) {
        const session = await this.getSession(sessionId);
        if (session) {
          sessions.push(session);
        }
      }

      return sessions.sort(
        (a, b) =>
          new Date(b.lastActivity).getTime() -
          new Date(a.lastActivity).getTime(),
      );
    } catch (_error) {
      this.logger.error(
        `Failed to get sessions for user ${userId}`,
        (_error as Error).stack,
      );
      return [];
    }
  }

  /**
   * Revoke all user sessions
   */
  async revokeAllUserSessions(
    userId: string,
    exceptSessionId?: string,
  ): Promise<number> {
    try {
      const sessions = await this.getUserSessions(userId);
      let revokedCount = 0;

      for (const session of sessions) {
        if (exceptSessionId && session.sessionId === exceptSessionId) {
          continue;
        }

        if (await this.invalidateSession(session.sessionId)) {
          revokedCount++;
        }
      }

      // Log mass revocation
      await this.logging.log(
        LogType.SECURITY,
        LogLevel.WARN,
        "All user sessions revoked",
        "SessionManagementService",
        {
          userId,
          revokedCount,
          exceptSessionId,
        },
      );

      return revokedCount;
    } catch (_error) {
      this.logger.error(
        `Failed to revoke sessions for user ${userId}`,
        (_error as Error).stack,
      );
      return 0;
    }
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      const pattern = `${this.SESSION_PREFIX}*`;
      const keys = await this.redis.keys(pattern);
      let cleanedCount = 0;

      for (const key of keys) {
        const sessionData = await this.redis.get<SessionData>(key);
        if (sessionData && new Date() > new Date(sessionData.expiresAt)) {
          await this.invalidateSession(sessionData.sessionId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.log(`Cleaned up ${cleanedCount} expired sessions`);
      }

      return cleanedCount;
    } catch (_error) {
      this.logger.error(
        "Failed to cleanup expired sessions",
        (_error as Error).stack,
      );
      return 0;
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStatistics(): Promise<SessionSummary> {
    try {
      const pattern = `${this.SESSION_PREFIX}*`;
      const keys = await this.redis.keys(pattern);
      const now = new Date();

      const summary = {
        totalSessions: 0,
        activeSessions: 0,
        expiredSessions: 0,
        sessionsPerUser: {} as Record<string, number>,
        sessionsPerClinic: {} as Record<string, number>,
        recentActivity: [] as SessionData[],
      };

      const recentSessions: SessionData[] = [];

      for (const key of keys) {
        const sessionData = await this.redis.get<SessionData>(key);
        if (!sessionData) continue;

        summary.totalSessions++;

        if (new Date(sessionData.expiresAt) > now) {
          summary.activeSessions++;
          recentSessions.push(sessionData);
        } else {
          summary.expiredSessions++;
        }

        // Count sessions per user
        summary.sessionsPerUser[sessionData.userId] =
          (summary.sessionsPerUser[sessionData.userId] || 0) + 1;

        // Count sessions per clinic
        if (sessionData.clinicId) {
          summary.sessionsPerClinic[sessionData.clinicId] =
            (summary.sessionsPerClinic[sessionData.clinicId] || 0) + 1;
        }
      }

      // Sort by most recent activity and take top 10
      summary.recentActivity = recentSessions
        .sort(
          (a, b) =>
            new Date(b.lastActivity).getTime() -
            new Date(a.lastActivity).getTime(),
        )
        .slice(0, 10);

      return summary as SessionSummary;
    } catch (_error) {
      this.logger.error(
        "Failed to get session statistics",
        (_error as Error).stack,
      );
      return {
        totalSessions: 0,
        activeSessions: 0,
        expiredSessions: 0,
        sessionsPerUser: {},
        sessionsPerClinic: {},
        recentActivity: [],
      };
    }
  }

  /**
   * Detect suspicious sessions
   */
  async detectSuspiciousSessions(): Promise<{
    suspicious: SessionData[];
    reasons: Record<string, string[]>;
  }> {
    try {
      const pattern = `${this.SESSION_PREFIX}*`;
      const keys = await this.redis.keys(pattern);
      const suspicious: SessionData[] = [];
      const reasons: Record<string, string[]> = {};

      for (const key of keys) {
        const sessionData = await this.redis.get<SessionData>(key);
        if (!sessionData) continue;

        const sessionReasons: string[] = [];

        // Check for multiple concurrent sessions from different IPs
        const userSessions = await this.getUserSessions(sessionData.userId);
        const uniqueIPs = new Set(
          userSessions.map((s) => s.ipAddress).filter(Boolean),
        );

        if (uniqueIPs.size > 3) {
          sessionReasons.push(
            "Multiple concurrent sessions from different IPs",
          );
        }

        // Check for unusual user agent patterns
        if (
          sessionData.userAgent &&
          this.isUnusualUserAgent(sessionData.userAgent)
        ) {
          sessionReasons.push("Unusual user agent detected");
        }

        // Check for session age without activity
        const hoursSinceActivity =
          (Date.now() - new Date(sessionData.lastActivity).getTime()) /
          (1000 * 60 * 60);

        if (hoursSinceActivity > 24 && sessionData.isActive) {
          sessionReasons.push("Long inactive session");
        }

        // Check for rapid location changes (if available)
        if (await this.detectRapidLocationChange(sessionData)) {
          sessionReasons.push("Rapid geographical location change");
        }

        if (sessionReasons.length > 0) {
          suspicious.push(sessionData);
          reasons[sessionData.sessionId] = sessionReasons;
        }
      }

      return { suspicious, reasons };
    } catch (_error) {
      this.logger.error(
        "Failed to detect suspicious sessions",
        (_error as Error).stack,
      );
      return { suspicious: [], reasons: {} };
    }
  }

  /**
   * Force invalidate suspicious sessions
   */
  async invalidateSuspiciousSessions(): Promise<number> {
    try {
      const { suspicious } = await this.detectSuspiciousSessions();
      let invalidatedCount = 0;

      for (const session of suspicious) {
        if (await this.invalidateSession(session.sessionId)) {
          invalidatedCount++;
        }
      }

      if (invalidatedCount > 0) {
        await this.logging.log(
          LogType.SECURITY,
          LogLevel.WARN,
          `Invalidated ${invalidatedCount} suspicious sessions`,
          "SessionManagementService",
          { count: invalidatedCount },
        );
      }

      return invalidatedCount;
    } catch (_error) {
      this.logger.error(
        "Failed to invalidate suspicious sessions",
        (_error as Error).stack,
      );
      return 0;
    }
  }

  /**
   * Private helper methods
   */
  private initializeConfig(): void {
    this.config = {
      maxSessionsPerUser: this.configService.get<number>(
        "SESSION_MAX_PER_USER",
        5,
      ),
      sessionTimeout: this.configService.get<number>(
        "SESSION_TIMEOUT",
        24 * 60 * 60,
      ), // 24 hours
      extendOnActivity: this.configService.get<boolean>(
        "SESSION_EXTEND_ON_ACTIVITY",
        true,
      ),
      secureCookies: this.configService.get<boolean>(
        "SESSION_SECURE_COOKIES",
        true,
      ),
      sameSite: this.configService.get<"strict" | "lax" | "none">(
        "SESSION_SAME_SITE",
        "strict",
      ),
      distributed: this.configService.get<boolean>("SESSION_DISTRIBUTED", true),
      partitions: this.configService.get<number>("SESSION_PARTITIONS", 16),
    };
  }

  private generateSessionId(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  private getSessionKey(sessionId: string): string {
    if (this.config.distributed) {
      const partition = this.getPartition(sessionId);
      return `${this.SESSION_PREFIX}${partition}:${sessionId}`;
    }
    return `${this.SESSION_PREFIX}${sessionId}`;
  }

  private getUserSessionsKey(userId: string): string {
    if (this.config.distributed) {
      const partition = this.getPartition(userId);
      return `${this.USER_SESSIONS_PREFIX}${partition}:${userId}`;
    }
    return `${this.USER_SESSIONS_PREFIX}${userId}`;
  }

  private getPartition(key: string): number {
    const hash = crypto.createHash("md5").update(key).digest("hex");
    return parseInt(hash.substring(0, 8), 16) % this.config.partitions;
  }

  private async storeSession(sessionData: SessionData): Promise<void> {
    const sessionKey = this.getSessionKey(sessionData.sessionId);
    const ttl = Math.max(
      0,
      Math.floor(
        (new Date(sessionData.expiresAt).getTime() - Date.now()) / 1000,
      ),
    );
    await this.redis.set(sessionKey, sessionData, ttl);
  }

  private async addUserSession(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const userSessionsKey = this.getUserSessionsKey(userId);
    await this.redis.sAdd(userSessionsKey, sessionId);
    await this.redis.expire(userSessionsKey, this.config.sessionTimeout);
  }

  private async removeUserSession(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const userSessionsKey = this.getUserSessionsKey(userId);
    await this.redis.sRem(userSessionsKey, sessionId);
  }

  private async blacklistSession(sessionId: string): Promise<void> {
    const blacklistKey = `${this.BLACKLIST_PREFIX}${sessionId}`;
    await this.redis.set(blacklistKey, "1", this.config.sessionTimeout);
  }

  private async isSessionBlacklisted(sessionId: string): Promise<boolean> {
    const blacklistKey = `${this.BLACKLIST_PREFIX}${sessionId}`;
    const result = await this.redis.get(blacklistKey);
    return result !== null;
  }

  private async enforceSessionLimits(userId: string): Promise<void> {
    const sessions = await this.getUserSessions(userId);

    if (sessions.length >= this.config.maxSessionsPerUser) {
      // Remove oldest sessions
      const sessionsToRemove = sessions
        .sort(
          (a, b) =>
            new Date(a.lastActivity).getTime() -
            new Date(b.lastActivity).getTime(),
        )
        .slice(0, sessions.length - this.config.maxSessionsPerUser + 1);

      for (const session of sessionsToRemove) {
        await this.invalidateSession(session.sessionId);
      }
    }
  }

  private setupCleanupJobs(): void {
    // Cleanup expired sessions every hour
    setInterval(
      () => {
        void this.cleanupExpiredSessions().catch((_error) => {
          this.logger.error(
            "Session cleanup job failed",
            (_error as Error).stack,
          );
        });
      },
      60 * 60 * 1000,
    );

    // Check for suspicious sessions every 30 minutes
    setInterval(
      () => {
        void this.detectSuspiciousSessions()
          .then(({ suspicious }) => {
            if (suspicious.length > 0) {
              this.logger.warn(
                `Detected ${suspicious.length} suspicious sessions`,
              );
            }
          })
          .catch((_error) => {
            this.logger.error(
              "Suspicious session detection failed",
              (_error as Error).stack,
            );
          });
      },
      30 * 60 * 1000,
    );
  }

  private setupSessionMonitoring(): void {
    // Log session statistics every 10 minutes
    setInterval(
      () => {
        void this.getSessionStatistics()
          .then((stats) => {
            this.logger.log("Session Statistics", {
              totalSessions: stats.totalSessions,
              activeSessions: stats.activeSessions,
              expiredSessions: stats.expiredSessions,
              uniqueUsers: Object.keys(stats.sessionsPerUser).length,
              uniqueClinics: Object.keys(stats.sessionsPerClinic).length,
            });
          })
          .catch((_error) => {
            this.logger.error(
              "Session monitoring failed",
              (_error as Error).stack,
            );
          });
      },
      10 * 60 * 1000,
    );
  }

  private isUnusualUserAgent(userAgent: string): boolean {
    const suspiciousPatterns = [
      /bot/i,
      /crawler/i,
      /spider/i,
      /scraper/i,
      /curl/i,
      /wget/i,
      /postman/i,
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(userAgent));
  }

  private detectRapidLocationChange(_session: SessionData): Promise<boolean> {
    // This would implement geolocation checking logic
    // For now, return false as placeholder
    return Promise.resolve(false);
  }
}
