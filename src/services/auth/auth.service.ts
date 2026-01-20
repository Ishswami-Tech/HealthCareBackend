import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@config/config.service';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';
import { HealthcareErrorsService } from '@core/errors';
import { LogType, LogLevel } from '@core/types';
import { EmailService } from '@communication/channels/email/email.service';
import { WhatsAppService } from '@communication/channels/whatsapp/whatsapp.service';
import { SessionManagementService } from '@core/session/session-management.service';
import { RbacService } from '@core/rbac/rbac.service';
import { JwtAuthService } from './core/jwt.service';
import { SocialAuthService } from './core/social-auth.service';
import { OtpService } from './core/otp.service';
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
import { Role } from '@core/types/enums.types';
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
    private readonly whatsAppService: WhatsAppService,
    private readonly sessionService: SessionManagementService,
    private readonly rbacService: RbacService,
    private readonly jwtAuthService: JwtAuthService,
    private readonly socialAuthService: SocialAuthService,
    private readonly otpService: OtpService
  ) {
    // Defensive check: ensure configService is available
    if (!this.configService) {
      void this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'ConfigService is not injected',
        'AuthService.constructor',
        {}
      );
    }
  }

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
  /**
   * Single registration endpoint for all users (primarily PATIENT)
   * Simplified for production - handles clinic validation, user creation, and patient record
   */
  async register(
    registerDto: RegisterDto,
    _sessionMetadata?: { userAgent?: string; ipAddress?: string }
  ): Promise<AuthResponse> {
    try {
      // 1. Validate clinicId (required)
      if (!registerDto.clinicId) {
        throw this.errors.validationError(
          'clinicId',
          'Clinic ID is required for registration',
          'AuthService.register'
        );
      }

      // 2. Resolve and validate clinic
      const { resolveClinicUUID } = await import('@utils/clinic.utils');
      const clinicUUID = await resolveClinicUUID(this.databaseService, registerDto.clinicId);
      const clinic = await this.databaseService.findClinicByIdSafe(clinicUUID);

      if (!clinic || !clinic.isActive) {
        throw this.errors.clinicNotFound(registerDto.clinicId, 'AuthService.register');
      }

      // 3. Verify OTP if provided
      if (registerDto.otp) {
        const identifier = registerDto.phone || registerDto.email;
        if (!identifier) {
          throw this.errors.validationError(
            'identifier',
            'Phone or Email required for OTP verification',
            'AuthService.register'
          );
        }
        const verificationResult = await this.otpService.verifyOtp(identifier, registerDto.otp);
        if (!verificationResult.success) {
          throw this.errors.validationError(
            'otp',
            verificationResult.message || 'Invalid OTP',
            'AuthService.register'
          );
        }
      }

      // 4. Check if user already exists
      const existingUser = await this.databaseService.findUserByEmailSafe(registerDto.email);
      if (existingUser) {
        throw this.errors.emailAlreadyExists(registerDto.email, 'AuthService.register');
      }

      // 5. Create user
      const hashedPassword = await bcrypt.hash(registerDto.password, 12);
      // Age handling for registration (profile completion happens after login)
      // - If DOB is provided during registration, calculate age and validate
      // - If DOB is not provided, use safe default (will be updated during profile completion)
      const age = registerDto.dateOfBirth
        ? (() => {
            const calculatedAge = Math.floor(
              (Date.now() - new Date(registerDto.dateOfBirth).getTime()) /
                (365.25 * 24 * 60 * 60 * 1000)
            );
            // Validate minimum age if DOB is provided
            if (calculatedAge < 12) {
              throw this.errors.validationError(
                'dateOfBirth',
                'User must be at least 12 years old to register',
                'AuthService.register'
              );
            }
            return calculatedAge;
          })()
        : 12; // Safe default - will be updated during profile completion with actual DOB

      const user = await this.databaseService.createUserSafe({
        email: registerDto.email,
        password: hashedPassword,
        userid: uuidv4(),
        name: `${registerDto.firstName} ${registerDto.lastName}`,
        age,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        ...(registerDto.phone && { phone: registerDto.phone }),
        ...(registerDto.dateOfBirth && { dateOfBirth: new Date(registerDto.dateOfBirth) }),
        ...(registerDto.gender && { gender: registerDto.gender }),
        ...(registerDto.address && { address: registerDto.address }),
        role: (registerDto.role || 'PATIENT') as Role,
        primaryClinicId: clinicUUID,
        ...(registerDto.googleId && { googleId: registerDto.googleId }),
        isVerified: !!registerDto.otp || !!registerDto.googleId,
      });

      // 6. Create Patient record if role is PATIENT
      if ((registerDto.role || 'PATIENT') === 'PATIENT') {
        try {
          await this.databaseService.executeHealthcareWrite(
            async client => {
              const typedClient = client as unknown as {
                patient: {
                  create: (args: { data: { userId: string } }) => Promise<{ id: string }>;
                };
              };
              await typedClient.patient.create({ data: { userId: user.id } });
            },
            {
              userId: user.id,
              clinicId: clinicUUID,
              resourceType: 'PATIENT',
              operation: 'CREATE',
              resourceId: user.id,
              userRole: 'PATIENT',
              details: { registration: true },
            }
          );
        } catch (patientError) {
          await this.logging.log(
            LogType.ERROR,
            LogLevel.WARN,
            `Failed to create patient record: ${(patientError as Error).message}`,
            'AuthService.register',
            { userId: user.id }
          );
        }
      }

      // 7. Send OTP and return response
      await this.eventService.emit('user.registered', {
        userId: user.id,
        email: user.email,
        role: user.role,
        clinicId: clinicUUID,
      });
      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `User registered: ${user.email}`,
        'AuthService.register',
        { userId: user.id, email: user.email, role: user.role }
      );

      const identifier = registerDto.phone || registerDto.email;
      await this.requestOtp({ identifier, clinicId: clinicUUID });

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName || undefined,
          lastName: user.lastName || undefined,
          role: user.role as Role,
          isVerified: false,
        },
        requiresVerification: true,
        message:
          'Registration successful. Please verify your account with the OTP sent to your registered contact.',
      };
    } catch (error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Registration failed for ${registerDto.email}`,
        'AuthService.register',
        {
          email: registerDto.email,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * User login
   */
  async login(
    loginDto: LoginDto,
    sessionMetadata?: { userAgent?: string; ipAddress?: string }
  ): Promise<AuthResponse> {
    try {
      // Find user directly without caching for login (password must be fresh)
      // Use findUserByEmailForAuth which explicitly selects the password field
      const userResult = (await this.databaseService.findUserByEmailForAuth(loginDto.email)) as
        | (UserWithRelations & { password: string })
        | null;

      if (!userResult) {
        await this.logging.log(
          LogType.SECURITY,
          LogLevel.DEBUG,
          `User not found for login: ${loginDto.email}`,
          'AuthService.login'
        );
        throw this.errors.invalidCredentials('AuthService.login');
      }
      // userResult already has the correct type (UserWithRelations & { password: string })
      const user: UserWithRelations & { password: string } = userResult;

      // Check if user has a password (required for password-based login)
      if (!user.password) {
        await this.logging.log(
          LogType.SECURITY,
          LogLevel.WARN,
          `Login attempt for user without password: ${loginDto.email}`,
          'AuthService.login',
          { email: loginDto.email, userId: user.id }
        );
        throw this.errors.invalidCredentials('AuthService.login');
      }

      // Verify password using optimized bcrypt comparison
      const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
      if (!isPasswordValid) {
        await this.logging.log(
          LogType.SECURITY,
          LogLevel.WARN,
          `Invalid password attempt for: ${loginDto.email}`,
          'AuthService.login',
          { email: loginDto.email, userId: user.id }
        );
        throw this.errors.invalidCredentials('AuthService.login');
      }

      // Create session first - handle null clinicId
      // Session is stored in Redis via SessionManagementService
      // Fastify session will be set in controller if request object is available
      const clinicId = loginDto.clinicId || user.primaryClinicId || undefined;
      const session = await this.sessionService.createSession({
        userId: user.id,
        userAgent: sessionMetadata?.userAgent || 'Login',
        ipAddress: sessionMetadata?.ipAddress || '127.0.0.1',
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
        ...(user.primaryClinicId && { primaryClinicId: user.primaryClinicId }),
      };
      const tokens = await this.generateTokens(
        userForTokens,
        session.sessionId,
        undefined,
        sessionMetadata?.userAgent,
        sessionMetadata?.ipAddress
      );

      // Update last login
      await this.databaseService.updateUserSafe(user.id, {
        lastLogin: new Date(),
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
          firstName: user.firstName || undefined,
          lastName: user.lastName || undefined,
          role: user.role as Role,
          isVerified: user.isVerified,
          clinicId: user.primaryClinicId || undefined,
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
  async refreshToken(
    refreshTokenDto: RefreshTokenDto,
    sessionMetadata?: { userAgent?: string; ipAddress?: string }
  ): Promise<AuthTokens> {
    try {
      // Use enhanced JWT refresh with security validation
      return await this.jwtAuthService.refreshEnhancedToken(
        refreshTokenDto.refreshToken,
        refreshTokenDto.deviceFingerprint,
        sessionMetadata?.userAgent || refreshTokenDto.userAgent,
        sessionMetadata?.ipAddress || refreshTokenDto.ipAddress
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
  async logout(
    sessionId: string,
    sessionMetadata?: { userAgent?: string; ipAddress?: string }
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Try to invalidate session, but don't fail if cache is unavailable
      try {
        await this.sessionService.invalidateSession(sessionId);
      } catch (sessionError) {
        // Log but don't fail - session invalidation is best effort
        await this.logging.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Session invalidation failed (non-critical): ${sessionId}`,
          'AuthService.logout',
          {
            sessionId,
            error: sessionError instanceof Error ? sessionError.message : String(sessionError),
          }
        );
      }

      // Try to emit logout event, but don't fail if event service is unavailable
      try {
        await this.eventService.emit('user.logged_out', {
          sessionId,
        });
      } catch (eventError) {
        // Log but don't fail - event emission is best effort
        await this.logging.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Logout event emission failed (non-critical): ${sessionId}`,
          'AuthService.logout',
          {
            sessionId,
            error: eventError instanceof Error ? eventError.message : String(eventError),
          }
        );
      }

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `User logged out: session ${sessionId}`,
        'AuthService.logout',
        {
          sessionId,
          ipAddress: sessionMetadata?.ipAddress,
          userAgent: sessionMetadata?.userAgent,
        }
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
    requestDto: PasswordResetRequestDto,
    sessionMetadata?: { userAgent?: string; ipAddress?: string }
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
      // Use user's primary clinic for multi-tenant email routing
      await this.emailService.sendEmail({
        to: user.email,
        subject: 'Password Reset Request',
        template: EmailTemplate.PASSWORD_RESET,
        context: {
          name: `${user.firstName} ${user.lastName}`,
          resetUrl: (() => {
            const frontendUrl =
              this.configService.getUrlsConfig()?.frontend ??
              this.configService.getEnv('FRONTEND_URL');

            if (!frontendUrl) {
              throw new Error(
                'Missing required environment variable: FRONTEND_URL. ' +
                  'Cannot generate password reset URL without frontend URL.'
              );
            }

            return `${frontendUrl}/reset-password?token=${resetToken}`;
          })(),
        },
        ...(user.primaryClinicId && { clinicId: user.primaryClinicId }),
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
        {
          userId: user.id,
          email: user.email,
          ipAddress: sessionMetadata?.ipAddress,
          userAgent: sessionMetadata?.userAgent,
        }
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
  /**
   * Reset password
   */
  async resetPassword(
    resetDto: PasswordResetDto,
    sessionMetadata?: { userAgent?: string; ipAddress?: string }
  ): Promise<{ success: boolean; message: string }> {
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
      const hashedPassword = await bcrypt.hash(resetDto.newPassword, 12);

      // Update password - use type assertion to include password field
      await this.databaseService.updateUserSafe(user.id, {
        password: hashedPassword,
        passwordChangedAt: new Date(),
        updatedAt: new Date(),
      } as UserUpdateInput);

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
        {
          userId: user.id,
          email: user.email,
          ipAddress: sessionMetadata?.ipAddress,
          userAgent: sessionMetadata?.userAgent,
        }
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
    changeDto: ChangePasswordDto,
    sessionMetadata?: { userAgent?: string; ipAddress?: string }
  ): Promise<{ success: boolean; message: string }> {
    try {
      const userResult = await this.databaseService.findUserByIdSafe(userId);
      // userResult doesn't contain password, need to fetch it explicitly for comparison if needed
      // But actually findUserByIdSafe might not return password depending on implementation.
      // Let's assume we need to verify current password.

      const userWithPassword = (await this.databaseService.findUserByEmailForAuth(
        userResult?.email || ''
      )) as (UserWithRelations & { password: string }) | null;

      if (!userWithPassword || !userWithPassword.password) {
        throw this.errors.userNotFound(userId, 'AuthService.changePassword');
      }

      // Verify current password
      const isPasswordValid = await bcrypt.compare(
        changeDto.currentPassword,
        userWithPassword.password
      );
      if (!isPasswordValid) {
        throw this.errors.invalidCredentials('AuthService.changePassword');
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(changeDto.newPassword, 12);

      // Update password
      await this.databaseService.updateUserSafe(userId, {
        password: hashedPassword,
        passwordChangedAt: new Date(),
        updatedAt: new Date(),
      } as UserUpdateInput);

      // Invalidate all user sessions
      await this.sessionService.revokeAllUserSessions(userId);

      // Invalidate user cache
      await this.invalidateUserCache(userId, userWithPassword.primaryClinicId || undefined);

      // Emit password changed event
      await this.eventService.emit('user.password_changed', {
        userId: userId,
        email: userWithPassword.email,
      });

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `Password changed for user: ${userId}`,
        'AuthService.changePassword',
        {
          userId,
          email: userWithPassword.email,
          ipAddress: sessionMetadata?.ipAddress,
          userAgent: sessionMetadata?.userAgent,
        }
      );

      return {
        success: true,
        message: 'Password changed successfully',
      };
    } catch (_error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Change password failed for user ${userId}`,
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
  async requestOtp(
    requestDto: RequestOtpDto,
    sessionMetadata?: { userAgent?: string; ipAddress?: string }
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Determine if identifier is email or phone
      const isEmail = requestDto.identifier.includes('@');
      let user: UserWithRelations | null = null;

      if (isEmail) {
        user = await this.databaseService.findUserByEmailSafe(requestDto.identifier);
      } else {
        // Find by phone
        const users = await this.databaseService.findUsersSafe(
          { phone: requestDto.identifier },
          { take: 1 }
        );
        user = users[0] || null;
      }

      if (!user) {
        throw this.errors.userNotFound(undefined, 'AuthService.requestOtp');
      }

      // Extract clinicId from requestDto or user's primary clinic
      const clinicId = requestDto.clinicId || user.primaryClinicId || undefined;
      const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User';

      let result;
      if (isEmail) {
        result = await this.otpService.sendOtpEmail(user.email, userName, 'login', clinicId);
      } else {
        // For phone, we use the user's stored phone number
        if (!user.phone) {
          throw new Error('User does not have a phone number linked');
        }
        result = await this.otpService.sendOtpSms(user.phone, 'login', clinicId);
      }

      if (!result.success) {
        throw new Error(result.message || 'Failed to send OTP');
      }

      // Emit OTP requested event
      await this.eventService.emit('user.otp_requested', {
        userId: user.id,
        email: user.email,
        ...(user.phone && { phone: user.phone }),
        ...(clinicId && { clinicId }),
      });

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `OTP requested for: ${requestDto.identifier}`,
        'AuthService.requestOtp',
        {
          identifier: requestDto.identifier,
          method: isEmail ? 'Email' : 'SMS',
          ipAddress: sessionMetadata?.ipAddress,
          userAgent: sessionMetadata?.userAgent,
        }
      );

      return {
        success: true,
        message: result.message || 'OTP sent successfully',
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
  /**
   * Verify OTP
   */
  async verifyOtp(
    verifyDto: VerifyOtpRequestDto,
    sessionMetadata?: { userAgent?: string; ipAddress?: string }
  ): Promise<AuthResponse> {
    try {
      // Determine if identifier is email or phone
      // Simple check: if it contains '@', assume email
      const isEmail = verifyDto.identifier.includes('@');
      let user: UserWithRelations | null = null;

      if (isEmail) {
        user = await this.databaseService.findUserByEmailSafe(verifyDto.identifier);
      } else {
        // Find by phone
        // Uses findUsersSafe which returns an array, take the first one
        const users = await this.databaseService.findUsersSafe(
          { phone: verifyDto.identifier },
          { take: 1 }
        );
        user = users[0] || null;
      }

      if (!user) {
        // Return proper 400 error instead of 500
        throw this.errors.userNotFound(undefined, 'AuthService.verifyOtp');
      }

      // Verify OTP using dedicated service
      // This handles cache lookup and deletion
      const verificationResult = await this.otpService.verifyOtp(
        verifyDto.identifier,
        verifyDto.otp
      );

      if (!verificationResult.success) {
        // Return proper 400 error instead of 500
        throw this.errors.otpInvalid('AuthService.verifyOtp');
      }

      // Legacy cleanup: Also try to delete OTP stored by user ID if it exists (legacy support)
      await this.cacheService.del(`otp:${user.id}`).catch(() => {});

      // Create session first
      // Session is stored in Redis via SessionManagementService
      // Fastify session will be set in controller if request object is available
      const clinicId = verifyDto.clinicId || user.primaryClinicId || undefined;
      const session = await this.sessionService.createSession({
        userId: user.id,
        userAgent: sessionMetadata?.userAgent || 'OTP Login',
        ipAddress: sessionMetadata?.ipAddress || '127.0.0.1',
        metadata: { otpLogin: true },
        ...(clinicId && { clinicId }),
      });

      // Generate tokens with session ID - handle null phone
      // Include clinicId from login or user's primary clinic
      const userForTokens: UserProfile = {
        id: user.id,
        email: user.email,
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        role: user.role,
        ...(user.phone && { phone: user.phone }),
        // Include clinicId: from verifyDto, or user's primaryClinicId
        ...(clinicId || user.primaryClinicId
          ? { clinicId: clinicId || user.primaryClinicId || '' }
          : {}),
        ...(user.primaryClinicId && { primaryClinicId: user.primaryClinicId }),
      };
      const tokens = await this.generateTokens(
        userForTokens,
        session.sessionId,
        undefined,
        sessionMetadata?.userAgent,
        sessionMetadata?.ipAddress
      );

      // Update last login
      await this.databaseService.updateUserSafe(user.id, {
        lastLogin: new Date(),
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
          firstName: user.firstName || undefined,
          lastName: user.lastName || undefined,
          role: user.role as Role,
          isVerified: user.isVerified,
          clinicId: user.primaryClinicId || undefined,
        },
      };
    } catch (_error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `OTP verification failed for ${verifyDto.identifier}`,
        'AuthService.verifyOtp',
        {
          identifier: verifyDto.identifier,
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
    // Extract clinicId: prefer explicit clinicId, fallback to primaryClinicId
    const clinicId =
      ('clinicId' in user && user.clinicId) ||
      ('primaryClinicId' in user && user.primaryClinicId) ||
      undefined;

    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role || '',
      domain: 'healthcare',
      sessionId: sessionId,
      ...(clinicId && { clinicId }),
    };

    // Use enhanced JWT service for advanced features
    return await this.jwtAuthService.generateEnhancedTokens(
      payload,
      deviceFingerprint,
      userAgent,
      ipAddress
    );
  }

  /**
   * Authenticate with Google OAuth
   * @param googleToken - Google ID token or access token
   * @param clinicId - Optional clinic ID for multi-tenant context
   * @returns AuthResponse with JWT tokens and user information
   */
  async authenticateWithGoogle(
    googleToken: string,
    clinicId?: string,
    sessionMetadata?: { userAgent?: string; ipAddress?: string }
  ): Promise<AuthResponse> {
    try {
      // Verify Google token and get user info
      const socialAuthResult = await this.socialAuthService.authenticateWithGoogle(googleToken);

      if (!socialAuthResult.success || !socialAuthResult.user) {
        throw this.errors.invalidCredentials('AuthService.authenticateWithGoogle');
      }

      // Type assertion for social user - we know the structure from SocialAuthService.processSocialUser
      const socialUser = socialAuthResult.user as
        | {
            id: string;
            email: string;
            firstName?: string;
            lastName?: string;
            role?: string;
            isVerified?: boolean;
            profilePicture?: string;
          }
        | null
        | undefined;

      if (!socialUser || !socialUser.email) {
        throw this.errors.invalidCredentials('AuthService.authenticateWithGoogle');
      }

      const userEmail: string = socialUser.email;
      const userId: string = socialUser.id;

      // Find the full user record
      const fullUser = await this.databaseService.findUserByEmailSafe(userEmail);
      if (!fullUser) {
        throw this.errors.userNotFound(userId, 'AuthService.authenticateWithGoogle');
      }

      // Determine clinic ID
      const finalClinicId = clinicId || fullUser.primaryClinicId || undefined;

      // Create session
      const session = await this.sessionService.createSession({
        userId: fullUser.id,
        userAgent: sessionMetadata?.userAgent || 'Google OAuth',
        ipAddress: sessionMetadata?.ipAddress || '127.0.0.1',
        metadata: { googleOAuth: true, isNewUser: socialAuthResult.isNewUser },
        ...(finalClinicId && { clinicId: finalClinicId }),
      });

      // Generate tokens
      // Include clinicId from OAuth or user's primary clinic
      const userForTokens: UserProfile = {
        id: fullUser.id,
        email: fullUser.email,
        name:
          fullUser.name ||
          `${fullUser.firstName || ''} ${fullUser.lastName || ''}`.trim() ||
          fullUser.email,
        role: fullUser.role,
        ...(fullUser.phone && { phone: fullUser.phone }),
        // Include clinicId: from OAuth clinicId, or user's primaryClinicId
        ...(finalClinicId || fullUser.primaryClinicId
          ? { clinicId: (finalClinicId || fullUser.primaryClinicId) as string }
          : {}),
        ...(fullUser.primaryClinicId && { primaryClinicId: fullUser.primaryClinicId }),
      };

      const tokens = await this.generateTokens(
        userForTokens,
        session.sessionId,
        undefined,
        sessionMetadata?.userAgent,
        sessionMetadata?.ipAddress
      );

      // Update last login
      await this.databaseService.updateUserSafe(fullUser.id, {
        lastLogin: new Date(),
      });

      // Emit Google OAuth login event
      await this.eventService.emit('user.google_oauth_logged_in', {
        userId: fullUser.id,
        email: fullUser.email,
        role: fullUser.role,
        clinicId: finalClinicId,
        sessionId: session.sessionId,
        isNewUser: socialAuthResult.isNewUser,
      });

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `Google OAuth login successful for: ${fullUser.email}${socialAuthResult.isNewUser ? ' (new user)' : ''}`,
        'AuthService.authenticateWithGoogle',
        { userId: fullUser.id, email: fullUser.email, role: fullUser.role, clinicId: finalClinicId }
      );

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: fullUser.id,
          email: fullUser.email,
          firstName: fullUser.firstName || undefined,
          lastName: fullUser.lastName || undefined,
          role: fullUser.role as Role,
          isVerified: fullUser.isVerified,
          clinicId: finalClinicId || undefined,
          profilePicture: fullUser.profilePicture || undefined,
        },
      };
    } catch (_error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Google OAuth authentication failed`,
        'AuthService.authenticateWithGoogle',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }
}
