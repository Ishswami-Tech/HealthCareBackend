import { Injectable, Logger, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { RedisService } from '../../../shared/cache/redis/redis.service';
import { LoggingService } from '../../../shared/logging/logging.service';
import { LogLevel, LogType } from '../../../shared/logging/types/logging.types';

/**
 * Interface representing session information
 * @interface SessionInfo
 */
export interface SessionInfo {
  sessionId: string;
  userId: string;
  deviceInfo: {
    deviceId: string;
    userAgent: string;
    platform: string;
    browser: string;
  };
  ipAddress: string;
  createdAt: Date;
  lastActivityAt: Date;
  isActive: boolean;
  refreshToken?: string;
  expiresAt?: Date;
}

/**
 * Service responsible for managing user sessions
 * @class SessionService
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly SESSION_TTL = 24 * 60 * 60; // 24 hours
  private readonly DEVICE_TTL = 30 * 24 * 60 * 60; // 30 days
  private readonly MAX_SESSIONS_PER_USER = 5;
  private readonly INACTIVE_SESSION_THRESHOLD = 7 * 24 * 60 * 60; // 7 days

  constructor(
    private readonly redisService: RedisService,
    private readonly loggingService: LoggingService
  ) {
    this.startSessionCleanupJob();
  }

  /**
   * Creates a new session for a user
   * @param sessionInfo - Session information to create
   * @throws {InternalServerErrorException} If session creation fails
   */
  async createSession(sessionInfo: SessionInfo): Promise<void> {
    try {
      const { sessionId, userId, deviceInfo } = sessionInfo;

      // Check active sessions count
      const activeSessions = await this.getActiveSessions(userId);
      if (activeSessions.length >= this.MAX_SESSIONS_PER_USER) {
        // Remove oldest session
        const oldestSession = activeSessions[0];
        await this.terminateSession(userId, oldestSession.sessionId);
      }

      // Store session data with expiry
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + this.SESSION_TTL);

      const sessionData = {
        ...sessionInfo,
        expiresAt,
        isActive: true
      };

      await Promise.all([
        this.redisService.set(
          `session:${userId}:${sessionId}`,
          JSON.stringify(sessionData),
          this.SESSION_TTL
        ),
        this.redisService.sAdd(
          `user:${userId}:sessions`,
          sessionId
        ),
        this.redisService.set(
          `device:${userId}:${deviceInfo.deviceId}`,
          JSON.stringify({
            ...deviceInfo,
            lastSeen: new Date(),
            sessionId
          }),
          this.DEVICE_TTL
        )
      ]);

      await this.loggingService.log(
        LogType.AUTH,
        LogLevel.INFO,
        'New session created',
        'SessionService',
        { userId, sessionId, deviceInfo: deviceInfo.deviceId }
      );
    } catch (error) {
      this.logger.error(`Failed to create session: ${error.message}`);
      throw new InternalServerErrorException('Failed to create session');
    }
  }

  /**
   * Gets all active sessions for a user
   * @param userId - User ID to get sessions for
   * @returns Array of active sessions
   */
  async getActiveSessions(userId: string): Promise<SessionInfo[]> {
    try {
      const sessionIds = await this.redisService.sMembers(`user:${userId}:sessions`);
      const sessions: SessionInfo[] = [];

      for (const sessionId of sessionIds) {
        const sessionData = await this.redisService.get(`session:${userId}:${sessionId}`);
        if (sessionData) {
          const session = JSON.parse(sessionData);
          if (session.isActive) {
            sessions.push(session);
          }
        }
      }

      return sessions.sort((a, b) => 
        new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
      );
    } catch (error) {
      this.logger.error(`Failed to get active sessions: ${error.message}`);
      throw new InternalServerErrorException('Failed to retrieve sessions');
    }
  }

  /**
   * Updates session activity timestamp
   * @param userId - User ID of the session
   * @param sessionId - Session ID to update
   * @throws {UnauthorizedException} If session not found
   */
  async updateSessionActivity(userId: string, sessionId: string): Promise<void> {
    try {
      const sessionKey = `session:${userId}:${sessionId}`;
      const sessionData = await this.redisService.get(sessionKey);

      if (!sessionData) {
        throw new UnauthorizedException('Session not found');
      }

      const session = JSON.parse(sessionData);
      if (!session.isActive) {
        throw new UnauthorizedException('Session is inactive');
      }

      session.lastActivityAt = new Date();

      await Promise.all([
        this.redisService.set(
          sessionKey,
          JSON.stringify(session),
          this.SESSION_TTL
        ),
        this.updateDeviceLastSeen(userId, session.deviceInfo.deviceId)
      ]);
    } catch (error) {
      this.logger.error(`Failed to update session activity: ${error.message}`);
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to update session');
    }
  }

  /**
   * Terminates a specific session
   * @param userId - User ID of the session
   * @param sessionId - Session ID to terminate
   */
  async terminateSession(userId: string, sessionId: string): Promise<void> {
    try {
      const sessionKey = `session:${userId}:${sessionId}`;
      const sessionData = await this.redisService.get(sessionKey);

      if (sessionData) {
        const session = JSON.parse(sessionData);
        session.isActive = false;
        
        await Promise.all([
          this.redisService.set(
            sessionKey,
            JSON.stringify(session),
            300 // Keep for 5 minutes for audit
          ),
          this.redisService.sRem(`user:${userId}:sessions`, sessionId),
          this.updateDeviceStatus(userId, session.deviceInfo.deviceId, 'logged_out')
        ]);

        await this.loggingService.log(
          LogType.AUTH,
          LogLevel.INFO,
          'Session terminated',
          'SessionService',
          { userId, sessionId, deviceId: session.deviceInfo.deviceId }
        );
      }
    } catch (error) {
      this.logger.error(`Failed to terminate session: ${error.message}`);
      throw new InternalServerErrorException('Failed to terminate session');
    }
  }

  /**
   * Terminates all sessions for a user
   * @param userId - User ID to terminate all sessions for
   */
  async terminateAllSessions(userId: string): Promise<void> {
    try {
      const sessions = await this.getActiveSessions(userId);
      await Promise.all(
        sessions.map(session => this.terminateSession(userId, session.sessionId))
      );

      await this.loggingService.log(
        LogType.AUTH,
        LogLevel.INFO,
        'All sessions terminated',
        'SessionService',
        { userId, sessionCount: sessions.length }
      );
    } catch (error) {
      this.logger.error(`Failed to terminate all sessions: ${error.message}`);
      throw new InternalServerErrorException('Failed to terminate all sessions');
    }
  }

  /**
   * Validates a session
   * @param userId - User ID of the session
   * @param sessionId - Session ID to validate
   * @returns boolean indicating if session is valid
   */
  async validateSession(userId: string, sessionId: string): Promise<boolean> {
    try {
      const sessionKey = `session:${userId}:${sessionId}`;
      const sessionData = await this.redisService.get(sessionKey);

      if (!sessionData) {
        return false;
      }

      const session = JSON.parse(sessionData);
      return session.isActive && new Date() < new Date(session.expiresAt);
    } catch (error) {
      this.logger.error(`Failed to validate session: ${error.message}`);
      return false;
    }
  }

  private async updateDeviceLastSeen(userId: string, deviceId: string): Promise<void> {
    const deviceKey = `device:${userId}:${deviceId}`;
    const deviceData = await this.redisService.get(deviceKey);
    
    if (deviceData) {
      const device = JSON.parse(deviceData);
      await this.redisService.set(
        deviceKey,
        JSON.stringify({
          ...device,
          lastSeen: new Date()
        }),
        this.DEVICE_TTL
      );
    }
  }

  private async updateDeviceStatus(userId: string, deviceId: string, status: string): Promise<void> {
    const deviceKey = `device:${userId}:${deviceId}`;
    const deviceData = await this.redisService.get(deviceKey);
    
    if (deviceData) {
      const device = JSON.parse(deviceData);
      await this.redisService.set(
        deviceKey,
        JSON.stringify({
          ...device,
          lastSeen: new Date(),
          status
        }),
        this.DEVICE_TTL
      );
    }
  }

  private startSessionCleanupJob(): void {
    setInterval(async () => {
      try {
        await this.cleanupInactiveSessions();
      } catch (error) {
        this.logger.error(`Session cleanup failed: ${error.message}`);
      }
    }, 24 * 60 * 60 * 1000); // Run daily
  }

  private async cleanupInactiveSessions(): Promise<void> {
    const pattern = 'session:*';
    const keys = await this.redisService.keys(pattern);
    
    for (const key of keys) {
      try {
        const sessionData = await this.redisService.get(key);
        if (sessionData) {
          const session = JSON.parse(sessionData);
          const lastActivity = new Date(session.lastActivityAt).getTime();
          const now = Date.now();
          
          if (now - lastActivity > this.INACTIVE_SESSION_THRESHOLD * 1000) {
            const [_, userId, sessionId] = key.split(':');
            await this.terminateSession(userId, sessionId);
          }
        }
      } catch (error) {
        this.logger.error(`Failed to cleanup session ${key}: ${error.message}`);
      }
    }
  }
} 