import { nowIso } from '@utils/date-time.util';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@config/config.service';
import { DatabaseService } from '@infrastructure/database/database.service';

import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events/event.service';
import { HealthcareErrorsService } from '@core/errors';
import { LogType, LogLevel } from '@core/types';
import { EmailService } from '@communication/channels/email/email.service';
import { WhatsAppService } from '@communication/channels/whatsapp/whatsapp.service';
import { SessionManagementService } from '@core/session/session-management.service';
import { RbacService } from '@core/rbac/rbac.service';
import { QueueService, JobPriority } from '@infrastructure/queue';
import { JobType } from '@core/types/queue.types';
import { JwtAuthService } from './core/jwt.service';
import { SocialAuthService } from './core/social-auth.service';
import { OtpService } from './core/otp.service';
import { normalizeAuthPhoneNumber } from './core/phone-normalizer.util';
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
import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import type { FastifyReply } from 'fastify';
import { generateUserId } from '@utils/user-id.util';
// import { ProfileCompletionService } from '@services/profile-completion/profile-completion.service';

function getAuthRedirectUrl(role: Role | string, profileComplete: boolean): string {
  const normalizedRole = (() => {
    const candidate = String(role || '').toUpperCase();
    return (Object.values(Role) as string[]).includes(candidate) ? (candidate as Role) : undefined;
  })();

  if (!normalizedRole) {
    return '/';
  }

  if (normalizedRole === Role.PATIENT && !profileComplete) {
    return '/profile-completion';
  }

  switch (normalizedRole) {
    case Role.SUPER_ADMIN:
      return '/super-admin/dashboard';
    case Role.CLINIC_ADMIN:
      return '/clinic-admin/dashboard';
    case Role.DOCTOR:
      return '/doctor/dashboard';
    case Role.ASSISTANT_DOCTOR:
      return '/assistant-doctor/dashboard';
    case Role.RECEPTIONIST:
      return '/receptionist/dashboard';
    case Role.PHARMACIST:
      return '/pharmacist/dashboard';
    case Role.CLINIC_LOCATION_HEAD:
      return '/clinic-location-head/dashboard';
    case Role.THERAPIST:
      return '/therapist/dashboard';
    case Role.LAB_TECHNICIAN:
      return '/lab-technician/dashboard';
    case Role.SUPPORT_STAFF:
      return '/support-staff/dashboard';
    case Role.NURSE:
      return '/nurse/dashboard';
    case Role.FINANCE_BILLING:
      return '/finance-billing/dashboard';
    case Role.COUNSELOR:
      return '/counselor/dashboard';
    case Role.PATIENT:
      return '/patient/dashboard';
    default:
      return '/';
  }
}

function formatAuthIdentityForLog(
  user:
    | {
        email?: string | null;
        phone?: string | null;
        name?: string | null;
        firstName?: string | null;
        lastName?: string | null;
      }
    | null
    | undefined,
  fallback = ''
): string {
  const email = user?.email?.trim();
  if (email) {
    return email;
  }

  const phone = user?.phone?.trim();
  if (phone) {
    return normalizeAuthPhoneNumber(phone);
  }

  const name = user?.name?.trim();
  if (name) {
    return name;
  }

  const firstName = user?.firstName?.trim() || '';
  const lastName = user?.lastName?.trim() || '';
  const combinedName = `${firstName} ${lastName}`.trim();
  if (combinedName) {
    return combinedName;
  }

  return fallback.trim();
}

@Injectable()
export class AuthService {
  private readonly CACHE_TTL = 3600; // 1 hour
  private readonly otpDebugEnabled: boolean;

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
    private readonly queueService: QueueService
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

