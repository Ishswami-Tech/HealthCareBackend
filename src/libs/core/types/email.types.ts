/**
 * Email template types for the healthcare application
 * @enum EmailTemplate
 * @description Defines all available email templates for user communications
 * @example
 * ```typescript
 * const template: EmailTemplate = EmailTemplate.WELCOME;
 * ```
 */
export enum EmailTemplate {
  /** Email verification template */
  VERIFICATION = "VERIFICATION",
  /** Password reset request template */
  PASSWORD_RESET = "PASSWORD_RESET",
  /** Password reset confirmation template */
  PASSWORD_RESET_CONFIRMATION = "PASSWORD_RESET_CONFIRMATION",
  /** OTP login template */
  OTP_LOGIN = "OTP_LOGIN",
  /** Magic link login template */
  MAGIC_LINK = "MAGIC_LINK",
  /** Security alert template */
  SECURITY_ALERT = "SECURITY_ALERT",
  /** Suspicious activity notification template */
  SUSPICIOUS_ACTIVITY = "SUSPICIOUS_ACTIVITY",
  /** Welcome email template */
  WELCOME = "WELCOME",
  /** Login notification template */
  LOGIN_NOTIFICATION = "LOGIN_NOTIFICATION",
  /** Appointment reminder template */
  APPOINTMENT_REMINDER = "APPOINTMENT_REMINDER",
}

/**
 * Base email context interface
 * @interface EmailContext
 * @description Generic context object for email template variables
 * @example
 * ```typescript
 * const context: EmailContext = {
 *   name: "John Doe",
 *   clinicName: "Downtown Medical",
 *   supportEmail: "support@clinic.com"
 * };
 * ```
 */
export interface EmailContext {
  /** Dynamic key-value pairs for email template variables */
  readonly [key: string]: string | number | boolean | undefined;
}

/**
 * Email context for verification emails
 * @interface VerificationEmailContext
 * @description Context specific to email verification templates
 * @example
 * ```typescript
 * const context: VerificationEmailContext = {
 *   verificationUrl: "https://clinic.com/verify?token=abc123",
 *   name: "John Doe"
 * };
 * ```
 */
export interface VerificationEmailContext extends EmailContext {
  /** URL for email verification */
  readonly verificationUrl: string;
}

export interface PasswordResetEmailContext extends EmailContext {
  name?: string;
  resetUrl: string;
  expiryTime?: string;
}

export interface OTPEmailContext extends EmailContext {
  name?: string;
  otp: string;
}

export interface MagicLinkEmailContext extends EmailContext {
  name: string;
  loginUrl: string;
  expiryTime: string;
}

export interface WelcomeEmailContext extends EmailContext {
  name?: string;
  role?: string;
  loginUrl?: string;
  dashboardUrl?: string;
  supportEmail?: string;
  isGoogleAccount?: boolean;
}

export interface LoginNotificationEmailContext extends EmailContext {
  name?: string;
  time: string;
  device?: string;
  browser?: string;
  operatingSystem?: string;
  ipAddress?: string;
  location?: string;
}

export interface SecurityAlertEmailContext extends EmailContext {
  name?: string;
  time: string;
  action?: string;
}

export interface SuspiciousActivityEmailContext extends EmailContext {
  name?: string;
  time: string;
  supportEmail?: string;
}

/**
 * Email sending options
 * @interface EmailOptions
 * @description Configuration for sending emails with templates
 * @example
 * ```typescript
 * const options: EmailOptions = {
 *   to: "user@example.com",
 *   subject: "Welcome to Downtown Medical",
 *   template: EmailTemplate.WELCOME,
 *   context: { name: "John Doe", clinicName: "Downtown Medical" }
 * };
 * ```
 */
export interface EmailOptions {
  /** Recipient email address */
  readonly to: string;
  /** Email subject line */
  readonly subject: string;
  /** Email template to use */
  readonly template: EmailTemplate;
  /** Context variables for template */
  readonly context: EmailContext;
  /** Optional plain text content */
  readonly text?: string;
  /** Optional HTML content */
  readonly html?: string;
}
