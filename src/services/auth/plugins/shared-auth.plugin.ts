import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../libs/infrastructure/database/prisma/prisma.service';
import { CacheService } from '../../../libs/infrastructure/cache';
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
  AuthTokens, 
  PasswordResetResult, 
  MagicLinkResult 
} from '../../../libs/core/types';

/**
 * Shared Authentication Plugin
 * 
 * Provides shared authentication functionality that can be used across domains:
 * - Social authentication (Google, Facebook, Apple)
 * - Two-factor authentication (2FA)
 * - Email and phone verification
 * - Cross-domain session management
 * - Security utilities and validation
 */
@Injectable()
export class SharedAuthPlugin implements IAuthPlugin {
  private readonly logger = new Logger(SharedAuthPlugin.name);
  
  readonly name = 'shared-auth';
  readonly version = '1.0.0';
  readonly domain = AuthPluginDomain.SHARED;
  readonly capabilities: AuthPluginCapabilities = {
    supportsOTP: true,
    supportsMagicLink: true,
    supportsPasswordAuth: false, // Shared plugin doesn't handle primary auth
    supportsSocialAuth: true,
    supportsBiometric: true,
    supports2FA: true,
    requiresEmailVerification: true,
    requiresPhoneVerification: true,
    supportsMultipleTenants: false, // Cross-domain shared logic
  };

