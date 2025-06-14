import { ExecutionContext, Injectable, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RedisService } from '../../shared/cache/redis/redis.service';
import { RateLimitService } from '../../shared/rate-limit/rate-limit.service'
import { LoggingService } from '../../shared/logging/logging.service';
import { LogLevel, LogType } from '../../shared/logging/types/logging.types';
import { Logger } from '@nestjs/common';

@Injectable()

export class JwtAuthGuard extends AuthGuard('jwt') {
  // Progressive lockout intervals in minutes
  private readonly LOCKOUT_INTERVALS = [
    10,    // 10 minutes after 3 failures
    25,    // 25 minutes after 4 failures
    45,    // 45 minutes after 5 failures
    60,    // 1 hour after 6 failures
    360    // 6 hours after 7 failures
  ];

  private readonly MAX_ATTEMPTS = 5; // Initial threshold before lockout
  private readonly ATTEMPT_WINDOW = 30 * 60; // 30 minutes base window for attempts
  private readonly SESSION_ACTIVITY_THRESHOLD = 15 * 60 * 1000; // 15 minutes for session inactivity warning
  private readonly MAX_CONCURRENT_SESSIONS = 5; // Maximum number of active sessions per user
  private readonly SECURITY_EVENT_RETENTION = 30 * 24 * 60 * 60; // 30 days retention for security events

