import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TokenPayload, AuthTokens } from '../../../libs/core/types';

@Injectable()
export class JwtAuthService {
  private readonly logger = new Logger(JwtAuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generate access token
   */
  async generateAccessToken(payload: TokenPayload): Promise<string> {
    try {
      return await this.jwtService.signAsync(payload, {
        expiresIn: this.configService.get('JWT_ACCESS_EXPIRES_IN') || '15m',
      });
    } catch (error) {
      this.logger.error('Failed to generate access token', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  /**
   * Generate refresh token
   */
  async generateRefreshToken(payload: TokenPayload): Promise<string> {
    try {
      return await this.jwtService.signAsync(payload, {
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN') || '7d',
      });
    } catch (error) {
      this.logger.error('Failed to generate refresh token', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  /**
   * Generate both access and refresh tokens
   */
  async generateTokens(payload: TokenPayload): Promise<AuthTokens> {
    try {
      const [accessToken, refreshToken] = await Promise.all([
        this.generateAccessToken(payload),
        this.generateRefreshToken(payload),
      ]);

      return {
        accessToken,
        refreshToken,
        expiresIn: 15 * 60, // 15 minutes
        sessionId: payload.sessionId || '',
      };
    } catch (error) {
      this.logger.error('Failed to generate tokens', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  /**
   * Verify token
   */
  async verifyToken(token: string): Promise<TokenPayload> {
    try {
      return await this.jwtService.verifyAsync(token);
    } catch (error) {
      this.logger.error('Failed to verify token', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  /**
   * Decode token without verification
   */
  decodeToken(token: string): TokenPayload | null {
    try {
      return this.jwtService.decode(token) as TokenPayload;
    } catch (error) {
      this.logger.error('Failed to decode token', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      return null;
    }
  }

  /**
   * Get token expiration time
   */
  getTokenExpiration(token: string): Date | null {
    try {
      const decoded = this.decodeToken(token);
      if (decoded && decoded.exp) {
        return new Date(decoded.exp * 1000);
      }
      return null;
    } catch (error) {
      this.logger.error('Failed to get token expiration', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      return null;
    }
  }

  /**
   * Check if token is expired
   */
  isTokenExpired(token: string): boolean {
    try {
      const expiration = this.getTokenExpiration(token);
      if (!expiration) return true;
      return expiration < new Date();
    } catch (error) {
      this.logger.error('Failed to check token expiration', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      return true;
    }
  }
}
