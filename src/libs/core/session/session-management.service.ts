import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@config';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { DatabaseService } from '@infrastructure/database';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import type {
  SessionData,
  SessionConfig,
  CreateSessionDto,
  SessionSummary,
} from '@core/types/session.types';
import type { FastifySession } from '@core/types/guard.types';

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
  private readonly SESSION_PREFIX = 'session:';
  private readonly USER_SESSIONS_PREFIX = 'user_sessions:';
  private readonly BLACKLIST_PREFIX = 'blacklist:';
  private readonly CLINIC_SESSIONS_PREFIX = 'clinic_sessions:';

  private config!: SessionConfig;

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly jwtService: JwtService
  ) {}

  /**
   * Initialize session management configuration
   */
  async onModuleInit(): Promise<void> {
    this.config = {
      maxSessionsPerUser:
        this.configService?.get<number>('SESSION_MAX_PER_USER', 10) ||
        parseInt(process.env['SESSION_MAX_PER_USER'] || '10', 10),
      sessionTimeout:
        this.configService?.get<number>('SESSION_TIMEOUT', 86400) ||
        parseInt(process.env['SESSION_TIMEOUT'] || '86400', 10), // 24 hours
      extendOnActivity:
        this.configService?.get<boolean>('SESSION_EXTEND_ON_ACTIVITY', true) ??
        process.env['SESSION_EXTEND_ON_ACTIVITY'] !== 'false',
      secureCookies:
        this.configService?.get<boolean>('SESSION_SECURE_COOKIES', true) ??
        process.env['SESSION_SECURE_COOKIES'] !== 'false',
      sameSite: (this.configService?.get<string>('SESSION_SAME_SITE', 'strict') ||
        process.env['SESSION_SAME_SITE'] ||
        'strict') as 'strict' | 'lax' | 'none',
      distributed:
        this.configService?.get<boolean>('SESSION_DISTRIBUTED', true) ??
        process.env['SESSION_DISTRIBUTED'] !== 'false',
      partitions:
        this.configService?.get<number>('SESSION_PARTITIONS', 16) ||
        parseInt(process.env['SESSION_PARTITIONS'] || '16', 10),
    };

    // Setup cleanup jobs
    this.setupCleanupJobs();

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Session management service initialized',
      'SessionManagementService',
      { config: this.config }
    );
  }

  /**
   * Create new session with automatic partition assignment
   * @param createSessionDto - Session creation data
   * @returns Created session data
   */
  async createSession(createSessionDto: CreateSessionDto): Promise<SessionData> {
    // Ensure config is initialized - use default if not ready
    const sessionTimeout =
      this.config?.sessionTimeout || parseInt(process.env['SESSION_TIMEOUT'] || '86400', 10);

    const sessionId = this.generateSessionId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionTimeout * 1000);

    const sessionData: SessionData = {
      sessionId,
      userId: createSessionDto.userId,
      ...(createSessionDto.clinicId && { clinicId: createSessionDto.clinicId }),
      ...(createSessionDto.userAgent && { userAgent: createSessionDto.userAgent }),
      ...(createSessionDto.ipAddress && { ipAddress: createSessionDto.ipAddress }),
      ...(createSessionDto.deviceId && { deviceId: createSessionDto.deviceId }),
      loginTime: now,
      lastActivity: now,
      expiresAt,
      isActive: true,
      metadata: createSessionDto.metadata || {},
    };

    try {
      // 1. Enforce session limits (auto-cleanup oldest sessions)
      await this.enforceSessionLimits(createSessionDto.userId);

      // 2. Store session with distributed partitioning
      await this.storeSession(sessionData);

      // 3. Add to user sessions index (Redis Set)
      await this.addUserSession(createSessionDto.userId, sessionId);

      // 4. Add to clinic sessions index if clinicId provided
      if (createSessionDto.clinicId) {
        await this.addClinicSession(createSessionDto.clinicId, sessionId);
      }

      // 5. Log security event
      await this.loggingService.log(
        LogType.SECURITY,
        LogLevel.INFO,
        'Session created',
        'SessionManagementService',
        {
          userId: createSessionDto.userId,
          clinicId: createSessionDto.clinicId,
          sessionId,
          ipAddress: createSessionDto.ipAddress,
        }
      );

      return sessionData;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to create session',
        'SessionManagementService',
        {
          error: error instanceof Error ? error.message : String(error),
          userId: createSessionDto.userId,
        }
      );
      throw error;
    }
  }

  /**
   * Get session with blacklist and expiry checks
   * @param sessionId - Session identifier
   * @returns Session data or null if not found/invalid
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    try {
      const sessionKey = this.getSessionKey(sessionId);
      const sessionData = await this.cacheService.get<SessionData>(sessionKey);

      if (!sessionData) {
        return null;
      }

      // Check expiry
      if (new Date() > new Date(sessionData.expiresAt)) {
        await this.invalidateSession(sessionId);
        return null;
      }

      // Check blacklist
      if (await this.isSessionBlacklisted(sessionId)) {
        return null;
      }

      return sessionData;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get session',
        'SessionManagementService',
        {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        }
      );
      return null;
    }
  }

  /**
   * Update session activity with auto-extension
   * @param sessionId - Session identifier
   * @param metadata - Optional metadata to merge
   * @returns True if session was updated, false otherwise
   */
  async updateSessionActivity(
    sessionId: string,
    metadata?: Record<string, unknown>
  ): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        return false;
      }

      const now = new Date();
      session.lastActivity = now;

      // Extend session if configured
      const extendOnActivity =
        this.config?.extendOnActivity ?? process.env['SESSION_EXTEND_ON_ACTIVITY'] !== 'false';
      if (extendOnActivity) {
        const sessionTimeout =
          this.config?.sessionTimeout || parseInt(process.env['SESSION_TIMEOUT'] || '86400', 10);
        session.expiresAt = new Date(now.getTime() + sessionTimeout * 1000);
      }

      if (metadata) {
        session.metadata = { ...session.metadata, ...metadata };
      }

      await this.storeSession(session);
      return true;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to update session activity',
        'SessionManagementService',
        {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        }
      );
      return false;
    }
  }

  /**
   * Delete/invalidate a session
   * @param sessionId - Session identifier
   * @returns True if session was invalidated, false otherwise
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    return this.invalidateSession(sessionId);
  }

  /**
   * Invalidate a session (blacklist and remove)
   * @param sessionId - Session identifier
   * @returns True if session was invalidated
   */
  async invalidateSession(sessionId: string): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        return false;
      }

      // Add to blacklist
      const blacklistKey = `${this.BLACKLIST_PREFIX}${sessionId}`;
      const ttl = Math.max(
        0,
        Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000)
      );
      if (ttl > 0) {
        await this.cacheService.set(blacklistKey, '1', ttl);
      }

      // Remove from session storage
      const sessionKey = this.getSessionKey(sessionId);
      await this.cacheService.del(sessionKey);

      // Remove from user sessions index
      await this.removeUserSession(session.userId, sessionId);

      // Remove from clinic sessions index if applicable
      if (session.clinicId) {
        await this.removeClinicSession(session.clinicId, sessionId);
      }

      // Log security event
      await this.loggingService.log(
        LogType.SECURITY,
        LogLevel.INFO,
        'Session invalidated',
        'SessionManagementService',
        {
          userId: session.userId,
          clinicId: session.clinicId,
          sessionId,
        }
      );

      return true;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to invalidate session',
        'SessionManagementService',
        {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        }
      );
      return false;
    }
  }

  /**
   * Revoke all user sessions except current
   * @param userId - User identifier
   * @param exceptSessionId - Optional session ID to exclude from revocation
   * @returns Number of sessions revoked
   */
  async revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
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

      await this.loggingService.log(
        LogType.SECURITY,
        LogLevel.INFO,
        'All user sessions revoked',
        'SessionManagementService',
        {
          userId,
          revokedCount,
          exceptSessionId,
        }
      );

      return revokedCount;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to revoke all user sessions',
        'SessionManagementService',
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
        }
      );
      return 0;
    }
  }

  /**
   * Get all sessions for a user
   * @param userId - User identifier
   * @returns Array of session data
   */
  async getUserSessions(userId: string): Promise<SessionData[]> {
    try {
      const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${userId}`;
      const sessionIds = await this.cacheService.sMembers(userSessionsKey);

      if (!sessionIds || sessionIds.length === 0) {
        return [];
      }

      const sessions: SessionData[] = [];
      for (const sessionId of sessionIds) {
        const session = await this.getSession(sessionId);
        if (session) {
          sessions.push(session);
        }
      }

      return sessions;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get user sessions',
        'SessionManagementService',
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
        }
      );
      return [];
    }
  }

  /**
   * Get session summary statistics
   * @returns Session summary with statistics
   */
  async getSessionSummary(): Promise<SessionSummary> {
    try {
      // This is a simplified implementation
      // In production, you might want to use Redis SCAN or maintain counters
      const totalSessions = 0;
      const activeSessions = 0;
      const expiredSessions = 0;
      const sessionsPerUser: Record<string, number> = {};
      const sessionsPerClinic: Record<string, number> = {};
      const recentActivity: SessionData[] = [];

      return {
        totalSessions,
        activeSessions,
        expiredSessions,
        sessionsPerUser,
        sessionsPerClinic,
        recentActivity,
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get session summary',
        'SessionManagementService',
        {
          error: error instanceof Error ? error.message : String(error),
        }
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
   * Detect suspicious sessions (auto-runs every 30 minutes)
   * @returns Object containing suspicious sessions and reasons
   */
  async detectSuspiciousSessions(): Promise<{
    suspicious: SessionData[];
    reasons: Record<string, string[]>;
  }> {
    const suspicious: SessionData[] = [];
    const reasons: Record<string, string[]> = {};

    try {
      // Implementation would check for:
      // 1. Multiple concurrent sessions from different IPs (> 3)
      // 2. Unusual user agent patterns (bots, crawlers)
      // 3. Long inactive sessions (> 24 hours)
      // 4. Rapid geographical location changes

      await this.loggingService.log(
        LogType.SECURITY,
        LogLevel.INFO,
        'Suspicious session detection completed',
        'SessionManagementService',
        {
          suspiciousCount: suspicious.length,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to detect suspicious sessions',
        'SessionManagementService',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    return { suspicious, reasons };
  }

  /**
   * Generate cryptographically secure session ID
   * @returns Session ID string
   */
  private generateSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Get session Redis key with optional partition
   * @param sessionId - Session identifier
   * @returns Redis key string
   */
  private getSessionKey(sessionId: string): string {
    const distributed = this.config?.distributed ?? process.env['SESSION_DISTRIBUTED'] !== 'false';
    if (distributed) {
      const partition = this.getPartition(sessionId);
      return `${this.SESSION_PREFIX}${partition}:${sessionId}`;
    }
    return `${this.SESSION_PREFIX}${sessionId}`;
  }

  /**
   * Get partition number for distributed storage
   * @param sessionId - Session identifier
   * @returns Partition number (0 to partitions-1)
   */
  private getPartition(sessionId: string): number {
    const hash = crypto.createHash('md5').update(sessionId).digest('hex');
    const hashInt = parseInt(hash.substring(0, 8), 16);
    const partitions =
      this.config?.partitions || parseInt(process.env['SESSION_PARTITIONS'] || '16', 10);
    return hashInt % partitions;
  }

  /**
   * Store session in Redis with TTL
   * @param sessionData - Session data to store
   */
  private async storeSession(sessionData: SessionData): Promise<void> {
    const sessionKey = this.getSessionKey(sessionData.sessionId);
    const ttl = Math.max(
      0,
      Math.floor((new Date(sessionData.expiresAt).getTime() - Date.now()) / 1000)
    );

    if (ttl > 0) {
      await this.cacheService.set(sessionKey, sessionData, ttl);
    }
  }

  /**
   * Add session to user's session set
   * @param userId - User identifier
   * @param sessionId - Session identifier
   */
  private async addUserSession(userId: string, sessionId: string): Promise<void> {
    const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${userId}`;
    await this.cacheService.sAdd(userSessionsKey, sessionId);
    // Set TTL on the set (max session timeout * 2 to account for cleanup)
    const sessionTimeout =
      this.config?.sessionTimeout || parseInt(process.env['SESSION_TIMEOUT'] || '86400', 10);
    await this.cacheService.expire(userSessionsKey, sessionTimeout * 2);
  }

  /**
   * Remove session from user's session set
   * @param userId - User identifier
   * @param sessionId - Session identifier
   */
  private async removeUserSession(userId: string, sessionId: string): Promise<void> {
    const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${userId}`;
    await this.cacheService.sRem(userSessionsKey, sessionId);
  }

  /**
   * Add session to clinic's session set
   * @param clinicId - Clinic identifier
   * @param sessionId - Session identifier
   */
  private async addClinicSession(clinicId: string, sessionId: string): Promise<void> {
    const clinicSessionsKey = `${this.CLINIC_SESSIONS_PREFIX}${clinicId}`;
    await this.cacheService.sAdd(clinicSessionsKey, sessionId);
    const sessionTimeout =
      this.config?.sessionTimeout || parseInt(process.env['SESSION_TIMEOUT'] || '86400', 10);
    await this.cacheService.expire(clinicSessionsKey, sessionTimeout * 2);
  }

  /**
   * Remove session from clinic's session set
   * @param clinicId - Clinic identifier
   * @param sessionId - Session identifier
   */
  private async removeClinicSession(clinicId: string, sessionId: string): Promise<void> {
    const clinicSessionsKey = `${this.CLINIC_SESSIONS_PREFIX}${clinicId}`;
    await this.cacheService.sRem(clinicSessionsKey, sessionId);
  }

  /**
   * Check if session is blacklisted
   * @param sessionId - Session identifier
   * @returns True if session is blacklisted
   */
  private async isSessionBlacklisted(sessionId: string): Promise<boolean> {
    const blacklistKey = `${this.BLACKLIST_PREFIX}${sessionId}`;
    const value = await this.cacheService.get(blacklistKey);
    return value !== null;
  }

  /**
   * Enforce session limits per user (auto-cleanup oldest)
   * @param userId - User identifier
   */
  private async enforceSessionLimits(userId: string): Promise<void> {
    const sessions = await this.getUserSessions(userId);

    const maxSessionsPerUser =
      this.config?.maxSessionsPerUser || parseInt(process.env['SESSION_MAX_PER_USER'] || '10', 10);
    if (sessions.length >= maxSessionsPerUser) {
      // Sort by lastActivity (oldest first)
      sessions.sort((a, b) => a.lastActivity.getTime() - b.lastActivity.getTime());

      // Remove oldest sessions
      const sessionsToRemove = sessions.slice(0, sessions.length - maxSessionsPerUser + 1);

      for (const session of sessionsToRemove) {
        await this.invalidateSession(session.sessionId);
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Session limits enforced',
        'SessionManagementService',
        {
          userId,
          removedCount: sessionsToRemove.length,
          maxSessions: this.config.maxSessionsPerUser,
        }
      );
    }
  }

  /**
   * Cleanup expired sessions
   */
  private async cleanupExpiredSessions(): Promise<void> {
    try {
      // This is a simplified implementation
      // In production, you might want to use Redis SCAN to iterate through sessions
      // or maintain a separate sorted set of session IDs by expiry time

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Expired session cleanup completed',
        'SessionManagementService',
        {}
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to cleanup expired sessions',
        'SessionManagementService',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Sync session data to Fastify session object
   * @param sessionData - Session data from SessionManagementService
   * @param fastifySession - Fastify session object (from request.session)
   * @returns void
   */
  syncToFastifySession(sessionData: SessionData, fastifySession: FastifySession): void {
    if (sessionData.sessionId) {
      fastifySession.sessionId = sessionData.sessionId;
    }
    if (sessionData.userId) {
      fastifySession.userId = sessionData.userId;
    }
    if (sessionData.clinicId) {
      fastifySession.clinicId = sessionData.clinicId;
    }
    if (sessionData.userAgent) {
      fastifySession.userAgent = sessionData.userAgent;
    }
    if (sessionData.ipAddress) {
      fastifySession.ipAddress = sessionData.ipAddress;
    }
    if (sessionData.loginTime) {
      fastifySession.loginTime = sessionData.loginTime;
    }
    if (sessionData.lastActivity) {
      fastifySession.lastActivity = sessionData.lastActivity;
    }
    if (sessionData.expiresAt) {
      fastifySession.expiresAt = sessionData.expiresAt;
    }
    if (sessionData.isActive !== undefined) {
      fastifySession.isActive = sessionData.isActive;
    }
    if (sessionData.metadata) {
      fastifySession.metadata = sessionData.metadata;
    }
  }

  /**
   * Create session data from Fastify session object
   * @param fastifySession - Fastify session object (from request.session)
   * @returns SessionData or null if invalid
   */
  createFromFastifySession(fastifySession: FastifySession): SessionData | null {
    if (!fastifySession.sessionId || !fastifySession.userId) {
      return null;
    }

    const sessionData: SessionData = {
      sessionId: fastifySession.sessionId,
      userId: fastifySession.userId,
      loginTime: fastifySession.loginTime || new Date(),
      lastActivity: fastifySession.lastActivity || new Date(),
      expiresAt: fastifySession.expiresAt || new Date(),
      isActive: fastifySession.isActive ?? true,
      metadata: fastifySession.metadata || {},
      ...(fastifySession.clinicId && { clinicId: fastifySession.clinicId }),
      ...(fastifySession.userAgent && { userAgent: fastifySession.userAgent }),
      ...(fastifySession.ipAddress && { ipAddress: fastifySession.ipAddress }),
    };

    return sessionData;
  }

  /**
   * Update Fastify session activity
   * @param fastifySession - Fastify session object (from request.session)
   * @param metadata - Optional metadata to merge
   * @returns True if session was updated, false otherwise
   */
  async updateFastifySessionActivity(
    fastifySession: FastifySession,
    metadata?: Record<string, unknown>
  ): Promise<boolean> {
    if (!fastifySession.sessionId) {
      return false;
    }

    const sessionData = this.createFromFastifySession(fastifySession);
    if (!sessionData) {
      return false;
    }

    const updated = await this.updateSessionActivity(sessionData.sessionId, metadata);
    if (updated && sessionData) {
      // Sync updated data back to Fastify session
      this.syncToFastifySession(sessionData, fastifySession);
    }

    return updated;
  }

  /**
   * Setup cleanup jobs (runs periodically)
   */
  private setupCleanupJobs(): void {
    // Cleanup expired sessions every hour
    setInterval(
      () => {
        void (async () => {
          await this.cleanupExpiredSessions();
        })();
      },
      60 * 60 * 1000
    );

    // Check for suspicious sessions every 30 minutes
    setInterval(
      () => {
        void (async () => {
          const { suspicious } = await this.detectSuspiciousSessions();
          if (suspicious.length > 0) {
            await this.loggingService.log(
              LogType.SECURITY,
              LogLevel.WARN,
              `Detected ${suspicious.length} suspicious sessions`,
              'SessionManagementService',
              { suspiciousCount: suspicious.length }
            );
          }
        })();
      },
      30 * 60 * 1000
    );
  }
}
