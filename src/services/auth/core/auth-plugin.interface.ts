import {
  AuthResponse,
  OTPResult,
  UserProfile,
  PasswordResetResult,
  MagicLinkResult,
  AuthTokens,
} from "../../../libs/core/types";

export enum AuthPluginDomain {
  CLINIC = "healthcare",
  FASHION = "clinic",
  SHARED = "shared",
}

export interface AuthPluginContext {
  domain: AuthPluginDomain;
  tenantId?: string;
  clinicId?: string;
  studioId?: string;
  userAgent?: string;
  ipAddress?: string;
  metadata?: Record<string, any>;
}

export interface DomainValidationResult {
  isValid: boolean;
  errors?: string[];
  warnings?: string[];
  metadata?: Record<string, any>;
}

export interface LoginRequest {
  email?: string;
  phone?: string;
  password?: string;
  otp?: string;
  context: AuthPluginContext;
}

export interface RegisterRequest {
  email: string;
  password?: string;
  name?: string;
  phone?: string;
  role?: string;
  metadata?: Record<string, any>;
  context: AuthPluginContext;
}

export interface OTPRequest {
  identifier: string; // email or phone
  purpose: "login" | "registration" | "verification" | "password_reset";
  context: AuthPluginContext;
}

export interface PasswordResetRequest {
  email: string;
  token?: string;
  newPassword?: string;
  context: AuthPluginContext;
}

export interface MagicLinkRequest {
  email: string;
  redirectUrl?: string;
  context: AuthPluginContext;
}

export interface AuthPluginCapabilities {
  supportsOTP: boolean;
  supportsMagicLink: boolean;
  supportsPasswordAuth: boolean;
  supportsSocialAuth: boolean;
  supportsBiometric: boolean;
  supports2FA: boolean;
  requiresEmailVerification: boolean;
  requiresPhoneVerification: boolean;
  supportsMultipleTenants: boolean;
}

/**
 * Core interface that all authentication plugins must implement
 */
export interface IAuthPlugin {
  readonly name: string;
  readonly version: string;
  readonly domain: AuthPluginDomain;
  readonly capabilities: AuthPluginCapabilities;

  // Core authentication methods
  validateUser(
    email: string,
    password: string,
    context: AuthPluginContext
  ): Promise<any | null>;
  login(request: LoginRequest): Promise<AuthResponse>;
  register(request: RegisterRequest): Promise<AuthResponse>;
  logout(
    userId: string,
    sessionId?: string,
    context?: AuthPluginContext
  ): Promise<{ success: boolean; message?: string }>;
  verifyToken(token: string, context?: AuthPluginContext): Promise<any | null>;

  // Domain-specific validation
  domainSpecificValidation(
    user: any,
    context: AuthPluginContext
  ): Promise<DomainValidationResult>;
  validateAccess(
    userId: string,
    resource: string,
    action: string,
    context: AuthPluginContext
  ): Promise<boolean>;
  getUserRolesAndPermissions(
    userId: string,
    context: AuthPluginContext
  ): Promise<{ roles: string[]; permissions: string[] }>;

  // Optional methods
  requestOTP?(request: OTPRequest): Promise<OTPResult>;
  verifyOTP?(
    identifier: string,
    otp: string,
    context: AuthPluginContext
  ): Promise<{ success: boolean; user?: any; error?: string }>;
  checkOTPStatus?(
    identifier: string,
    context: AuthPluginContext
  ): Promise<{
    hasActiveOTP: boolean;
    attemptsRemaining?: number;
    expiresAt?: Date;
  }>;
  invalidateOTP?(identifier: string, context: AuthPluginContext): Promise<void>;

  forgotPassword?(request: PasswordResetRequest): Promise<PasswordResetResult>;
  resetPassword?(request: PasswordResetRequest): Promise<PasswordResetResult>;
  changePassword?(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: AuthPluginContext
  ): Promise<{ success: boolean; error?: string }>;

  sendMagicLink?(request: MagicLinkRequest): Promise<MagicLinkResult>;
  verifyMagicLink?(
    token: string,
    context: AuthPluginContext
  ): Promise<AuthResponse | null>;

  handleGoogleAuth?(
    token: string,
    context: AuthPluginContext
  ): Promise<AuthResponse>;
  handleFacebookAuth?(
    token: string,
    context: AuthPluginContext
  ): Promise<AuthResponse>;
  handleAppleAuth?(
    token: string,
    context: AuthPluginContext
  ): Promise<AuthResponse>;

  refreshTokens?(
    refreshToken: string,
    context: AuthPluginContext
  ): Promise<AuthTokens>;
  validateRefreshToken?(
    refreshToken: string,
    context: AuthPluginContext
  ): Promise<boolean>;

  getUserSessions?(userId: string, context: AuthPluginContext): Promise<any[]>;
  revokeSession?(sessionId: string, context: AuthPluginContext): Promise<void>;
  revokeAllSessions?(userId: string, context: AuthPluginContext): Promise<void>;

  getUserProfile?(
    userId: string,
    context: AuthPluginContext
  ): Promise<UserProfile>;
  updateUserProfile?(
    userId: string,
    updateData: Partial<UserProfile>,
    context: AuthPluginContext
  ): Promise<UserProfile>;

  sendEmailVerification?(
    email: string,
    context: AuthPluginContext
  ): Promise<{ success: boolean; error?: string }>;
  verifyEmail?(
    token: string,
    context: AuthPluginContext
  ): Promise<{ success: boolean; error?: string }>;
  sendPhoneVerification?(
    phone: string,
    context: AuthPluginContext
  ): Promise<{ success: boolean; error?: string }>;
  verifyPhone?(
    phone: string,
    code: string,
    context: AuthPluginContext
  ): Promise<{ success: boolean; error?: string }>;

  // Plugin lifecycle
  initialize?(config?: Record<string, any>): Promise<void>;
  destroy?(): Promise<void>;
  healthCheck?(): Promise<{
    healthy: boolean;
    details?: Record<string, any>;
    errors?: string[];
  }>;
  getMetrics?(): Promise<Record<string, any>>;

  // Rate limiting & security
  checkRateLimit?(
    identifier: string,
    action: string,
    context: AuthPluginContext
  ): Promise<{
    allowed: boolean;
    remainingAttempts?: number;
    resetTime?: Date;
  }>;
  logSecurityEvent?(
    event: string,
    userId: string | null,
    details: Record<string, any>,
    context: AuthPluginContext
  ): Promise<void>;
  detectSuspiciousActivity?(
    userId: string,
    activity: Record<string, any>,
    context: AuthPluginContext
  ): Promise<{ suspicious: boolean; riskScore?: number; reasons?: string[] }>;
}

export interface AuthPluginMetadata {
  name: string;
  version: string;
  domain: AuthPluginDomain;
  description?: string;
  author?: string;
  dependencies?: string[];
  config?: Record<string, any>;
}

export interface IAuthPluginFactory {
  create(config?: Record<string, any>): Promise<IAuthPlugin>;
  getMetadata(): AuthPluginMetadata;
}
