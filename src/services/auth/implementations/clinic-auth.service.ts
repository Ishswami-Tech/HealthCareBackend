import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { CacheService } from '../../../libs/infrastructure/cache';
import { CircuitBreakerService } from '../../../libs/core/resilience';
import { PluginManagerService } from '../core/plugin-manager.service';
import { 
  AuthPluginDomain, 
  AuthPluginContext,
  LoginRequest,
  RegisterRequest,
  OTPRequest,
  PasswordResetRequest,
  MagicLinkRequest
} from '../core/auth-plugin.interface';
import { 
  AuthResponse, 
  OTPResult, 
  UserProfile, 
  PasswordResetResult, 
  MagicLinkResult, 
  AuthTokens 
} from '../../../libs/core/types';

// Enhanced error types for clinic authentication
export class ClinicAuthValidationError extends BadRequestException {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ClinicAuthValidationError';
  }
}

export class ClinicAuthRateLimitError extends BadRequestException {
  constructor(message: string, public retryAfter?: number) {
    super(message);
    this.name = 'ClinicAuthRateLimitError';
  }
}

export class ClinicAuthConfigurationError extends Error {
  constructor(message: string, public configField?: string) {
    super(message);
    this.name = 'ClinicAuthConfigurationError';
  }
}

interface ClinicAuthMetrics {
  totalLogins: number;
  successfulLogins: number;
  failedLogins: number;
  otpRequests: number;
  registrations: number;
  passwordResets: number;
  lastUpdated: Date;
}

interface ClinicAuthConfig {
  enableCaching: boolean;
  enableCircuitBreaker: boolean;
  enableRateLimiting: boolean;
  enableMetrics: boolean;
  enableSocialAuth: boolean;
  cacheTimeout: number;
  rateLimitWindow: number;
  rateLimitMax: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
}

@Injectable()
export class ClinicAuthService {
  private readonly logger = new Logger(ClinicAuthService.name);
  private readonly metrics: ClinicAuthMetrics;
  private readonly config: ClinicAuthConfig;

