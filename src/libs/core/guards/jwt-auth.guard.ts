import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { RedisService } from "../../infrastructure/cache/redis/redis.service";
import { RateLimitService } from "../../utils/rate-limit/rate-limit.service";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { LoggingService } from "../../infrastructure/logging/logging.service";
import {
  LogLevel,
  LogType,
} from "../../infrastructure/logging/types/logging.types";
import { JwtAuthService } from "../../../services/auth/core/jwt.service";
import * as crypto from "crypto";

interface User {
  id?: string;
  email?: string;
  role?: string;
  sessionId?: string;
  sub?: string;
  jti?: string;
  [key: string]: unknown;
}

interface FastifyRequestWithUser {
  user?: User;
  ip?: string;
  headers: Record<string, string | undefined>;
  method: string;
  raw: {
    url: string;
  };
}

interface JwtPayload {
  sub?: string;
  sessionId?: string;
  jti?: string;
  [key: string]: unknown;
}

interface SessionData {
  sessionId: string;
  isActive: boolean;
  lastActivityAt: string;
  deviceFingerprint: string;
  deviceInfo: {
    userAgent: string;
  };
  ipAddress: string;
}

interface LockoutStatus {
  isLocked: boolean;
  remainingMinutes: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  // Progressive lockout intervals in minutes
  private readonly LOCKOUT_INTERVALS = [
    10, // 10 minutes after 3 failures
    25, // 25 minutes after 4 failures
    45, // 45 minutes after 5 failures
    60, // 1 hour after 6 failures
    360, // 6 hours after 7 failures
  ];

  private readonly MAX_ATTEMPTS = 10; // Initial threshold before lockout
  private readonly ATTEMPT_WINDOW = 30 * 60; // 30 minutes base window for attempts
  private readonly SESSION_ACTIVITY_THRESHOLD = 15 * 60 * 1000; // 15 minutes for session inactivity warning
  private readonly MAX_CONCURRENT_SESSIONS = 5; // Maximum number of active sessions per user
  private readonly SECURITY_EVENT_RETENTION = 30 * 24 * 60 * 60; // 30 days retention for security events

  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
    private jwtAuthService: JwtAuthService,
    private redisService: RedisService,
    private rateLimitService: RateLimitService,
    private loggingService: LoggingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const isPublic = this.reflector.getAllAndOverride<boolean>(
        IS_PUBLIC_KEY,
        [context.getHandler(), context.getClass()],
      );

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const request = context
        .switchToHttp()
        .getRequest() as FastifyRequestWithUser;
      const path = request.raw?.url || "";

      // Allow public endpoints without token
      if (isPublic || this.isPublicPath(path)) {
        return true;
      }

      // Skip rate limiting and security checks in development mode
      if (this.redisService.isDevelopmentMode()) {
        const token = this.extractTokenFromHeader(request);
        if (!token) {
          throw new UnauthorizedException("No token provided");
        }
        const payload = await this.verifyToken(token);
        request.user = payload;
        return true;
      }

      // Get client info
      const clientIp =
        request.ip || request.headers["x-forwarded-for"] || "unknown";

      // Rate limiting disabled for development stage
      // TODO: Enable rate limiting in production
      /*
      // Check rate limits (enabled for production security)
      if (!this.redisService.isDevelopmentMode()) {
        const rateLimitResult = await this.rateLimitService.isRateLimited(
          `${clientIp}:${path}`,
          'auth'
        );

        if (rateLimitResult.limited) {
          throw new HttpException(
            {
              error: 'Too Many Requests',
              message: 'Rate limit exceeded. Please try again later.',
              retryAfter: 60, // Standard retry after 60 seconds
              remaining: rateLimitResult.remaining
            },
            HttpStatus.TOO_MANY_REQUESTS
          );
        }
      }
      */

