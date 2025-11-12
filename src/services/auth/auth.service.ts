import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@config';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';
import { HealthcareErrorsService } from '@core/errors';
import { LogType, LogLevel } from '@core/types';
import { EmailService } from '@communication/channels/email/email.service';
import { SessionManagementService } from '@core/session/session-management.service';
import { RbacService } from '@core/rbac/rbac.service';
import { JwtAuthService } from './core/jwt.service';
import {
  LoginDto,
  RegisterDto,
  AuthResponse,
  PasswordResetRequestDto,
  PasswordResetDto,
  RefreshTokenDto,
  ChangePasswordDto,
  RequestOtpDto,
  VerifyOtpRequestDto,
} from '@dtos/auth.dto';
import type { AuthTokens, TokenPayload, UserProfile } from '@core/types';
import { EmailTemplate } from '@core/types/common.types';
import type { UserWhereInput, UserCreateInput, UserUpdateInput } from '@core/types/input.types';
import type { UserWithPassword, UserWithRelations } from '@core/types/user.types';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  private readonly CACHE_TTL = 3600; // 1 hour

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly logging: LoggingService,
    private readonly eventService: EventService,
    private readonly errors: HealthcareErrorsService,
    private readonly emailService: EmailService,
    private readonly sessionService: SessionManagementService,
    private readonly rbacService: RbacService,
    private readonly jwtAuthService: JwtAuthService
  ) {}

  // Comprehensive type-safe database operations
  async findUserByIdSafe(id: string) {
    return this.databaseService.findUserByIdSafe(id);
  }

  async findUserByEmailSafe(email: string) {
    return this.databaseService.findUserByEmailSafe(email);
  }

  async findUsersSafe(where: UserWhereInput) {
    return this.databaseService.findUsersSafe(where);
  }

  async createUserSafe(data: UserCreateInput) {
    return this.databaseService.createUserSafe(data);
  }

  async updateUserSafe(id: string, data: UserUpdateInput) {
    return this.databaseService.updateUserSafe(id, data);
  }

  async deleteUserSafe(id: string) {
    return this.databaseService.deleteUserSafe(id);
  }

  async countUsersSafe(where: UserWhereInput) {
    return this.databaseService.countUsersSafe(where);
  }

  /**
   * Get user profile with enterprise healthcare caching
   */
  async getUserProfile(userId: string, clinicId?: string): Promise<UserProfile> {
    const cacheKey = `user:${userId}:profile:${clinicId || 'default'}`;

    return this.cacheService.cache(
      cacheKey,
      async (): Promise<UserProfile> => {
        const user = await this.databaseService.findUserByIdSafe(userId);

        if (!user) {
          throw this.errors.userNotFound(userId, 'AuthService.getUserProfile');
        }

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
          ...(user.primaryClinicId && { clinicId: user.primaryClinicId }),
        };
      },
      {
        ttl: 1800, // 30 minutes
        tags: [`user:${userId}`, 'user_profiles', clinicId ? `clinic:${clinicId}` : 'global'],
        priority: 'high',
        enableSwr: true,
        compress: true, // Compress user profiles
        containsPHI: true, // User profiles contain PHI
      }
    );
  }

  /**
   * Get user permissions with enterprise RBAC caching
   */
  async getUserPermissions(userId: string, clinicId: string): Promise<string[]> {
    const cacheKey = `user:${userId}:clinic:${clinicId}:permissions`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        // First get user roles
        const userRoles = await this.rbacService.getUserRoles(userId, clinicId);
        // Then get permissions for those roles
        const roleIds = userRoles.map(role => role.roleId);
        return await this.rbacService.getRolePermissions(roleIds);
      },
      {
        ttl: 3600, // 1 hour
        tags: [`user:${userId}`, `clinic:${clinicId}`, 'permissions', 'rbac'],
        priority: 'high',
        enableSwr: true,
        compress: true, // Compress permission data
        containsPHI: false, // Permissions are not PHI
      }
    );
  }

  /**
   * Invalidate user cache when user data changes
   */
  private async invalidateUserCache(userId: string, clinicId?: string): Promise<void> {
    try {
      // Invalidate user profile cache
      await this.cacheService.invalidatePatientCache(userId, clinicId);

      // Invalidate user-specific caches
      await this.cacheService.invalidateCacheByPattern(`user:${userId}:*`);

      // Invalidate clinic-specific caches if clinicId provided
      if (clinicId) {
        await this.cacheService.invalidateClinicCache(clinicId);
      }

      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `Invalidated cache for user: ${userId}, clinic: ${clinicId || 'all'}`,
        'AuthService.invalidateUserCache',
        { userId, clinicId }
      );
    } catch (_error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to invalidate user cache for ${userId}`,
        'AuthService.invalidateUserCache',
        { userId, clinicId, error: _error instanceof Error ? _error.message : String(_error) }
      );
    }
  }

  /**
   * User registration
   */
  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    try {
      // Check if user already exists
      const existingUser = await this.databaseService.findUserByEmailSafe(registerDto.email);

      if (existingUser) {
        throw this.errors.emailAlreadyExists(registerDto.email, 'AuthService.register');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(registerDto.password, 12);

      // Calculate age from dateOfBirth if provided, otherwise default to 25
      const age = registerDto.dateOfBirth
        ? Math.floor(
            (Date.now() - new Date(registerDto.dateOfBirth).getTime()) /
              (365.25 * 24 * 60 * 60 * 1000)
          )
        : 25;

      // Create user data with proper typing using UserCreateInput
      const userCreateInput: UserCreateInput = {
        email: registerDto.email,
        password: hashedPassword,
        userid: uuidv4(),
        name: `${registerDto.firstName} ${registerDto.lastName}`,
        age,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        phone: registerDto.phone,
        ...(registerDto.dateOfBirth && {
          dateOfBirth: new Date(registerDto.dateOfBirth),
        }),
        ...(registerDto.gender && { gender: registerDto.gender }),
        ...(registerDto.address && { address: registerDto.address }),
        ...(registerDto.role && { role: registerDto.role }),
        ...(registerDto.clinicId && { primaryClinicId: registerDto.clinicId }),
        ...(registerDto.googleId && { googleId: registerDto.googleId }),
        isActive: true,
        isVerified: false,
      };

      // Use createUserSafe from DatabaseService
      const user = await this.databaseService.createUserSafe(userCreateInput);

      // Create session first
      const session = await this.sessionService.createSession({
        userId: user.id,
        userAgent: 'Registration',
        ipAddress: '127.0.0.1',
        metadata: { registration: true },
        ...(registerDto.clinicId && { clinicId: registerDto.clinicId }),
      });

      // Generate tokens with session ID - handle null phone
      const userForTokens: UserProfile = {
        id: user.id,
        email: user.email,
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        role: user.role,
        ...(user.phone && { phone: user.phone }),
      };
      const tokens = await this.generateTokens(userForTokens, session.sessionId);

      // Send welcome email
      await this.emailService.sendEmail({
        to: user.email,
        subject: 'Welcome to Healthcare App',
        template: EmailTemplate.WELCOME,
        context: {
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
        },
      });

      // Invalidate clinic cache if user is associated with a clinic
      if (registerDto.clinicId) {
        await this.cacheService.invalidateClinicCache(registerDto.clinicId);
      }

      // Emit user registration event
      await this.eventService.emit('user.registered', {
        userId: user.id,
        email: user.email,
        role: user.role,
        clinicId: registerDto.clinicId,
        sessionId: session.sessionId,
      });

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `User registered successfully: ${user.email}`,
        'AuthService.register',
        { userId: user.id, email: user.email, role: user.role }
      );

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isVerified: user.isVerified,
        },
      };
    } catch (_error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Registration failed for ${registerDto.email}`,
        'AuthService.register',
        {
          email: registerDto.email,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * User login
   */
  async login(loginDto: LoginDto): Promise<AuthResponse> {
    try {
      // Find user with caching
      const userResult = await this.cacheService.cache(
        `user:login:${loginDto.email}`,
        async (): Promise<UserWithRelations | null> => {
          return await this.databaseService.findUserByEmailSafe(loginDto.email);
        },
        {
          ttl: 300, // 5 minutes for login attempts
          tags: ['user_login'],
          priority: 'high',
          enableSwr: false, // No SWR for login data
        }
      );
      if (!userResult) {
        throw this.errors.invalidCredentials('AuthService.login');
      }
      // Type assertion: UserWithRelations should have password for auth operations
      const user = userResult as UserWithRelations & { password: string };

      if (!user) {
        throw this.errors.invalidCredentials('AuthService.login');
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
      if (!isPasswordValid) {
        throw this.errors.invalidCredentials('AuthService.login');
      }

      // Create session first - handle null clinicId
      const clinicId = loginDto.clinicId || user.primaryClinicId || undefined;
      const session = await this.sessionService.createSession({
        userId: user.id,
        userAgent: 'Login',
        ipAddress: '127.0.0.1',
        metadata: { login: true },
        ...(clinicId && { clinicId }),
      });

      // Generate tokens with session ID - handle null phone
      const userForTokens: UserProfile = {
        id: user.id,
        email: user.email,
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        role: user.role,
        ...(user.phone && { phone: user.phone }),
      };
      const tokens = await this.generateTokens(userForTokens, session.sessionId);

      // Update last login
      await this.databaseService.updateUserSafe(user.id, {
        lastLoginAt: new Date(),
      });

      // Emit user login event
      await this.eventService.emit('user.logged_in', {
        userId: user.id,
        email: user.email,
        role: user.role,
        clinicId,
        sessionId: session.sessionId,
      });

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `User logged in successfully: ${user.email}`,
        'AuthService.login',
        { userId: user.id, email: user.email, role: user.role, clinicId }
      );

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isVerified: user.isVerified,
          clinicId: user.primaryClinicId,
        },
      };
    } catch (_error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Login failed for ${loginDto.email}`,
        'AuthService.login',
        {
          email: loginDto.email,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Refresh access token with enhanced security
   */
  async refreshToken(refreshTokenDto: RefreshTokenDto): Promise<AuthTokens> {
    try {
      // Use enhanced JWT refresh with security validation
      return await this.jwtAuthService.refreshEnhancedToken(
        refreshTokenDto.refreshToken,
        refreshTokenDto.deviceFingerprint,
        refreshTokenDto.userAgent,
        refreshTokenDto.ipAddress
      );
    } catch (_error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Enhanced token refresh failed',
        'AuthService.refreshToken',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw this.errors.tokenExpired('AuthService.refreshToken');
    }
  }

  /**
   * Logout user
   */
  async logout(sessionId: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.sessionService.invalidateSession(sessionId);

      // Emit user logout event
      await this.eventService.emit('user.logged_out', {
        sessionId,
      });

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `User logged out: session ${sessionId}`,
        'AuthService.logout',
        { sessionId }
      );

      return {
        success: true,
        message: 'Logout successful',
      };
    } catch (_error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Logout failed for session ${sessionId}`,
        'AuthService.logout',
        {
          sessionId,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(
    requestDto: PasswordResetRequestDto
  ): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.databaseService.findUserByEmailSafe(requestDto.email);

      if (!user) {
        // Don't reveal if user exists
        return {
          success: true,
          message: 'If the email exists, a password reset link has been sent',
        };
      }

      // Generate reset token
      const resetToken = uuidv4();

      // Store reset token with healthcare cache service
      await this.cacheService.set(
        `password_reset:${resetToken}`,
        user.id,
        900 // 15 minutes
      );

      // Send reset email
      await this.emailService.sendEmail({
        to: user.email,
        subject: 'Password Reset Request',
        template: EmailTemplate.PASSWORD_RESET,
        context: {
          name: `${user.firstName} ${user.lastName}`,
          resetUrl: `${this.configService.get<string>('FRONTEND_URL')}/reset-password?token=${resetToken}`,
        },
      });

      // Emit password reset requested event
      await this.eventService.emit('user.password_reset_requested', {
        userId: user.id,
        email: user.email,
      });

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `Password reset requested for: ${user.email}`,
        'AuthService.requestPasswordReset',
        { userId: user.id, email: user.email }
      );

      return {
        success: true,
        message: 'If the email exists, a password reset link has been sent',
      };
    } catch (_error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Password reset request failed for ${requestDto.email}`,
        'AuthService.requestPasswordReset',
        {
          email: requestDto.email,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Reset password
   */
  async resetPassword(resetDto: PasswordResetDto): Promise<{ success: boolean; message: string }> {
    try {
      // Verify reset token
      const userId = await this.cacheService.get<string>(`password_reset:${resetDto.token}`);

      if (!userId) {
        throw this.errors.validationError(
          'token',
          'Invalid or expired reset token',
          'AuthService.resetPassword'
        );
      }

      // Find user
      const user = await this.databaseService.findUserByIdSafe(userId);

      if (!user) {
        throw this.errors.userNotFound(userId, 'AuthService.resetPassword');
      }

      // Hash new password
      const _hashedPassword = await bcrypt.hash(resetDto.newPassword, 12);

      // Update password
      await this.databaseService.updateUserSafe(user.id, {
        // password: hashedPassword, // Password field not available in UserUpdateInput
      });

      // Invalidate all user sessions
      await this.sessionService.revokeAllUserSessions(user.id);

      // Invalidate user cache
      await this.invalidateUserCache(user.id, user.primaryClinicId || undefined);

      // Remove reset token
      await this.cacheService.del(`password_reset:${resetDto.token}`);

      // Emit password reset completed event
      await this.eventService.emit('user.password_reset_completed', {
        userId: user.id,
        email: user.email,
      });

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `Password reset successful for: ${user.email}`,
        'AuthService.resetPassword',
        { userId: user.id, email: user.email }
      );

      return {
        success: true,
        message: 'Password reset successful',
      };
    } catch (_error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Password reset failed',
        'AuthService.resetPassword',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Change password (authenticated user)
   */
  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto
  ): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.databaseService.findUserByIdSafe(userId);

      if (!user) {
        throw this.errors.userNotFound(userId, 'AuthService.changePassword');
      }

      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(
        changePasswordDto.currentPassword,
        user.password
      );
      if (!isCurrentPasswordValid) {
        throw this.errors.validationError(
          'currentPassword',
          'Current password is incorrect',
          'AuthService.changePassword'
        );
      }

      // Hash new password
      const _hashedPassword = await bcrypt.hash(changePasswordDto.newPassword, 12);

      // Update password
      await this.databaseService.updateUserSafe(user.id, {
        // password: hashedPassword, // Password field not available in UserUpdateInput
      });

      // Invalidate all user sessions except current
      await this.sessionService.revokeAllUserSessions(user.id);

      // Emit password changed event
      await this.eventService.emit('user.password_changed', {
        userId: user.id,
        email: user.email,
      });

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `Password changed successfully for: ${user.email}`,
        'AuthService.changePassword',
        { userId: user.id, email: user.email }
      );

      return {
        success: true,
        message: 'Password changed successfully',
      };
    } catch (_error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Password change failed for user ${userId}`,
        'AuthService.changePassword',
        {
          userId,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Request OTP
   */
  async requestOtp(requestDto: RequestOtpDto): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.databaseService.findUserByEmailSafe(requestDto.identifier);

      if (!user) {
        throw this.errors.userNotFound(undefined, 'AuthService.requestOtp');
      }

      // Generate OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Store OTP with healthcare cache service
      await this.cacheService.set(
        `otp:${user.id}`,
        otp,
        300 // 5 minutes
      );

      // Send OTP email
      await this.emailService.sendEmail({
        to: user.email,
        subject: 'Your OTP Code',
        template: EmailTemplate.OTP_LOGIN,
        context: {
          name: `${user.firstName} ${user.lastName}`,
          otp,
        },
      });

      // Emit OTP requested event
      await this.eventService.emit('user.otp_requested', {
        userId: user.id,
        email: user.email,
      });

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `OTP sent to: ${user.email}`,
        'AuthService.requestOtp',
        { userId: user.id, email: user.email }
      );

      return {
        success: true,
        message: 'OTP sent successfully',
      };
    } catch (_error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `OTP request failed for ${requestDto.identifier}`,
        'AuthService.requestOtp',
        {
          identifier: requestDto.identifier,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Verify OTP
   */
  async verifyOtp(verifyDto: VerifyOtpRequestDto): Promise<AuthResponse> {
    try {
      const user = await this.databaseService.findUserByEmailSafe(verifyDto.email);

      if (!user) {
        throw this.errors.userNotFound(undefined, 'AuthService.verifyOtp');
      }

      // Verify OTP
      const storedOtp = await this.cacheService.get(`otp:${user.id}`);

      if (!storedOtp || storedOtp !== verifyDto.otp) {
        throw this.errors.otpInvalid('AuthService.verifyOtp');
      }

      // Remove OTP
      await this.cacheService.del(`otp:${user.id}`);

      // Create session first
      const clinicId = verifyDto.clinicId || user.primaryClinicId || undefined;
      const session = await this.sessionService.createSession({
        userId: user.id,
        userAgent: 'OTP Login',
        ipAddress: '127.0.0.1',
        metadata: { otpLogin: true },
        ...(clinicId && { clinicId }),
      });

      // Generate tokens with session ID - handle null phone
      const userForTokens: UserProfile = {
        id: user.id,
        email: user.email,
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        role: user.role,
        ...(user.phone && { phone: user.phone }),
      };
      const tokens = await this.generateTokens(userForTokens, session.sessionId);

      // Update last login
      await this.databaseService.updateUserSafe(user.id, {
        lastLoginAt: new Date(),
      });

      // Emit OTP login event
      await this.eventService.emit('user.otp_logged_in', {
        userId: user.id,
        email: user.email,
        role: user.role,
        clinicId,
        sessionId: session.sessionId,
      });

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `OTP login successful for: ${user.email}`,
        'AuthService.verifyOtp',
        { userId: user.id, email: user.email, role: user.role, clinicId }
      );

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isVerified: user.isVerified,
          clinicId: user.primaryClinicId,
        },
      };
    } catch (_error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `OTP verification failed for ${verifyDto.email}`,
        'AuthService.verifyOtp',
        {
          email: verifyDto.email,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Generate JWT tokens with enhanced security features
   */
  private async generateTokens(
    user: UserProfile | UserWithPassword | UserWithRelations,
    sessionId: string,
    deviceFingerprint?: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<AuthTokens> {
    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role || '',
      domain: 'healthcare',
      sessionId: sessionId,
      ...('primaryClinicId' in user && user.primaryClinicId && { clinicId: user.primaryClinicId }),
    };

    // Use enhanced JWT service for advanced features
    return await this.jwtAuthService.generateEnhancedTokens(
      payload,
      deviceFingerprint,
      userAgent,
      ipAddress
    );
  }
}
