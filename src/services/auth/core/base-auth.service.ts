import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../libs/infrastructure/cache';
import { CircuitBreakerService } from '../../../libs/core/resilience';
import { PrismaService } from '../../../libs/infrastructure/database';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { 
  AuthResponse, 
  OTPResult, 
  UserProfile, 
  SessionData,
  TokenPayload,
  AuthTokens,
  PasswordResetResult,
  MagicLinkResult
} from '../../../libs/core/types';

// Enhanced type safety for authentication
interface AuthUser {
  id: string;
  email: string;
  roles?: string[];
  permissions?: string[];
  domain?: string;
  [key: string]: any; // For domain-specific properties
}

// Extended session data for internal use
interface ExtendedSessionData {
  id: string;
  userId: string;
  domain: string;
  accessToken: string;
  refreshToken: string;
  userAgent: string;
  ipAddress: string;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

export interface BaseAuthConfig {
  jwt: {
    secret: string;
    expiresIn: string;
    refreshExpiresIn: string;
  };
  otp: {
    length: number;
    expiresInMinutes: number;
    maxAttempts: number;
  };
  session: {
      expiresInHours: number;
    maxConcurrentSessions: number;
  };
  security: {
    saltRounds: number;
    tokenBlacklistTtl: number;
    passwordResetTtl: number;
    magicLinkTtl: number;
  };
}

@Injectable()
export class BaseAuthService {
  private readonly logger = new Logger(BaseAuthService.name);
  private readonly config: BaseAuthConfig;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly prismaService: PrismaService,
  ) {
    this.config = {
      jwt: {
        secret: this.configService.get<string>('JWT_SECRET') || 'default-secret',
        expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') || '24h',
        refreshExpiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d',
      },
      otp: {
        length: this.configService.get<number>('OTP_LENGTH') || 6,
        expiresInMinutes: this.configService.get<number>('OTP_EXPIRES_IN_MINUTES') || 5,
        maxAttempts: this.configService.get<number>('OTP_MAX_ATTEMPTS') || 3,
      },
      session: {
        expiresInHours: this.configService.get<number>('SESSION_EXPIRES_IN_HOURS') || 24,
        maxConcurrentSessions: this.configService.get<number>('MAX_CONCURRENT_SESSIONS') || 5,
      },
      security: {
        saltRounds: this.configService.get<number>('BCRYPT_SALT_ROUNDS') || 12,
        tokenBlacklistTtl: this.configService.get<number>('TOKEN_BLACKLIST_TTL') || 86400,
        passwordResetTtl: this.configService.get<number>('PASSWORD_RESET_TTL') || 3600,
        magicLinkTtl: this.configService.get<number>('MAGIC_LINK_TTL') || 600,
      },
    };
  }

  // =============================================
  // JWT TOKEN OPERATIONS
  // =============================================

  async generateTokens(user: AuthUser, domain: string): Promise<AuthTokens> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const payload: TokenPayload = {
        sub: user.id,
        email: user.email,
        domain,
        roles: user.roles || [],
        permissions: user.permissions || [],
        iat: now,
        exp: now + this.parseTimeToSeconds(this.config.jwt.expiresIn),
      };

      const [accessToken, refreshToken] = await Promise.all([
        this.jwtService.signAsync(payload, {
          expiresIn: this.config.jwt.expiresIn,
        }),
        this.jwtService.signAsync(
          { ...payload, type: 'refresh' },
          {
            expiresIn: this.config.jwt.refreshExpiresIn,
          }
        ),
      ]);

      const sessionId = await this.createSession(user.id, domain, {
        accessToken,
        refreshToken,
        userAgent: 'unknown',
        ipAddress: 'unknown',
      });

      this.logger.debug(`Tokens generated for user ${user.id} in domain ${domain}`);