      // Lockout mechanism disabled for development stage
      // TODO: Enable lockout protection in production
      /*
      // Check for time-based lockout (enabled for production security)
      if (!this.redisService.isDevelopmentMode()) {
        const lockoutStatus = await this.checkLockoutStatus(clientIp);
        if (lockoutStatus.isLocked) {
          throw new HttpException(
            {
              error: 'Account Locked',
              message: `Account temporarily locked due to multiple failed attempts. Try again in ${lockoutStatus.remainingMinutes} minutes.`,
              lockoutMinutes: lockoutStatus.remainingMinutes,
              retryAfter: lockoutStatus.remainingMinutes * 60
            },
            HttpStatus.TOO_MANY_REQUESTS
          );
        }
      }
      */

      // Validate security headers and request integrity
      this.validateRequest(request);

      const token = this.extractTokenFromHeader(request);
      if (!token) {
        await this.recordFailedAttempt(clientIp);
        throw new UnauthorizedException("No token provided");
      }

      // Verify and decode JWT token
      const payload = await this.verifyToken(token);
      request.user = payload;

      // Validate session
      const sessionData = await this.validateSession(
        payload.sub || "anonymous",
        request,
      );

      // Check concurrent sessions limit
      if (payload.sub) {
        await this.checkConcurrentSessions(payload.sub);
      }

      // Update session data
      if (payload.sub) {
        await this.updateSessionData(payload.sub, sessionData, request);
      }

      // Reset failed attempts on successful authentication
      await this.resetFailedAttempts(clientIp);