    this.otpDebugEnabled =
      this.configService?.getEnvBoolean('ENABLE_OTP_DEBUG', false) ||
      this.configService?.getEnvBoolean('DEBUG_MODE', false) ||
      false;
  }

  private debugOtp(message: string, context: Record<string, unknown> = {}): void {
    if (!this.otpDebugEnabled) {
      return;
    }

    // Use structured logging instead of console.warn for HIPAA compliance
    void this.logging.log(
      LogType.AUTH,
      LogLevel.DEBUG,
      `[OTP DEBUG] ${message}`,
      'AuthService',
      context
    );
  }

  private logOtp(message: string, context: Record<string, unknown> = {}): void {
    void this.logging.log(LogType.AUTH, LogLevel.WARN, message, 'AuthService', context);
    void this.eventService.emit('auth.otp.diagnostic', {
      source: 'AuthService',
      message,
      context,
      timestamp: nowIso(),
    });
  }

  private maskOtp(value?: string | null): string | null {
    if (!value) {
      return null;
    }

    const text = String(value).trim();
    if (!text) {
      return null;
    }

    if (text.length <= 2) {
      return '*'.repeat(text.length);
    }

    return `${text.slice(0, 1)}${'*'.repeat(text.length - 2)}${text.slice(-1)}`;
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
          role: user.role as Role,
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
   * Ensure a Patient record exists for auth-generated or auth-recovered patient sessions.
   */
  private async ensurePatientRecordForAuth(
    userId: string,
    clinicId?: string,
    source: string = 'auth'
  ): Promise<void> {
    try {
      const existingPatient = await this.databaseService.executeHealthcareRead(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          patient: {
            findUnique: (args: PrismaDelegateArgs) => Promise<{ id: string } | null>;
          };
        };

        return await typedClient.patient.findUnique({
          where: { userId } as PrismaDelegateArgs,
          select: { id: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      });

      if (existingPatient) {
        return;
      }

      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            patient: {
              create: (args: PrismaDelegateArgs) => Promise<{ id: string }>;
            };
          };

          return await typedClient.patient.create({
            data: { userId } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId,
          clinicId: clinicId || '',
          resourceType: 'PATIENT',
          operation: 'CREATE',
          resourceId: userId,
          userRole: Role.PATIENT,
          details: { source, action: 'ensure_patient_profile' },
        }
      );

      await this.cacheService.invalidatePatientCache(userId, clinicId);
      await this.cacheService.invalidateCacheByTag('users');
    } catch (error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Failed to ensure patient record for ${source}`,
        'AuthService.ensurePatientRecordForAuth',
        {
          userId,
          clinicId: clinicId || '',
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Internal account creation helper used by privileged onboarding flows.
   */
  /**
   * Public registration endpoint for patients.
   * Staff and admin users are created through the privileged /user flow.
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
        // Consume OTP after successful verification (deferred deletion pattern)
        await this.otpService.consumeOtp(identifier);
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

      const requestedRole = registerDto.role ?? 'PATIENT';
      if (requestedRole !== 'PATIENT') {
        throw this.errors.validationError(
          'role',
          'Public registration is limited to patient accounts',
          'AuthService.register'
        );
      }

      const effectiveRole = Role.PATIENT;
      const userid = generateUserId(registerDto.email, true);
      const user = await this.databaseService.createUserSafe({
        email: registerDto.email,
        password: hashedPassword,
        userid,
        name: `${registerDto.firstName} ${registerDto.lastName}`,
        age,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        ...(registerDto.phone && { phone: registerDto.phone }),
        ...(registerDto.dateOfBirth && { dateOfBirth: new Date(registerDto.dateOfBirth) }),
        ...(registerDto.gender && { gender: registerDto.gender }),
        ...(registerDto.address && { address: registerDto.address }),
        role: effectiveRole,
        primaryClinicId: clinicUUID,
        ...(registerDto.googleId && { googleId: registerDto.googleId }),
        isVerified: !!registerDto.otp || !!registerDto.googleId,
        // Public patient registrations remain incomplete until profile completion is finished.
      });

      // 6. Ensure Patient record exists for patient registrations
      if ((registerDto.role || 'PATIENT') === 'PATIENT') {
        await this.ensurePatientRecordForAuth(user.id, clinicUUID, 'register');
      }

      const clinicName = await this.resolveClinicDisplayName(clinicUUID);

      // 7. Send OTP and return response
      await this.eventService.emit('user.registered', {
        userId: user.id,
        email: user.email,
        role: user.role as Role,
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
          ...(user.firstName ? { firstName: user.firstName } : {}),
          ...(user.lastName ? { lastName: user.lastName } : {}),
          role: user.role as Role,
          isVerified: false,
          clinicId: clinicUUID,
          ...(clinicName && { clinicName }),
        },
        requiresVerification: true,
        message:
          'Registration successful. Please verify your account with the OTP sent to your registered contact.',
        redirectUrl: getAuthRedirectUrl(user.role, false),
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

      const clinicId = clinicIdFromHeader || loginDto.clinicId;
      if (!clinicId) {
        throw this.errors.validationError(
          'clinicId',
          'Clinic ID is required for login',
          'AuthService.login'
        );
      }

      const clinicUUID = await this.validateClinicAccessForAuth(user.id, clinicId, 'login');

      const loginUserRole = user.role as Role;
      if (loginUserRole === Role.PATIENT) {
        await this.ensurePatientRecordForAuth(user.id, clinicUUID, 'login');
      }

      // Create session with validated clinic UUID (optional for SUPER_ADMIN)
      const session = await this.sessionService.createSession({
        userId: user.id,
        userAgent: sessionMetadata?.userAgent || 'Login',
        ipAddress: sessionMetadata?.ipAddress || '127.0.0.1',
        metadata: { login: true },
        ...(clinicUUID && { clinicId: clinicUUID }),
      });

      // Generate tokens with session ID - handle null phone
      const userForTokens: UserProfile = {
        id: user.id,
        email: user.email,
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        role: user.role as Role,
        ...(user.phone && { phone: user.phone }),
        ...(clinicUUID && { clinicId: clinicUUID }),
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
      const isFirstLogin = !user.lastLogin;
      await this.databaseService.updateUserSafe(user.id, {
        lastLogin: new Date(),
      });

      // Emit user login event
      const appName = this.configService.getEnv('APP_NAME') || 'Healthcare App';
      const loginEventClinicName = await this.resolveClinicDisplayName(clinicUUID);
      await this.eventService.emit('user.logged_in', {
        userId: user.id,
        email: user.email,
        role: user.role as Role,
        clinicId,
        ...(loginEventClinicName && { clinicName: loginEventClinicName }),
        sessionId: session.sessionId,
        appName,
        isFirstLogin,
        metadata: {
          loginMethod: 'password',
          userAgent: sessionMetadata?.userAgent,
          ipAddress: sessionMetadata?.ipAddress,
        },
      });

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `User logged in successfully: ${user.email}`,
        'AuthService.login',
        { userId: user.id, email: user.email, role: user.role, clinicId }
      );

      const profileStatus = await this.checkProfileCompletionStatus(user.id, user.role as Role);
      const loginResponseClinicName = await this.resolveClinicDisplayName(clinicUUID);

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        sessionId: tokens.sessionId,
        redirectUrl: getAuthRedirectUrl(user.role, profileStatus.isComplete),
        user: this.buildAuthUserPayload(user, {
          clinicId: clinicUUID || undefined,
          clinicName: loginResponseClinicName,
          profileComplete: profileStatus.isComplete,
          requiresProfileCompletion: !profileStatus.isComplete,
          loginMethod: 'password',
        }),
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
      if (!refreshTokenDto.refreshToken) {
        throw this.errors.authenticationError(
          'Refresh token is required',
          'AuthService.refreshToken'
        );
      }

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

      // Send reset email via async queue
      // Use user's primary clinic for multi-tenant email routing
      await this.queueService.addJob(
        JobType.EMAIL,
        'password_reset',
        {
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
        },
        { priority: JobPriority.HIGH as unknown as number, attempts: 3 }
      );

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
    const isEmail = requestDto.identifier.includes('@');
    const normalizedIdentifier = isEmail
      ? requestDto.identifier.trim().toLowerCase()
      : normalizeAuthPhoneNumber(requestDto.identifier);
    const requestLockKey = `otp_request_lock:${normalizedIdentifier}`;
    const lockValue = nowIso();

    const lockAcquired = await this.cacheService.acquireLock(requestLockKey, 8, lockValue);
    if (!lockAcquired) {
      return {
        success: false,
        message: 'OTP request already in progress. Please wait a moment and try again.',
      };
    }

    try {
      // Determine if identifier is email or phone
      let user: UserWithRelations | null = null;

      if (isEmail) {
        user = await this.databaseService.findUserByEmailSafe(requestDto.identifier);
      } else {
        // Find by phone
        const normalizedPhoneIdentifier = normalizeAuthPhoneNumber(requestDto.identifier);
        const users = await this.databaseService.findUsersSafe(
          { phone: normalizedPhoneIdentifier },
          { take: 1 }
        );
        user = users[0] || null;
      }

      // Unified OTP flow: allow OTP for both login and registration
      // User existence check is done in verifyOtp, not here
      // This allows new users to request OTP and auto-register during verification
      const clinicId = requestDto.clinicId || clinicIdFromHeader;
      if (!clinicId) {
        throw this.errors.validationError(
          'clinicId',
          'Clinic ID is required for OTP requests',
          'AuthService.requestOtp'
        );
      }
      const userName = user
        ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User'
        : 'Future User';
      const otpCode = this.otpService.generateOtp();

      this.logOtp('Generated OTP for requestOtp', {
        identifier: requestDto.identifier,
        normalizedIdentifier,
        flow: isEmail ? 'email' : 'phone',
        otpLength: otpCode.length,
        otp: this.maskOtp(otpCode),
      });

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
          'login',
          clinicId,
          otpCode
        );
      } else {
        // ✅ DUAL-CHANNEL OTP: Send via WhatsApp AND email (if available) for better delivery
        const phoneTarget = normalizeAuthPhoneNumber(user?.phone || requestDto.identifier);
        if (!phoneTarget) {
          throw this.errors.validationError(
            'phone',
            'Phone not provided',
            'AuthService.requestOtp'
          );
        }

        this.logOtp('Sending phone OTP', {
          identifier: requestDto.identifier,
          normalizedPhone: phoneTarget,
          otpKey: `otp:${phoneTarget}`,
          otp: this.maskOtp(otpCode),
          otpLength: otpCode.length,
          clinicId,
        });

        result = await this.otpService.sendOtpSms(phoneTarget, 'login', clinicId, otpCode);

        this.logOtp('OTP request channel result', {
          identifier: requestDto.identifier,
          normalizedPhone: phoneTarget,
          otpKey: `otp:${phoneTarget}`,
          otp: this.maskOtp(otpCode),
          otpLength: otpCode.length,
          clinicId,
          result,
        });

        if (!result.success) {
          throw this.errors.otpSendFailed(
            result.message || 'Failed to send WhatsApp message. Please try again later.',
            'AuthService.requestOtp'
          );
        }

        this.logOtp('OTP request completed', {
          identifier: requestDto.identifier,
          normalizedPhone: phoneTarget,
          otpKey: `otp:${phoneTarget}`,
          otp: this.maskOtp(otpCode),
          otpLength: otpCode.length,
          clinicId,
          result,
        });
      }

      if (!result.success) {
        throw new Error(result.message ?? 'Failed to send OTP');
      }

      // Emit OTP requested event
      await this.eventService.emit('user.otp_requested', {
        userId: user?.id || 'new-user',
        identifier: requestDto.identifier,
        normalizedIdentifier,
        otpKey: `otp:${normalizedIdentifier}`,
        reusedExistingOtp: false,
        ...(clinicId && { clinicId }),
        isNewUser: !user,
        otp: result.otp || otpCode,
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
          otp: result.otp || otpCode,
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
    } finally {
      await this.cacheService.releaseLock(requestLockKey);
    }
  }

  /**
   * Verify OTP
   */
  /**
   * Verify OTP - Single entry point for both login and registration
   *
   * Flow:
   * 1. ALWAYS verify OTP first (before any user operations)
   * 2. Find user by identifier (phone or email)
   * 3. If user exists -> LOGIN (existing user)
   * 4. If user doesn't exist -> REGISTER (new user)
   * 5. If authenticated user needs phone verification -> use verifyPhone instead
   */
  async verifyOtp(
    verifyDto: VerifyOtpRequestDto,
    sessionMetadata?: { userAgent?: string; ipAddress?: string },
    clinicIdFromHeader?: string
  ): Promise<AuthResponse> {
    const isEmail = verifyDto.identifier.includes('@');
    const normalizedIdentifier = isEmail
      ? verifyDto.identifier.trim().toLowerCase()
      : normalizeAuthPhoneNumber(verifyDto.identifier);

    // STEP 1: ALWAYS verify OTP first - this must succeed before any user operations
    const verificationResult = await this.otpService.verifyOtp(
      isEmail ? verifyDto.identifier : normalizeAuthPhoneNumber(verifyDto.identifier),
      verifyDto.otp
    );

    this.logOtp('OTP verification attempted', {
      identifier: verifyDto.identifier,
      normalizedIdentifier,
      flow: isEmail ? 'email' : 'phone',
      otpLength: verifyDto.otp?.length,
      otp: this.maskOtp(verifyDto.otp),
      verificationSuccess: verificationResult.success,
      verificationMessage: verificationResult.message,
    });

    // OTP verification failed - fail immediately, no user operations
    if (!verificationResult.success) {
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
          timestamp: nowIso(),
        }
      );
      throw this.errors.otpInvalid('AuthService.verifyOtp', verificationResult.message);
    }

    // STEP 2: OTP verified successfully - now find user to determine login vs registration
    let user: UserWithRelations | null;

    if (isEmail) {
      user = await this.databaseService.findUserByEmailSafe(verifyDto.identifier);
    } else {
      // Find user by phone number
      const usersByPhone = await this.databaseService.findUsersSafe(
        { phone: normalizedIdentifier },
        { take: 1 }
      );
      user = usersByPhone[0] ?? null;
    }

    // STEP 3: Branch based on whether user exists
    if (user) {
      // ===== EXISTING USER LOGIN =====
      const loginResult = await this.handleExistingUserLogin(
        user,
        clinicIdFromHeader,
        verifyDto,
        sessionMetadata,
        isEmail,
        normalizedIdentifier
      );
      // Consume OTP after successful login (deferred deletion pattern)
      await this.otpService.consumeOtp(normalizedIdentifier);
      return loginResult;
    } else {
      // ===== NEW USER REGISTRATION =====
      return await this.handleNewUserRegistration(
        verifyDto,
        sessionMetadata,
        clinicIdFromHeader,
        isEmail,
        normalizedIdentifier
      );
    }
  }

  /**
   * Handle login for existing user - no user creation
   * Called only after OTP is verified AND user exists
   */
  private async handleExistingUserLogin(
    user: UserWithRelations,
    clinicIdFromHeader: string | undefined,
    verifyDto: VerifyOtpRequestDto,
    sessionMetadata: { userAgent?: string; ipAddress?: string } | undefined,
    isEmail: boolean,
    normalizedIdentifier: string
  ): Promise<AuthResponse> {
    // Legacy cleanup: Also try to delete OTP stored by user ID if it exists (legacy support)
    this.cacheService.del(`otp:${user.id}`).catch(() => {});

    if (verifyDto.clinicId && clinicIdFromHeader && verifyDto.clinicId !== clinicIdFromHeader) {
      throw this.errors.validationError(
        'clinicId',
        'Clinic ID mismatch detected. Please verify through the correct clinic portal.',
        'AuthService.verifyOtp'
      );
    }

    const clinicId = verifyDto.clinicId || clinicIdFromHeader;
    if (!clinicId) {
      throw this.errors.validationError(
        'clinicId',
        'Clinic ID is required for OTP verification',
        'AuthService.verifyOtp'
      );
    }

    const clinicUUID = await this.validateClinicAccessForAuth(user.id, clinicId, 'verifyOtp');

    const otpUserRole = user.role as Role;
    if (otpUserRole === Role.PATIENT) {
      await this.ensurePatientRecordForAuth(user.id, clinicUUID, 'verifyOtp');
    }

    // Create session
    const session = await this.sessionService.createSession({
      userId: user.id,
      userAgent: sessionMetadata?.userAgent || 'OTP Login',
      ipAddress: sessionMetadata?.ipAddress || '127.0.0.1',
      metadata: { otpLogin: true },
      ...(clinicUUID && { clinicId: clinicUUID }),
    });

    let verifiedUser = user;
    const loginIdentifier = verifyDto.identifier.trim();
    if (!isEmail) {
      const normalizedPhone = normalizeAuthPhoneNumber(
        user.phone || normalizedIdentifier || loginIdentifier
      );
      const existingPhoneUser = await this.databaseService.findUserByPhoneSafe(normalizedPhone);

      if (existingPhoneUser && existingPhoneUser.id !== user.id) {
        await this.logging.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Duplicate phone record detected during OTP login; continuing with verified account',
          'AuthService.verifyOtp',
          {
            requestedPhone: normalizedPhone,
            verifiedUserId: user.id,
            duplicateUserId: existingPhoneUser.id,
            clinicId: clinicUUID,
          }
        );
      }

      // Update phone if needed
      if (!user.phoneVerified || normalizedPhone !== user.phone) {
        await this.databaseService.updateUserSafe(user.id, {
          phone: normalizedPhone,
          phoneVerified: true,
          phoneVerifiedAt: new Date(),
        } as never);

        verifiedUser = {
          ...user,
          phone: normalizedPhone,
          phoneVerified: true,
          phoneVerifiedAt: new Date(),
        } as UserWithRelations;
      }
    }

    // Generate tokens
    const userForTokens: UserProfile = {
      id: verifiedUser.id,
      email: verifiedUser.email,
      name:
        verifiedUser.name ||
        `${verifiedUser.firstName || ''} ${verifiedUser.lastName || ''}`.trim() ||
        verifiedUser.email,
      role: verifiedUser.role as Role,
      ...(verifiedUser.phone && { phone: verifiedUser.phone }),
      ...(clinicUUID && { clinicId: clinicUUID }),
      ...(verifiedUser.primaryClinicId && { primaryClinicId: verifiedUser.primaryClinicId }),
    };
    const tokens = await this.generateTokens(
      userForTokens,
      session.sessionId,
      undefined,
      sessionMetadata?.userAgent,
      sessionMetadata?.ipAddress
    );

    // Update last login
    const isFirstLogin = !verifiedUser.lastLogin;
    await this.databaseService.updateUserSafe(verifiedUser.id, { lastLogin: new Date() });

    // Emit OTP login event
    const appName = this.configService.getEnv('APP_NAME') || 'Healthcare App';
    const clinicName = await this.resolveClinicDisplayName(clinicUUID);
    const loginMethod = isEmail ? 'email_otp' : 'phone_otp';

    await this.eventService.emit('user.otp_logged_in', {
      userId: verifiedUser.id,
      email: verifiedUser.email,
      role: verifiedUser.role as Role,
      clinicId: clinicUUID,
      ...(clinicName && { clinicName }),
      sessionId: session.sessionId,
      appName,
      isFirstLogin,
      metadata: {
        loginMethod,
        isExistingUser: true,
        userAgent: sessionMetadata?.userAgent,
        ipAddress: sessionMetadata?.ipAddress,
      },
    });

    await this.logging.log(
      LogType.AUDIT,
      LogLevel.INFO,
      `OTP login successful for: ${formatAuthIdentityForLog(verifiedUser, normalizedIdentifier)}`,
      'AuthService.verifyOtp',
      {
        userId: verifiedUser.id,
        identity: formatAuthIdentityForLog(verifiedUser, normalizedIdentifier),
        email: verifiedUser.email,
        phone: verifiedUser.phone,
        role: verifiedUser.role,
        clinicId: clinicUUID,
        isExistingUser: true,
      }
    );

    const profileStatus = await this.checkProfileCompletionStatus(
      verifiedUser.id,
      verifiedUser.role as Role
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: tokens.sessionId,
      redirectUrl: getAuthRedirectUrl(verifiedUser.role, profileStatus.isComplete),
      user: this.buildAuthUserPayload(verifiedUser, {
        clinicId: clinicUUID || undefined,
        profileComplete: profileStatus.isComplete,
        requiresProfileCompletion: !profileStatus.isComplete,
        loginMethod,
      }),
    };
  }

  /**
   * Handle new user registration - create user after OTP verified
   * Called only after OTP is verified AND user doesn't exist
   */
  private async handleNewUserRegistration(
    verifyDto: VerifyOtpRequestDto,
    sessionMetadata: { userAgent?: string; ipAddress?: string } | undefined,
    clinicIdFromHeader: string | undefined,
    isEmail: boolean,
    normalizedIdentifier: string
  ): Promise<AuthResponse> {
    // OTP already verified at this point - proceed to registration

    const clinicId = verifyDto.clinicId || clinicIdFromHeader;
    if (!clinicId) {
      throw this.errors.validationError(
        'clinicId',
        'Clinic ID is required for OTP verification',
        'AuthService.verifyOtp'
      );
    }

    const { resolveClinicUUID } = await import('@utils/clinic.utils');
    const clinicUUID = await resolveClinicUUID(this.databaseService, clinicId);

    // Validate clinicUUID is non-null before user creation
    if (!clinicUUID) {
      throw this.errors.validationError(
        'clinicId',
        'Cannot create user: clinic UUID could not be resolved. Please ensure a valid clinic is selected.',
        'AuthService.handleNewUserRegistration'
      );
    }

    await this.logging.log(
      LogType.AUTH,
      LogLevel.INFO,
      `Auto-registering new user via OTP: ${verifyDto.identifier}`,
      'AuthService.verifyOtp',
      { identifier: verifyDto.identifier }
    );

    // Create new user (OTP already verified above)
    // For phone-only login, don't create a fake email
    // Null-safe name resolution: default to normalizedIdentifier if firstName/lastName are empty
    const resolvedFirstName = verifyDto.firstName?.trim() || '';
    const resolvedLastName = verifyDto.lastName?.trim() || '';
    const resolvedName = `${resolvedFirstName} ${resolvedLastName}`.trim() || normalizedIdentifier;

    // Generate meaningful user ID from identifier (with fallback for safety)
    const safeIdentifier = normalizedIdentifier || verifyDto.identifier || uuidv4();
    const userid = generateUserId(safeIdentifier, isEmail);

    // Create user with optional fields omitted when not applicable
    // Build conditionally to satisfy exactOptionalPropertyTypes: true
    const baseUserData: UserCreateInput = {
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
      name: resolvedName,
      isVerified: true,
      phoneVerified: !isEmail,
      role: 'PATIENT',
      primaryClinicId: clinicUUID,
      userid,
    };

    const userCreateData: UserCreateInput = isEmail
      ? {
          ...baseUserData,
          email: normalizedIdentifier,
          password: await bcrypt.hash(uuidv4(), 12),
        }
      : {
          ...baseUserData,
          phone: normalizedIdentifier,
        };

    const user = await this.databaseService.createUserSafe(userCreateData);

    // Consume OTP after successful user creation (deferred deletion pattern)
    await this.otpService.consumeOtp(normalizedIdentifier);

    // Ensure patient record
    await this.ensurePatientRecordForAuth(user.id, clinicUUID, 'verifyOtp');

    // Emit registration event
    const loginMethod = isEmail ? 'email_otp' : 'phone_otp';

    await this.eventService.emit('user.registered', {
      userId: user.id,
      identifier: normalizedIdentifier,
      role: user.role,
      clinicId: clinicUUID,
      registrationMethod: loginMethod,
    });

    await this.logging.log(
      LogType.AUDIT,
      LogLevel.INFO,
      `New user registered via OTP: ${normalizedIdentifier}`,
      'AuthService.verifyOtp',
      { userId: user.id }
    );

    // Validate clinic access
    const validatedClinicUUID = await this.validateClinicAccessForAuth(
      user.id,
      clinicUUID,
      'verifyOtp'
    );

    const otpUserRole = user.role as Role;
    if (otpUserRole === Role.PATIENT) {
      await this.ensurePatientRecordForAuth(user.id, validatedClinicUUID, 'verifyOtp');
    }

    // Create session
    const session = await this.sessionService.createSession({
      userId: user.id,
      userAgent: sessionMetadata?.userAgent || 'OTP Login',
      ipAddress: sessionMetadata?.ipAddress || '127.0.0.1',
      metadata: { otpLogin: true, isNewUser: true },
      ...(validatedClinicUUID && { clinicId: validatedClinicUUID }),
    });

    // Generate tokens
    const userForTokens: UserProfile = {
      id: user.id,
      email: user.email || '',
      name: user.name || normalizedIdentifier,
      role: user.role as Role,
      ...(user.phone && { phone: user.phone }),
      ...(validatedClinicUUID && { clinicId: validatedClinicUUID }),
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
    await this.databaseService.updateUserSafe(user.id, { lastLogin: new Date() });

    // Emit OTP login event
    const appName = this.configService.getEnv('APP_NAME') || 'Healthcare App';
    const clinicName = await this.resolveClinicDisplayName(validatedClinicUUID);
    await this.eventService.emit('user.otp_logged_in', {
      userId: user.id,
      email: user.email || '',
      role: user.role as Role,
      clinicId: validatedClinicUUID,
      ...(clinicName && { clinicName }),
      sessionId: session.sessionId,
      appName,
      isFirstLogin: true,
      metadata: {
        loginMethod,
        isNewUser: true,
        userAgent: sessionMetadata?.userAgent,
        ipAddress: sessionMetadata?.ipAddress,
      },
    });

    await this.logging.log(
      LogType.AUDIT,
      LogLevel.INFO,
      `OTP login successful for new user: ${formatAuthIdentityForLog(user, normalizedIdentifier)}`,
      'AuthService.verifyOtp',
      {
        userId: user.id,
        identity: formatAuthIdentityForLog(user, normalizedIdentifier),
        email: user.email,
        phone: user.phone,
        role: user.role,
        clinicId: validatedClinicUUID,
        isNewUser: true,
      }
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: tokens.sessionId,
      redirectUrl: getAuthRedirectUrl(user.role, false),
      user: this.buildAuthUserPayload(user, {
        clinicId: validatedClinicUUID || undefined,
        profileComplete: false,
        requiresProfileCompletion: true,
        loginMethod,
      }),
    };
  }

  /**
   * Verify an authenticated user's phone number with OTP.
   */
  async verifyPhone(
    userId: string,
    phone: string,
    otp: string
  ): Promise<{ success: boolean; phoneVerified: boolean; phoneVerifiedAt: string }> {
    const user = await this.databaseService.findUserByIdSafe(userId);
    if (!user) {
      throw this.errors.userNotFound(userId, 'AuthService.verifyPhone');
    }

    const normalizedInputPhone = normalizeAuthPhoneNumber(phone);
    const expectedPhone = normalizeAuthPhoneNumber(user.phone || normalizedInputPhone);
    if (expectedPhone !== normalizedInputPhone && user.phone) {
      throw this.errors.validationError(
        'phone',
        'Phone number does not match the authenticated user profile',
        'AuthService.verifyPhone'
      );
    }

    const existingPhoneUser = await this.databaseService.findUserByPhoneSafe(normalizedInputPhone);
    const isExistingPhoneOwnedByAnotherUser = existingPhoneUser && existingPhoneUser.id !== user.id;
    const existingPhoneUserProfileComplete =
      isExistingPhoneOwnedByAnotherUser &&
      ((existingPhoneUser as unknown as Record<string, unknown>)['isProfileComplete'] === true ||
        (existingPhoneUser as unknown as Record<string, unknown>)['profileComplete'] === true);

    if (isExistingPhoneOwnedByAnotherUser && existingPhoneUserProfileComplete) {
      throw this.errors.validationError(
        'phone',
        'Phone number already registered with another account. Please login with existing account or try a different number.',
        'AuthService.verifyPhone'
      );
    }

    const otpStatus = await this.otpService.checkOtpStatus(normalizedInputPhone);
    this.logOtp('verifyPhone OTP status preflight', {
      userId,
      identifier: phone,
      normalizedIdentifier: normalizedInputPhone,
      expectedPhone,
      otpKey: `otp:${normalizedInputPhone}`,
      otpLength: otp?.length,
      otp: this.maskOtp(otp),
      ...otpStatus,
    });

    const verificationResult = await this.otpService.verifyOtp(normalizedInputPhone, otp);
    this.logOtp('verifyPhone lookup result', {
      userId,
      identifier: phone,
      normalizedIdentifier: normalizedInputPhone,
      expectedPhone,
      otpLength: otp?.length,
      otp: this.maskOtp(otp),
      verificationSuccess: verificationResult.success,
      verificationMessage: verificationResult.message,
    });
    this.logOtp('verifyPhone OTP verification attempted', {
      userId,
      identifier: phone,
      normalizedIdentifier: normalizedInputPhone,
      expectedPhone,
      otpLength: otp?.length,
      otp: this.maskOtp(otp),
      verificationSuccess: verificationResult.success,
      verificationMessage: verificationResult.message,
    });
    if (!verificationResult.success) {
      throw this.errors.otpInvalid('AuthService.verifyPhone', verificationResult.message);
    }

    const verifiedAt = new Date();
    if (isExistingPhoneOwnedByAnotherUser && !existingPhoneUserProfileComplete) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            user: {
              update: (args: PrismaDelegateArgs) => Promise<unknown>;
            };
          };

          await typedClient.user.update({
            where: { id: existingPhoneUser.id },
            data: {
              phone: null,
              phoneVerified: false,
              phoneVerifiedAt: null,
            } as never,
          } as PrismaDelegateArgs);

          await typedClient.user.update({
            where: { id: user.id },
            data: {
              phone: normalizedInputPhone,
              phoneVerified: true,
              phoneVerifiedAt: verifiedAt,
            } as never,
          } as PrismaDelegateArgs);
        },
        {
          userId,
          clinicId: user.primaryClinicId || '',
          resourceType: 'USER',
          operation: 'UPDATE',
          resourceId: user.id,
          userRole: user.role as Role,
          details: {
            source: 'AuthService.verifyPhone',
            action: 'transfer_phone_from_incomplete_profile',
            claimedPhone: normalizedInputPhone,
            existingPhoneUserId: existingPhoneUser.id,
          },
        }
      );
    } else {
      await this.databaseService.updateUserSafe(user.id, {
        phone: normalizedInputPhone,
        phoneVerified: true,
        phoneVerifiedAt: verifiedAt,
      } as never);
    }

    // Consume OTP after successful verification (deferred deletion pattern)
    await this.otpService.consumeOtp(normalizedInputPhone);

    return {
      success: true,
      phoneVerified: true,
      phoneVerifiedAt: verifiedAt.toISOString(),
    };
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

    // 2. Look up user role and clinic isolation service
    const clinicIsolationService = this.databaseService['clinicIsolationService'];
    const userRecord = await this.databaseService.findUserByIdSafe(userId);
    const userRole = userRecord?.role as Role | undefined;

    // 3. For PATIENT role: any valid active clinic is accessible.
    // Patients are not staff-locked; they can log into any clinic portal.
    // If their primaryClinicId is stale, update it to the current valid clinic.
    if (userRole === Role.PATIENT) {
      if (userRecord && userRecord.primaryClinicId !== clinicUUID) {
        // Auto-heal: update the stale primaryClinicId
        await this.databaseService
          .updateUserSafe(userId, {
            primaryClinicId: clinicUUID,
          } as never)
          .catch(() => {
            // Non-fatal: best effort update
          });
        await this.logging.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Auto-updated stale primaryClinicId for patient ${userId}: ${userRecord.primaryClinicId} → ${clinicUUID}`,
          `AuthService.${operation}`,
          { userId, oldClinicId: userRecord.primaryClinicId, newClinicId: clinicUUID }
        );
      }
      return clinicUUID;
    }

    // 4. For staff roles: validate user has an active association with this clinic
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

  private async resolveClinicDisplayName(clinicId?: string | null): Promise<string | undefined> {
    if (!clinicId) {
      return undefined;
    }

    try {
      const clinic = await this.databaseService.findClinicByIdSafe(clinicId);
      return clinic?.name || undefined;
    } catch {
      return undefined;
    }
  }

  private buildAuthUserPayload(
    user: {
      id: string;
      email: string;
      name?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      role: Role | string;
      isVerified: boolean;
      phone?: string | null;
      phoneVerified?: boolean | null;
      phoneVerifiedAt?: Date | string | null;
      profilePicture?: string | null;
    },
    options: {
      clinicId?: string | undefined;
      clinicName?: string | undefined;
      profileComplete: boolean;
      requiresProfileCompletion: boolean;
      loginMethod?:
        | 'password'
        | 'phone_otp'
        | 'email_otp'
        | 'google_oauth'
        | 'facebook_oauth'
        | 'apple_oauth';
    }
  ): UserProfile {
    // Email OTP login: email is verified since OTP was sent to and verified at that email
    // Google OAuth: email is verified by Google
    // Phone OTP login: phone is verified but email is NOT automatically verified
    const emailVerified =
      options.loginMethod === 'email_otp' || options.loginMethod === 'google_oauth'
        ? true
        : undefined;

    const isPhoneOtpLogin = options.loginMethod === 'phone_otp';

    // Build name from available fields
    const userName = user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim();

    // Phone OTP users should not carry email into the auth payload at all.
    // This keeps the session/profile-completion flow aligned with phone-only login.
    const emailToInclude = isPhoneOtpLogin ? undefined : user.email;

    return {
      id: user.id,
      ...(emailToInclude ? { email: emailToInclude } : {}),
      name: userName || emailToInclude || '',
      ...(user.firstName ? { firstName: user.firstName } : {}),
      ...(user.lastName ? { lastName: user.lastName } : {}),
      role: user.role as Role,
      isVerified: user.isVerified,
      ...(user.phone ? { phone: user.phone } : {}),
      ...(typeof user.phoneVerified === 'boolean' ? { phoneVerified: user.phoneVerified } : {}),
      ...(user.phoneVerifiedAt
        ? {
            phoneVerifiedAt:
              user.phoneVerifiedAt instanceof Date
                ? user.phoneVerifiedAt.toISOString()
                : new Date(user.phoneVerifiedAt).toISOString(),
          }
        : {}),
      ...(emailVerified !== undefined ? { emailVerified } : {}),
      ...(options.clinicId ? { clinicId: options.clinicId } : {}),
      ...(options.clinicName ? { clinicName: options.clinicName } : {}),
      ...(user.profilePicture ? { profilePicture: user.profilePicture } : {}),
      profileComplete: options.profileComplete,
      requiresProfileCompletion: options.requiresProfileCompletion,
      ...(options.loginMethod ? { loginMethod: options.loginMethod } : {}),
    };
  }

  /**
   * Resolve clinic for authentication flows.
   * Priority: explicit clinic (header/body) -> primaryClinicId -> ClinicAdmin -> active UserRole clinic assignment
   */
  private async resolveClinicForAuthentication(
    user: { id: string; role: Role | string; primaryClinicId?: string | null },
    explicitClinicId?: string
  ): Promise<string | undefined> {
    if (explicitClinicId) {
      return explicitClinicId;
    }

    if (user.primaryClinicId) {
      return user.primaryClinicId;
    }

    if ((user.role as Role) === Role.SUPER_ADMIN) {
      return undefined;
    }

    const clinicAdminAssignment = await this.databaseService.executeHealthcareRead<{
      clinicId: string | null;
    } | null>(async client => {
      const typedClient = client as unknown as {
        clinicAdmin: {
          findFirst: (args: {
            where: { userId: string };
            select: { clinicId: true };
          }) => Promise<{ clinicId: string | null } | null>;
        };
      };

      return typedClient.clinicAdmin.findFirst({
        where: { userId: user.id },
        select: { clinicId: true },
      });
    });

    if (clinicAdminAssignment?.clinicId) {
      return clinicAdminAssignment.clinicId;
    }

    const activeRoleAssignment = await this.databaseService.executeHealthcareRead<{
      clinicId: string | null;
    } | null>(async client => {
      const typedClient = client as unknown as {
        userRole: {
          findFirst: (args: {
            where: {
              userId: string;
              clinicId: { not: null };
              isActive: true;
              revokedAt: null;
              OR: Array<{ expiresAt: null } | { expiresAt: { gt: Date } }>;
            };
            select: { clinicId: true };
            orderBy: { assignedAt: 'asc' };
          }) => Promise<{ clinicId: string | null } | null>;
        };
      };

      return typedClient.userRole.findFirst({
        where: {
          userId: user.id,
          clinicId: { not: null },
          isActive: true,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { clinicId: true },
        orderBy: { assignedAt: 'asc' },
      });
    });

    return activeRoleAssignment?.clinicId ?? undefined;
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

      const dbIsComplete = user.isProfileComplete === true;
      const calculatedIsComplete = this.calculateProfileCompletionFromUser(
        user as unknown as Record<string, unknown>,
        role
      );

      // Authoritative source is the calculated value (actual data on the user record).
      // Trusting only the DB flag would let stale `isProfileComplete = true` rows
      // hide incomplete profiles (e.g. user registered via OTP, never entered name).
      const isComplete = calculatedIsComplete;

      // Self-heal stale rows in both directions so subsequent checks can use the persisted flag.
      if (!dbIsComplete && calculatedIsComplete) {
        await this.databaseService.updateUserSafe(userId, {
          isProfileComplete: true,
          profileCompletedAt: new Date(),
        } as UserUpdateInput);
      } else if (dbIsComplete && !calculatedIsComplete) {
        await this.databaseService.updateUserSafe(userId, {
          isProfileComplete: false,
        } as UserUpdateInput);
      }

      return {
        isComplete,
        isProfileComplete: isComplete, // Backward compatibility
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
    const profileRecord = user as Record<string, unknown>;
    return profileRecord['isProfileComplete'] === true;
  }

  private calculateProfileCompletionFromUser(user: Record<string, unknown>, role: Role): boolean {
    if (role !== Role.PATIENT) {
      return true;
    }

    const requiredFields = this.getRequiredProfileFieldsForRole(role);
    if (requiredFields.length === 0) {
      return true;
    }

    const hasRequiredFields = requiredFields.every(field =>
      this.isProfileFieldPresent(user[field])
    );
    const hasVerifiedPhone =
      !this.isProfileFieldPresent(user['phone']) || user['phoneVerified'] === true;

    return hasRequiredFields && hasVerifiedPhone;
  }

  private getRequiredProfileFieldsForRole(role: Role): string[] {
    if (role !== Role.PATIENT) {
      return [];
    }

    switch (role) {
      case Role.PATIENT:
        return ['firstName', 'lastName', 'phone'];
      default:
        return ['firstName', 'lastName', 'phone'];
    }
  }

  private isProfileFieldPresent(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    if (typeof value === 'string') {
      return value.trim().length > 0;
    }

    return true;
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
        timestamp: nowIso(),
      });

      // Invalidate user cache after profile update
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

    // SUPER_ADMIN operates across all clinics — no clinic association required
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;

    if (!clinicId && !isSuperAdmin) {
      throw new Error('Cannot generate token: user missing clinic association');
    }

    // For SUPER_ADMIN: include clinicId if available, otherwise omit
    // For other roles: always include clinicId
    const payload: TokenPayload = {
      sub: user.id,
      ...(user.email ? { email: user.email } : {}),
      role: user.role || '',
      sessionId: sessionId,
      ...(clinicId || isSuperAdmin ? { clinicId: clinicId || '' } : {}),
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

    // Consume OTP after successful verification (deferred deletion pattern)
    await this.otpService.consumeOtp(email);

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

    if (!clinicId) {
      throw this.errors.validationError(
        'clinicId',
        'Clinic ID is required for verification',
        'AuthService.resendVerification'
      );
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
      const socialAuthResult = await this.socialAuthService.authenticateWithGoogle(
        googleToken,
        clinicId
      );

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

      // Find the full user record - auto-register if not found (NEW USERS)
      let fullUser = await this.databaseService.findUserByEmailSafe(userEmail);
      let finalClinicId: string | undefined;

      if (!fullUser) {
        // Auto-register new Google OAuth users
        await this.logging.log(
          LogType.AUTH,
          LogLevel.INFO,
          `Auto-registering new user via Google OAuth: ${userEmail}`,
          'AuthService.authenticateWithGoogle',
          { email: userEmail }
        );

        // Determine clinic ID
        const { resolveClinicUUID } = await import('@utils/clinic.utils');
        if (!clinicId) {
          throw this.errors.validationError(
            'clinicId',
            'Clinic ID is required for Google authentication',
            'AuthService.authenticateWithGoogle'
          );
        }
        finalClinicId = await resolveClinicUUID(this.databaseService, clinicId);

        // Create new user with Google info
        const googleUserid = generateUserId(userEmail, true);
        fullUser = await this.databaseService.createUserSafe({
          email: userEmail,
          password: await bcrypt.hash(uuidv4(), 12),
          firstName: socialUser.firstName || '',
          lastName: socialUser.lastName || '',
          name: `${socialUser.firstName || ''} ${socialUser.lastName || ''}`.trim() || userEmail,
          googleId: userId,
          isVerified: true,
          role: 'PATIENT',
          primaryClinicId: finalClinicId,
          userid: googleUserid,
          ...(socialUser.profilePicture ? { profilePicture: socialUser.profilePicture } : {}),
        });

        // Emit registration event
        await this.eventService.emit('user.registered', {
          userId: fullUser.id,
          email: fullUser.email,
          role: fullUser.role,
          clinicId: finalClinicId,
          registrationMethod: 'google_oauth',
        });

        await this.logging.log(
          LogType.AUDIT,
          LogLevel.INFO,
          `New user registered via Google OAuth: ${fullUser.email}`,
          'AuthService.authenticateWithGoogle',
          { userId: fullUser.id, email: fullUser.email }
        );
      }

      // Persist the clinic association for Google users so subsequent guarded
      // requests can resolve clinic access from the database, not just the JWT.
      if (finalClinicId && fullUser.primaryClinicId !== finalClinicId) {
        try {
          await this.databaseService.updateUserSafe(fullUser.id, {
            primaryClinicId: finalClinicId,
            clinics: {
              connect: { id: finalClinicId },
            },
          } as never);
          fullUser.primaryClinicId = finalClinicId;
        } catch (_error) {
          void this.logging.log(
            LogType.AUTH,
            LogLevel.WARN,
            'Failed to persist primary clinic for Google OAuth user; falling back to runtime clinic context',
            'AuthService.authenticateWithGoogle',
            {
              userId: fullUser.id,
              email: fullUser.email,
              clinicId: finalClinicId,
              error: _error instanceof Error ? _error.message : String(_error),
            }
          );

          // Keep the in-memory user context aligned so session/JWT generation
          // still carries the resolved clinic for this login request.
          fullUser.primaryClinicId = finalClinicId;
        }
      }

      const googleUserRole = fullUser.role as Role;
      if (googleUserRole === Role.PATIENT) {
        await this.ensurePatientRecordForAuth(fullUser.id, finalClinicId, 'googleOAuth');
      }

      // Determine if this was a new registration (we auto-registered above)
      const isNewUser = !socialAuthResult.isNewUser || !userEmail; // Will be true for auto-registered users

      // Create session
      const session = await this.sessionService.createSession({
        userId: fullUser.id,
        userAgent: sessionMetadata?.userAgent || 'Google OAuth',
        ipAddress: sessionMetadata?.ipAddress || '127.0.0.1',
        metadata: { googleOAuth: true, isNewUser },
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
        role: fullUser.role as Role,
        ...(fullUser.phone && { phone: fullUser.phone }),
        // Include clinicId as the resolved UUID so guards and DB checks agree.
        ...(finalClinicId ? { clinicId: finalClinicId } : {}),
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
      const isFirstLogin = !fullUser.lastLogin || socialAuthResult.isNewUser;
      await this.databaseService.updateUserSafe(fullUser.id, {
        lastLogin: new Date(),
      });

      // Emit Google OAuth login event
      const appName = this.configService.getEnv('APP_NAME') || 'Healthcare App';
      const googleEventClinicName = await this.resolveClinicDisplayName(finalClinicId);
      await this.eventService.emit('user.google_oauth_logged_in', {
        userId: fullUser.id,
        email: fullUser.email,
        role: fullUser.role as Role,
        clinicId: finalClinicId,
        ...(googleEventClinicName && { clinicName: googleEventClinicName }),
        sessionId: session.sessionId,
        isNewUser: socialAuthResult.isNewUser,
        appName,
        isFirstLogin,
        metadata: {
          loginMethod: 'google_oauth',
          userAgent: sessionMetadata?.userAgent,
          ipAddress: sessionMetadata?.ipAddress,
        },
      });

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `Google OAuth login successful for: ${fullUser.email}${socialAuthResult.isNewUser ? ' (new user)' : ''}`,
        'AuthService.authenticateWithGoogle',
        { userId: fullUser.id, email: fullUser.email, role: fullUser.role, clinicId: finalClinicId }
      );

      const profileStatus = await this.checkProfileCompletionStatus(
        fullUser.id,
        fullUser.role as Role
      );
      const googleResponseClinicName = await this.resolveClinicDisplayName(finalClinicId);

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        sessionId: tokens.sessionId,
        redirectUrl: getAuthRedirectUrl(fullUser.role, profileStatus.isComplete),
        user: this.buildAuthUserPayload(fullUser, {
          clinicId: finalClinicId || undefined,
          clinicName: googleResponseClinicName,
          profileComplete: profileStatus.isComplete,
          requiresProfileCompletion: !profileStatus.isComplete,
          loginMethod: 'google_oauth',
        }),
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
        timestamp: nowIso(),
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
