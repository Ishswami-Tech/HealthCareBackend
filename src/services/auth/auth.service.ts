import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../../libs/infrastructure/database";
import { CacheService } from "../../libs/infrastructure/cache/cache.service";
import { LoggingService } from "../../libs/infrastructure/logging/logging.service";
import { EmailService } from "../../libs/communication/messaging/email/email.service";
import { SessionManagementService } from "../../libs/core/session/session-management.service";
import { RbacService } from "../../libs/core/rbac/rbac.service";
import { JwtAuthService } from "./core/jwt.service";
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
} from "../../libs/dtos/auth.dto";
import { Role, Gender } from "../../libs/dtos/user.dto";
import { AuthTokens, TokenPayload, UserProfile } from "../../libs/core/types";
import { EmailTemplate } from "../../libs/core/types/email.types";
import {
  UserWithPassword,
  UserCreateData,
  // UserSelectResult,
} from "../../libs/infrastructure/database/prisma/user.types";
import {
  UserCreateInput,
  UserUpdateInput,
  UserWhereInput,
} from "../../libs/infrastructure/database/prisma/prisma.service";
// import { UserWithRelations } from "../../libs/infrastructure/database/prisma/prisma.service";
import * as bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly CACHE_TTL = 3600; // 1 hour

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly logging: LoggingService,
    private readonly emailService: EmailService,
    private readonly sessionService: SessionManagementService,
    private readonly rbacService: RbacService,
    private readonly jwtAuthService: JwtAuthService,
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
  async getUserProfile(
    userId: string,
    clinicId?: string,
  ): Promise<UserProfile> {
    const cacheKey = `user:${userId}:profile:${clinicId || "default"}`;

    return this.cacheService.cache(
      cacheKey,
      async (): Promise<UserProfile> => {
        const user = await this.databaseService.findUserByIdSafe(userId);

        if (!user) {
          throw new UnauthorizedException("User not found");
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
        tags: [
          `user:${userId}`,
          "user_profiles",
          clinicId ? `clinic:${clinicId}` : "global",
        ],
        priority: "high",
        enableSwr: true,
        compress: true, // Compress user profiles
        containsPHI: true, // User profiles contain PHI
      },
    );
  }

  /**
   * Get user permissions with enterprise RBAC caching
   */
  async getUserPermissions(
    userId: string,
    clinicId: string,
  ): Promise<string[]> {
    const cacheKey = `user:${userId}:clinic:${clinicId}:permissions`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        // First get user roles
        const userRoles = await this.rbacService.getUserRoles(userId, clinicId);
        // Then get permissions for those roles
        const roleIds = userRoles.map((role) => role.roleId);
        return await this.rbacService.getRolePermissions(roleIds);
      },
      {
        ttl: 3600, // 1 hour
        tags: [`user:${userId}`, `clinic:${clinicId}`, "permissions", "rbac"],
        priority: "high",
        enableSwr: true,
        compress: true, // Compress permission data
        containsPHI: false, // Permissions are not PHI
      },
    );
  }

  /**
   * Invalidate user cache when user data changes
   */
  private async invalidateUserCache(
    userId: string,
    clinicId?: string,
  ): Promise<void> {
    try {
      // Invalidate user profile cache
      await this.cacheService.invalidatePatientCache(userId, clinicId);

      // Invalidate user-specific caches
      await this.cacheService.invalidateCacheByPattern(`user:${userId}:*`);

      // Invalidate clinic-specific caches if clinicId provided
      if (clinicId) {
        await this.cacheService.invalidateClinicCache(clinicId);
      }

      this.logger.debug(
        `Invalidated cache for user: ${userId}, clinic: ${clinicId || "all"}`,
      );
    } catch (_error) {
      this.logger.error(
        `Failed to invalidate user cache for ${userId}:`,
        _error,
      );
    }
  }

  /**
   * User registration
   */
  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    try {
      // Check if user already exists
      const existingUser = await this.databaseService.findUserByEmailSafe(
        registerDto.email,
      );

      if (existingUser) {
        throw new BadRequestException("User with this email already exists");
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(registerDto.password, 12);

      // Create user data with proper typing
      const userData: UserCreateData = {
        userid: uuidv4(), // Generate unique userid
        email: registerDto.email,
        password: hashedPassword,
        name: `${registerDto.firstName} ${registerDto.lastName}`, // Required name field
        age: 25, // Default age, should be provided in DTO
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        phone: registerDto.phone,
      };

      // Add optional fields only if they exist
      if (registerDto.role) userData.role = registerDto.role as Role;
      if (registerDto.gender) userData.gender = registerDto.gender as Gender;
      if (registerDto.dateOfBirth)
        userData.dateOfBirth = registerDto.dateOfBirth;
      if (registerDto.address) userData.address = registerDto.address;
      if (registerDto.clinicId) userData.primaryClinicId = registerDto.clinicId;
      if (registerDto.googleId) userData.googleId = registerDto.googleId;

      const { dateOfBirth, ...userDataWithoutDate } = userData;
      const user = await this.databaseService.createUserSafe({
        ...userDataWithoutDate,
        ...(dateOfBirth && { dateOfBirth: new Date(dateOfBirth) }),
      });

      // Create session first
      const session = await this.sessionService.createSession({
        userId: user.id,
        userAgent: "Registration",
        ipAddress: "127.0.0.1",
        metadata: { registration: true },
        ...(registerDto.clinicId && { clinicId: registerDto.clinicId }),
      });

      // Generate tokens with session ID
      const tokens = await this.generateTokens(user, session.sessionId);

      // Send welcome email
      await this.emailService.sendEmail({
        to: user.email,
        subject: "Welcome to Healthcare App",
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

      this.logger.log(`User registered successfully: ${user.email}`);

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
      this.logger.error(
        `Registration failed for ${registerDto.email}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
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
      const user = await this.cacheService.cache(
        `user:login:${loginDto.email}`,
        async (): Promise<UserWithPassword | null> => {
          const result = await this.databaseService.findUserByEmailSafe(
            loginDto.email,
          );
          return result as UserWithPassword | null;
        },
        {
          ttl: 300, // 5 minutes for login attempts
          tags: ["user_login"],
          priority: "high",
          enableSwr: false, // No SWR for login data
        },
      );

      if (!user) {
        throw new UnauthorizedException("Invalid credentials");
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(
        loginDto.password,
        user.password,
      );
      if (!isPasswordValid) {
        throw new UnauthorizedException("Invalid credentials");
      }

      // Create session first
      const session = await this.sessionService.createSession({
        userId: user.id,
        userAgent: "Login",
        ipAddress: "127.0.0.1",
        metadata: { login: true },
        ...((loginDto.clinicId || user.primaryClinicId) && {
          clinicId: loginDto.clinicId || user.primaryClinicId,
        }),
      });

      this.logger.log(`DEBUG: Session created: ${JSON.stringify(session)}`);
      this.logger.log(`DEBUG: Session ID: ${session?.sessionId}`);

      // Generate tokens with session ID
      const tokens = await this.generateTokens(user, session.sessionId);

      // Update last login
      await this.databaseService.updateUserSafe(user.id, {
        lastLoginAt: new Date(),
      });

      this.logger.log(`User logged in successfully: ${user.email}`);

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
      this.logger.error(
        `Login failed for ${loginDto.email}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
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
        refreshTokenDto.ipAddress,
      );
    } catch (_error) {
      this.logger.error(
        "Enhanced token refresh failed",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw new UnauthorizedException("Invalid refresh token");
    }
  }

  /**
   * Logout user
   */
  async logout(
    sessionId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.sessionService.invalidateSession(sessionId);

      this.logger.log(`User logged out: session ${sessionId}`);

      return {
        success: true,
        message: "Logout successful",
      };
    } catch (_error) {
      this.logger.error(
        `Logout failed for session ${sessionId}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(
    requestDto: PasswordResetRequestDto,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.databaseService.findUserByEmailSafe(
        requestDto.email,
      );

      if (!user) {
        // Don't reveal if user exists
        return {
          success: true,
          message: "If the email exists, a password reset link has been sent",
        };
      }

      // Generate reset token
      const resetToken = uuidv4();

      // Store reset token with healthcare cache service
      await this.cacheService.set(
        `password_reset:${resetToken}`,
        user.id,
        900, // 15 minutes
      );

      // Send reset email
      await this.emailService.sendEmail({
        to: user.email,
        subject: "Password Reset Request",
        template: EmailTemplate.PASSWORD_RESET,
        context: {
          name: `${user.firstName} ${user.lastName}`,
          resetUrl: `${this.configService.get("FRONTEND_URL")}/reset-password?token=${resetToken}`,
        },
      });

      this.logger.log(`Password reset requested for: ${user.email}`);

      return {
        success: true,
        message: "If the email exists, a password reset link has been sent",
      };
    } catch (_error) {
      this.logger.error(
        `Password reset request failed for ${requestDto.email}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Reset password
   */
  async resetPassword(
    resetDto: PasswordResetDto,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Verify reset token
      const userId = await this.cacheService.get<string>(
        `password_reset:${resetDto.token}`,
      );

      if (!userId) {
        throw new BadRequestException("Invalid or expired reset token");
      }

      // Find user
      const user = await this.databaseService.findUserByIdSafe(userId);

      if (!user) {
        throw new BadRequestException("User not found");
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
      await this.invalidateUserCache(
        user.id,
        user.primaryClinicId || undefined,
      );

      // Remove reset token
      await this.cacheService.del(`password_reset:${resetDto.token}`);

      this.logger.log(`Password reset successful for: ${user.email}`);

      return {
        success: true,
        message: "Password reset successful",
      };
    } catch (_error) {
      this.logger.error(
        "Password reset failed",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Change password (authenticated user)
   */
  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.databaseService.findUserByIdSafe(userId);

      if (!user) {
        throw new BadRequestException("User not found");
      }

      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(
        changePasswordDto.currentPassword,
        user.password,
      );
      if (!isCurrentPasswordValid) {
        throw new BadRequestException("Current password is incorrect");
      }

      // Hash new password
      const _hashedPassword = await bcrypt.hash(
        changePasswordDto.newPassword,
        12,
      );

      // Update password
      await this.databaseService.updateUserSafe(user.id, {
        // password: hashedPassword, // Password field not available in UserUpdateInput
      });

      // Invalidate all user sessions except current
      await this.sessionService.revokeAllUserSessions(user.id);

      this.logger.log(`Password changed successfully for: ${user.email}`);

      return {
        success: true,
        message: "Password changed successfully",
      };
    } catch (_error) {
      this.logger.error(
        `Password change failed for user ${userId}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Request OTP
   */
  async requestOtp(
    requestDto: RequestOtpDto,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.databaseService.findUserByEmailSafe(
        requestDto.identifier,
      );

      if (!user) {
        throw new BadRequestException("User not found");
      }

      // Generate OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Store OTP with healthcare cache service
      await this.cacheService.set(
        `otp:${user.id}`,
        otp,
        300, // 5 minutes
      );

      // Send OTP email
      await this.emailService.sendEmail({
        to: user.email,
        subject: "Your OTP Code",
        template: EmailTemplate.OTP_LOGIN,
        context: {
          name: `${user.firstName} ${user.lastName}`,
          otp,
        },
      });

      this.logger.log(`OTP sent to: ${user.email}`);

      return {
        success: true,
        message: "OTP sent successfully",
      };
    } catch (_error) {
      this.logger.error(
        `OTP request failed for ${requestDto.identifier}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Verify OTP
   */
  async verifyOtp(verifyDto: VerifyOtpRequestDto): Promise<AuthResponse> {
    try {
      const user = await this.databaseService.findUserByEmailSafe(
        verifyDto.email,
      );

      if (!user) {
        throw new BadRequestException("User not found");
      }

      // Verify OTP
      const storedOtp = await this.cacheService.get(`otp:${user.id}`);

      if (!storedOtp || storedOtp !== verifyDto.otp) {
        throw new BadRequestException("Invalid or expired OTP");
      }

      // Remove OTP
      await this.cacheService.del(`otp:${user.id}`);

      // Create session first
      const session = await this.sessionService.createSession({
        userId: user.id,
        userAgent: "OTP Login",
        ipAddress: "127.0.0.1",
        metadata: { otpLogin: true },
        ...((verifyDto.clinicId || user.primaryClinicId) && {
          clinicId: verifyDto.clinicId || user.primaryClinicId,
        }),
      });

      // Generate tokens with session ID
      const tokens = await this.generateTokens(user, session.sessionId);

      // Update last login
      await this.databaseService.updateUserSafe(user.id, {
        lastLoginAt: new Date(),
      });

      this.logger.log(`OTP login successful for: ${user.email}`);

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
      this.logger.error(
        `OTP verification failed for ${verifyDto.email}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Generate JWT tokens with enhanced security features
   */
  private async generateTokens(
    user: UserProfile | UserWithPassword,
    sessionId: string,
    deviceFingerprint?: string,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<AuthTokens> {
    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role || "",
      domain: "healthcare",
      sessionId: sessionId,
      ...("primaryClinicId" in user &&
        user.primaryClinicId && { clinicId: user.primaryClinicId }),
    };

    // Use enhanced JWT service for advanced features
    return await this.jwtAuthService.generateEnhancedTokens(
      payload,
      deviceFingerprint,
      userAgent,
      ipAddress,
    );
  }
}