      return true;
    } catch (error) {
      // Skip error handling in development mode
      if (this.redisService.isDevelopmentMode()) {
        throw error;
      }
      await this.handleAuthenticationError(error as Error, context);
      throw error;
    }
  }

  private validateRequest(request: FastifyRequestWithUser): void {
    // Validate Content-Type for POST/PUT/PATCH requests
    if (
      ["POST", "PUT", "PATCH"].includes(request.method) &&
      !request.headers["content-type"]?.includes("application/json")
    ) {
      throw new HttpException("Invalid Content-Type", HttpStatus.BAD_REQUEST);
    }

    // Check for required security headers
    const requiredHeaders = ["user-agent", "accept", "host"];
    const missingHeaders = requiredHeaders.filter(
      (header) => !request.headers[header],
    );
    if (missingHeaders.length > 0) {
      throw new HttpException(
        `Missing required headers: ${missingHeaders.join(", ")}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate origin for CORS requests
    if (request.headers.origin) {
      const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
      if (!allowedOrigins.includes(request.headers.origin)) {
        throw new HttpException("Invalid origin", HttpStatus.FORBIDDEN);
      }
    }
  }

  private async verifyToken(token: string): Promise<JwtPayload> {
    const logger = this.loggingService;
    void logger.log(
      LogType.AUTH,
      LogLevel.DEBUG,
      "Attempting to verify JWT token",
      "JwtAuthGuard",
      { tokenStart: token.substring(0, 20) + "..." },
    );

    let payload: JwtPayload | null = null;
    let lastError: Error | null = null;

    // Try basic JWT service first
    try {
      payload = this.jwtService.verify(token) as JwtPayload;
      void logger.log(
        LogType.AUTH,
        LogLevel.DEBUG,
        "JWT token verified with basic service",
        "JwtAuthGuard",
        { userId: payload?.sub },
      );
    } catch (basicError) {
      lastError =
        basicError instanceof Error
          ? basicError
          : new Error("Unknown basic JWT error");
      void logger.log(
        LogType.AUTH,
        LogLevel.DEBUG,
        "Basic JWT verification failed, trying enhanced service",
        "JwtAuthGuard",
        { error: lastError.message },
      );

      // Try enhanced JWT service as fallback
      try {
        payload = (await this.jwtAuthService.verifyEnhancedToken(token)) as unknown as JwtPayload;
        void logger.log(
          LogType.AUTH,
          LogLevel.DEBUG,
          "JWT token verified with enhanced service",
          "JwtAuthGuard",
          { userId: payload?.sub },
        );
        lastError = null; // Clear error since enhanced verification succeeded
      } catch (enhancedError) {
        lastError =
          enhancedError instanceof Error
            ? enhancedError
            : new Error("Unknown enhanced JWT error");
        void logger.log(
          LogType.AUTH,
          LogLevel.ERROR,
          "Enhanced JWT verification also failed",
          "JwtAuthGuard",
          { error: lastError.message },
        );
      }
    }

    // If both verifications failed, handle the error
    if (!payload && lastError) {
      void logger.log(
        LogType.AUTH,
        LogLevel.ERROR,
        `All token verification methods failed: ${lastError.name}`,
        "JwtAuthGuard",
        { error: lastError.message },
      );

      if (lastError.name === "TokenExpiredError") {
        throw new UnauthorizedException("Token has expired");
      }
      if (lastError.name === "JsonWebTokenError") {
        throw new UnauthorizedException("Invalid token format");
      }
      if (lastError.message && lastError.message.includes("revoked")) {
        throw new UnauthorizedException("Token has been revoked");
      }
      throw new UnauthorizedException("Token validation failed");
    }

    // Check blacklist regardless of verification method
    if (payload && payload.jti) {
      try {
        const blacklistKey = `jwt:blacklist:${payload.jti}`;
        const isBlacklisted = await this.redisService.get(blacklistKey);
        if (isBlacklisted) {
          void logger.log(
            LogType.AUTH,
            LogLevel.WARN,
            "Token validation failed: Token is blacklisted",
            "JwtAuthGuard",
            { userId: payload.sub, jti: payload.jti },
          );
          throw new UnauthorizedException("Token has been revoked");
        }
      } catch (blacklistError) {
        void logger.log(
          LogType.AUTH,
          LogLevel.ERROR,
          "Failed to check token blacklist",
          "JwtAuthGuard",
          {
            error:
              blacklistError instanceof Error
                ? blacklistError.message
                : "Unknown",
          },
        );
        // Continue with token validation even if blacklist check fails
      }
    }

    if (!payload) {
      throw new UnauthorizedException("Invalid token");
    }
    return payload;
  }

  /**
   * Get session data from Redis and parse it
   */
  private async getSessionData(
    sessionKey: string,
  ): Promise<SessionData | null> {
    const session = await this.redisService.get(sessionKey);
    if (!session) {
      return null;
    }

    const sessionData = JSON.parse(session) as SessionData;

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

  private async validateSession(
    userId: string,
    request: FastifyRequestWithUser,
  ): Promise<SessionData> {
    const logger = this.loggingService;
    // Get sessionId from token payload (more reliable than request.user which might not be set yet)
    const token = this.extractTokenFromHeader(request);
    let sessionId =
      (request.user as JwtPayload)?.sessionId ||
      (request.headers["x-session-id"] as string);

    // If sessionId not found in request.user, try to decode token to get it
    if (!sessionId && token) {
      try {
        const decoded = this.jwtService.decode(token);
        if (decoded && typeof decoded === "object" && "sessionId" in decoded) {
          sessionId = decoded.sessionId;
        }
      } catch (error) {
        void logger.log(
          LogType.AUTH,
          LogLevel.ERROR,
          "Failed to decode token for sessionId",
          "JwtAuthGuard",
          { error },
        );
      }
    }

    void logger.log(
      LogType.AUTH,
      LogLevel.DEBUG,
      "Attempting to validate session",
      "JwtAuthGuard",
      { userId, sessionId: sessionId || "MISSING" },
    );

    if (!sessionId) {
      void logger.log(
        LogType.AUTH,
        LogLevel.WARN,
        "Session validation failed: No session ID provided in token or headers",
        "JwtAuthGuard",
        { userId },
      );
      throw new UnauthorizedException("Session ID is missing");
    }

    const sessionKey = `session:${userId}:${sessionId}`;
    const sessionData = await this.getSessionData(sessionKey);

    if (!sessionData) {
      void logger.log(
        LogType.AUTH,
        LogLevel.WARN,
        "Session validation failed: Session not found in Redis",
        "JwtAuthGuard",
        { userId, sessionId, sessionKey },
      );
      throw new UnauthorizedException("Invalid session");
    }

    void logger.log(
      LogType.AUTH,
      LogLevel.DEBUG,
      "Session found in Redis",
      "JwtAuthGuard",
      { userId, sessionId },
    );

    // Skip device fingerprint check in DEV_MODE
    if (!this.redisService.isDevelopmentMode()) {
      const currentFingerprint = this.generateDeviceFingerprint(request);
      if (sessionData.deviceFingerprint !== currentFingerprint) {
        void logger.log(
          LogType.AUTH,
          LogLevel.WARN,
          "Session validation failed: Device fingerprint mismatch",
          "JwtAuthGuard",
          {
            userId,
            sessionId,
            storedFingerprint: sessionData.deviceFingerprint,
            currentFingerprint: currentFingerprint,
          },
        );
        // Depending on security policy, you might want to invalidate the session here.
        // For now, we'll just log it.
      }
    }

    void logger.log(
      LogType.AUTH,
      LogLevel.INFO,
      "Session validated successfully",
      "JwtAuthGuard",
      { userId, sessionId },
    );
    return sessionData;
  }

  /**
   * Compare two user agent strings to determine if they are similar devices
   * This helps with browser updates and minor variations
   */
  private isSimilarUserAgent(
    storedAgent: string,
    currentAgent: string,
  ): boolean {
    if (!storedAgent || !currentAgent) return false;

    // Extract browser family (e.g., Chrome, Firefox, Safari)
    const getBrowserFamily = (ua: string): string => {
      ua = ua.toLowerCase();
      if (ua.includes("chrome")) return "chrome";
      if (ua.includes("firefox")) return "firefox";
      if (ua.includes("safari")) return "safari";
      if (ua.includes("edge")) return "edge";
      if (ua.includes("opera")) return "opera";
      return ua;
    };

    // Extract OS family (e.g., Windows, Mac, Android)
    const getOSFamily = (ua: string): string => {
      ua = ua.toLowerCase();
      if (ua.includes("windows")) return "windows";
      if (ua.includes("mac")) return "mac";
      if (ua.includes("android")) return "android";
      if (ua.includes("ios") || ua.includes("iphone") || ua.includes("ipad"))
        return "ios";
      if (ua.includes("linux")) return "linux";
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
    const activeSessions = await this.redisService.sMembers(
      `user:${userId}:sessions`,
    );
    if (activeSessions.length >= this.MAX_CONCURRENT_SESSIONS) {
      await this.trackSecurityEvent(userId, "MAX_SESSIONS_REACHED", {
        activeSessionCount: activeSessions.length,
      });
      throw new HttpException(
        `Maximum number of concurrent sessions (${this.MAX_CONCURRENT_SESSIONS}) reached`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async updateSessionData(
    userId: string,
    sessionData: SessionData,
    request: FastifyRequestWithUser,
  ): Promise<void> {
    try {
      const clientIp = request.ip || "unknown";
      const userAgent = request.headers["user-agent"] || "unknown";

      // Update session with latest activity and info
      const updatedSession = {
        ...sessionData,
        lastActivityAt: new Date(),
        ipAddress: clientIp,
        deviceInfo: {
          ...sessionData.deviceInfo,
          userAgent: userAgent,
        },
      };

      await this.redisService.set(
        `session:${userId}:${sessionData.sessionId}`,
        JSON.stringify(updatedSession),
        3600, // Keep session alive for another hour
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        "Failed to update session data",
        "JwtAuthGuard",
        { error },
      );
    }
  }

  private generateDeviceFingerprint(request: FastifyRequestWithUser): string {
    const userAgent = request.headers["user-agent"] || "unknown";
    // Use a stable hash of the user agent. IP address is removed to support dynamic IPs.
    return crypto.createHash("sha256").update(userAgent).digest("hex");
  }

  private async trackSecurityEvent(
    identifier: string,
    eventType: string,
    details: Record<string, any>,
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const event = {
        timestamp,
        eventType,
        identifier,
        details,
      };

      await this.redisService.rPush(
        `security:events:${identifier}`,
        JSON.stringify(event),
      );

      // Trim old events
      await this.redisService.lTrim(`security:events:${identifier}`, -1000, -1);

      // Set expiry for events list
      await this.redisService.expire(
        `security:events:${identifier}`,
        this.SECURITY_EVENT_RETENTION,
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        "Failed to track security event",
        "JwtAuthGuard",
        { error },
      );
    }
  }

  private async handleAuthenticationError(
    error: Error,
    context: ExecutionContext,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest();
    const clientIp =
      request.ip || request.headers["x-forwarded-for"] || "unknown";

    // Record failed attempt
    await this.recordFailedAttempt(clientIp);

    // Track security event
    await this.trackSecurityEvent(clientIp, "AUTHENTICATION_FAILURE", {
      error: error.message,
      path: request.raw?.url || "",
      method: request.method,
    });

    // Enhance error message if needed
    if (error instanceof UnauthorizedException) {
      const lockoutStatus = await this.checkLockoutStatus(clientIp);
      if (lockoutStatus.isLocked) {
        error.message = `Account is temporarily locked. Please try again in ${lockoutStatus.remainingMinutes} minutes.`;
      }
    }
  }

  private async checkLockoutStatus(identifier: string): Promise<LockoutStatus> {
    const lockoutKey = `auth:lockout:${identifier}`;

    const lockoutData = await this.redisService.get(lockoutKey);

    if (lockoutData) {
      const { lockedUntil } = JSON.parse(lockoutData) as {
        lockedUntil: number;
      };
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
      const lockoutIndex = Math.min(
        newAttempts - this.MAX_ATTEMPTS,
        this.LOCKOUT_INTERVALS.length - 1,
      );
      const lockoutMinutes = this.LOCKOUT_INTERVALS[lockoutIndex];
      const lockedUntil = Date.now() + lockoutMinutes * 60 * 1000;

      // Set lockout with progressive duration
      await this.redisService.set(
        lockoutKey,
        JSON.stringify({
          lockedUntil,
          attempts: newAttempts,
          lockoutMinutes,
        }),
        lockoutMinutes * 60,
      );

      // Track security event
      await this.trackSecurityEvent(identifier, "ACCOUNT_LOCKOUT", {
        attempts: newAttempts,
        lockoutMinutes,
        lockedUntil: new Date(lockedUntil),
      });
    } else {
      // Update attempts count
      await this.redisService.set(
        attemptsKey,
        newAttempts.toString(),
        this.ATTEMPT_WINDOW,
      );
    }
  }

  private async resetFailedAttempts(identifier: string): Promise<void> {
    const attemptsKey = `auth:attempts:${identifier}`;
    const lockoutKey = `auth:lockout:${identifier}`;
    await Promise.all([
      this.redisService.del(attemptsKey),
      this.redisService.del(lockoutKey),
    ]);
  }

  private validateSecurityHeaders(request: FastifyRequestWithUser): void {
    // Validate Content-Type for POST requests
    if (
      request.method === "POST" &&
      !request.headers["content-type"]?.includes("application/json")
    ) {
      throw new HttpException("Invalid Content-Type", HttpStatus.BAD_REQUEST);
    }

    // Check for required security headers
    if (!request.headers["user-agent"]) {
      throw new HttpException(
        "User-Agent header is required",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private generateDeviceId(userAgent: string): string {
    return crypto.createHash("md5").update(userAgent).digest("hex");
  }

  private extractTokenFromHeader(
    request: FastifyRequestWithUser,
  ): string | undefined {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    return type === "Bearer" ? token : undefined;
  }

  private isPublicPath(path: string): boolean {
    const publicPaths = [
      "/auth/login",
      "/auth/register",
      "/auth/forgot-password",
      "/auth/reset-password",
      "/auth/verify-email",
      "/health",
      "/health/check",
      "/api-health",
      "/docs",
      "/api",
      "/api-json",
      "/swagger",
      "/favicon.ico",
    ];
    return publicPaths.some((publicPath) => path.startsWith(publicPath));
  }
}
