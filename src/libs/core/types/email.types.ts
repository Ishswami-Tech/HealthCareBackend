export enum EmailTemplate {
  VERIFICATION = 'VERIFICATION',
  PASSWORD_RESET = 'PASSWORD_RESET',
  PASSWORD_RESET_CONFIRMATION = 'PASSWORD_RESET_CONFIRMATION',
  OTP_LOGIN = 'OTP_LOGIN',
  MAGIC_LINK = 'MAGIC_LINK',
  SECURITY_ALERT = 'SECURITY_ALERT',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  WELCOME = 'WELCOME',
  LOGIN_NOTIFICATION = 'LOGIN_NOTIFICATION'
}

export interface EmailContext {
  [key: string]: string | number | boolean | undefined;
}

export interface VerificationEmailContext extends EmailContext {
  verificationUrl: string;
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

export interface EmailOptions {
  to: string;
  subject: string;
  template: EmailTemplate;
  context: EmailContext;
  text?: string;
  html?: string;
}