  constructor(
    private readonly pluginManager: PluginManagerService,
    private readonly cacheService: CacheService,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {
    this.config = {
      enableCaching: process.env.CLINIC_AUTH_CACHING !== 'false',
      enableCircuitBreaker: process.env.CLINIC_AUTH_CIRCUIT_BREAKER !== 'false',
      enableRateLimiting: process.env.CLINIC_AUTH_RATE_LIMITING !== 'false',
      enableMetrics: process.env.CLINIC_AUTH_METRICS !== 'false',
      enableSocialAuth: process.env.CLINIC_AUTH_SOCIAL !== 'false',
      cacheTimeout: parseInt(process.env.CLINIC_AUTH_CACHE_TIMEOUT || '300', 10),
      rateLimitWindow: parseInt(process.env.CLINIC_AUTH_RATE_LIMIT_WINDOW || '900000', 10), // 15 minutes
      rateLimitMax: parseInt(process.env.CLINIC_AUTH_RATE_LIMIT_MAX || '50', 10),
      circuitBreakerThreshold: parseInt(process.env.CLINIC_AUTH_CB_THRESHOLD || '10', 10),
      circuitBreakerTimeout: parseInt(process.env.CLINIC_AUTH_CB_TIMEOUT || '60000', 10), // 1 minute
    };

    this.metrics = {
      totalLogins: 0,
      successfulLogins: 0,
      failedLogins: 0,
      otpRequests: 0,
      registrations: 0,
      passwordResets: 0,
      lastUpdated: new Date(),
    };

    this.logger.log('🏥 Clinic Auth Service initialized with configuration:', this.config);
  }

  // =============================================
  // INPUT VALIDATION METHODS
  // =============================================

  private validateLoginData(data: any): void {
    if (!data.email && !data.otp) {
      throw new ClinicAuthValidationError('Email or OTP is required for authentication', 'email');
    }
    if (!data.password && !data.otp) {
      throw new ClinicAuthValidationError('Password or OTP is required for authentication', 'password');
    }
    if (data.clinicId && !this.isValidClinicId(data.clinicId)) {
      throw new ClinicAuthValidationError('Invalid clinic ID format', 'clinicId');
    }
  }

  private validateRegistrationData(data: any): void {
    if (!data.email) {
      throw new ClinicAuthValidationError('Email is required for registration', 'email');
    }
    if (!this.isValidEmail(data.email)) {
      throw new ClinicAuthValidationError('Invalid email format', 'email');
    }
    if (!data.name) {
      throw new ClinicAuthValidationError('Name is required for registration', 'name');
    }
    if (!data.clinicId) {
      throw new ClinicAuthValidationError('Clinic ID is required for registration', 'clinicId');
    }
    if (!this.isValidClinicId(data.clinicId)) {
      throw new ClinicAuthValidationError('Invalid clinic ID format', 'clinicId');
    }
    if (data.password && !this.isValidPassword(data.password)) {
      throw new ClinicAuthValidationError('Password does not meet security requirements', 'password');
    }
  }

  private validateOTPData(data: any): void {
    if (!data.identifier) {
      throw new ClinicAuthValidationError('Identifier (email/phone) is required for OTP', 'identifier');
    }
    if (data.clinicId && !this.isValidClinicId(data.clinicId)) {
      throw new ClinicAuthValidationError('Invalid clinic ID format', 'clinicId');
    }
  }

  private validatePasswordResetData(data: any): void {
    if (!data.email) {
      throw new ClinicAuthValidationError('Email is required for password reset', 'email');
    }
    if (!this.isValidEmail(data.email)) {
      throw new ClinicAuthValidationError('Invalid email format', 'email');
    }
    if (data.clinicId && !this.isValidClinicId(data.clinicId)) {
      throw new ClinicAuthValidationError('Invalid clinic ID format', 'clinicId');
    }
  }

  private validateMagicLinkData(data: any): void {
    if (!data.email) {
      throw new ClinicAuthValidationError('Email is required for magic link', 'email');
    }
    if (!this.isValidEmail(data.email)) {
      throw new ClinicAuthValidationError('Invalid email format', 'email');
    }
    if (data.clinicId && !this.isValidClinicId(data.clinicId)) {
      throw new ClinicAuthValidationError('Invalid clinic ID format', 'clinicId');
    }
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private isValidClinicId(clinicId: string): boolean {
    // Clinic ID should be a valid UUID or alphanumeric with specific format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const alphanumericRegex = /^[a-zA-Z0-9-_]{3,50}$/;
    return uuidRegex.test(clinicId) || alphanumericRegex.test(clinicId);
  }

  private isValidPassword(password: string): boolean {
    // Password should be at least 8 characters with at least one uppercase, one lowercase, one number, and one special character
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return passwordRegex.test(password);
  }

  private validateConfig(config: ClinicAuthConfig): void {
    if (config.rateLimitMax <= 0) {
      throw new ClinicAuthConfigurationError('Rate limit max must be greater than 0', 'rateLimitMax');
    }
    if (config.cacheTimeout <= 0) {
      throw new ClinicAuthConfigurationError('Cache timeout must be greater than 0', 'cacheTimeout');
    }
    if (config.circuitBreakerThreshold <= 0) {
      throw new ClinicAuthConfigurationError('Circuit breaker threshold must be greater than 0', 'circuitBreakerThreshold');
    }
    if (config.circuitBreakerTimeout <= 0) {
      throw new ClinicAuthConfigurationError('Circuit breaker timeout must be greater than 0', 'circuitBreakerTimeout');
    }
  }

  // =============================================
  // CORE AUTHENTICATION METHODS
  // =============================================

  /**
   * Authenticate user with healthcare-specific validation
   */
  async validateUser(email: string, password: string, clinicId?: string, metadata?: Record<string, any>): Promise<any | null> {
    const context = this.createContext(clinicId, metadata);
    
    return this.executeWithResilience(
      'validateUser',
      () => this.pluginManager.validateUser(email, password, context),
      context
    );
  }

  /**
   * Handle user login with healthcare compliance
   */
  async login(loginData: {
    email?: string;
    password?: string;
    otp?: string;
    clinicId?: string;
    userAgent?: string;
    ipAddress?: string;
    metadata?: Record<string, any>;
  }): Promise<AuthResponse> {
    try {
      // Validate input data
      this.validateLoginData(loginData);
      
      this.updateMetrics('login_attempt');
      
      const context = this.createContext(loginData.clinicId, {
        ...loginData.metadata,
        userAgent: loginData.userAgent,
        ipAddress: loginData.ipAddress,
      });

      // Check rate limiting
      if (this.config.enableRateLimiting) {
        await this.checkRateLimit(loginData.email || 'unknown', 'login');
      }

      // Create login request
      const loginRequest: LoginRequest = {
        email: loginData.email,
        password: loginData.password,
        otp: loginData.otp,
        context,
      };

      // Execute login with resilience patterns
      const result = await this.executeWithResilience(
        'login',
        () => this.pluginManager.login(loginRequest),
        context
      );

      this.updateMetrics('login_success');
      
      // Cache user session for quick access
      if (this.config.enableCaching) {
        await this.cacheUserSession(result);
      }

      this.logger.log(`Healthcare login successful for ${loginData.email} in clinic ${loginData.clinicId}`);
      return result;

    } catch (error) {
      this.updateMetrics('login_failed');
      this.logger.error('Healthcare login failed:', error);
      throw error;
    }
  }

  /**
   * Handle user registration with healthcare compliance
   */
  async register(registrationData: {
    email: string;
    password?: string;
    name: string;
    phone?: string;
    role?: string;
    clinicId: string;
    userAgent?: string;
    ipAddress?: string;
    metadata?: Record<string, any>;
  }): Promise<AuthResponse> {
    try {
      // Validate input data
      this.validateRegistrationData(registrationData);
      
      this.updateMetrics('registration_attempt');

      const context = this.createContext(registrationData.clinicId, {
        ...registrationData.metadata,
        userAgent: registrationData.userAgent,
        ipAddress: registrationData.ipAddress,
      });

      // Check rate limiting for registration
      if (this.config.enableRateLimiting) {
        await this.checkRateLimit(registrationData.email, 'register');
      }

      // Create registration request
      const registerRequest: RegisterRequest = {
        email: registrationData.email,
        password: registrationData.password,
        name: registrationData.name,
        phone: registrationData.phone,
        role: registrationData.role,
        metadata: registrationData.metadata,
        context,
      };

      // Execute registration with resilience patterns
      const result = await this.executeWithResilience(
        'register',
        () => this.pluginManager.register(registerRequest),
        context
      );

      this.updateMetrics('registration_success');
      
      // Cache new user session
      if (this.config.enableCaching) {
        await this.cacheUserSession(result);
      }

      this.logger.log(`Healthcare registration successful for ${registrationData.email} in clinic ${registrationData.clinicId}`);
      return result;

    } catch (error) {
      this.updateMetrics('registration_failed');
      this.logger.error('Healthcare registration failed:', error);
      throw error;
    }
  }

  /**
   * Handle user logout with healthcare audit
   */
  async logout(logoutData: {
    userId: string;
    sessionId?: string;
    clinicId?: string;
    userAgent?: string;
    ipAddress?: string;
    allDevices?: boolean;
  }): Promise<{ success: boolean; message?: string }> {
    try {
      const context = this.createContext(logoutData.clinicId, {
        userAgent: logoutData.userAgent,
        ipAddress: logoutData.ipAddress,
      });

      // Execute logout with plugin
      const result = await this.executeWithResilience(
        'logout',
        () => this.pluginManager.logout(logoutData.userId, logoutData.sessionId, context),
        context
      );

      // Clear cached session data
      if (this.config.enableCaching) {
        await this.clearUserSessionCache(logoutData.userId, logoutData.sessionId);
      }

      this.logger.log(`Healthcare logout for user ${logoutData.userId} in clinic ${logoutData.clinicId}`);
      return result;

    } catch (error) {
      this.logger.error('Healthcare logout failed:', error);
      return { success: false, message: 'Logout failed' };
    }
  }

  /**
   * Verify JWT token with healthcare context
   */
  async verifyToken(token: string, clinicId?: string): Promise<any | null> {
    const cacheKey = `clinic:token:${this.hashToken(token)}`;
    
    // Check cache first
    if (this.config.enableCaching) {
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const context = this.createContext(clinicId);
    
    const result = await this.executeWithResilience(
      'verifyToken',
      () => this.pluginManager.verifyToken(token, context),
      context
    );

    // Cache valid tokens
    if (this.config.enableCaching && result) {
      await this.cacheService.set(cacheKey, result, this.config.cacheTimeout);
    }

    return result;
  }

  // =============================================
  // OTP OPERATIONS
  // =============================================

  /**
   * Request OTP for healthcare authentication
   */
  async requestOTP(otpData: {
    identifier: string;
    purpose?: 'login' | 'registration' | 'verification' | 'password_reset';
    clinicId?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<OTPResult> {
    try {
      // Validate input data
      this.validateOTPData(otpData);
      
      this.updateMetrics('otp_request');

      const context = this.createContext(otpData.clinicId, {
        userAgent: otpData.userAgent,
        ipAddress: otpData.ipAddress,
      });

      // Check rate limiting for OTP requests (more strict for healthcare)
      if (this.config.enableRateLimiting) {
        await this.checkRateLimit(otpData.identifier, 'otp', 3); // Max 3 OTP requests
      }

      const otpRequest: OTPRequest = {
        identifier: otpData.identifier,
        purpose: otpData.purpose || 'login',
        context,
      };

      const result = await this.executeWithResilience(
        'requestOTP',
        () => this.pluginManager.requestOTP(otpRequest),
        context
      );

      this.logger.log(`Healthcare OTP requested for ${otpData.identifier} in clinic ${otpData.clinicId}`);
      return result;

    } catch (error) {
      this.logger.error('Healthcare OTP request failed:', error);
      throw error;
    }
  }

  /**
   * Verify OTP with healthcare compliance
   */
  async verifyOTP(verificationData: {
    identifier: string;
    otp: string;
    clinicId?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ success: boolean; user?: any; error?: string }> {
    try {
      const context = this.createContext(verificationData.clinicId, {
        userAgent: verificationData.userAgent,
        ipAddress: verificationData.ipAddress,
      });

      const result = await this.executeWithResilience(
        'verifyOTP',
        () => this.pluginManager.verifyOTP(verificationData.identifier, verificationData.otp, context),
        context
      );

      if (result.success) {
        this.logger.log(`Healthcare OTP verification successful for ${verificationData.identifier}`);
      } else {
        this.logger.warn(`Healthcare OTP verification failed for ${verificationData.identifier}: ${result.error}`);
      }

      return result;

    } catch (error) {
      this.logger.error('Healthcare OTP verification failed:', error);
      return { success: false, error: 'OTP verification failed' };
    }
  }

  // =============================================
  // PASSWORD OPERATIONS
  // =============================================

  /**
   * Handle forgot password with healthcare compliance
   */
  async forgotPassword(passwordData: {
    email: string;
    clinicId?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<PasswordResetResult> {
    try {
      // Validate input data
      this.validatePasswordResetData(passwordData);
      
      this.updateMetrics('password_reset_request');

      const context = this.createContext(passwordData.clinicId, {
        userAgent: passwordData.userAgent,
        ipAddress: passwordData.ipAddress,
      });

      // Rate limiting for password reset requests
      if (this.config.enableRateLimiting) {
        await this.checkRateLimit(passwordData.email, 'password_reset', 3);
      }

      const resetRequest: PasswordResetRequest = {
        email: passwordData.email,
        context,
      };

      const result = await this.executeWithResilience(
        'forgotPassword',
        () => this.pluginManager.forgotPassword(resetRequest),
        context
      );

      this.updateMetrics('password_reset_success');
      
      // Clear any cached user data after password change
      if (passwordData.email) {
        await this.clearUserCache(passwordData.email);
      }

      this.logger.log(`Healthcare password reset requested for ${passwordData.email} in clinic ${passwordData.clinicId}`);
      return result;

    } catch (error) {
      this.updateMetrics('password_reset_failed');
      this.logger.error('Healthcare forgot password failed:', error);
      throw error;
    }
  }

  /**
   * Reset password with healthcare security measures
   */
  async resetPassword(resetData: {
    email?: string;
    token: string;
    newPassword: string;
    clinicId?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<PasswordResetResult> {
    try {
      const context = this.createContext(resetData.clinicId, {
        userAgent: resetData.userAgent,
        ipAddress: resetData.ipAddress,
      });

      const resetRequest: PasswordResetRequest = {
        email: resetData.email || '',
        token: resetData.token,
        newPassword: resetData.newPassword,
        context,
      };

      const result = await this.executeWithResilience(
        'resetPassword',
        () => this.pluginManager.resetPassword(resetRequest),
        context
      );

      if (result.success) {
        this.updateMetrics('password_reset_success');
        // Clear any cached user data after password change
        if (resetData.email) {
          await this.clearUserCache(resetData.email);
        }
      }

      this.logger.log(`Healthcare password reset for ${resetData.email} in clinic ${resetData.clinicId}`);
      return result;

    } catch (error) {
      this.updateMetrics('password_reset_failed');
      this.logger.error('Healthcare password reset failed:', error);
      throw error;
    }
  }

  /**
   * Change password with healthcare audit
   */
  async changePassword(changeData: {
      userId: string;
    currentPassword: string;
    newPassword: string;
    clinicId?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const context = this.createContext(changeData.clinicId, {
        userAgent: changeData.userAgent,
        ipAddress: changeData.ipAddress,
      });

      const result = await this.executeWithResilience(
        'changePassword',
        () => this.pluginManager.changePassword(
          changeData.userId,
          changeData.currentPassword,
          changeData.newPassword,
          context
        ),
        context
      );

      if (result.success) {
        // Clear cached user data after password change
        await this.clearUserCacheById(changeData.userId);
      }

      this.logger.log(`Healthcare password changed for user ${changeData.userId} in clinic ${changeData.clinicId}`);
      return result;

    } catch (error) {
      this.updateMetrics('password_change_failed');
      this.logger.error('Healthcare password change failed:', error);
      throw error;
    }
  }

  // =============================================
  // MAGIC LINK OPERATIONS
  // =============================================

  /**
   * Send magic link for healthcare passwordless authentication
   */
  async sendMagicLink(magicLinkData: {
    email: string;
    redirectUrl?: string;
    clinicId?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<MagicLinkResult> {
    try {
      // Validate input data
      this.validateMagicLinkData(magicLinkData);
      
      const context = this.createContext(magicLinkData.clinicId, {
        userAgent: magicLinkData.userAgent,
        ipAddress: magicLinkData.ipAddress,
      });

      // Rate limiting for magic link requests
      if (this.config.enableRateLimiting) {
        await this.checkRateLimit(magicLinkData.email, 'magic_link', 3);
      }

      const magicLinkRequest: MagicLinkRequest = {
        email: magicLinkData.email,
        redirectUrl: magicLinkData.redirectUrl,
        context,
      };

      const result = await this.executeWithResilience(
        'sendMagicLink',
        () => this.pluginManager.sendMagicLink(magicLinkRequest),
        context
      );

      this.logger.log(`Healthcare magic link sent to ${magicLinkData.email} in clinic ${magicLinkData.clinicId}`);
      return result;

    } catch (error) {
      this.logger.error('Healthcare magic link send failed:', error);
      return { 
        success: false, 
        message: 'Failed to send magic link' 
      };
    }
  }

  /**
   * Verify magic link with healthcare context
   */
  async verifyMagicLink(token: string, clinicId?: string): Promise<AuthResponse | null> {
    try {
      const context = this.createContext(clinicId);

      const result = await this.executeWithResilience(
        'verifyMagicLink',
        () => this.pluginManager.verifyMagicLink(token, context),
        context
      );

      if (result) {
        // Cache magic link session
        if (this.config.enableCaching) {
          await this.cacheUserSession(result);
        }
        this.logger.log(`Healthcare magic link verification successful in clinic ${clinicId}`);
      }

      return result;

    } catch (error) {
      this.logger.error('Healthcare magic link verification failed:', error);
      return null;
    }
  }

  // =============================================
  // TOKEN OPERATIONS
  // =============================================

  /**
   * Refresh tokens with healthcare context
   */
  async refreshTokens(refreshData: {
    refreshToken: string;
    clinicId?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<AuthTokens> {
    try {
      const context = this.createContext(refreshData.clinicId, {
        userAgent: refreshData.userAgent,
        ipAddress: refreshData.ipAddress,
      });

      const result = await this.executeWithResilience(
        'refreshTokens',
        () => this.pluginManager.refreshTokens(refreshData.refreshToken, context),
        context
      );

      // Update cached tokens
      if (this.config.enableCaching) {
        const cacheKey = `clinic:tokens:${result.sessionId}`;
        await this.cacheService.set(cacheKey, result, this.config.cacheTimeout);
      }

      this.logger.log(`Healthcare tokens refreshed for session ${result.sessionId}`);
      return result;

    } catch (error) {
      this.logger.error('Healthcare token refresh failed:', error);
      throw error;
    }
  }

  // =============================================
  // USER PROFILE OPERATIONS
  // =============================================

  /**
   * Get user profile with healthcare context
   */
  async getUserProfile(userId: string, clinicId?: string): Promise<UserProfile | null> {
    try {
      const cacheKey = `clinic:profile:${userId}`;
      
      // Check cache first
      if (this.config.enableCaching) {
        const cached = await this.cacheService.get<UserProfile>(cacheKey);
        if (cached) {
          return cached;
        }
      }

      const context = this.createContext(clinicId);

      // Get profile from plugin (would need to add this to plugin interface)
      const profile = await this.executeWithResilience(
        'getUserProfile',
        async () => {
          // Implementation would depend on plugin having this method
          // For now, return null as this would be implemented in plugin
          return null;
        },
        context
      );

      // Cache the profile
      if (this.config.enableCaching && profile) {
        await this.cacheService.set(cacheKey, profile, this.config.cacheTimeout);
      }

      return profile;

    } catch (error) {
      this.logger.error('Error getting healthcare user profile:', error);
      return null;
    }
  }

  // =============================================
  // RESILIENCE & EXECUTION WRAPPER
  // =============================================

  private async executeWithResilience<T>(
    operation: string,
    fn: () => Promise<T>,
    context: AuthPluginContext
  ): Promise<T> {
    const startTime = Date.now();

    try {
      let result: T;

      if (this.config.enableCircuitBreaker) {
        // Execute with circuit breaker
        result = await this.circuitBreakerService.execute(
          fn,
          {
            name: `clinic.auth.${operation}`,
            failureThreshold: this.config.circuitBreakerThreshold,
            recoveryTimeout: this.config.circuitBreakerTimeout,
            onStateChange: (state, name) => {
              this.logger.warn(`Circuit breaker state changed: ${name} -> ${state}`);
            },
          }
        );
      } else {
        // Execute directly
        result = await fn();
      }

      const duration = Date.now() - startTime;
      this.updatePerformanceMetrics(operation, true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updatePerformanceMetrics(operation, false, duration);

      this.logger.error(
        `Healthcare auth operation failed: ${operation}`,
        {
          operation,
          clinicId: context.clinicId,
          error: error instanceof Error ? (error as Error).message : String(error),
          duration,
        }
      );

      throw error;
    }
  }

  // =============================================
  // RATE LIMITING
  // =============================================

  private async checkRateLimit(identifier: string, operation: string, maxAttempts?: number): Promise<void> {
    if (!this.config.enableRateLimiting) return;

    const rateLimitKey = `clinic:rate_limit:${operation}:${identifier}`;
    const attempts = await this.cacheService.get<number>(rateLimitKey) || 0;
    const limit = maxAttempts || this.config.rateLimitMax;

    if (attempts >= limit) {
      throw new BadRequestException(`Rate limit exceeded for ${operation}. Try again later.`);
    }

    await this.cacheService.set(rateLimitKey, attempts + 1, this.config.rateLimitWindow / 1000);
  }

  // =============================================
  // CACHING HELPERS
  // =============================================

  private async cacheUserSession(authResponse: AuthResponse): Promise<void> {
    if (!this.config.enableCaching) return;

    try {
      // Extract session ID and user data from AuthResponse
      const sessionId = (authResponse as any).session_id || (authResponse as any).sessionId;
      const userData = (authResponse as any).user || (authResponse as any).data?.user;
      
      if (sessionId && userData) {
        const sessionKey = `clinic:session:${sessionId}`;
        const userKey = `clinic:user:${userData.id}`;

        await Promise.all([
          this.cacheService.set(sessionKey, authResponse, this.config.cacheTimeout),
          this.cacheService.set(userKey, userData, this.config.cacheTimeout),
        ]);
      }
    } catch (error) {
      this.logger.error('Error caching user session:', error);
    }
  }

  private async clearUserSessionCache(userId: string, sessionId?: string): Promise<void> {
    if (!this.config.enableCaching) return;

    try {
      const keysToDelete = [
        `clinic:user:${userId}`,
        `clinic:profile:${userId}`,
      ];

      if (sessionId) {
        keysToDelete.push(`clinic:session:${sessionId}`);
      }

      await Promise.all(keysToDelete.map(key => this.cacheService.del(key)));
    } catch (error) {
      this.logger.error('Error clearing user session cache:', error);
    }
  }

  private async clearUserCache(email: string): Promise<void> {
    if (!this.config.enableCaching) return;

    try {
      // Clear email-based cache entries
      await this.cacheService.del(`clinic:user:email:${email}`);
    } catch (error) {
      this.logger.error('Error clearing user cache:', error);
    }
  }

  private async clearUserCacheById(userId: string): Promise<void> {
    if (!this.config.enableCaching) return;

    try {
      await Promise.all([
        this.cacheService.del(`clinic:user:${userId}`),
        this.cacheService.del(`clinic:profile:${userId}`),
      ]);
    } catch (error) {
      this.logger.error('Error clearing user cache by ID:', error);
    }
  }

  // =============================================
  // METRICS & MONITORING
  // =============================================

  private updateMetrics(event: string): void {
    if (!this.config.enableMetrics) return;

    switch (event) {
      case 'login_attempt':
        this.metrics.totalLogins++;
        break;
      case 'login_success':
        this.metrics.successfulLogins++;
        break;
      case 'login_failed':
        this.metrics.failedLogins++;
        break;
      case 'otp_request':
        this.metrics.otpRequests++;
        break;
      case 'registration_success':
        this.metrics.registrations++;
        break;
      case 'password_reset_success':
        this.metrics.passwordResets++;
        break;
    }

    this.metrics.lastUpdated = new Date();
  }

  private updatePerformanceMetrics(operation: string, success: boolean, duration: number): void {
    if (!this.config.enableMetrics) return;

    // Store performance metrics in cache for monitoring
    const metricsKey = `clinic:auth:performance:${operation}`;
    this.cacheService.set(metricsKey, { success, duration, timestamp: new Date() }, 3600)
      .catch(error => this.logger.debug('Error storing performance metrics:', error));
  }

  /**
   * Get authentication metrics
   */
  async getMetrics(): Promise<ClinicAuthMetrics> {
    return { ...this.metrics };
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{
    healthy: boolean;
    metrics: ClinicAuthMetrics;
    pluginHealth: any[];
    config: ClinicAuthConfig;
  }> {
    try {
      const pluginHealth = await this.pluginManager.getPluginHealth();
      const healthy = pluginHealth.every(p => p.healthy);

      return {
        healthy,
        metrics: this.metrics,
        pluginHealth,
        config: this.config,
      };
    } catch (error) {
      this.logger.error('Error getting health status:', error);
      return {
        healthy: false,
        metrics: this.metrics,
        pluginHealth: [],
        config: this.config,
      };
    }
  }

  /**
   * Reset metrics (for testing or maintenance)
   */
  async resetMetrics(): Promise<void> {
    Object.assign(this.metrics, {
      totalLogins: 0,
      successfulLogins: 0,
      failedLogins: 0,
      otpRequests: 0,
      registrations: 0,
      passwordResets: 0,
      lastUpdated: new Date(),
    });

    this.logger.log('Healthcare auth metrics reset');
  }

  /**
   * Handle Google authentication for clinic
   */
  async authenticateWithGoogle(authData: {
    token: string;
    clinicId?: string;
    userAgent?: string;
    ipAddress?: string;
    deviceId?: string;
  }): Promise<AuthResponse> {
    try {
      if (!this.config.enableSocialAuth) {
        throw new BadRequestException('Social authentication is disabled');
      }

      const context = this.createContext(authData.clinicId, {
        socialProvider: 'google',
        socialToken: authData.token,
        userAgent: authData.userAgent,
        ipAddress: authData.ipAddress,
        deviceId: authData.deviceId,
      });

      const result = await this.executeWithResilience(
        'socialAuth',
        () => this.pluginManager.handleGoogleAuth?.(authData.token, context),
        context
      );

      if (!result) {
        throw new UnauthorizedException('Google authentication failed');
      }

      this.updateMetrics('social_login');
      this.updateMetrics('login_success');

      // Cache social login session
      if (this.config.enableCaching) {
        await this.cacheUserSession(result);
      }

      this.logger.log(`Clinic Google login successful in clinic ${authData.clinicId}`);
      return result;

    } catch (error) {
      this.logger.error('Clinic Google authentication failed:', error);
      throw error;
    }
  }

  // =============================================
  // UTILITY METHODS
  // =============================================

  private createContext(clinicId?: string, metadata?: Record<string, any>): AuthPluginContext {
    return {
      domain: AuthPluginDomain.CLINIC,
      clinicId,
      tenantId: clinicId,
      userAgent: metadata?.userAgent,
      ipAddress: metadata?.ipAddress,
      metadata,
    };
  }

  private hashToken(token: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(token).digest('hex').substring(0, 32);
  }

  /**
   * Get configuration for external monitoring
   */
  getConfiguration(): ClinicAuthConfig {
    return { ...this.config };
  }

  /**
   * Update configuration dynamically (for testing)
   */
  updateConfiguration(updates: Partial<ClinicAuthConfig>): void {
    Object.assign(this.config, updates);
    this.logger.log('Healthcare auth configuration updated:', updates);
  }
}