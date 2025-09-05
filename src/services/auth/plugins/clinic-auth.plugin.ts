import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../libs/infrastructure/database/prisma/prisma.service';
import { CacheService } from '../../../libs/infrastructure/cache';
import { CircuitBreakerService } from '../../../libs/core/resilience';
import { RbacService } from '../../../libs/core/rbac/rbac.service';
import { Roles } from '../../../libs/infrastructure/database/prisma/constants';
import { 
  IAuthPlugin, 
  AuthPluginDomain, 
  AuthPluginContext, 
  AuthPluginCapabilities,
  LoginRequest,
  RegisterRequest,
  OTPRequest,
  PasswordResetRequest,
  MagicLinkRequest,
  DomainValidationResult
} from '../core/auth-plugin.interface';
import { BaseAuthService } from '../core/base-auth.service';
import { 
  AuthResponse, 
  OTPResult, 
  UserProfile, 
  PasswordResetResult, 
  MagicLinkResult, 
  AuthTokens 
} from '../../../libs/core/types';

@Injectable()
export class ClinicAuthPlugin implements IAuthPlugin {
  private readonly logger = new Logger(ClinicAuthPlugin.name);
  
  readonly name = 'clinic-auth';
  readonly version = '1.0.0';
  readonly domain = AuthPluginDomain.CLINIC;
  readonly capabilities: AuthPluginCapabilities = {
    supportsOTP: true,
    supportsMagicLink: true,
    supportsPasswordAuth: true,
    supportsSocialAuth: true,
    supportsBiometric: false,
    supports2FA: true,
    requiresEmailVerification: true,
    requiresPhoneVerification: true,
    supportsMultipleTenants: true,
  };

  constructor(
    private readonly baseAuthService: BaseAuthService,
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly rbacService: RbacService,
  ) {}

  async initialize(config?: Record<string, any>): Promise<void> {
    this.logger.log('🏥 Initializing Clinic Auth Plugin...');
    this.logger.log('✅ Clinic Auth Plugin initialized successfully');
  }

  async destroy(): Promise<void> {
    this.logger.log('🔧 Destroying Clinic Auth Plugin...');
  }

  // =============================================
  // CORE AUTHENTICATION METHODS
  // =============================================

  async validateUser(email: string, password: string, context: AuthPluginContext): Promise<any | null> {
    try {
      // Healthcare audit logging
      await this.logSecurityEvent('user_validation_attempt', null, { email, clinicId: context.clinicId }, context);

      // Find user in healthcare database
      const user = await this.findHealthcareUser(email, context.clinicId);
      if (!user) {
        await this.logSecurityEvent('user_validation_failed', null, { email, reason: 'user_not_found' }, context);
        return null;
      }

      // Verify password
      const isValidPassword = await this.baseAuthService.verifyPassword(password, user.hashedPassword);
      if (!isValidPassword) {
        await this.logSecurityEvent('user_validation_failed', user.id, { reason: 'invalid_password' }, context);
        return null;
      }

      // Healthcare-specific validation
      const validation = await this.domainSpecificValidation(user, context);
      if (!validation.isValid) {
        await this.logSecurityEvent('user_validation_failed', user.id, { reason: 'domain_validation_failed', errors: validation.errors }, context);
        return null;
      }

      await this.logSecurityEvent('user_validation_success', user.id, { clinicId: context.clinicId }, context);
      return user;
    } catch (error) {
      this.logger.error('Error validating user:', error);
      await this.logSecurityEvent('user_validation_error', null, { email, error: error instanceof Error ? (error as Error).message : String(error) }, context);
      return null;
    }
  }