      return {
        accessToken,
        refreshToken,
        expiresIn: this.parseTimeToSeconds(this.config.jwt.expiresIn),
        sessionId,
        tokenType: 'Bearer',
      };
    } catch (error) {
      this.logger.error('Error generating tokens:', error);
      throw new UnauthorizedException('Failed to generate authentication tokens');
    }
  }

  async validateToken(token: string): Promise<TokenPayload | null> {
    try {
      // Check if token is blacklisted
      const isBlacklisted = await this.isTokenBlacklisted(token);
      if (isBlacklisted) {
        return null;
      }

      const payload = this.jwtService.verify(token) as TokenPayload;
      
      // Validate session exists and is active
      const sessionExists = await this.validateSession(payload.sub, token);
      if (!sessionExists) {
        return null;
      }

      return payload;
    } catch (error) {
      this.logger.debug('Token validation failed:', error instanceof Error ? (error as Error).message : String(error));
      return null;
    }
  }

  async refreshTokens(refreshToken: string, domain: string): Promise<AuthTokens> {
    try {
      const payload = this.jwtService.verify(refreshToken) as TokenPayload;
      
      // For now, we'll trust that if it's a refresh token, it was signed with the refresh secret
      // In a more secure implementation, we'd add a specific claim to distinguish refresh tokens

      // Blacklist the old refresh token
      await this.blacklistToken(refreshToken);

      // Generate new tokens
      return this.generateTokens({ 
        id: payload.sub, 
        email: payload.email, 
        roles: payload.roles,
        permissions: payload.permissions 
      }, domain);
    } catch (error) {
      this.logger.error('Token refresh failed:', error);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async blacklistToken(token: string): Promise<void> {
    try {
      const cacheKey = `auth:blacklist:${this.hashToken(token)}`;
      await this.cacheService.set(cacheKey, true, this.config.security.tokenBlacklistTtl);
      this.logger.debug('Token blacklisted successfully');
    } catch (error) {
      this.logger.error('Error blacklisting token:', error);
    }
  }

  private async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      const cacheKey = `auth:blacklist:${this.hashToken(token)}`;
      const result = await this.cacheService.get<boolean>(cacheKey);
      return result === true;
    } catch (error) {
      this.logger.error('Error checking token blacklist:', error);
      return false;
    }
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // =============================================
  // SESSION OPERATIONS
  // =============================================

  async createSession(userId: string, domain: string, sessionData: Partial<ExtendedSessionData>): Promise<string> {
    try {
      const sessionId = crypto.randomUUID();
      const session: ExtendedSessionData = {
        id: sessionId,
        userId,
        domain,
        accessToken: sessionData.accessToken || '',
        refreshToken: sessionData.refreshToken || '',
        userAgent: sessionData.userAgent || 'unknown',
        ipAddress: sessionData.ipAddress || 'unknown',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        expiresAt: new Date(Date.now() + (this.config.session.expiresInHours * 60 * 60 * 1000)),
        isActive: true,
      };

      // Store session in cache
      const cacheKey = `auth:session:${sessionId}`;
      await this.cacheService.set(cacheKey, session, this.config.session.expiresInHours * 3600);

      // Store user session mapping
      const userSessionsKey = `auth:user:${userId}:sessions`;
      const existingSessions = await this.cacheService.get<string[]>(userSessionsKey) || [];
      
      // Enforce max concurrent sessions
      if (existingSessions.length >= this.config.session.maxConcurrentSessions) {
        const oldestSession = existingSessions.shift();
        if (oldestSession) {
          await this.revokeSession(oldestSession);
        }
      }

      existingSessions.push(sessionId);
      await this.cacheService.set(userSessionsKey, existingSessions, this.config.session.expiresInHours * 3600);

      this.logger.debug(`Session created: ${sessionId} for user: ${userId}`);
      return sessionId;
    } catch (error) {
      this.logger.error('Error creating session:', error);
      throw new UnauthorizedException('Failed to create session');
    }
  }

  async validateSession(userId: string, accessToken?: string): Promise<boolean> {
    try {
      const userSessionsKey = `auth:user:${userId}:sessions`;
      const sessionIds = await this.cacheService.get<string[]>(userSessionsKey);
      
      if (!sessionIds || sessionIds.length === 0) {
        return false;
      }

      // Check if any session is valid
      for (const sessionId of sessionIds) {
        const session = await this.getSession(sessionId);
        if (session && session.isActive && session.expiresAt > new Date()) {
          if (!accessToken || session.accessToken === accessToken) {
            // Update last active time
            await this.updateSessionActivity(sessionId);
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      this.logger.error('Error validating session:', error);
      return false;
    }
  }

  async getSession(sessionId: string): Promise<ExtendedSessionData | null> {
    try {
      const cacheKey = `auth:session:${sessionId}`;
      return await this.cacheService.get<ExtendedSessionData>(cacheKey);
    } catch (error) {
      this.logger.error('Error getting session:', error);
      return null;
    }
  }

  async updateSessionActivity(sessionId: string): Promise<void> {
    try {
      const session = await this.getSession(sessionId);
      if (session) {
        session.lastActiveAt = new Date();
        const cacheKey = `auth:session:${sessionId}`;
        await this.cacheService.set(cacheKey, session, this.config.session.expiresInHours * 3600);
      }
    } catch (error) {
      this.logger.error('Error updating session activity:', error);
    }
  }

  async revokeSession(sessionId: string): Promise<void> {
    try {
      const session = await this.getSession(sessionId);
      if (session) {
        // Blacklist tokens
        await this.blacklistToken(session.accessToken);
        await this.blacklistToken(session.refreshToken);

        // Remove session
        const cacheKey = `auth:session:${sessionId}`;
        await this.cacheService.del(cacheKey);

        // Remove from user sessions
        const userSessionsKey = `auth:user:${session.userId}:sessions`;
        const sessions = await this.cacheService.get<string[]>(userSessionsKey) || [];
        const updatedSessions = sessions.filter(id => id !== sessionId);
        await this.cacheService.set(userSessionsKey, updatedSessions, this.config.session.expiresInHours * 3600);

        this.logger.debug(`Session revoked: ${sessionId}`);
      }
    } catch (error) {
      this.logger.error('Error revoking session:', error);
    }
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    try {
      const userSessionsKey = `auth:user:${userId}:sessions`;
      const sessionIds = await this.cacheService.get<string[]>(userSessionsKey) || [];
      
      await Promise.all(sessionIds.map(sessionId => this.revokeSession(sessionId)));
      
      this.logger.debug(`All sessions revoked for user: ${userId}`);
    } catch (error) {
      this.logger.error('Error revoking all user sessions:', error);
    }
  }

  // =============================================
  // PASSWORD OPERATIONS
  // =============================================

  async hashPassword(password: string): Promise<string> {
    try {
      return await bcrypt.hash(password, this.config.security.saltRounds);
    } catch (error) {
      this.logger.error('Error hashing password:', error);
      throw new BadRequestException('Failed to process password');
    }
  }

  async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    try {
      return await bcrypt.compare(password, hashedPassword);
    } catch (error) {
      this.logger.error('Error verifying password:', error);
      return false;
    }
  }

  // =============================================
  // OTP OPERATIONS
  // =============================================

  async generateOTP(): Promise<string> {
    const otp = crypto.randomInt(100000, 999999).toString();
    return otp.padStart(this.config.otp.length, '0');
  }

  async storeOTP(identifier: string, otp: string, domain: string): Promise<void> {
    try {
      const cacheKey = `auth:otp:${domain}:${identifier}`;
      const otpData = {
        otp,
        attempts: 0,
        createdAt: Date.now(),
        expiresAt: Date.now() + (this.config.otp.expiresInMinutes * 60 * 1000),
      };
      
      await this.cacheService.set(cacheKey, otpData, this.config.otp.expiresInMinutes * 60);
      this.logger.debug(`OTP stored for ${identifier} in domain ${domain}`);
    } catch (error) {
      this.logger.error('Error storing OTP:', error);
      throw new BadRequestException('Failed to generate OTP');
    }
  }

  async verifyOTP(identifier: string, otp: string, domain: string): Promise<boolean> {
    try {
      const cacheKey = `auth:otp:${domain}:${identifier}`;
      const otpData = await this.cacheService.get<any>(cacheKey);
      
      if (!otpData) {
        return false;
      }

      // Check expiration
      if (Date.now() > otpData.expiresAt) {
        await this.cacheService.del(cacheKey);
        return false;
      }

      // Check attempts
      if (otpData.attempts >= this.config.otp.maxAttempts) {
        await this.cacheService.del(cacheKey);
        return false;
      }

      // Verify OTP
      if (otpData.otp === otp) {
        await this.cacheService.del(cacheKey);
        return true;
      } else {
        // Increment attempts
        otpData.attempts++;
        await this.cacheService.set(cacheKey, otpData, this.config.otp.expiresInMinutes * 60);
        return false;
      }
    } catch (error) {
      this.logger.error('Error verifying OTP:', error);
      return false;
    }
  }

  async invalidateOTP(identifier: string, domain: string): Promise<void> {
    try {
      const cacheKey = `auth:otp:${domain}:${identifier}`;
      await this.cacheService.del(cacheKey);
      this.logger.debug(`OTP invalidated for ${identifier} in domain ${domain}`);
    } catch (error) {
      this.logger.error('Error invalidating OTP:', error);
    }
  }

  async hasActiveOTP(identifier: string, domain: string): Promise<boolean> {
    try {
      const cacheKey = `auth:otp:${domain}:${identifier}`;
      const otpData = await this.cacheService.get<any>(cacheKey);
      return otpData !== null && Date.now() < otpData.expiresAt;
    } catch (error) {
      this.logger.error('Error checking active OTP:', error);
      return false;
    }
  }

  // =============================================
  // MAGIC LINK OPERATIONS
  // =============================================

  async generateMagicLink(email: string, domain: string, redirectUrl?: string): Promise<MagicLinkResult> {
    try {
      const token = crypto.randomBytes(32).toString('hex');
      const magicLinkData = {
        email,
        domain,
        redirectUrl,
        createdAt: Date.now(),
        expiresAt: Date.now() + (this.config.security.magicLinkTtl * 1000),
        used: false,
      };

      const cacheKey = `auth:magic-link:${token}`;
      await this.cacheService.set(cacheKey, magicLinkData, this.config.security.magicLinkTtl);

      const magicLink = `${this.configService.get('BASE_URL')}/auth/verify-magic-link?token=${token}`;
      
      this.logger.debug(`Magic link generated for ${email} in domain ${domain}`);
      
      return {
        success: true,
        message: 'Magic link generated successfully',
        linkSent: true,
        expiresIn: this.config.security.magicLinkTtl,
      };
    } catch (error) {
      this.logger.error('Error generating magic link:', error);
      return {
        success: false,
        message: 'Failed to generate magic link',
      };
    }
  }

  async verifyMagicLink(token: string): Promise<{ success: boolean; email?: string; domain?: string; redirectUrl?: string; error?: string }> {
    try {
      const cacheKey = `auth:magic-link:${token}`;
      const magicLinkData = await this.cacheService.get<any>(cacheKey);
      
      if (!magicLinkData) {
        return { success: false, error: 'Invalid or expired magic link' };
      }

      if (magicLinkData.used) {
        return { success: false, error: 'Magic link already used' };
      }

      if (Date.now() > magicLinkData.expiresAt) {
        await this.cacheService.del(cacheKey);
        return { success: false, error: 'Magic link expired' };
      }

      // Mark as used
      magicLinkData.used = true;
      await this.cacheService.set(cacheKey, magicLinkData, this.config.security.magicLinkTtl);

      return {
        success: true,
        email: magicLinkData.email,
        domain: magicLinkData.domain,
        redirectUrl: magicLinkData.redirectUrl,
      };
    } catch (error) {
      this.logger.error('Error verifying magic link:', error);
      return { success: false, error: 'Failed to verify magic link' };
    }
  }

  // =============================================
  // PASSWORD RESET OPERATIONS
  // =============================================

  async generatePasswordResetToken(email: string, domain: string): Promise<string> {
    try {
      const token = crypto.randomBytes(32).toString('hex');
      const resetData = {
        email,
        domain,
        createdAt: Date.now(),
        expiresAt: Date.now() + (this.config.security.passwordResetTtl * 1000),
        used: false,
      };

      const cacheKey = `auth:password-reset:${token}`;
      await this.cacheService.set(cacheKey, resetData, this.config.security.passwordResetTtl);

      this.logger.debug(`Password reset token generated for ${email} in domain ${domain}`);
      return token;
    } catch (error) {
      this.logger.error('Error generating password reset token:', error);
      throw new BadRequestException('Failed to generate reset token');
    }
  }

  async verifyPasswordResetToken(token: string): Promise<{ success: boolean; email?: string; domain?: string; error?: string }> {
    try {
      const cacheKey = `auth:password-reset:${token}`;
      const resetData = await this.cacheService.get<any>(cacheKey);
      
      if (!resetData) {
        return { success: false, error: 'Invalid or expired reset token' };
      }

      if (resetData.used) {
        return { success: false, error: 'Reset token already used' };
      }

      if (Date.now() > resetData.expiresAt) {
        await this.cacheService.del(cacheKey);
        return { success: false, error: 'Reset token expired' };
      }

      return {
        success: true,
        email: resetData.email,
        domain: resetData.domain,
      };
    } catch (error) {
      this.logger.error('Error verifying password reset token:', error);
      return { success: false, error: 'Failed to verify reset token' };
    }
  }

  async markPasswordResetTokenAsUsed(token: string): Promise<void> {
    try {
      const cacheKey = `auth:password-reset:${token}`;
      const resetData = await this.cacheService.get<any>(cacheKey);
      
      if (resetData) {
        resetData.used = true;
        await this.cacheService.set(cacheKey, resetData, this.config.security.passwordResetTtl);
      }
    } catch (error) {
      this.logger.error('Error marking password reset token as used:', error);
    }
  }

  // =============================================
  // UTILITY METHODS
  // =============================================

  private parseTimeToSeconds(timeString: string): number {
    const match = timeString.match(/^(\d+)([smhd])$/);
    if (!match) return 3600; // Default to 1 hour

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 3600;
    }
  }

  async invalidateUserCache(userId: string, domain: string): Promise<void> {
    try {
      await this.cacheService.invalidateByPattern(`${domain}:user:${userId}:*`);
    } catch (error) {
      this.logger.error('Error invalidating user cache:', error);
    }
  }
}