  constructor(
    private readonly baseAuthService: BaseAuthService,
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  async initialize(config?: Record<string, any>): Promise<void> {
    this.logger.log('🔗 Initializing Shared Auth Plugin...');
    this.logger.log('✅ Shared Auth Plugin initialized successfully');
  }

  async destroy(): Promise<void> {
    this.logger.log('🔧 Destroying Shared Auth Plugin...');
  }

  // =============================================
  // CORE AUTHENTICATION METHODS (DELEGATED)
  // =============================================
  // These methods delegate to domain-specific plugins

  async validateUser(email: string, password: string, context: AuthPluginContext): Promise<any | null> {
    throw new Error('Shared plugin does not handle primary authentication. Use domain-specific plugin.');
  }

  async login(request: LoginRequest): Promise<AuthResponse> {
    // Handle social login if social provider is specified
    if (request.context.metadata?.socialProvider) {
      return this.handleSocialLogin(request);
    }
    
    return {
      success: false,
      message: 'Shared plugin does not handle primary authentication. Use domain-specific plugin.',
      error: 'UNSUPPORTED_OPERATION: Shared plugin does not handle primary authentication',
    };
  }

  async register(request: RegisterRequest): Promise<AuthResponse> {
    // Handle social registration if social provider is specified
    if (request.context.metadata?.socialProvider) {
      return this.handleSocialRegistration(request);
    }
    
    return {
      success: false,
      message: 'Shared plugin does not handle primary registration. Use domain-specific plugin.',
      error: 'UNSUPPORTED_OPERATION: Shared plugin does not handle primary registration',
    };
  }

  async logout(userId: string, sessionId?: string, context?: AuthPluginContext): Promise<{ success: boolean; message?: string }> {
    // Shared logout logic (clear global sessions, social tokens, etc.)
    try {
      await this.clearSharedAuthData(userId);
      return { success: true, message: 'Shared auth data cleared' };
    } catch (error) {
      this.logger.error('Error in shared logout:', error);
      return { success: false, message: 'Failed to clear shared auth data' };
    }
  }

  async verifyToken(token: string, context?: AuthPluginContext): Promise<any | null> {
    return this.baseAuthService.validateToken(token);
  }

  // =============================================
  // DOMAIN-SPECIFIC VALIDATION
  // =============================================

  async domainSpecificValidation(user: any, context: AuthPluginContext): Promise<DomainValidationResult> {
    // Shared validation that applies to all domains
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Validate email format
      if (user.email && !this.isValidEmail(user.email)) {
        errors.push('Invalid email format');
      }

      // Check for security flags
      if (user.isLocked) {
        errors.push('Account is locked');
      }

      if (user.requiresEmailVerification && !user.isEmailVerified) {
        warnings.push('Email verification required');
      }

      return {
        isValid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      this.logger.error('Error in shared domain validation:', error);
      return {
        isValid: false,
        errors: ['Validation service temporarily unavailable'],
      };
    }
  }

  async validateAccess(userId: string, resource: string, action: string, context: AuthPluginContext): Promise<boolean> {
    try {
      // Shared access validation logic
      const sharedPermissions = await this.getSharedPermissions(userId);
      
      // Global admin check
      if (sharedPermissions.includes('global:admin')) {
        return true;
      }

      // Cross-domain permissions
      const permissionKey = `${resource}:${action}`;
      return sharedPermissions.includes(permissionKey);
    } catch (error) {
      this.logger.error('Error validating shared access:', error);
      return false;
    }
  }

  async getUserRolesAndPermissions(userId: string, context: AuthPluginContext): Promise<{ roles: string[]; permissions: string[] }> {
    try {
      const sharedPermissions = await this.getSharedPermissions(userId);
      const sharedRoles = await this.getSharedRoles(userId);

      return {
        roles: sharedRoles,
        permissions: sharedPermissions,
      };
    } catch (error) {
      this.logger.error('Error getting shared roles and permissions:', error);
      return { roles: [], permissions: [] };
    }
  }

  // =============================================
  // SOCIAL AUTHENTICATION
  // =============================================

  async handleGoogleAuth(token: string, context: AuthPluginContext): Promise<import('../../../libs/core/types').AuthResponse> {
    try {
      const googleUser = await this.verifyGoogleToken(token);
      return this.processSocialAuth('google', googleUser, context);
    } catch (error) {
      this.logger.error('Google auth failed:', error);
      throw error;
    }
  }

  async handleFacebookAuth(token: string, context: AuthPluginContext): Promise<import('../../../libs/core/types').AuthResponse> {
    try {
      const facebookUser = await this.verifyFacebookToken(token);
      return this.processSocialAuth('facebook', facebookUser, context);
    } catch (error) {
      this.logger.error('Facebook auth failed:', error);
      throw error;
    }
  }

  async handleAppleAuth(token: string, context: AuthPluginContext): Promise<import('../../../libs/core/types').AuthResponse> {
    try {
      const appleUser = await this.verifyAppleToken(token);
      return this.processSocialAuth('apple', appleUser, context);
    } catch (error) {
      this.logger.error('Apple auth failed:', error);
      throw error;
    }
  }

  // =============================================
  // EMAIL/PHONE VERIFICATION
  // =============================================

  async sendEmailVerification(email: string, context: AuthPluginContext): Promise<{ success: boolean; error?: string }> {
    try {
      const verificationToken = this.generateSecureToken();
      await this.storeEmailVerificationToken(email, verificationToken);
      
      // In production, send email here
      this.logger.debug(`Email verification token for ${email}: ${verificationToken}`);
      
      return { success: true };
    } catch (error) {
      this.logger.error('Error sending email verification:', error);
      return { success: false, error: 'Failed to send verification email' };
    }
  }

  async verifyEmail(token: string, context: AuthPluginContext): Promise<{ success: boolean; error?: string }> {
    try {
      const isValid = await this.validateEmailVerificationToken(token);
      if (!isValid) {
        return { success: false, error: 'Invalid or expired verification token' };
      }

      await this.markEmailAsVerified(token);
      return { success: true };
    } catch (error) {
      this.logger.error('Error verifying email:', error);
      return { success: false, error: 'Email verification failed' };
    }
  }

  async sendPhoneVerification(phone: string, context: AuthPluginContext): Promise<{ success: boolean; error?: string }> {
    try {
      const otp = await this.baseAuthService.generateOTP();
      await this.storePhoneVerificationOTP(phone, otp);
      
      // In production, send SMS here
      this.logger.debug(`Phone verification OTP for ${phone}: ${otp}`);
      
      return { success: true };
    } catch (error) {
      this.logger.error('Error sending phone verification:', error);
      return { success: false, error: 'Failed to send verification SMS' };
    }
  }

  async verifyPhone(phone: string, code: string, context: AuthPluginContext): Promise<{ success: boolean; error?: string }> {
    try {
      const isValid = await this.validatePhoneVerificationOTP(phone, code);
      if (!isValid) {
        return { success: false, error: 'Invalid or expired verification code' };
      }

      await this.markPhoneAsVerified(phone);
      return { success: true };
    } catch (error) {
      this.logger.error('Error verifying phone:', error);
      return { success: false, error: 'Phone verification failed' };
    }
  }

  // =============================================
  // UTILITY METHODS
  // =============================================

  async healthCheck(): Promise<{ healthy: boolean; details?: Record<string, any>; errors?: string[] }> {
    try {
      const details = {
        socialAuth: 'available',
        emailVerification: 'available',
        phoneVerification: 'available',
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

  // =============================================
  // PRIVATE HELPER METHODS
  // =============================================

  private async handleSocialLogin(request: LoginRequest): Promise<AuthResponse> {
    const provider = request.context.metadata?.socialProvider;
    const token = request.context.metadata?.socialToken;

    switch (provider) {
      case 'google':
        return this.handleGoogleAuth(token, request.context);
      case 'facebook':
        return this.handleFacebookAuth(token, request.context);
      case 'apple':
        return this.handleAppleAuth(token, request.context);
      default:
        throw new Error(`Unsupported social provider: ${provider}`);
    }
  }

  private async handleSocialRegistration(request: RegisterRequest): Promise<AuthResponse> {
    // Similar to social login but for registration
    return this.handleSocialLogin({
      email: request.email,
      context: request.context,
    });
  }

  private async processSocialAuth(provider: string, socialUser: any, context: AuthPluginContext): Promise<import('../../../libs/core/types').AuthResponse> {
    // Mock implementation - in production, this would handle social auth properly
    const tokens = await this.baseAuthService.generateTokens(socialUser, 'clinic');

    return {
      success: true,
      message: 'Social authentication successful',
      user: {
        id: socialUser.id,
        email: socialUser.email,
        name: socialUser.name,
        provider,
        isEmailVerified: true,
        isSocialUser: true,
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        sessionId: tokens.sessionId || 'social-session-' + Date.now(),
        tokenType: 'Bearer'
      },
      sessionId: tokens.sessionId || 'social-session-' + Date.now()
    };
  }

  private async clearSharedAuthData(userId: string): Promise<void> {
    // Mock implementation - clear shared auth data
    this.logger.debug('Clearing shared auth data for user:', userId);
  }

  private async getSharedPermissions(userId: string): Promise<string[]> {
    // Mock implementation - get shared permissions
    return ['read:profile', 'update:profile'];
  }

  private async getSharedRoles(userId: string): Promise<string[]> {
    // Mock implementation - get shared roles
    return ['user'];
  }

  private async verifyGoogleToken(token: string): Promise<any> {
    // Mock implementation - in production, verify with Google
    return {
      id: 'google_' + Date.now(),
      email: 'user@gmail.com',
      name: 'Google User',
      picture: 'https://example.com/avatar.jpg',
    };
  }

  private async verifyFacebookToken(token: string): Promise<any> {
    // Mock implementation - in production, verify with Facebook
    return {
      id: 'facebook_' + Date.now(),
      email: 'user@facebook.com',
      name: 'Facebook User',
    };
  }

  private async verifyAppleToken(token: string): Promise<any> {
    // Mock implementation - in production, verify with Apple
    return {
      id: 'apple_' + Date.now(),
      email: 'user@icloud.com',
      name: 'Apple User',
    };
  }

  private async storeEmailVerificationToken(email: string, token: string): Promise<void> {
    const key = `email_verification:${email}`;
    await this.cacheService.set(key, token, 24 * 60 * 60); // 24 hours
  }

  private async validateEmailVerificationToken(token: string): Promise<boolean> {
    // Mock implementation - in production, validate token properly
    return token.length > 10;
  }

  private async markEmailAsVerified(token: string): Promise<void> {
    // Mock implementation - mark email as verified
    this.logger.debug('Email marked as verified');
  }

  private async storePhoneVerificationOTP(phone: string, otp: string): Promise<void> {
    const key = `phone_verification:${phone}`;
    await this.cacheService.set(key, otp, 5 * 60); // 5 minutes
  }

  private async validatePhoneVerificationOTP(phone: string, code: string): Promise<boolean> {
    const key = `phone_verification:${phone}`;
    const storedOTP = await this.cacheService.get(key);
    return storedOTP === code;
  }

  private async markPhoneAsVerified(phone: string): Promise<void> {
    // Mock implementation - mark phone as verified
    this.logger.debug('Phone marked as verified');
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private generateSecureToken(length: number = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    
    for (let i = 0; i < length; i++) {
      token += chars[Math.floor(Math.random() * chars.length)];
    }
    
    return token;
  }

  // Add missing methods required by the interface
  async forgotPassword(request: PasswordResetRequest): Promise<PasswordResetResult> {
    return {
      success: false,
      message: 'Password reset not supported in shared plugin',
    };
  }

  async resetPassword(request: PasswordResetRequest): Promise<PasswordResetResult> {
    return {
      success: false,
      message: 'Password reset not supported in shared plugin',
    };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: AuthPluginContext
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Password change not supported in shared plugin' };
  }

  async sendMagicLink(request: MagicLinkRequest): Promise<MagicLinkResult> {
    return {
      success: false,
      message: 'Magic link not supported in shared plugin',
    };
  }

  async verifyMagicLink(token: string, context: AuthPluginContext): Promise<import('../../../libs/core/types').AuthResponse | null> {
    return null;
  }

  async refreshTokens(refreshToken: string, context: AuthPluginContext): Promise<import('../../../libs/core/types').AuthTokens> {
    try {
      const tokens = await this.baseAuthService.refreshTokens(refreshToken, 'clinic');
      const result: import('../../../libs/core/types').AuthTokens = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        sessionId: tokens.sessionId || 'shared-session-' + Date.now(),
        tokenType: tokens.tokenType || 'Bearer'
      };
      return result;
    } catch (error) {
      this.logger.error('Error refreshing tokens:', error);
      throw error;
    }
  }
}