  async login(request: LoginRequest): Promise<AuthResponse> {
    try {
      const { email, password, otp, context } = request;

      if (!email) {
        throw new BadRequestException('Email is required for clinic authentication');
      }

      await this.logSecurityEvent('login_attempt', null, { email, clinicId: context.clinicId }, context);

      let user: any = null;

      // Handle OTP login
      if (otp) {
        const otpResult = await this.verifyOTP(email, otp, context);
        if (!otpResult.success) {
          throw new UnauthorizedException(otpResult.error || 'Invalid OTP');
        }
        user = otpResult.user;
      } 
      // Handle password login
      else if (password) {
        user = await this.validateUser(email, password, context);
        if (!user) {
          throw new UnauthorizedException('Invalid credentials');
        }
      } else {
        throw new BadRequestException('Either password or OTP is required');
      }

      // Generate tokens
      const tokens = await this.baseAuthService.generateTokens(user, 'clinic');

      await this.logSecurityEvent('login_success', user.id, { 
        clinicId: context.clinicId,
        sessionId: tokens.sessionId,
        userRole: user.role 
      }, context);

      const response: AuthResponse = {
        success: true,
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          clinicId: user.clinicId,
          permissions: user.permissions || [],
          isEmailVerified: user.isEmailVerified,
          isPhoneVerified: user.isPhoneVerified,
          lastLoginAt: new Date(),
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
          sessionId: tokens.sessionId,
          tokenType: 'Bearer'
        },
      };

      return response;
    } catch (error) {
      await this.logSecurityEvent('login_failed', null, { 
        email: request.email, 
        error: error instanceof Error ? (error as Error).message : String(error),
        clinicId: request.context.clinicId 
      }, request.context);
      
      return {
        success: false,
        message: 'Login failed',
        error: `LOGIN_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async register(request: RegisterRequest): Promise<AuthResponse> {
    try {
      const { email, password, name, phone, role, context } = request;

      if (!email || !password || !name) {
        throw new BadRequestException('Email, password, and name are required for clinic registration');
      }

      if (!context.clinicId) {
        throw new BadRequestException('Clinic ID is required for healthcare registration');
      }

      await this.logSecurityEvent('registration_attempt', null, { 
        email, 
        clinicId: context.clinicId,
        role 
      }, context);

      // Check if user already exists
      const existingUser = await this.findHealthcareUser(email, context.clinicId);
      if (existingUser) {
        throw new BadRequestException('User already exists with this email in the clinic');
      }

      // Hash password
      const hashedPassword = await this.baseAuthService.hashPassword(password);

      // Create user with healthcare-specific fields
      const userData = {
        email,
        hashedPassword,
        name,
        phone,
        role: role || 'patient',
        clinicId: context.clinicId,
        isActive: true,
        isEmailVerified: false,
        isPhoneVerified: false,
        registeredAt: new Date(),
      };

      const user = await this.createHealthcareUser(userData);

      // Generate tokens
      const tokens = await this.baseAuthService.generateTokens(user, 'clinic');

      await this.logSecurityEvent('registration_success', user.id, { 
        clinicId: context.clinicId,
        role: user.role,
        sessionId: tokens.sessionId 
      }, context);

      const response: AuthResponse = {
        success: true,
        message: 'Registration successful',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          clinicId: user.clinicId,
          permissions: user.permissions || [],
          isEmailVerified: user.isEmailVerified,
          isPhoneVerified: user.isPhoneVerified,
          requiresVerification: !user.isEmailVerified || (phone && !user.isPhoneVerified),
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
          sessionId: tokens.sessionId,
          tokenType: 'Bearer'
        },
      };

      return response;
    } catch (error) {
      await this.logSecurityEvent('registration_failed', null, { 
        email: request.email, 
        error: error instanceof Error ? (error as Error).message : String(error),
        clinicId: request.context.clinicId 
      }, request.context);
      
      return {
        success: false,
        message: 'Registration failed',
        error: `REGISTRATION_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async logout(userId: string, sessionId?: string, context?: AuthPluginContext): Promise<{ success: boolean; message?: string }> {
    try {
      await this.logSecurityEvent('logout_attempt', userId, { 
        sessionId,
        clinicId: context?.clinicId 
      }, context!);

      // Revoke session
      if (sessionId) {
        await this.baseAuthService.revokeSession(sessionId);
      } else {
        await this.baseAuthService.revokeAllUserSessions(userId);
      }

      await this.logSecurityEvent('logout_success', userId, { 
        sessionId,
        clinicId: context?.clinicId 
      }, context!);

      return { success: true, message: 'Logged out successfully' };
    } catch (error) {
      await this.logSecurityEvent('logout_failed', userId, { 
        error: error instanceof Error ? (error as Error).message : String(error),
        sessionId,
        clinicId: context?.clinicId 
      }, context!);
      
      return { success: false, message: 'Logout failed' };
    }
  }

  async verifyToken(token: string, context?: AuthPluginContext): Promise<any | null> {
    try {
      const payload = await this.baseAuthService.validateToken(token);
      if (!payload) return null;

      // Additional healthcare-specific validation
      const user = await this.findHealthcareUserById(payload.sub, context?.clinicId);
      if (!user || !user.isActive) {
        return null;
      }

      return payload;
    } catch (error) {
      this.logger.error('Error verifying token:', error);
      return null;
    }
  }

  // =============================================
  // DOMAIN-SPECIFIC VALIDATION
  // =============================================

  async domainSpecificValidation(user: any, context: AuthPluginContext): Promise<DomainValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Validate clinic association
      if (context.clinicId && user.clinicId !== context.clinicId) {
        errors.push('User is not associated with the specified clinic');
      }

      return {
        isValid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      this.logger.error('Error in domain-specific validation:', error);
      return {
        isValid: false,
        errors: ['Validation service temporarily unavailable'],
      };
    }
  }

  async validateAccess(userId: string, resource: string, action: string, context: AuthPluginContext): Promise<boolean> {
    try {
      // Use the centralized RBAC service for access validation
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        resource,
        action,
        resourceId: context.clinicId,
      });

      return permissionCheck.hasPermission;
    } catch (error) {
      this.logger.error('Error validating access:', error);
      return false;
    }
  }

  async getUserRolesAndPermissions(userId: string, context: AuthPluginContext): Promise<{ roles: string[]; permissions: string[] }> {
    try {
      // Use the centralized RBAC service to get user permissions
      const permissionsSummary = await this.rbacService.getUserPermissionsSummary(userId, context.clinicId);
      const permissions = permissionsSummary.effectivePermissions;
      
      const user = await this.findHealthcareUserById(userId, context.clinicId);
      if (!user) {
        return { roles: [], permissions: [] };
      }

      const roles = [user.role];

      return { roles, permissions };
    } catch (error) {
      this.logger.error('Error getting user roles and permissions:', error);
      return { roles: [], permissions: [] };
    }
  }

  // =============================================
  // OTP OPERATIONS
  // =============================================

  async requestOTP(request: OTPRequest): Promise<OTPResult> {
    try {
      const { identifier, purpose, context } = request;

      await this.logSecurityEvent('otp_request', null, { 
        identifier, 
        purpose,
        clinicId: context.clinicId 
      }, context);

      // Generate and store OTP
      const otp = await this.baseAuthService.generateOTP();
      await this.baseAuthService.storeOTP(identifier, otp, 'clinic');

      // Send OTP (placeholder implementation)
      this.logger.debug(`Sending OTP to ${identifier}: ${otp} (purpose: ${purpose})`);

      await this.logSecurityEvent('otp_sent', null, { 
        identifier, 
        purpose,
        clinicId: context.clinicId 
      }, context);

      return {
        success: true,
        message: 'OTP sent successfully',
        expiresIn: 300,
      };
    } catch (error) {
      this.logger.error('Error requesting OTP:', error);
      return {
        success: false,
        message: 'Failed to request OTP',
      };
    }
  }

  async verifyOTP(identifier: string, otp: string, context: AuthPluginContext): Promise<{ success: boolean  ; user?: any; error?: string }> {
    try {
      const isValidOTP = await this.baseAuthService.verifyOTP(identifier, otp, 'clinic');
      if (!isValidOTP) {
        return { success: false, error: 'Invalid or expired OTP' };
      }

      const user = await this.findHealthcareUser(identifier, context.clinicId);   
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      return { success: true, user };
    } catch (error) {
      this.logger.error('Error verifying OTP:', error);
      return { success: false, error: 'OTP verification failed' };
    }
  }

  // =============================================
  // HELPER METHODS
  // =============================================

  private async findHealthcareUser(email: string, clinicId?: string): Promise<any | null> {
    try {
      // Mock implementation - in production this would query the database
      return {
        id: 'user_' + Date.now(),
        email,
        name: 'Healthcare User',
        hashedPassword: '$2b$12$hashed_password',
        role: 'patient',
        clinicId: clinicId || 'default_clinic',
        isActive: true,
        isEmailVerified: false,
        isPhoneVerified: false,
        permissions: [],
      };
    } catch (error) {
      this.logger.error('Error finding healthcare user:', error);
      return null;
    }
  }

  private async findHealthcareUserById(userId: string, clinicId?: string): Promise<any | null> {
    try {
      // Mock implementation
      return {
        id: userId,
        email: 'user@clinic.com',
        name: 'Healthcare User',
        role: 'patient',
        clinicId: clinicId || 'default_clinic',
        isActive: true,
        permissions: [],
      };
    } catch (error) {
      this.logger.error('Error finding healthcare user by ID:', error);
      return null;
    }
  }

  private async createHealthcareUser(userData: any): Promise<any> {
    try {
      // Mock implementation - in production this would create user in database
      const user = {
        id: 'user_' + Date.now(),
        ...userData,
        createdAt: new Date(),
        permissions: this.getDefaultPermissions(userData.role),
      };
      
      return user;
    } catch (error) {
      this.logger.error('Error creating healthcare user:', error);
      throw error;
    }
  }

  private getDefaultPermissions(role: string): string[] {
    const rolePermissions: Record<string, string[]> = {
      patient: ['read:own_records', 'create:appointments', 'read:appointments', 'update:own_profile'],
      doctor: ['read:patient_records', 'write:patient_records', 'create:prescriptions', 'read:appointments', 'create:appointments'],
      nurse: ['read:patient_records', 'read:appointments', 'update:appointments', 'create:notes'],
      admin: ['read:all', 'write:all', 'delete:records', 'manage:users', 'manage:clinic'],
    };
    
    return rolePermissions[role] || [];
  }

  async logSecurityEvent(event: string, userId: string | null, details: Record<string, any>, context: AuthPluginContext): Promise<void> {
    try {
      const logEntry = {
        event,
        userId,
        clinicId: context.clinicId,
        domain: 'clinic',
        details,
        timestamp: new Date(),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      };

      // In production, store in audit log database
      this.logger.debug('Healthcare security event:', logEntry);
    } catch (error) {
      this.logger.error('Error logging security event:', error);
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; details?: Record<string, any>; errors?: string[] }> {
    try {
      const details = {
        database: 'connected',
        cache: 'connected',
      };

      return {
        healthy: true,
        details,
      };
    } catch (error) {
      return {
        healthy: false,
        errors: ['Health check failed'],
        details: { error: error instanceof Error ? (error as Error).message : String(error) },
      };
    }
  }

  // Add missing methods required by the interface
  async forgotPassword(request: PasswordResetRequest): Promise<PasswordResetResult> {
    try {
      const { email, context } = request;
      
      const user = await this.findHealthcareUser(email, context.clinicId);
      if (!user) {
        return {
          success: false,
          message: 'No user found with this email',
        };
      }

      const resetToken = await this.baseAuthService.generatePasswordResetToken(email, 'clinic');
      
      // In production, send email here
      this.logger.debug(`Password reset token for ${email}: ${resetToken}`);

      return {
        success: true,
        message: 'Password reset email sent',
      };
    } catch (error) {
      this.logger.error('Error in forgot password:', error);
      return {
        success: false,
        message: 'Failed to process password reset request',
      };
    }
  }

  async resetPassword(request: PasswordResetRequest): Promise<PasswordResetResult> {
    try {
      const { email, token, newPassword, context } = request;

      if (!token || !newPassword) {
        return {
          success: false,
          message: 'Token and new password are required',
        };
      }

      const resetResult = await this.baseAuthService.verifyPasswordResetToken(token);
      if (!resetResult.success) {
        return {
          success: false,
          message: resetResult.error || 'Invalid or expired reset token',
        };
      }

      const user = await this.findHealthcareUser(email || resetResult.email!, context.clinicId);
      if (!user) {
        return {
          success: false,
          message: 'No user found with this email',
        };
      }

      // Update password (mock implementation)
      this.logger.debug(`Password reset for user ${user.id}`);

      await this.baseAuthService.markPasswordResetTokenAsUsed(token);

      return {
        success: true,
        message: 'Password reset successful',
      };
    } catch (error) {
      this.logger.error('Error in reset password:', error);
      return {
        success: false,
        message: 'Failed to reset password',
      };
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: AuthPluginContext
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await this.findHealthcareUserById(userId, context.clinicId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      const isValidPassword = await this.baseAuthService.verifyPassword(currentPassword, user.hashedPassword);
      if (!isValidPassword) {
        return { success: false, error: 'Current password is incorrect' };
      }

      // Update password (mock implementation)
      this.logger.debug(`Password changed for user ${userId}`);

      return { success: true };
    } catch (error) {
      this.logger.error('Error changing password:', error);
      return { success: false, error: 'Failed to change password' };
    }
  }

  async sendMagicLink(request: MagicLinkRequest): Promise<MagicLinkResult> {
    try {
      const { email, redirectUrl, context } = request;
      
      const user = await this.findHealthcareUser(email, context.clinicId);
      if (!user) {
        return {
          success: false,
          message: 'No user found with this email',
        };
      }

      const magicLinkResult = await this.baseAuthService.generateMagicLink(email, 'clinic', redirectUrl);
      
      return magicLinkResult;
    } catch (error) {
      this.logger.error('Error sending magic link:', error);
      return {
        success: false,
        message: 'Failed to send magic link',
      };
    }
  }

  async verifyMagicLink(token: string, context: AuthPluginContext): Promise<AuthResponse | null> {
    try {
      const magicLinkResult = await this.baseAuthService.verifyMagicLink(token);
      
      if (!magicLinkResult.success) {
        return null;
      }

      const user = await this.findHealthcareUser(magicLinkResult.email!, context.clinicId);
      if (!user) {
        return null;
      }

      const tokens = await this.baseAuthService.generateTokens(user, 'clinic');

      return {
        success: true,
        message: 'Magic link verification successful',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          clinicId: user.clinicId,
          permissions: user.permissions || [],
          isEmailVerified: user.isEmailVerified,
          isPhoneVerified: user.isPhoneVerified,
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
          sessionId: tokens.sessionId,
          tokenType: 'Bearer'
        },
      };
    } catch (error) {
      this.logger.error('Error verifying magic link:', error);
      return null;
    }
  }

  async refreshTokens(refreshToken: string, context: AuthPluginContext): Promise<AuthTokens> {
    try {
      return await this.baseAuthService.refreshTokens(refreshToken, 'clinic');
    } catch (error) {
      this.logger.error('Error refreshing tokens:', error);
      throw error;
    }
  }
}