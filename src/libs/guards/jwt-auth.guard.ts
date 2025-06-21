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
import * as crypto from 'crypto';

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

  /**
   * Get session data from Redis and parse it
   */
  private async getSessionData(sessionKey: string): Promise<any> {
    const session = await this.redisService.get(sessionKey);
    if (!session) {
      return null;
    }
    
    const sessionData = JSON.parse(session);
    
    // Verify session is active
    if (!sessionData.isActive) {
      return null;
    }
    
    // Check session inactivity
    const lastActivity = new Date(sessionData.lastActivityAt).getTime();
    const inactivityDuration = Date.now() - lastActivity;
    if (inactivityDuration > this.SESSION_ACTIVITY_THRESHOLD) {
      // Session is still valid but inactive for a while
      // This is just for logging, we'll still return the session
    }
    
    return sessionData;
  }

  private async validateSession(userId: string, request: any, deviceFingerprint: string): Promise<any> {
    // Get session ID from token or headers
    const sessionId = request.user?.sessionId || request.headers['x-session-id'];
    
    // Debug log to help diagnose session issues
    this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.DEBUG,
      'Session validation attempt',
      'JwtAuthGuard',
      { 
        userId, 
        hasSessionIdInToken: !!request.user?.sessionId,
        hasSessionIdInHeader: !!request.headers['x-session-id'],
        sessionId: sessionId || 'MISSING'
      }
    );
    
    // Check if this is a standard API request that should be more lenient
    const isStandardApiRequest = request.raw.url.includes('/api/') || 
                                request.raw.url.includes('/health');
    
    // For standard API requests, create a session if needed but don't block
    if (!sessionId && isStandardApiRequest) {
      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Missing session for standard API request, creating temporary session',
        'JwtAuthGuard',
        { userId, path: request.raw.url }
      );
      
      // Create a temporary session ID
      const tempSessionId = require('crypto').randomUUID();
      
      // Create and return a basic session
      return {
        userId,
        sessionId: tempSessionId,
        isActive: true,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        deviceFingerprint: deviceFingerprint,
        temporary: true
      };
    }
    
    if (!sessionId) {
      throw new UnauthorizedException('Invalid session');
    }

    // Get session data from Redis
    const sessionKey = `session:${userId}:${sessionId}`;
    const sessionData = await this.getSessionData(sessionKey);
    
    // Determine if this is a request that should be handled with more flexibility
    const isFlexibleRequest = 
      (request.raw.url.includes('/user/') && 
       (request.method === 'PATCH' || request.method === 'PUT' || request.method === 'GET')) ||
      request.raw.url.includes('/profile-completion') ||
      request.raw.url.includes('/dashboard') ||
      request.raw.url.includes('/settings') ||
      isStandardApiRequest;
    
    if (!sessionData) {
      // For flexible requests, create a temporary session
      if (isFlexibleRequest) {
        this.loggingService.log(
          LogType.SECURITY,
          LogLevel.INFO,
          'Creating temporary session for flexible request',
          'JwtAuthGuard',
          { userId, sessionId, path: request.raw.url }
        );
        
        // Create a basic session object
        const tempSessionData = {
          userId,
          sessionId,
          isActive: true,
          createdAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          deviceFingerprint: deviceFingerprint,
          userAgent: request.headers['user-agent'] || 'unknown',
          ipAddress: request.ip || 'unknown',
          deviceInfo: {
            userAgent: request.headers['user-agent'] || 'unknown',
            type: 'unknown'
          }
        };
        
        // Store the temporary session with a longer TTL (7 days)
        await this.redisService.set(sessionKey, JSON.stringify(tempSessionData), 7 * 24 * 3600); // 7 days TTL
        
        // Track the event
        await this.trackSecurityEvent(userId, 'TEMPORARY_SESSION_CREATED', {
          sessionId,
          context: 'flexible_request',
          path: request.raw.url
        });
        
        return tempSessionData;
      }
      
      throw new UnauthorizedException('Session expired or invalid');
    }

    // Check if this is a logout request (special case)
    const isLogoutRequest = request.raw.url.includes('/auth/logout');
    
    if (isLogoutRequest) {
      // Always allow logout requests
      return sessionData;
    }

    // For flexible requests, be lenient with device fingerprint validation
    if (isFlexibleRequest) {
      // If fingerprints don't match, update the stored fingerprint instead of rejecting
      if (sessionData.deviceFingerprint !== deviceFingerprint) {
        this.loggingService.log(
          LogType.SECURITY,
          LogLevel.INFO,
          'Updating device fingerprint for flexible request',
          'JwtAuthGuard',
          { userId, sessionId, path: request.raw.url }
        );
        
        // Update the fingerprint in the session data
        sessionData.deviceFingerprint = deviceFingerprint;
        await this.redisService.set(sessionKey, JSON.stringify(sessionData), 7 * 24 * 3600); // 7 days TTL
        
        // Track the event but allow the request
        await this.trackSecurityEvent(userId, 'DEVICE_FINGERPRINT_UPDATED', {
          sessionId,
          oldFingerprint: sessionData.deviceFingerprint,
          newFingerprint: deviceFingerprint,
          context: 'flexible_request'
        });
      }
      return sessionData;
    }

    // For non-flexible operations, perform device validation but with fallbacks
    if (sessionData.deviceFingerprint !== deviceFingerprint) {
      // Fallback for migrating from old fingerprinting method (IP-based)
      const oldFingerprint = crypto.createHash('sha256').update(`${request.headers['user-agent']}|${request.ip}`).digest('hex');
      
      // Check if it's a similar device (e.g., same browser family but different version)
      const isSimilarDevice = this.isSimilarUserAgent(
        sessionData.userAgent || sessionData.deviceInfo?.userAgent, 
        request.headers['user-agent']
      );
      
      if (sessionData.deviceFingerprint === oldFingerprint || isSimilarDevice) {
        // This is a valid session using the old fingerprint method or a similar device.
        // Let's update it to the new method.
        sessionData.deviceFingerprint = deviceFingerprint;
        sessionData.userAgent = request.headers['user-agent'];
        if (sessionData.deviceInfo) {
          sessionData.deviceInfo.userAgent = request.headers['user-agent'];
        }
        
        await this.redisService.set(sessionKey, JSON.stringify(sessionData), 7 * 24 * 3600); // 7 days TTL
        
        this.loggingService.log(
          LogType.SECURITY,
          LogLevel.INFO,
          'Updated device fingerprint for similar device',
          'JwtAuthGuard',
          { userId, sessionId }
        );
      } else {
        await this.trackSecurityEvent(userId, 'DEVICE_MISMATCH', {
          sessionId,
          expectedFingerprint: sessionData.deviceFingerprint,
          receivedFingerprint: deviceFingerprint
        });
        throw new UnauthorizedException('Invalid device detected');
      }
    }

    return sessionData;
  }

  /**
   * Compare two user agent strings to determine if they are similar devices
   * This helps with browser updates and minor variations
   */
  private isSimilarUserAgent(storedAgent: string, currentAgent: string): boolean {
    if (!storedAgent || !currentAgent) return false;
    
    // Extract browser family (e.g., Chrome, Firefox, Safari)
    const getBrowserFamily = (ua: string): string => {
      ua = ua.toLowerCase();
      if (ua.includes('chrome')) return 'chrome';
      if (ua.includes('firefox')) return 'firefox';
      if (ua.includes('safari')) return 'safari';
      if (ua.includes('edge')) return 'edge';
      if (ua.includes('opera')) return 'opera';
      return ua;
    };
    
    // Extract OS family (e.g., Windows, Mac, Android)
    const getOSFamily = (ua: string): string => {
      ua = ua.toLowerCase();
      if (ua.includes('windows')) return 'windows';
      if (ua.includes('mac')) return 'mac';
      if (ua.includes('android')) return 'android';
      if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) return 'ios';
      if (ua.includes('linux')) return 'linux';
      return ua;
    };
    
    const storedBrowser = getBrowserFamily(storedAgent);
    const currentBrowser = getBrowserFamily(currentAgent);
    const storedOS = getOSFamily(storedAgent);
    const currentOS = getOSFamily(currentAgent);
    
    // Consider similar if both browser family and OS family match
    return storedBrowser === currentBrowser && storedOS === currentOS;
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
    try {
      const clientIp = request.ip || 'unknown';
      const userAgent = request.headers['user-agent'] || 'unknown';

      // Update session with latest activity and info
      const updatedSession = {
        ...sessionData,
        lastActivityAt: new Date(),
        ipAddress: clientIp,
        deviceInfo: {
          ...sessionData.deviceInfo,
          userAgent: userAgent,
        }
      };

      await this.redisService.set(
        `session:${userId}:${sessionData.sessionId}`,
        JSON.stringify(updatedSession),
        3600 // Keep session alive for another hour
      );
    } catch (error) {
      this.loggingService.log(LogType.ERROR, LogLevel.ERROR, 'Failed to update session data', 'JwtAuthGuard', { error });
    }
  }

  private generateDeviceFingerprint(request: any): string {
    const userAgent = request.headers['user-agent'] || 'unknown';
    // Use a stable hash of the user agent. IP address is removed to support dynamic IPs.
    return crypto.createHash('sha256').update(userAgent).digest('hex');
  }

  private async trackSecurityEvent(identifier: string, eventType: string, details: any): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const event = {
        timestamp,
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
    } catch (error) {
      this.loggingService.log(LogType.ERROR, LogLevel.ERROR, 'Failed to track security event', 'JwtAuthGuard', { error });
    }
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
      await this.trackSecurityEvent(identifier, 'ACCOUNT_LOCKOUT', {
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