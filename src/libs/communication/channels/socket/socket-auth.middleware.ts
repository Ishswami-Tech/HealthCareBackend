/**
 * WEBSOCKET AUTHENTICATION MIDDLEWARE
 * ====================================
 * Validates JWT tokens on WebSocket connection
 * Extracts user data for automatic room joining
 */

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import type { IncomingMessage } from 'http';
import { Socket } from 'socket.io';

export interface AuthenticatedUser {
  userId: string;
  clinicId?: string;
  role?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

interface SessionUserData {
  id?: string;
  userId?: string;
  clinicId?: string;
  role?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

interface SocketSession extends IncomingMessage {
  session?: {
    user?: SessionUserData;
  };
}

interface JwtPayload extends AuthenticatedUser {
  sub?: string;
  id?: string;
}

type HandshakeQueryValue = string | string[] | null | undefined;

interface SocketHandshakeHeaders {
  authorization?: string | string[];
}

interface SocketHandshake {
  auth?: {
    token?: string | string[] | null;
  };
  query: Record<string, HandshakeQueryValue>;
  headers: SocketHandshakeHeaders;
}

@Injectable()
export class SocketAuthMiddleware {
  constructor(
    private readonly jwtService: JwtService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Validate WebSocket connection with JWT token or session
   * @param client - Socket client
   * @returns Authenticated user data
   */
  async validateConnection(client: Socket): Promise<AuthenticatedUser> {
    try {
      // Try session-based auth first (if available)
      const sessionUser = this.extractFromSession(client);
      if (sessionUser) {
        void this.loggingService.log(
          LogType.AUTH,
          LogLevel.INFO,
          `Client authenticated via session: ${client.id} (User: ${sessionUser.userId})`,
          'SocketAuthMiddleware'
        );
        return sessionUser;
      }

      // Fall back to JWT token auth
      const token = this.extractToken(client);

      if (!token) {
        void this.loggingService.log(
          LogType.AUTH,
          LogLevel.WARN,
          `Connection rejected: No token or session (${client.id})`,
          'SocketAuthMiddleware'
        );
        throw new HealthcareError(
          ErrorCode.AUTH_TOKEN_INVALID,
          'Authentication required - no token or session',
          undefined,
          { clientId: client.id },
          'SocketAuthMiddleware.validateConnection'
        );
      }

      // Verify JWT token
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      // Extract user data from token
      const userId = payload.sub || payload.userId || payload.id;
      if (!userId) {
        void this.loggingService.log(
          LogType.AUTH,
          LogLevel.WARN,
          `Invalid token payload: Missing userId (${client.id})`,
          'SocketAuthMiddleware'
        );
        throw new HealthcareError(
          ErrorCode.AUTH_TOKEN_INVALID,
          'Invalid token - missing user ID',
          undefined,
          { clientId: client.id },
          'SocketAuthMiddleware.validateConnection'
        );
      }

      const user: AuthenticatedUser = {
        userId,
        ...(payload.clinicId && { clinicId: payload.clinicId }),
        ...(payload.role && { role: payload.role }),
        ...(payload.email && { email: payload.email }),
        ...(payload.firstName && { firstName: payload.firstName }),
        ...(payload.lastName && { lastName: payload.lastName }),
      };

      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.INFO,
        `Client authenticated via JWT: ${client.id} (User: ${user.userId}, Role: ${user.role})`,
        'SocketAuthMiddleware'
      );

      return user;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.ERROR,
        `Authentication failed for ${client.id}: ${errorMessage}`,
        'SocketAuthMiddleware',
        { clientId: client.id, error: errorMessage }
      );
      if (error instanceof HealthcareError) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.AUTH_TOKEN_INVALID,
        `Authentication failed: ${errorMessage}`,
        undefined,
        { clientId: client.id, originalError: errorMessage },
        'SocketAuthMiddleware.validateConnection'
      );
    }
  }

  /**
   * Extract user data from session (if available)
   */
  private extractFromSession(client: Socket): AuthenticatedUser | null {
    const request = client.request;

    if (!this.isSocketSession(request) || !request.session?.user) {
      return null;
    }

    const { user } = request.session;
    const userId = user.id ?? user.userId;

    if (!userId) {
      return null;
    }

    return {
      userId,
      ...(user.clinicId && { clinicId: user.clinicId }),
      ...(user.role && { role: user.role }),
      ...(user.email && { email: user.email }),
      ...(user.firstName && { firstName: user.firstName }),
      ...(user.lastName && { lastName: user.lastName }),
    };
  }

  private isSocketSession(request: IncomingMessage): request is SocketSession {
    const potentialSession = request as SocketSession;
    return typeof potentialSession.session === 'object' && potentialSession.session !== null;
  }

  /**
   * Extract JWT token from socket connection
   */
  private extractToken(client: Socket): string | null {
    const handshake = client.handshake as SocketHandshake;

    const authToken = this.normalizeTokenValue(handshake.auth?.token ?? null);
    if (authToken) {
      return authToken;
    }

    const queryToken = this.normalizeTokenValue(handshake.query?.['token'] ?? null);
    if (queryToken) {
      return queryToken;
    }

    const headerToken = this.normalizeAuthorizationHeader(handshake.headers?.authorization);
    if (headerToken) {
      return headerToken;
    }

    return null;
  }

  private normalizeTokenValue(value: string | string[] | null | undefined): string | null {
    if (typeof value === 'string') {
      const trimmedValue = value.trim();
      return trimmedValue.length > 0 ? trimmedValue : null;
    }

    if (Array.isArray(value)) {
      const firstToken = value.find(
        (item): item is string => typeof item === 'string' && item.trim().length > 0
      );

      return firstToken ? firstToken.trim() : null;
    }

    return null;
  }

  private normalizeAuthorizationHeader(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) {
      const headerToken = value.find(
        (item): item is string => typeof item === 'string' && item.trim().length > 0
      );

      return headerToken ? headerToken.replace(/^Bearer\s+/i, '').trim() : null;
    }

    if (typeof value === 'string') {
      const trimmedValue = value.trim();
      return trimmedValue.length > 0 ? trimmedValue.replace(/^Bearer\s+/i, '').trim() : null;
    }

    return null;
  }

  /**
   * Validate token without throwing (for optional auth)
   */
  async validateOptional(client: Socket): Promise<AuthenticatedUser | null> {
    try {
      return await this.validateConnection(client);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.DEBUG,
        `Optional auth failed for ${client.id}, allowing anonymous connection: ${errorMessage}`,
        'SocketAuthMiddleware'
      );
      return null;
    }
  }
}
