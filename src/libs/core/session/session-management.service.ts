import { Injectable, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
// Import directly from database.service to avoid TDZ circular dependency with barrel (@infrastructure/database)
// Barrel loads DatabaseModule + database-service.export; when JwtAuthGuard->SessionManagementService
// loads the barrel, _databaseserviceexport can be uninitialized. Direct import breaks the cycle.
// NOTE: DatabaseService is marked @Optional() because it's not actually used in this service
// but was injected for potential future use. Making it optional prevents initialization blocking.
import { DatabaseService } from '@infrastructure/database/database.service';
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
  private readonly SESSION_META_PREFIX = 'session_meta:';
  private readonly SESSION_REGISTRY_KEY = 'session_registry:all';
  private readonly SESSION_EXPIRY_INDEX_KEY = 'session_index:expires';
  private readonly SESSION_ACTIVITY_INDEX_KEY = 'session_index:activity';

  private config!: SessionConfig;

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @Optional() private readonly databaseService?: DatabaseService
  ) {}

  /**
   * Initialize session management configuration
   */
  async onModuleInit(): Promise<void> {
    // Use ConfigService (which uses dotenv) for all environment variable access
    this.config = {
      maxSessionsPerUser: this.configService.getEnvNumber('SESSION_MAX_PER_USER', 10),
      sessionTimeout: this.configService.getEnvNumber('SESSION_TIMEOUT', 86400), // 24 hours
      extendOnActivity: this.configService.getEnvBoolean('SESSION_EXTEND_ON_ACTIVITY', true),
      secureCookies: this.configService.getEnvBoolean('SESSION_SECURE_COOKIES', true),
      sameSite: (this.configService.getEnv('SESSION_SAME_SITE', 'strict') || 'strict') as
        'strict' | 'lax' | 'none',
      distributed: this.configService.getEnvBoolean('SESSION_DISTRIBUTED', true),
      partitions: this.configService.getEnvNumber('SESSION_PARTITIONS', 16),
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
    // Use ConfigService (which uses dotenv) for environment variable access
    const sessionTimeout =
      this.config?.sessionTimeout || this.configService.getEnvNumber('SESSION_TIMEOUT', 86400);

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
      // IMPORTANT: enforceSessionLimits is called here AND in restoreSession() to keep
      // both creation paths consistent with the configured SESSION_MAX_PER_USER limit.
      await this.enforceSessionLimits(createSessionDto.userId);

      // 2. Store session with distributed partitioning
      await this.storeSession(sessionData);
      await this.persistSessionState(sessionData);

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
   * Restore an existing session id back into cache when cache was lost (e.g. Redis restart)
   * but JWT/session token is still valid.
   */
  async restoreSession(
    sessionId: string,
    restoreDto: {
      userId: string;
      clinicId?: string;
      userAgent?: string;
      ipAddress?: string;
      expiresAt?: Date;
      metadata?: Record<string, unknown>;
    }
  ): Promise<SessionData> {
    const existing = await this.getSession(sessionId);
    if (existing) {
      return existing;
    }

    // HIGH-1 FIX: Enforce session limits before restoring a session.
    // restoreSession() is triggered on cold-cache (Redis restart) by JwtAuthGuard.
    // Without this call, each cache miss would add a new entry to the user_sessions Set
    // without removing old ones, causing the concurrent-session count to grow unboundedly
    // and trigger 429 errors even for users with a single legitimate session.
    await this.enforceSessionLimits(restoreDto.userId);

    // Use ConfigService (which uses dotenv) for environment variable access
    const sessionTimeout =
      this.config?.sessionTimeout || this.configService.getEnvNumber('SESSION_TIMEOUT', 86400);
    const now = new Date();
    const expiresAt =
      restoreDto.expiresAt && restoreDto.expiresAt.getTime() > now.getTime()
        ? restoreDto.expiresAt
        : new Date(now.getTime() + sessionTimeout * 1000);

    const restoredSession: SessionData = {
      sessionId,
      userId: restoreDto.userId,
      ...(restoreDto.clinicId && { clinicId: restoreDto.clinicId }),
      ...(restoreDto.userAgent && { userAgent: restoreDto.userAgent }),
      ...(restoreDto.ipAddress && { ipAddress: restoreDto.ipAddress }),
      loginTime: now,
      lastActivity: now,
      expiresAt,
      isActive: true,
      metadata: {
        source: 'session-restore',
        ...(restoreDto.metadata || {}),
      },
    };

    await this.storeSession(restoredSession);
    await this.persistSessionState(restoredSession);
    await this.addUserSession(restoreDto.userId, sessionId);
    if (restoreDto.clinicId) {
      await this.addClinicSession(restoreDto.clinicId, sessionId);
    }

    await this.loggingService.log(
      LogType.SECURITY,
      LogLevel.WARN,
      'Session restored after cache miss',
      'SessionManagementService',
      {
        sessionId,
        userId: restoreDto.userId,
        clinicId: restoreDto.clinicId,
      }
    );

    return restoredSession;
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
      // Use ConfigService (which uses dotenv) for environment variable access
      const extendOnActivity =
        this.config?.extendOnActivity ??
        this.configService.getEnvBoolean('SESSION_EXTEND_ON_ACTIVITY', true);
      if (extendOnActivity) {
        // Use ConfigService (which uses dotenv) for environment variable access
        const sessionTimeout =
          this.config?.sessionTimeout || this.configService.getEnvNumber('SESSION_TIMEOUT', 86400);
        session.expiresAt = new Date(now.getTime() + sessionTimeout * 1000);
      }

      if (metadata) {
        session.metadata = { ...session.metadata, ...metadata };
      }

      await this.storeSession(session);
      await this.persistSessionState(session);
      await this.addUserSession(session.userId, session.sessionId);
      if (session.clinicId) {
        await this.addClinicSession(session.clinicId, session.sessionId);
      }
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
      await this.removeSessionState(sessionId);

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
      const staleIds: string[] = [];

      for (const sessionId of sessionIds) {
        const session = await this.getSession(sessionId);
        if (session) {
          sessions.push(session);
        } else {
          // CRIT-2 FIX: Collect ghost/expired session IDs so we can prune them.
          // The individual session key in Redis has already expired (or was blacklisted),
          // but the ID remains in this user_sessions Set indefinitely, inflating the
          // concurrent-session count and triggering false 429 errors.
          staleIds.push(sessionId);
        }
      }

      // Prune all stale IDs from the user's session Set in one pass.
      // Fire-and-forget — pruning failure is non-critical and should not block the caller.
      if (staleIds.length > 0) {
        void Promise.all(staleIds.map(id => this.removeUserSession(userId, id))).catch(
          async (err: unknown) => {
            await this.loggingService.log(
              LogType.ERROR,
              LogLevel.WARN,
              'Failed to prune stale session IDs from user session Set',
              'SessionManagementService',
              {
                userId,
                staleCount: staleIds.length,
                error: err instanceof Error ? err.message : String(err),
              }
            );
          }
        );
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
      const now = Date.now();
      const sessions = await this.collectStoredSessions();
      const activeSessionsList = sessions.filter(
        session => session.isActive && session.expiresAt.getTime() > now
      );
      const sessionsPerUser: Record<string, number> = {};
      const sessionsPerClinic: Record<string, number> = {};

      for (const session of activeSessionsList) {
        sessionsPerUser[session.userId] = (sessionsPerUser[session.userId] || 0) + 1;
        if (session.clinicId) {
          sessionsPerClinic[session.clinicId] = (sessionsPerClinic[session.clinicId] || 0) + 1;
        }
      }

      const recentActivity = [...activeSessionsList]
        .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime())
        .slice(0, 10);

      return {
        totalSessions: sessions.length,
        activeSessions: activeSessionsList.length,
        expiredSessions: Math.max(0, sessions.length - activeSessionsList.length),
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
    try {
      const sessions = await this.collectStoredSessions();
      const suspiciousReasons = new Map<string, Set<string>>();
      const suspiciousSessions = new Map<string, SessionData>();
      const userAgentPattern =
        /(bot|crawler|spider|scrapy|headless|curl|wget|python-requests|postman|okhttp|libwww-perl)/i;
      const inactiveThresholdMs = 24 * 60 * 60 * 1000;
      const rapidChangeWindowMs = 60 * 60 * 1000;
      const sessionsByUser = new Map<string, SessionData[]>();

      const markSuspicious = (session: SessionData, reason: string): void => {
        suspiciousSessions.set(session.sessionId, session);
        const current = suspiciousReasons.get(session.sessionId) ?? new Set<string>();
        current.add(reason);
        suspiciousReasons.set(session.sessionId, current);
      };

      for (const session of sessions) {
        const userId = session.userId?.trim();
        if (!userId) {
          continue;
        }

        const userSessions = sessionsByUser.get(userId) ?? [];
        userSessions.push(session);
        sessionsByUser.set(userId, userSessions);
      }

      for (const sessionsForUser of sessionsByUser.values()) {
        const sessionsWithIp = sessionsForUser.filter(session => session.ipAddress);
        const distinctIps = new Set(sessionsWithIp.map(session => session.ipAddress as string));
        if (distinctIps.size > 3) {
          for (const session of sessionsWithIp) {
            markSuspicious(session, 'Multiple concurrent sessions from different IP addresses');
          }
        }

        for (const session of sessionsForUser) {
          if (session.userAgent && userAgentPattern.test(session.userAgent)) {
            markSuspicious(session, 'Suspicious user agent pattern detected');
          }

          if (Date.now() - session.lastActivity.getTime() > inactiveThresholdMs) {
            markSuspicious(session, 'Session has been inactive for more than 24 hours');
          }
        }

        const recentSessions = sessionsWithIp
          .filter(session => Date.now() - session.lastActivity.getTime() <= rapidChangeWindowMs)
          .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

        if (recentSessions.length >= 3) {
          const recentIps = new Set(recentSessions.map(session => session.ipAddress as string));
          if (recentIps.size >= 3) {
            for (const session of recentSessions) {
              markSuspicious(session, 'Rapid IP changes detected within a short period');
            }
          }
        }
      }

      return {
        suspicious: [...suspiciousSessions.values()].sort(
          (a, b) => b.lastActivity.getTime() - a.lastActivity.getTime()
        ),
        reasons: Object.fromEntries(
          [...suspiciousReasons.entries()].map(([sessionId, reasons]) => [sessionId, [...reasons]])
        ),
      };
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
      return { suspicious: [], reasons: {} };
    }
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
    // Use ConfigService (which uses dotenv) for environment variable access
    const distributed =
      this.config?.distributed ?? this.configService.getEnvBoolean('SESSION_DISTRIBUTED', true);
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
    // Use ConfigService (which uses dotenv) for environment variable access
    const partitions =
      this.config?.partitions || this.configService.getEnvNumber('SESSION_PARTITIONS', 16);
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
    // Use ConfigService (which uses dotenv) for environment variable access
    const sessionTimeout =
      this.config?.sessionTimeout || this.configService.getEnvNumber('SESSION_TIMEOUT', 86400);
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
    // Use ConfigService (which uses dotenv) for environment variable access
    const sessionTimeout =
      this.config?.sessionTimeout || this.configService.getEnvNumber('SESSION_TIMEOUT', 86400);
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
   * Get metadata key for a session.
   */
  private getSessionMetaKey(sessionId: string): string {
    return `${this.SESSION_META_PREFIX}${sessionId}`;
  }

  /**
   * Normalize session data read back from cache.
   */
  private normalizeSessionData(
    raw:
      | Partial<SessionData>
      | null
      | undefined
      | {
          sessionId?: string;
          userId?: string;
          loginTime?: string | Date;
          lastActivity?: string | Date;
          expiresAt?: string | Date;
          isActive?: boolean;
          metadata?: Record<string, unknown>;
          clinicId?: string;
          userAgent?: string;
          ipAddress?: string;
          deviceId?: string;
        }
  ): SessionData | null {
    if (!raw || !raw.sessionId || !raw.userId) {
      return null;
    }

    const toDate = (value: unknown, fallback?: Date): Date | null => {
      if (value instanceof Date) {
        return value;
      }
      if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
      return fallback ?? null;
    };

    const loginTime = toDate(raw.loginTime, new Date()) ?? new Date();
    const lastActivity = toDate(raw.lastActivity, loginTime) ?? loginTime;
    const expiresAt = toDate(raw.expiresAt, loginTime) ?? loginTime;

    return {
      sessionId: raw.sessionId,
      userId: raw.userId,
      ...(raw.clinicId && { clinicId: raw.clinicId }),
      ...(raw.userAgent && { userAgent: raw.userAgent }),
      ...(raw.ipAddress && { ipAddress: raw.ipAddress }),
      ...(raw.deviceId && { deviceId: raw.deviceId }),
      loginTime,
      lastActivity,
      expiresAt,
      isActive: raw.isActive ?? true,
      metadata: raw.metadata && typeof raw.metadata === 'object' ? { ...raw.metadata } : {},
    };
  }

  /**
   * Read a session record from the metadata index or live session payload.
   */
  private async readStoredSession(sessionId: string): Promise<SessionData | null> {
    const liveSessionKey = this.getSessionKey(sessionId);
    const liveSession = await this.cacheService.get<SessionData>(liveSessionKey);
    const normalizedLive = this.normalizeSessionData(liveSession);
    if (normalizedLive) {
      return normalizedLive;
    }

    const metaKey = this.getSessionMetaKey(sessionId);
    const storedMeta = await this.cacheService.get<SessionData>(metaKey);
    return this.normalizeSessionData(storedMeta);
  }

  /**
   * Persist bookkeeping data for a session.
   */
  private async persistSessionState(sessionData: SessionData): Promise<void> {
    await Promise.all([
      this.cacheService.set(this.getSessionMetaKey(sessionData.sessionId), sessionData),
      this.cacheService.sAdd(this.SESSION_REGISTRY_KEY, sessionData.sessionId),
      this.cacheService.zadd(
        this.SESSION_EXPIRY_INDEX_KEY,
        sessionData.expiresAt.getTime(),
        sessionData.sessionId
      ),
      this.cacheService.zadd(
        this.SESSION_ACTIVITY_INDEX_KEY,
        sessionData.lastActivity.getTime(),
        sessionData.sessionId
      ),
    ]);
  }

  /**
   * Remove bookkeeping data for a session.
   */
  private async removeSessionState(sessionId: string): Promise<void> {
    await Promise.all([
      this.cacheService.sRem(this.SESSION_REGISTRY_KEY, sessionId),
      this.cacheService.zrem(this.SESSION_EXPIRY_INDEX_KEY, sessionId),
      this.cacheService.zrem(this.SESSION_ACTIVITY_INDEX_KEY, sessionId),
      this.cacheService.del(this.getSessionMetaKey(sessionId)),
    ]);
  }

  /**
   * Load all currently tracked sessions for reporting.
   */
  private async collectStoredSessions(): Promise<SessionData[]> {
    const sessionIdList = await this.cacheService.sMembers(this.SESSION_REGISTRY_KEY);
    const sessionIds = new Set(sessionIdList);

    if (sessionIds.size === 0) {
      return [];
    }

    const staleIds: string[] = [];
    const sessions = await Promise.all(
      sessionIdList.map(async sessionId => this.readStoredSession(sessionId))
    );

    const activeSessions = sessions.filter((session): session is SessionData => session !== null);

    for (let index = 0; index < sessions.length; index += 1) {
      if (sessions[index] === null) {
        const sessionId = sessionIdList[index];
        if (sessionId) {
          staleIds.push(sessionId);
        }
      }
    }

    if (staleIds.length > 0) {
      void Promise.all(staleIds.map(sessionId => this.removeSessionState(sessionId))).catch(
        async (error: unknown) => {
          await this.loggingService.log(
            LogType.ERROR,
            LogLevel.WARN,
            'Failed to prune stale session registry entries',
            'SessionManagementService',
            {
              staleCount: staleIds.length,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      );
    }

    return activeSessions;
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

    // Use ConfigService (which uses dotenv) for environment variable access
    const maxSessionsPerUser =
      this.config?.maxSessionsPerUser ||
      this.configService.getEnvNumber('SESSION_MAX_PER_USER', 10);
    if (sessions.length >= maxSessionsPerUser) {
      // Sort by lastActivity (oldest first)
      // Ensure lastActivity is a Date object (may be string when deserialized from cache)
      sessions.sort((a, b) => {
        const aTime =
          a.lastActivity instanceof Date
            ? a.lastActivity.getTime()
            : new Date(a.lastActivity).getTime();
        const bTime =
          b.lastActivity instanceof Date
            ? b.lastActivity.getTime()
            : new Date(b.lastActivity).getTime();
        return aTime - bTime;
      });

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
      const now = Date.now();
      const expiredSessionIds = await this.cacheService.zrangebyscore(
        this.SESSION_EXPIRY_INDEX_KEY,
        '-inf',
        now
      );

      let cleanedCount = 0;
      let staleCount = 0;
      let refreshedCount = 0;

      for (const sessionId of expiredSessionIds) {
        const session = await this.readStoredSession(sessionId);

        if (session && session.expiresAt.getTime() <= now) {
          await Promise.all([
            this.cacheService.del(this.getSessionKey(sessionId)),
            this.removeUserSession(session.userId, sessionId),
            session.clinicId
              ? this.removeClinicSession(session.clinicId, sessionId)
              : Promise.resolve(),
            this.removeSessionState(sessionId),
          ]);
          cleanedCount++;
          continue;
        }

        if (session) {
          await this.persistSessionState(session);
          await this.addUserSession(session.userId, sessionId);
          if (session.clinicId) {
            await this.addClinicSession(session.clinicId, sessionId);
          }
          refreshedCount++;
          continue;
        }

        await Promise.all([
          this.cacheService.del(this.getSessionKey(sessionId)),
          this.removeSessionState(sessionId),
        ]);
        staleCount++;
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        'Periodic session cleanup tick',
        'SessionManagementService',
        {
          expiredCount: expiredSessionIds.length,
          cleanedCount,
          staleCount,
          refreshedCount,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to run session cleanup tick',
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
    // NOTE:
    // `@fastify/session` exposes `sessionId` as a read-only getter on the Session object.
    // Assigning to it throws: "Cannot set property sessionId of #<Session> which has only a getter".
    // Store our app session id under a separate key and use Reflect.set to avoid hard crashes
    // if any property is non-writable at runtime.
    const target = fastifySession as unknown as Record<string, unknown>;

    if (sessionData.sessionId) {
      // Keep Fastify's own session id intact; store our session id separately.
      Reflect.set(target, 'healthcareSessionId', sessionData.sessionId);
    }
    if (sessionData.userId) {
      Reflect.set(target, 'userId', sessionData.userId);
    }
    if (sessionData.clinicId) {
      Reflect.set(target, 'clinicId', sessionData.clinicId);
    }
    if (sessionData.userAgent) {
      Reflect.set(target, 'userAgent', sessionData.userAgent);
    }
    if (sessionData.ipAddress) {
      Reflect.set(target, 'ipAddress', sessionData.ipAddress);
    }
    if (sessionData.loginTime) {
      Reflect.set(target, 'loginTime', sessionData.loginTime);
    }
    if (sessionData.lastActivity) {
      Reflect.set(target, 'lastActivity', sessionData.lastActivity);
    }
    if (sessionData.expiresAt) {
      Reflect.set(target, 'expiresAt', sessionData.expiresAt);
    }
    if (sessionData.isActive !== undefined) {
      Reflect.set(target, 'isActive', sessionData.isActive);
    }
    if (sessionData.metadata) {
      Reflect.set(target, 'metadata', sessionData.metadata);
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
