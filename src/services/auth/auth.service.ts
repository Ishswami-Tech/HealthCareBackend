import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../libs/infrastructure/database/prisma/prisma.service';
import { CacheService } from '../../libs/infrastructure/cache/cache.service';
import { LoggingService } from '../../libs/infrastructure/logging/logging.service';
import { EmailService } from '../../libs/communication/messaging/email/email.service';
import { SessionManagementService } from '../../libs/core/session/session-management.service';
import { RbacService } from '../../libs/core/rbac/rbac.service';
import { 
  LoginDto, 
  RegisterDto, 
  AuthResponse, 
  PasswordResetRequestDto, 
  PasswordResetDto,
  RefreshTokenDto,
  ChangePasswordDto,
  RequestOtpDto,
  VerifyOtpRequestDto
} from '../../libs/dtos/auth.dto';
import { CreateUserDto, Role } from '../../libs/dtos/user.dto';
import { AuthTokens, TokenPayload } from '../../libs/core/types';
import { EmailTemplate } from '../../libs/core/types/email.types';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly CACHE_TTL = 3600; // 1 hour

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly logging: LoggingService,
    private readonly emailService: EmailService,
    private readonly sessionService: SessionManagementService,
    private readonly rbacService: RbacService,
  ) {}

  /**
   * Get user profile with enterprise healthcare caching
   */
  async getUserProfile(userId: string, clinicId?: string): Promise<any> {
    const cacheKey = `user:${userId}:profile:${clinicId || 'default'}`;
    
    return this.cacheService.cache(
      cacheKey,
      async () => {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            isVerified: true,
            primaryClinicId: true,
            lastLogin: true,
            createdAt: true,
          },
        });

        if (!user) {
          throw new UnauthorizedException('User not found');
        }

        return user;
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
  async getUserPermissions(userId: string, clinicId: string): Promise<any> {
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
      
      this.logger.debug(`Invalidated cache for user: ${userId}, clinic: ${clinicId || 'all'}`);
    } catch (error) {
      this.logger.error(`Failed to invalidate user cache for ${userId}:`, error);
    }
  }

  /**
   * User registration
   */
  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    try {
      // Check if user already exists
      const existingUser = await this.prisma.user.findUnique({
        where: { email: registerDto.email },
      });

      if (existingUser) {
        throw new BadRequestException('User with this email already exists');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(registerDto.password, 12);

      // Create user
      const userData: any = {
        userid: uuidv4(), // Generate unique userid
        email: registerDto.email,
        password: hashedPassword,
        name: `${registerDto.firstName} ${registerDto.lastName}`, // Required name field
        age: 25, // Default age, should be provided in DTO
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        phone: registerDto.phone,
        isVerified: false,
      };

      // Add optional fields only if they exist
      if (registerDto.role) userData.role = registerDto.role as Role;
      if (registerDto.gender) userData.gender = registerDto.gender;
      if (registerDto.dateOfBirth) userData.dateOfBirth = new Date(registerDto.dateOfBirth);
      if (registerDto.address) userData.address = registerDto.address;
      if (registerDto.clinicId) userData.primaryClinicId = registerDto.clinicId;
      if (registerDto.googleId) userData.googleId = registerDto.googleId;

      const user = await this.prisma.user.create({
        data: userData,
      });

      // Generate tokens
      const tokens = await this.generateTokens(user);

      // Create session
      const session = await this.sessionService.createSession({
        userId: user.id,
        clinicId: registerDto.clinicId,
        userAgent: 'Registration',
        ipAddress: '127.0.0.1',
        metadata: { registration: true },
      });

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
    } catch (error) {
      this.logger.error(`Registration failed for ${registerDto.email}`, error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
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
        async () => {
          return await this.prisma.user.findUnique({
            where: { email: loginDto.email },
            select: {
              id: true,
              email: true,
              password: true,
              firstName: true,
              lastName: true,
              role: true,
              isVerified: true,
              primaryClinicId: true,
            },
          });
        },
        {
          ttl: 300, // 5 minutes for login attempts
          tags: ['user_login'],
          priority: 'high',
          enableSwr: false, // No SWR for login data
        }
      );

      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }


      // Verify password
      const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid credentials');
      }

      // Generate tokens
      const tokens = await this.generateTokens(user);

      // Create session
      const session = await this.sessionService.createSession({
        userId: user.id,
        clinicId: loginDto.clinicId || user.primaryClinicId || undefined,
        userAgent: 'Login',
        ipAddress: '127.0.0.1',
        metadata: { login: true },
      });

      // Update last login
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
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
    } catch (error) {
      this.logger.error(`Login failed for ${loginDto.email}`, error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshTokenDto: RefreshTokenDto): Promise<AuthTokens> {
    try {
      const payload = this.jwtService.verify(refreshTokenDto.refreshToken);
      
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          role: true,
          primaryClinicId: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return await this.generateTokens(user);
    } catch (error) {
      this.logger.error('Token refresh failed', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Logout user
   */
  async logout(sessionId: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.sessionService.invalidateSession(sessionId);
      
      this.logger.log(`User logged out: session ${sessionId}`);
      
      return {
        success: true,
        message: 'Logout successful',
      };
    } catch (error) {
      this.logger.error(`Logout failed for session ${sessionId}`, error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(requestDto: PasswordResetRequestDto): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: requestDto.email },
      });

      if (!user) {
        // Don't reveal if user exists
        return {
          success: true,
          message: 'If the email exists, a password reset link has been sent',
        };
      }

      // Generate reset token
      const resetToken = uuidv4();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

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
          resetUrl: `${this.configService.get('FRONTEND_URL')}/reset-password?token=${resetToken}`,
        },
      });

      this.logger.log(`Password reset requested for: ${user.email}`);

      return {
        success: true,
        message: 'If the email exists, a password reset link has been sent',
      };
    } catch (error) {
      this.logger.error(`Password reset request failed for ${requestDto.email}`, error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
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
        throw new BadRequestException('Invalid or expired reset token');
      }

      // Find user
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(resetDto.newPassword, 12);

      // Update password
      await this.prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });

      // Invalidate all user sessions
      await this.sessionService.revokeAllUserSessions(user.id);

      // Invalidate user cache
      await this.invalidateUserCache(user.id, user.primaryClinicId || undefined);

      // Remove reset token
      await this.cacheService.del(`password_reset:${resetDto.token}`);

      this.logger.log(`Password reset successful for: ${user.email}`);

      return {
        success: true,
        message: 'Password reset successful',
      };
    } catch (error) {
      this.logger.error('Password reset failed', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  /**
   * Change password (authenticated user)
   */
  async changePassword(userId: string, changePasswordDto: ChangePasswordDto): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(changePasswordDto.currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        throw new BadRequestException('Current password is incorrect');
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(changePasswordDto.newPassword, 12);

      // Update password
      await this.prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });

      // Invalidate all user sessions except current
      await this.sessionService.revokeAllUserSessions(user.id);

      this.logger.log(`Password changed successfully for: ${user.email}`);

      return {
        success: true,
        message: 'Password changed successfully',
      };
    } catch (error) {
      this.logger.error(`Password change failed for user ${userId}`, error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  /**
   * Request OTP
   */
  async requestOtp(requestDto: RequestOtpDto): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: requestDto.identifier },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Generate OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

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

      this.logger.log(`OTP sent to: ${user.email}`);

      return {
        success: true,
        message: 'OTP sent successfully',
      };
    } catch (error) {
      this.logger.error(`OTP request failed for ${requestDto.identifier}`, error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  /**
   * Verify OTP
   */
  async verifyOtp(verifyDto: VerifyOtpRequestDto): Promise<AuthResponse> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: verifyDto.email },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Verify OTP
      const storedOtp = await this.cacheService.get(`otp:${user.id}`);
      
      if (!storedOtp || storedOtp !== verifyDto.otp) {
        throw new BadRequestException('Invalid or expired OTP');
      }

      // Remove OTP
      await this.cacheService.del(`otp:${user.id}`);

      // Generate tokens
      const tokens = await this.generateTokens(user);

      // Create session
      const session = await this.sessionService.createSession({
        userId: user.id,
        clinicId: verifyDto.clinicId || user.primaryClinicId || undefined,
        userAgent: 'OTP Login',
        ipAddress: '127.0.0.1',
        metadata: { otpLogin: true },
      });

      // Update last login
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
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
    } catch (error) {
      this.logger.error(`OTP verification failed for ${verifyDto.email}`, error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  /**
   * Generate JWT tokens
   */
  private async generateTokens(user: any): Promise<AuthTokens> {
    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      clinicId: user.primaryClinicId,
      domain: 'healthcare',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        expiresIn: this.configService.get('JWT_ACCESS_EXPIRES_IN') || '15m',
      }),
      this.jwtService.signAsync(payload, {
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN') || '7d',
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15 minutes
      sessionId: uuidv4(),
    };
  }
}
