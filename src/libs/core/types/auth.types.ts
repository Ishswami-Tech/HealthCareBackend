/**
 * Centralized Auth Types
 * @module @core/types/auth.types
 * @description All authentication-related types and interfaces for the healthcare system
 */

// ============================================================================
// AUTHENTICATION RESPONSE TYPES
// ============================================================================

/**
 * Authentication response interface
 * @interface AuthResponse
 * @description Response structure for authentication operations
 * @example
 * ```typescript
 * const authResponse: AuthResponse = {
 *   success: true,
 *   user: userData,
 *   tokens: { accessToken: "token123", refreshToken: "refresh456" },
 *   sessionId: "session-789",
 *   message: "Login successful"
 * };
 * ```
 */
export interface AuthResponse {
  /** Whether the authentication was successful */
  readonly success: boolean;
  /** Optional user data */
  readonly user?: unknown;
  /** Optional authentication tokens */
  readonly tokens?: AuthTokens;
  /** Optional session ID (legacy field) */
  readonly session_id?: string;
  /** Optional session ID */
  readonly sessionId?: string;
  /** Optional success/error message */
  readonly message?: string;
  /** Optional error message */
  readonly error?: string;
}

/**
 * Authentication tokens interface
 * @interface AuthTokens
 * @description Contains JWT tokens and session information
 * @example
 * ```typescript
 * const tokens: AuthTokens = {
 *   accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
 *   refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
 *   expiresIn: 3600,
 *   sessionId: "session-123",
 *   tokenType: "Bearer"
 * };
 * ```
 */
export interface AuthTokens {
  /** JWT access token */
  readonly accessToken: string;
  /** JWT refresh token */
  readonly refreshToken: string;
  /** Token expiration time in seconds */
  readonly expiresIn: number;
  /** Session identifier */
  readonly sessionId: string;
  /** Optional token type (default: Bearer) */
  readonly tokenType?: string;
}

/**
 * JWT token payload interface
 * @interface TokenPayload
 * @description Contains JWT token payload information
 */
export interface TokenPayload {
  /** Subject (user ID) */
  readonly sub: string;
  /** User email */
  readonly email: string;
  /** Optional user role */
  readonly role?: string;
  /** Optional array of roles */
  readonly roles?: string[];
  /** Optional array of permissions */
  readonly permissions?: string[];
  /** Optional clinic ID */
  readonly clinicId?: string;
  /** Optional domain */
  readonly domain?: string;
  /** Optional session ID */
  readonly sessionId?: string;
  /** Optional issued at timestamp */
  readonly iat?: number;
  /** Optional expiration timestamp */
  readonly exp?: number;
  /** Optional JWT ID for blacklist tracking */
  readonly jti?: string;
  /** Optional device fingerprint for security */
  readonly deviceFingerprint?: string;
  /** Optional user agent for security tracking */
  readonly userAgent?: string;
  /** Optional IP address for security validation */
  readonly ipAddress?: string;
}

/**
 * User profile interface
 * @interface UserProfile
 * @description User profile information for authentication responses
 */
export interface UserProfile {
  /** User ID */
  readonly id: string;
  /** User email */
  readonly email: string;
  /** User name */
  readonly name: string;
  /** Optional user role */
  readonly role?: string;
  /** Optional clinic ID */
  readonly clinicId?: string;
  /** Optional phone number */
  readonly phone?: string;
  /** Optional avatar URL */
  readonly avatar?: string;
  /** Optional last login timestamp */
  readonly lastLogin?: Date;
  /** Optional creation timestamp */
  readonly createdAt?: Date;
  /** Optional update timestamp */
  readonly updatedAt?: Date;
}

/**
 * Password reset result interface
 * @interface PasswordResetResult
 * @description Result of password reset operation
 */
export interface PasswordResetResult {
  /** Whether the operation was successful */
  readonly success: boolean;
  /** Result message */
  readonly message: string;
  /** Optional reset token */
  readonly token?: string;
}

/**
 * Magic link result interface
 * @interface MagicLinkResult
 * @description Result of magic link generation/verification
 */
export interface MagicLinkResult {
  /** Whether the operation was successful */
  readonly success: boolean;
  /** Result message */
  readonly message: string;
  /** Optional link ID */
  readonly linkId?: string;
  /** Whether the link was sent */
  readonly linkSent?: boolean;
  /** Optional expiration time in seconds */
  readonly expiresIn?: number;
}

// ============================================================================
// SOCIAL AUTH TYPES
// ============================================================================

/**
 * Social authentication provider configuration
 */
export interface SocialAuthProvider {
  name: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Social user information from OAuth provider
 */
export interface SocialUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  profilePicture?: string;
  provider: 'google' | 'facebook' | 'apple';
}

/**
 * Social authentication result
 */
export interface SocialAuthResult {
  success: boolean;
  user?: unknown;
  isNewUser?: boolean;
  message?: string;
}

// ============================================================================
// PASSWORD TYPES
// ============================================================================

/**
 * Password validation result
 */
export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
  score: number; // 0-100
}

/**
 * Password strength assessment
 */
export interface PasswordStrength {
  score: number;
  feedback: string[];
  suggestions: string[];
}

// ============================================================================
// OTP TYPES
// ============================================================================

/**
 * OTP configuration
 */
export interface OtpConfig {
  length: number;
  expiryMinutes: number;
  maxAttempts: number;
  cooldownMinutes: number;
}

/**
 * OTP result with OTP value (for OTP generation/verification)
 * @interface OtpResult
 * @description Result of OTP generation or verification operations
 */
export interface OtpResult {
  /** Whether the operation was successful */
  readonly success: boolean;
  /** Result message */
  readonly message: string;
  /** Optional OTP value (only included in generation, not verification) */
  readonly otp?: string;
  /** Optional expiration time in seconds */
  readonly expiresIn?: number;
  /** Optional remaining attempts */
  readonly attemptsRemaining?: number;
}
