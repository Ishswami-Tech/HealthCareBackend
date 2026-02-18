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
import type { FastifyReply } from 'fastify';
import { ProfileCompletionService } from '@services/profile-completion/profile-completion.service';

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
    private readonly otpService: OtpService,
    private readonly profileCompletionService: ProfileCompletionService
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
    _sessionMetadata?: { userAgent?: string; ipAddress?: string },
    clinicIdFromHeader?: string // NEW: Accept clinic ID from controller/headers
  ): Promise<AuthResponse> {
    try {
      // 1. SECURITY: Validate body clinicId doesn't mismatch header
      if (
        registerDto.clinicId &&
        clinicIdFromHeader &&
        registerDto.clinicId !== clinicIdFromHeader
      ) {
        await this.logging.log(
          LogType.SECURITY,
          LogLevel.ERROR,
          `Registration attempt with mismatched clinicId: header=${clinicIdFromHeader}, body=${registerDto.clinicId}`,
          'AuthService.register',
          {
            email: registerDto.email,
            headerClinicId: clinicIdFromHeader,
            bodyClinicId: registerDto.clinicId,
          }
        );
        throw this.errors.validationError(
          'clinicId',
          'Clinic ID mismatch detected. Cannot register to a different clinic.',
          'AuthService.register'
        );
      }

      // 2. Get clinic ID from header (preferred) or DTO
      const clinicId = clinicIdFromHeader || registerDto.clinicId;

      if (!clinicId) {
        throw this.errors.validationError(
          'clinicId',
          'Clinic ID is required for registration',
          'AuthService.register'
        );
      }

      // 2. Resolve and validate clinic (before creating user)
      const { resolveClinicUUID } = await import('@utils/clinic.utils');
      const clinicUUID = await resolveClinicUUID(this.databaseService, clinicId);
      const clinic = await this.databaseService.findClinicByIdSafe(clinicUUID);

      if (!clinic || !clinic.isActive) {
        throw this.errors.clinicNotFound(clinicId, 'AuthService.register');
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
    sessionMetadata?: { userAgent?: string; ipAddress?: string },
    clinicIdFromHeader?: string
  ): Promise<AuthResponse> {
    try {
      // ✅ SECURITY: Check if account is locked due to failed login attempts
      const lockKey = `account_lock:${loginDto.email}`;
      const lockData = await this.cacheService.get<string>(lockKey);

      if (lockData) {
        const unlockTime = new Date(lockData);
        if (unlockTime > new Date()) {
          // Account still locked
          await this.logging.log(
            LogType.SECURITY,
            LogLevel.WARN,
            `Login attempt for locked account: ${loginDto.email}`,
            'AuthService.login',
            {
              email: loginDto.email,
              unlockTime: unlockTime.toISOString(),
              ipAddress: sessionMetadata?.ipAddress,
              userAgent: sessionMetadata?.userAgent,
            }
          );
          throw this.errors.accountLocked('AuthService.login');
        } else {
          // Lock expired, clear it
          await this.cacheService.del(lockKey);
          await this.cacheService.del(`failed_login:${loginDto.email}`);
        }
      }

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
        // Track failed attempt for non-existent users (prevent enumeration but still track)
        await this.trackFailedLogin(loginDto.email, sessionMetadata || {});
        throw this.errors.invalidCredentials('AuthService.login');
      }
      // userResult already has the correct type (UserWithRelations & { password: string })
      const user: UserWithRelations & { password: string } = userResult;

      // Check if user has a password (required for password-based login)
      const hasPassword =
        'password' in user && typeof user.password === 'string' && user.password.length > 0;

      if (!hasPassword) {
        await this.logging.log(
          LogType.SECURITY,
          LogLevel.WARN,
          `Login attempt for user without password: ${loginDto.email}`,
          'AuthService.login',
          { email: loginDto.email, userId: 'unknown' }
        );
        await this.trackFailedLogin(loginDto.email, sessionMetadata || {});
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
        // Track failed attempt for invalid password
        await this.trackFailedLogin(loginDto.email, sessionMetadata || {});
        throw this.errors.invalidCredentials('AuthService.login');
      }

      // ✅ SECURITY: Clear failed login attempts on successful login
      await this.cacheService.del(`failed_login:${loginDto.email}`);

      // SECURITY: Validate body clinicId doesn't mismatch header
      if (loginDto.clinicId && clinicIdFromHeader && loginDto.clinicId !== clinicIdFromHeader) {
        await this.logging.log(
          LogType.SECURITY,
          LogLevel.ERROR,
          `Login attempt with mismatched clinicId: header=${clinicIdFromHeader}, body=${loginDto.clinicId}`,
          'AuthService.login',
          {
            email: loginDto.email,
            userId: user.id,
            headerClinicId: clinicIdFromHeader,
            bodyClinicId: loginDto.clinicId,
          }
        );
        throw this.errors.validationError(
          'clinicId',
          'Clinic ID mismatch detected. Please login through the correct clinic portal.',
          'AuthService.login'
        );
      }

      // Get clinic ID: Priority order = header > user.primaryClinicId
      // Body clinicId is only used if no header and no primaryClinicId (legacy support)
      const clinicId = clinicIdFromHeader || user.primaryClinicId || loginDto.clinicId;

      if (!clinicId) {
        await this.logging.log(
          LogType.SECURITY,
          LogLevel.WARN,
          `Login attempt without clinic association: ${loginDto.email}`,
          'AuthService.login',
          { email: loginDto.email, userId: user.id }
        );
        throw this.errors.validationError(
          'clinicId',
          'No clinic associated with this account. Please contact support.',
          'AuthService.login'
        );
      }

      // Validate clinic access BEFORE creating session
      const clinicUUID = await this.validateClinicAccessForAuth(user.id, clinicId, 'login');

      // Create session with validated clinic UUID
      const session = await this.sessionService.createSession({
        userId: user.id,
        userAgent: sessionMetadata?.userAgent || 'Login',
        ipAddress: sessionMetadata?.ipAddress || '127.0.0.1',
        metadata: { login: true },
        clinicId: clinicUUID,
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
          profileComplete: user.isProfileComplete,
          requiresProfileCompletion: !user.isProfileComplete,
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
    sessionMetadata?: { userAgent?: string; ipAddress?: string },
    clinicIdFromHeader?: string
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

      // Handle Registration vs Login logic
      if (requestDto.isRegistration) {
        if (user) {
          throw this.errors.emailAlreadyExists(requestDto.identifier, 'AuthService.requestOtp');
        }
      } else {
        if (!user) {
          throw this.errors.userNotFound(undefined, 'AuthService.requestOtp');
        }
      }

      // Extract clinicId from requestDto, header, or user's primary clinic
      const clinicId =
        requestDto.clinicId || clinicIdFromHeader || user?.primaryClinicId || undefined;
      const userName = user
        ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User'
        : 'Future User';

      let result;
      if (isEmail) {
        // Use user email if available, otherwise identifier
        const emailTarget = user?.email || requestDto.identifier;
        if (!emailTarget) {
          throw this.errors.validationError(
            'email',
            'Email not provided',
            'AuthService.requestOtp'
          );
        }
        result = await this.otpService.sendOtpEmail(
          emailTarget,
          userName,
          requestDto.isRegistration ? 'verification' : 'login',
          clinicId
        );
      } else {
        // ✅ DUAL-CHANNEL OTP: Send via WhatsApp AND email (if available) for better delivery
        const phoneTarget = user?.phone || requestDto.identifier;
        if (!phoneTarget) {
          throw this.errors.validationError(
            'phone',
            'Phone not provided',
            'AuthService.requestOtp'
          );
        }

        const promises: Promise<{ success: boolean; message: string }>[] = [
          this.otpService.sendOtpSms(
            phoneTarget,
            requestDto.isRegistration ? 'verification' : 'login',
            clinicId
          ),
        ];

        // Also send to email if user has one (increases delivery success rate)
        if (user?.email) {
          promises.push(
            this.otpService
              .sendOtpEmail(
                user.email,
                userName,
                requestDto.isRegistration ? 'verification' : 'login',
                clinicId
              )
              .catch((err: Error) => {
                // Log but don't fail if email send fails (WhatsApp is primary)
                void this.logging.log(
                  LogType.SYSTEM,
                  LogLevel.WARN,
                  'Email OTP fallback failed for phone login',
                  'AuthService.requestOtp',
                  { error: err.message, phone: phoneTarget }
                );
                return { success: false, message: err.message };
              })
          );
        }

        // Wait for all channels
        const results = await Promise.allSettled(promises);
        const successful = results.filter(
          (r): r is PromiseFulfilledResult<{ success: boolean; message: string }> =>
            r.status === 'fulfilled'
        );

        // ✅ At least one channel must succeed
        if (successful.length === 0) {
          throw this.errors.otpSendFailed(
            'Failed to send OTP via all channels. Please try again later.',
            'AuthService.requestOtp'
          );
        }

        // Use the first successful result
        result =
          successful.length > 0 && successful[0]?.status === 'fulfilled'
            ? (successful[0] as PromiseFulfilledResult<{ success: boolean; message: string }>).value
            : { success: true, message: 'OTP sent via multiple channels' };
      }

      if (!result.success) {
        throw new Error(result.message ?? 'Failed to send OTP');
      }

      // Emit OTP requested event
      await this.eventService.emit('user.otp_requested', {
        userId: user?.id || 'new-user',
        identifier: requestDto.identifier,
        ...(clinicId && { clinicId }),
        isRegistration: !!requestDto.isRegistration,
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
        message: result.message ?? 'OTP sent successfully',
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
    sessionMetadata?: { userAgent?: string; ipAddress?: string },
    clinicIdFromHeader?: string
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
        // ✅ SECURITY: Log failed OTP attempts for audit trail
        await this.logging.log(
          LogType.SECURITY,
          LogLevel.WARN,
          `Failed OTP verification for ${verifyDto.identifier}`,
          'AuthService.verifyOtp',
          {
            identifier: verifyDto.identifier,
            ipAddress: sessionMetadata?.ipAddress,
            userAgent: sessionMetadata?.userAgent,
            reason: verificationResult.message,
            timestamp: new Date().toISOString(),
          }
        );
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
        ...(user.primaryClinicId && { primaryClinicId: user.primaryClinicId }),
        ...(clinicIdFromHeader && { currentClinicId: clinicIdFromHeader }),
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
          profileComplete: user.isProfileComplete,
          requiresProfileCompletion: !user.isProfileComplete,
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
   * Validate clinic access for authentication
   * Centralized helper used by all auth methods (login, register, OTP, Google OAuth)
   * @param userId - User ID to validate access for
   * @param clinicId - Clinic ID (can be UUID or code like "CL0002")
   * @param operation - Operation name for logging (e.g., "login", "register")
   * @returns Resolved clinic UUID
   * @throws HealthcareError if clinic not found or user doesn't have access
   */
  private async validateClinicAccessForAuth(
    userId: string,
    clinicId: string,
    operation: string
  ): Promise<string> {
    // 1. Resolve clinic ID to UUID (handles both UUID and codes like "CL0002")
    const { resolveClinicUUID } = await import('@utils/clinic.utils');
    let clinicUUID: string;

    try {
      clinicUUID = await resolveClinicUUID(this.databaseService, clinicId);
    } catch (error) {
      await this.logging.log(
        LogType.SECURITY,
        LogLevel.WARN,
        `${operation} failed: Clinic not found or inactive: ${clinicId}`,
        `AuthService.${operation}`,
        { userId, clinicId, error: error instanceof Error ? error.message : String(error) }
      );
      throw this.errors.clinicNotFound(clinicId, `AuthService.${operation}`);
    }

    // 2. Validate user has access to this clinic
    const clinicIsolationService = this.databaseService['clinicIsolationService'];
    const accessResult = await clinicIsolationService.validateClinicAccess(userId, clinicUUID);

    if (!accessResult.success) {
      await this.logging.log(
        LogType.SECURITY,
        LogLevel.WARN,
        `${operation} failed: User does not have access to clinic: ${clinicId}`,
        `AuthService.${operation}`,
        { userId, clinicId: clinicUUID, error: accessResult.error }
      );
      throw this.errors.clinicAccessDenied(clinicId, `AuthService.${operation}`);
    }

    return clinicUUID;
  }

  /**
   * Check user profile completion status using the ProfileCompletionService
   * This is the authoritative source for profile completion status
   */
  public async checkProfileCompletionStatus(
    userId: string,
    role: Role
  ): Promise<{ isComplete: boolean; isProfileComplete?: boolean }> {
    try {
      const user = await this.databaseService.findUserByIdSafe(userId);

      if (!user) {
        await this.logging.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `User not found for profile completion check: ${userId}`,
          'AuthService.checkProfileCompletionStatus'
        );
        return { isComplete: false };
      }

      // Check the database-level flag (authoritative)
      const dbIsComplete = user.isProfileComplete;

      // Also validate with ProfileCompletionService to ensure consistency
      const validation = this.profileCompletionService.validateProfileCompletion(
        user as unknown as Record<string, unknown>,
        role
      );

      const serviceIsComplete = validation.isComplete;

      // Log if there's a discrepancy
      if (dbIsComplete !== serviceIsComplete) {
        await this.logging.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Profile completion status mismatch for user ${userId}: DB=${dbIsComplete}, Validation=${serviceIsComplete}`,
          'AuthService.checkProfileCompletionStatus'
        );
      }

      // Return the database status as primary, but also include the validation result
      return {
        isComplete: dbIsComplete,
        isProfileComplete: serviceIsComplete, // For backward compatibility
      };
    } catch (error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to check profile completion for user ${userId}`,
        'AuthService.checkProfileCompletionStatus',
        { error: error instanceof Error ? error.message : String(error) }
      );
      return { isComplete: false };
    }
  }

  /**
   * Check if user profile is complete
   * Wrapper around ProfileCompletionService for convenience checks
   */
  public isProfileComplete(user: object): boolean {
    if (!user || typeof user !== 'object') return false;
    // Cast to unknown then Record to satisfy the type requirement
    const profileRecord = user as Record<string, unknown>;
    const role = (profileRecord['role'] as Role) || Role.PATIENT;

    return this.profileCompletionService.isProfileComplete(profileRecord, role);
  }

  /**
   * Update user's profile completion status in database
   * Should only be called after successful validation of all required fields
   */
  public async markProfileComplete(userId: string): Promise<boolean> {
    try {
      const user = await this.databaseService.findUserByIdSafe(userId);

      if (!user) {
        await this.logging.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `User not found for marking profile complete: ${userId}`,
          'AuthService.markProfileComplete'
        );
        return false;
      }

      // Update the database flag
      await this.databaseService.updateUserSafe(userId, {
        isProfileComplete: true,
        profileCompletedAt: new Date(),
      } as never);

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `Profile marked as complete for user: ${userId}`,
        'AuthService.markProfileComplete'
      );

      await this.eventService.emit('profile.completed', {
        userId,
        timestamp: new Date().toISOString(),
      });

      // Invalidate user cache
      await this.invalidateUserCache(userId, user.primaryClinicId || undefined);

      return true;
    } catch (error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to mark profile complete for user ${userId}`,
        'AuthService.markProfileComplete',
        { error: error instanceof Error ? error.message : String(error) }
      );
      return false;
    }
  }

  /**
   * Register user with Email OTP
   */
  async registerWithEmailOtp(
    email: string,
    otp: string,
    firstName: string,
    lastName: string,
    clinicIdFromHeader?: string,
    sessionMetadata?: { userAgent?: string; ipAddress?: string }
  ): Promise<AuthResponse> {
    try {
      // 1. Verify OTP
      const verificationResult = await this.otpService.verifyOtp(email, otp);
      if (!verificationResult.success) {
        throw this.errors.validationError(
          'otp',
          verificationResult.message || 'Invalid OTP',
          'AuthService.registerWithEmailOtp'
        );
      }

      // 2. Check if user already exists
      const existingUser = await this.databaseService.findUserByEmailSafe(email);
      if (existingUser) {
        throw this.errors.emailAlreadyExists(email, 'AuthService.registerWithEmailOtp');
      }

      // 3. Validate clinic
      const clinicId = clinicIdFromHeader;
      if (!clinicId) {
        throw this.errors.validationError(
          'clinicId',
          'Clinic ID is required for registration',
          'AuthService.registerWithEmailOtp'
        );
      }

      const { resolveClinicUUID } = await import('@utils/clinic.utils');
      const clinicUUID = await resolveClinicUUID(this.databaseService, clinicId);

      // 4. Create user
      const user = await this.databaseService.createUserSafe({
        email,
        firstName,
        lastName,
        primaryClinicId: clinicUUID,
        isVerified: true, // Email verified via OTP
        role: 'PATIENT',
        password: '', // No password for OTP registration
        userid: uuidv4(),
        name: `${firstName} ${lastName}`,
        age: 12, // Default age, will be updated in profile completion
      });

      // 5. Create session
      const session = await this.sessionService.createSession({
        userId: user.id,
        userAgent: sessionMetadata?.userAgent || 'OTP Registration',
        ipAddress: sessionMetadata?.ipAddress || '127.0.0.1',
        metadata: { registrationMethod: 'email-otp' },
        clinicId: clinicUUID,
      });

      // 6. Generate tokens
      const userForTokens: UserProfile = {
        id: user.id,
        email: user.email || email,
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        role: user.role,
        ...(user.primaryClinicId && { primaryClinicId: user.primaryClinicId }),
      };
      const tokens = await this.generateTokens(
        userForTokens,
        session.sessionId,
        undefined,
        sessionMetadata?.userAgent,
        sessionMetadata?.ipAddress
      );

      // 7. Emit registration event
      await this.eventService.emit('user.registered', {
        userId: user.id,
        email: user.email || email,
        role: user.role,
        clinicId: clinicUUID,
        registrationMethod: 'email-otp',
      });

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: user.id,
          email: user.email || email,
          firstName: user.firstName || undefined,
          lastName: user.lastName || undefined,
          role: user.role as Role,
          isVerified: user.isVerified,
          profileComplete: false, // New users must complete profile
          requiresProfileCompletion: true,
        },
      };
    } catch (error) {
      await this.logging.log(
        LogType.AUTH,
        LogLevel.ERROR,
        'Email OTP registration failed',
        'AuthService.registerWithEmailOtp',
        { email, error: error instanceof Error ? error.message : String(error) }
      );
      throw error;
    }
  }

  /**
   * Register user with Phone OTP
   */
  async registerWithPhoneOtp(
    phone: string,
    otp: string,
    firstName: string,
    lastName: string,
    email?: string,
    clinicIdFromHeader?: string,
    sessionMetadata?: { userAgent?: string; ipAddress?: string }
  ): Promise<AuthResponse> {
    try {
      // 1. Verify OTP
      const verificationResult = await this.otpService.verifyOtp(phone, otp);
      if (!verificationResult.success) {
        throw this.errors.validationError(
          'otp',
          verificationResult.message || 'Invalid OTP',
          'AuthService.registerWithPhoneOtp'
        );
      }

      // 2. Check if phone already exists
      const existingUser = await this.databaseService.findUserByPhoneSafe(phone);
      if (existingUser) {
        throw this.errors.validationError(
          'phone',
          'Phone number already registered',
          'AuthService.registerWithPhoneOtp'
        );
      }

      // 3. Validate clinic
      const clinicId = clinicIdFromHeader;
      if (!clinicId) {
        throw this.errors.validationError(
          'clinicId',
          'Clinic ID is required for registration',
          'AuthService.registerWithPhoneOtp'
        );
      }

      const { resolveClinicUUID } = await import('@utils/clinic.utils');
      const clinicUUID = await resolveClinicUUID(this.databaseService, clinicId);

      // 4. Create user
      const user = await this.databaseService.createUserSafe({
        phone,
        email: email || `${phone}@temp.com`, // Temporary email if not provided
        firstName,
        lastName,
        primaryClinicId: clinicUUID,
        isVerified: true, // Phone verified via OTP
        role: 'PATIENT',
        password: '', // No password for OTP registration
        userid: uuidv4(),
        name: `${firstName} ${lastName}`,
        age: 12, // Default age, will be updated in profile completion
      });

      // 5. Create session
      const session = await this.sessionService.createSession({
        userId: user.id,
        userAgent: sessionMetadata?.userAgent || 'OTP Registration',
        ipAddress: sessionMetadata?.ipAddress || '127.0.0.1',
        metadata: { registrationMethod: 'phone-otp' },
        clinicId: clinicUUID,
      });

      // 6. Generate tokens
      const userForTokens: UserProfile = {
        id: user.id,
        email: user.email || '',
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
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

      // 7. Emit registration event
      await this.eventService.emit('user.registered', {
        userId: user.id,
        phone: user.phone || phone,
        role: user.role,
        clinicId: clinicUUID,
        registrationMethod: 'phone-otp',
      });

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: user.id,
          email: user.email || '',
          phone: user.phone || undefined,
          firstName: user.firstName || undefined,
          lastName: user.lastName || undefined,
          role: user.role as Role,
          isVerified: user.isVerified,
          profileComplete: false, // New users must complete profile
          requiresProfileCompletion: true,
        },
      };
    } catch (error) {
      await this.logging.log(
        LogType.AUTH,
        LogLevel.ERROR,
        'Phone OTP registration failed',
        'AuthService.registerWithPhoneOtp',
        { phone, error: error instanceof Error ? error.message : String(error) }
      );
      throw error;
    }
  }

  /**
   * Generate JWT tokens with enhanced security features
   */
  public async generateTokens(
    user: UserProfile | UserWithPassword | UserWithRelations,
    sessionId: string,
    deviceFingerprint?: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<AuthTokens> {
    // Extract clinicId: prefer explicit clinicId, fallback to primaryClinicId
    const clinicId =
      ('clinicId' in user && user.clinicId) || ('primaryClinicId' in user && user.primaryClinicId);

    if (!clinicId) {
      throw new Error('Cannot generate token: user missing clinic association');
    }

    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role || '',
      domain: 'healthcare',
      sessionId: sessionId,
      clinicId: clinicId, // Always include clinic ID
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
   * Verify email with OTP
   */
  async verifyEmail(email: string, otp: string): Promise<boolean> {
    const result = await this.otpService.verifyOtp(email, otp);
    if (!result.success) {
      throw this.errors.invalidCredentials('AuthService.verifyEmail');
    }

    const user = await this.databaseService.findUserByEmailSafe(email);
    if (!user) {
      throw this.errors.userNotFound(email, 'AuthService.verifyEmail');
    }

    if (!user.isVerified) {
      await this.databaseService.updateUserSafe(user.id, { isVerified: true });
    }

    return true;
  }

  /**
   * Resend verification email
   */
  async resendVerification(email: string, clinicId?: string): Promise<boolean> {
    const user = await this.databaseService.findUserByEmailSafe(email);
    if (!user) {
      // Return true to avoid enumeration
      return true;
    }

    if (user.isVerified) {
      return true;
    }

    await this.otpService.sendOtpEmail(email, user.firstName || 'User', 'verification', clinicId);
    return true;
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

  /**
   * Track failed login attempts and lock account after threshold
   * ✅ SECURITY: Prevents brute force attacks by locking account after 5 failed attempts
   * @private
   */
  private async trackFailedLogin(
    email: string,
    metadata: { ipAddress?: string; userAgent?: string }
  ): Promise<void> {
    const failedKey = `failed_login:${email}`;
    const lockKey = `account_lock:${email}`;

    // Get current failed count
    const current = await this.cacheService.get<string>(failedKey);
    const failedCount = current ? parseInt(current) + 1 : 1;

    // Store failed count for 1 hour
    await this.cacheService.set(failedKey, failedCount.toString(), 3600);

    // Log the failed attempt
    await this.logging.log(
      LogType.SECURITY,
      LogLevel.WARN,
      `Failed login attempt ${failedCount}/10 for ${email}`,
      'AuthService.trackFailedLogin',
      {
        email,
        failedCount,
        ipAddress: metadata?.ipAddress,
        userAgent: metadata?.userAgent,
        timestamp: new Date().toISOString(),
      }
    );

    // Lock account after 10 failed attempts
    if (failedCount >= 10) {
      const lockDuration = 20 * 60 * 1000; // 20 minutes
      const unlockTime = new Date(Date.now() + lockDuration);

      // Store lock with 20-minute TTL
      await this.cacheService.set(lockKey, unlockTime.toISOString(), 1200);

      await this.logging.log(
        LogType.SECURITY,
        LogLevel.ERROR,
        `Account locked for ${email} - 10 failed login attempts`,
        'AuthService.trackFailedLogin',
        {
          email,
          failedAttempts: failedCount,
          unlockTime: unlockTime.toISOString(),
          ipAddress: metadata?.ipAddress,
          userAgent: metadata?.userAgent,
        }
      );

      // Emit security event
      await this.eventService.emit('security.account_locked', {
        email,
        reason: 'too_many_failed_attempts',
        failedAttempts: failedCount,
        unlockTime: unlockTime.toISOString(),
        metadata,
      });
    }
  }
  /**
   * Set authentication cookies in the response
   * @param reply - FastifyReply object
   * @param tokens - Authentication tokens
   */
  public setAuthCookies(reply: FastifyReply, tokens: AuthTokens): void {
    const isProduction = process.env['NODE_ENV'] === 'production';

    // Set access token cookie
    reply.setCookie('access_token', tokens.accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60, // 15 minutes
    });

    // Set refresh token cookie
    reply.setCookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });
  }
}
