/**
 * WEBSOCKET AUTHENTICATION MIDDLEWARE
 * ====================================
 * Validates JWT tokens on WebSocket connection
 * Extracts user data for automatic room joining
 */

import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';

export interface AuthenticatedUser {
  userId: string;
  clinicId?: string;
  role?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

@Injectable()
export class SocketAuthMiddleware {
  private readonly logger = new Logger(SocketAuthMiddleware.name);

  constructor(private readonly jwtService: JwtService) {}

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
        this.logger.log(
          `Client authenticated via session: ${client.id} (User: ${sessionUser.userId})`,
        );
        return sessionUser;
      }

      // Fall back to JWT token auth
      const token = this.extractToken(client);

      if (!token) {
        this.logger.warn(`Connection rejected: No token or session (${client.id})`);
        throw new Error('Authentication required - no token or session');
      }

      // Verify JWT token
      const payload = await this.jwtService.verifyAsync(token);

      // Extract user data from token
      const user: AuthenticatedUser = {
        userId: payload.sub || payload.userId || payload.id,
        clinicId: payload.clinicId,
        role: payload.role,
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
      };

      if (!user.userId) {
        this.logger.warn(`Invalid token payload: Missing userId (${client.id})`);
        throw new Error('Invalid token - missing user ID');
      }

      this.logger.log(
        `Client authenticated via JWT: ${client.id} (User: ${user.userId}, Role: ${user.role})`,
      );

      return user;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Authentication failed for ${client.id}: ${errorMessage}`);
      throw new Error(`Authentication failed: ${errorMessage}`);
    }
  }

  /**
   * Extract user data from session (if available)
   */
  private extractFromSession(client: Socket): AuthenticatedUser | null {
    try {
      // Access session from socket handshake (if session middleware is enabled)
      const request = client.request as any;
      const session = request?.session;

      if (!session || !session.user) {
        return null;
      }

      const user: AuthenticatedUser = {
        userId: session.user.id || session.user.userId,
        clinicId: session.user.clinicId,
        role: session.user.role,
        email: session.user.email,
        firstName: session.user.firstName,
        lastName: session.user.lastName,
      };

      return user.userId ? user : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract JWT token from socket connection
   */
  private extractToken(client: Socket): string | null {
    // Try auth object first (socket.io v4 recommended way)
    if (client.handshake.auth?.token) {
      return client.handshake.auth.token;
    }

    // Try query parameters (fallback)
    if (client.handshake.query?.token) {
      return client.handshake.query.token as string;
    }

    // Try authorization header
    const authHeader = client.handshake.headers.authorization;
    if (authHeader) {
      // Remove 'Bearer ' prefix if present
      return authHeader.replace(/^Bearer\s+/i, '');
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
      this.logger.debug(`Optional auth failed for ${client.id}, allowing anonymous connection`);
      return null;
    }
  }
}