  constructor(
    private reflector: Reflector, 
    private jwtService: JwtService,
    private redisService: RedisService,
    private rateLimitService: RateLimitService,
    private loggingService: LoggingService
  ) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    try {
      const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

      const request = context.switchToHttp().getRequest();
      const path = request.raw.url;

      // Allow public endpoints without token
      if (isPublic || this.isPublicPath(path)) {
        return true;
      }

      // Skip rate limiting and security checks in development mode
      if (this.redisService.isDevelopmentMode()) {
        const token = this.extractTokenFromHeader(request);
        if (!token) {
          throw new UnauthorizedException('No token provided');
        }
        const payload = await this.verifyToken(token);
        request.user = payload;
        return true;
      }

      // Get client info
      const clientIp = request.ip || request.headers['x-forwarded-for'] || 'unknown';
      const userAgent = request.headers['user-agent'] || 'unknown';
      const deviceFingerprint = this.generateDeviceFingerprint(request);

      // Temporarily disable rate limiting for testing
      /*
      // Check rate limits
      const rateLimitResult = await this.rateLimitService.isRateLimited(
        `${clientIp}:${path}`,
        'auth'
      );

      if (rateLimitResult.limited) {
        throw new HttpException(
          `Rate limit exceeded. Please try again later. ${rateLimitResult.remaining} attempts remaining.`,
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      */

      // Temporarily disable lockout check for testing
      /*
      // Check for time-based lockout
      const lockoutStatus = await this.checkLockoutStatus(clientIp);
      if (lockoutStatus.isLocked) {
        throw new HttpException(
          `Account temporarily locked due to multiple failed attempts. Try again in ${lockoutStatus.remainingMinutes} minutes.`,
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      */

      // Validate security headers and request integrity
      await this.validateRequest(request);

    const token = this.extractTokenFromHeader(request);
    if (!token) {
        await this.recordFailedAttempt(clientIp);
      throw new UnauthorizedException('No token provided');
    }

      // Verify and decode JWT token
      const payload = await this.verifyToken(token);
      request.user = payload;

      // Validate session
      const sessionData = await this.validateSession(payload.sub, request, deviceFingerprint);
      
      // Check concurrent sessions limit
      await this.checkConcurrentSessions(payload.sub);

      // Update session data
      await this.updateSessionData(payload.sub, sessionData, request);

      // Reset failed attempts on successful authentication
      await this.resetFailedAttempts(clientIp);

      return true;
    } catch (error) {
      // Skip error handling in development mode
      if (this.redisService.isDevelopmentMode()) {
        throw error;
      }
      await this.handleAuthenticationError(error, context);
      throw error;
    }
  }

  private async validateRequest(request: any): Promise<void> {
    // Validate Content-Type for POST/PUT/PATCH requests
    if (['POST', 'PUT', 'PATCH'].includes(request.method) && 
        !request.headers['content-type']?.includes('application/json')) {
      throw new HttpException('Invalid Content-Type', HttpStatus.BAD_REQUEST);
    }

    // Check for required security headers
    const requiredHeaders = ['user-agent', 'accept', 'host'];
    const missingHeaders = requiredHeaders.filter(header => !request.headers[header]);
    if (missingHeaders.length > 0) {
      throw new HttpException(
        `Missing required headers: ${missingHeaders.join(', ')}`,
        HttpStatus.BAD_REQUEST
      );
    }

    // Validate origin for CORS requests
    if (request.headers.origin) {
      const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
      if (!allowedOrigins.includes(request.headers.origin)) {
        throw new HttpException('Invalid origin', HttpStatus.FORBIDDEN);
      }
    }
  }

  private async verifyToken(token: string): Promise<any> {
    try {
      const payload = this.jwtService.verify(token);
      
      // Check if token has been invalidated (blacklisted)
      const isBlacklisted = await this.redisService.get(`blacklist:token:${token.substring(0, 64)}`);
      if (isBlacklisted) {
        throw new UnauthorizedException('Token has been invalidated');
      }
      
      return payload;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Token has expired');
      }
      if (error.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('Invalid token format');
      }
      throw new UnauthorizedException('Token validation failed');
    }
  }

  private async validateSession(userId: string, request: any, deviceFingerprint: string): Promise<any> {
    const sessionId = request.headers['x-session-id'];
    if (!sessionId) {
      throw new UnauthorizedException('Session ID not provided');
    }

    const sessionKey = `session:${userId}:${sessionId}`;
    const session = await this.redisService.get(sessionKey);
    
    if (!session) {
      throw new UnauthorizedException('Session expired or invalidated');
    }

    const sessionData = JSON.parse(session);

    // Verify session is active
    if (!sessionData.isActive) {
      throw new UnauthorizedException('Session is no longer active');
    }

    // Check session inactivity
    const lastActivity = new Date(sessionData.lastActivityAt).getTime();
    const inactivityDuration = Date.now() - lastActivity;
    if (inactivityDuration > this.SESSION_ACTIVITY_THRESHOLD) {
      await this.trackSecurityEvent(userId, 'SESSION_INACTIVITY_WARNING', {
        sessionId,
        inactivityDuration: Math.floor(inactivityDuration / 1000)
      });
    }

    // For logout operations, be more lenient with device validation
    const isLogoutRequest = request.path === '/auth/logout';
    if (isLogoutRequest) {
      // During logout, only validate the user-agent as it's the most stable component
      const currentUserAgent = request.headers['user-agent'];
      const storedUserAgent = sessionData.userAgent;
      
      if (currentUserAgent && storedUserAgent && currentUserAgent !== storedUserAgent) {
        await this.trackSecurityEvent(userId, 'DEVICE_MISMATCH_LOGOUT', {
          sessionId,
          expectedUserAgent: storedUserAgent,
          receivedUserAgent: currentUserAgent
        });
        // Log the mismatch but don't block logout
        this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Device mismatch during logout',
          'JwtAuthGuard',
          { userId, sessionId, expectedUserAgent: storedUserAgent, receivedUserAgent: currentUserAgent }
        );
      }
      return sessionData;
    }

    // For non-logout operations, perform strict device validation
    if (sessionData.deviceFingerprint !== deviceFingerprint) {
      await this.trackSecurityEvent(userId, 'DEVICE_MISMATCH', {
        sessionId,
        expectedFingerprint: sessionData.deviceFingerprint,
        receivedFingerprint: deviceFingerprint
      });
      throw new UnauthorizedException('Invalid device detected');
    }

    return sessionData;
  }

  private async checkConcurrentSessions(userId: string): Promise<void> {
    const activeSessions = await this.redisService.sMembers(`user:${userId}:sessions`);
    if (activeSessions.length >= this.MAX_CONCURRENT_SESSIONS) {
      await this.trackSecurityEvent(userId, 'MAX_SESSIONS_REACHED', {
        activeSessionCount: activeSessions.length
      });
      throw new HttpException(
        `Maximum number of concurrent sessions (${this.MAX_CONCURRENT_SESSIONS}) reached`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  private async updateSessionData(userId: string, sessionData: any, request: any): Promise<void> {
    const sessionKey = `session:${userId}:${sessionData.sessionId}`;
    const now = new Date();

    // Update session data
    const updatedSession = {
      ...sessionData,
      lastActivityAt: now,
      lastIp: request.ip,
      securityChecks: {
        ...sessionData.securityChecks,
        lastValidated: now,
        validationHistory: [
          ...(sessionData.securityChecks?.validationHistory || []).slice(-9),
          {
            timestamp: now,
            ip: request.ip,
            userAgent: request.headers['user-agent'],
            path: request.raw.url
          }
        ]
      }
    };

    await this.redisService.set(
      sessionKey,
      JSON.stringify(updatedSession),
      24 * 60 * 60
    );

    // Add session data to request for use in controllers
    request.session = updatedSession;
  }

  private generateDeviceFingerprint(request: any): string {
    const components = [
      request.headers['user-agent'],
      request.headers['accept-language'],
      request.headers['accept-encoding'],
      request.ip
    ];
    
    return require('crypto')
      .createHash('sha256')
      .update(components.join('|'))
      .digest('hex');
  }

  private async trackSecurityEvent(identifier: string, eventType: string, details: any): Promise<void> {
    const event = {
      timestamp: new Date(),
      eventType,
      identifier,
      details
    };

    await this.redisService.rPush(
      `security:events:${identifier}`,
      JSON.stringify(event)
    );

    // Trim old events
    await this.redisService.lTrim(
      `security:events:${identifier}`,
      -1000,
      -1
    );

    // Set expiry for events list
    await this.redisService.expire(
      `security:events:${identifier}`,
      this.SECURITY_EVENT_RETENTION
    );
  }

  private async handleAuthenticationError(error: any, context: ExecutionContext): Promise<void> {
    const request = context.switchToHttp().getRequest();
    const clientIp = request.ip || request.headers['x-forwarded-for'] || 'unknown';

    // Record failed attempt
    await this.recordFailedAttempt(clientIp);

    // Track security event
    await this.trackSecurityEvent(clientIp, 'AUTHENTICATION_FAILURE', {
      error: error.message,
      path: request.raw.url,
      method: request.method
    });

    // Enhance error message if needed
    if (error instanceof UnauthorizedException) {
      const lockoutStatus = await this.checkLockoutStatus(clientIp);
      if (lockoutStatus.isLocked) {
        error.message = `Account is temporarily locked. Please try again in ${lockoutStatus.remainingMinutes} minutes.`;
      }
    }
  }

  private async checkLockoutStatus(identifier: string): Promise<{ isLocked: boolean; remainingMinutes: number }> {
    const attemptsKey = `auth:attempts:${identifier}`;
    const lockoutKey = `auth:lockout:${identifier}`;

    const attempts = await this.redisService.get(attemptsKey);
    const lockoutData = await this.redisService.get(lockoutKey);
    
    if (lockoutData) {
      const { lockedUntil } = JSON.parse(lockoutData);
      const now = Date.now();
      if (now < lockedUntil) {
        const remainingMinutes = Math.ceil((lockedUntil - now) / (1000 * 60));
        return { isLocked: true, remainingMinutes };
      }
      // Lockout expired, clear it
      await this.redisService.del(lockoutKey);
    }

    return { isLocked: false, remainingMinutes: 0 };
  }

  private async recordFailedAttempt(identifier: string): Promise<void> {
    const attemptsKey = `auth:attempts:${identifier}`;
    const lockoutKey = `auth:lockout:${identifier}`;
    
    const attempts = await this.redisService.get(attemptsKey);
    const currentAttempts = attempts ? parseInt(attempts) : 0;
    const newAttempts = currentAttempts + 1;

    if (newAttempts >= this.MAX_ATTEMPTS) {
      const lockoutIndex = Math.min(newAttempts - this.MAX_ATTEMPTS, this.LOCKOUT_INTERVALS.length - 1);
      const lockoutMinutes = this.LOCKOUT_INTERVALS[lockoutIndex];
      const lockedUntil = Date.now() + (lockoutMinutes * 60 * 1000);

      // Set lockout with progressive duration
      await this.redisService.set(
        lockoutKey,
        JSON.stringify({
          lockedUntil,
          attempts: newAttempts,
          lockoutMinutes
        }),
        lockoutMinutes * 60
      );

      // Track security event
      await this.redisService.trackSecurityEvent(identifier, 'ACCOUNT_LOCKOUT', {
        attempts: newAttempts,
        lockoutMinutes,
        lockedUntil: new Date(lockedUntil)
      });
    } else {
      // Update attempts count
      await this.redisService.set(
        attemptsKey,
        newAttempts.toString(),
        this.ATTEMPT_WINDOW
      );
    }
  }

  private async resetFailedAttempts(identifier: string): Promise<void> {
    const attemptsKey = `auth:attempts:${identifier}`;
    const lockoutKey = `auth:lockout:${identifier}`;
    await Promise.all([
      this.redisService.del(attemptsKey),
      this.redisService.del(lockoutKey)
    ]);
  }

  private validateSecurityHeaders(request: any): void {
    // Validate Content-Type for POST requests
    if (request.method === 'POST' && !request.headers['content-type']?.includes('application/json')) {
      throw new HttpException('Invalid Content-Type', HttpStatus.BAD_REQUEST);
    }

    // Check for required security headers
    if (!request.headers['user-agent']) {
      throw new HttpException('User-Agent header is required', HttpStatus.BAD_REQUEST);
    }
  }

  private generateDeviceId(userAgent: string): string {
    return require('crypto')
      .createHash('md5')
      .update(userAgent)
      .digest('hex');
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  private isPublicPath(path: string): boolean {
    const publicPaths = [
      '/auth/login',
      '/auth/register',
      '/auth/forgot-password',
      '/auth/reset-password',
      '/auth/verify-email',
      '/health',
      '/health/check',
      '/api-health',
      '/docs',
      '/api',
      '/api-json',
      '/swagger',
      '/favicon.ico'
    ];
    return publicPaths.some(publicPath => path.startsWith(publicPath));
  }
} 