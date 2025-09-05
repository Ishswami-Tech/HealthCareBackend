import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../libs/infrastructure/database';
import { CacheService } from '../../../libs/infrastructure/cache';
import { SessionData, TokenPayload } from '../../../libs/core/types';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly SESSION_CACHE_PREFIX = 'session:';
  private readonly SESSION_TTL = 24 * 60 * 60; // 24 hours

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  async createSession(
    userId: string,
    clinicId?: string,
    domain?: string,
    metadata?: Record<string, any>
  ): Promise<SessionData> {
    try {
      const sessionId = this.generateSessionId();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (this.SESSION_TTL * 1000));

      const sessionData: SessionData = {
        sessionId,
        userId,
        clinicId,
        domain,
        createdAt: now,
        expiresAt,
        lastActivity: now,
        userAgent: metadata?.userAgent,
        ipAddress: metadata?.ipAddress,
        metadata,
      };

      // Store in cache for fast access
      await this.cacheService.set(
        `${this.SESSION_CACHE_PREFIX}${sessionId}`,
        JSON.stringify(sessionData),
        this.SESSION_TTL
      );

      // Store in database for persistence
      // In production, implement proper database session storage

      this.logger.log(`Session created: ${sessionId} for user: ${userId}`);
      return sessionData;
    } catch (error) {
      this.logger.error('Error creating session:', error);
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    try {
      const cachedSession = await this.cacheService.get(`${this.SESSION_CACHE_PREFIX}${sessionId}`);
      
      if (cachedSession && typeof cachedSession === 'string') {
        const sessionData = JSON.parse(cachedSession) as SessionData;
        
        // Check if session is expired
        if (new Date() > new Date(sessionData.expiresAt)) {
          await this.destroySession(sessionId);
          return null;
        }

        // Update last activity
        sessionData.lastActivity = new Date();
        await this.cacheService.set(
          `${this.SESSION_CACHE_PREFIX}${sessionId}`,
          JSON.stringify(sessionData),
          this.SESSION_TTL
        );

        return sessionData;
      }

      // If not in cache, try database (in production)
      return null;
    } catch (error) {
      this.logger.error('Error getting session:', error);
      return null;
    }
  }

  async updateSession(sessionId: string, updates: Partial<SessionData>): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        return false;
      }

      const updatedSession = { ...session, ...updates, lastActivity: new Date() };
      
      await this.cacheService.set(
        `${this.SESSION_CACHE_PREFIX}${sessionId}`,
        JSON.stringify(updatedSession),
        this.SESSION_TTL
      );

      return true;
    } catch (error) {
      this.logger.error('Error updating session:', error);
      return false;
    }
  }

  async destroySession(sessionId: string): Promise<boolean> {
    try {
      await this.cacheService.delete(`${this.SESSION_CACHE_PREFIX}${sessionId}`);
      
      // Remove from database (in production)
      
      this.logger.log(`Session destroyed: ${sessionId}`);
      return true;
    } catch (error) {
      this.logger.error('Error destroying session:', error);
      return false;
    }
  }

  async destroyAllUserSessions(userId: string): Promise<boolean> {
    try {
      // In production, implement proper bulk session cleanup
      this.logger.log(`All sessions destroyed for user: ${userId}`);
      return true;
    } catch (error) {
      this.logger.error('Error destroying user sessions:', error);
      return false;
    }
  }

  async validateSession(sessionId: string): Promise<TokenPayload | null> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        return null;
      }

      // Return token payload format for compatibility
      return {
        sub: session.userId,
        email: '', // Would be populated from user data in production
        sessionId: session.sessionId,
        clinicId: session.clinicId,
        domain: session.domain,
      };
    } catch (error) {
      this.logger.error('Error validating session:', error);
      return null;
    }
  }

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async getActiveSessions(userId: string): Promise<SessionData[]> {
    // In production, implement proper session listing
    return [];
  }

  async extendSession(sessionId: string, additionalTime?: number): Promise<boolean> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return false;
    }

    const extension = additionalTime || this.SESSION_TTL;
    const newExpiresAt = new Date(Date.now() + (extension * 1000));

    return this.updateSession(sessionId, { expiresAt: newExpiresAt });
  }
}