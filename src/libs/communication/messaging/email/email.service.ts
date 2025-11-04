import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailTemplate,
  EmailOptions,
  EmailContext,
  VerificationEmailContext,
  PasswordResetEmailContext,
  OTPEmailContext,
  MagicLinkEmailContext,
  WelcomeEmailContext,
  LoginNotificationEmailContext,
  SecurityAlertEmailContext,
  SuspiciousActivityEmailContext,
} from '@core/types';
import * as nodemailer from 'nodemailer';
import { MailtrapClient } from 'mailtrap';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

/**
 * Email configuration interface
 * @interface EmailConfig
 */
interface EmailConfig {
  /** SMTP server host */
  readonly host: string;
  /** SMTP server port */
  readonly port: number;
  /** Whether to use secure connection (TLS) */
  readonly secure: boolean;
  /** SMTP username */
  readonly user: string;
  /** SMTP password */
  readonly password: string;
  /** Default sender email address */
  readonly from: string;
}

/**
 * Email service for sending emails via SMTP or API
 * Supports multiple providers and templates
 *
 * @class EmailService
 * @implements {OnModuleInit}
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private transporter!: nodemailer.Transporter;
  private mailtrap!: MailtrapClient;
  private isInitialized = false;
  private provider!: 'smtp' | 'api';

  /**
   * Creates an instance of EmailService
   * @param configService - Configuration service for environment variables
   */
  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Initializes the email service on module startup
   * Determines provider and sets up appropriate client
   */
  async onModuleInit(): Promise<void> {
    this.provider = (this.configService.get<string>('EMAIL_PROVIDER') || 'smtp') as 'smtp' | 'api';
    if (this.provider === 'smtp') {
      await this.initSMTP();
    } else {
      this.initAPI();
    }
  }

  /**
   * Initializes SMTP transporter
   * @private
   */
  private async initSMTP(): Promise<void> {
    try {
      const emailConfig = this.configService.get<EmailConfig>('email');
      if (!emailConfig || !emailConfig.user || !emailConfig.password) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'SMTP credentials not provided, email service will be disabled',
          'EmailService'
        );
        this.isInitialized = false;
        return;
      }
      this.transporter = nodemailer.createTransport({
        host: emailConfig.host,
        port: emailConfig.port,
        secure: emailConfig.secure,
        auth: {
          user: emailConfig.user,
          pass: emailConfig.password,
        },
        tls: {
          ciphers: 'SSLv3',
          rejectUnauthorized: false,
        },
      });
      await this.transporter.verify();
      this.isInitialized = true;
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'SMTP email server is ready',
        'EmailService'
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to initialize SMTP transporter: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'EmailService',
        { stack: (error as Error)?.stack }
      );
      this.isInitialized = false;
    }
  }

  /**
   * Initializes Mailtrap API client
   * @private
   */
  private initAPI(): void {
    try {
      const token = this.configService.get<string>('MAILTRAP_API_TOKEN');
      if (!token) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Mailtrap API token not set, email service disabled.',
          'EmailService'
        );
        this.isInitialized = false;
        return;
      }
      this.mailtrap = new MailtrapClient({ token });
      this.isInitialized = true;
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Mailtrap API client initialized',
        'EmailService'
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to initialize Mailtrap API: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'EmailService',
        { stack: (error as Error)?.stack }
      );
      this.isInitialized = false;
    }
  }

  /**
   * Sends an email using the configured provider
   * @param options - Email options including template and context
   * @returns Promise resolving to true if email was sent successfully
   */
  async sendEmail(options: EmailOptions): Promise<boolean> {
    if (!this.isInitialized) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Email service is not initialized, skipping email send',
        'EmailService'
      );
      return false;
    }
    if (this.provider === 'smtp') {
      return this.sendViaSMTP(options);
    } else {
      return this.sendViaAPI(options);
    }
  }

  /**
   * Sends email via SMTP
   * @param options - Email options
   * @returns Promise resolving to true if successful
   * @private
   */
  private async sendViaSMTP(options: EmailOptions): Promise<boolean> {
    try {
      const emailConfig = this.configService.get<EmailConfig>('email');
      const mailOptions = {
        from: emailConfig?.from || 'noreply@healthcare.com',
        to: options.to,
        subject: options.subject,
        html: this.getEmailTemplate(options.template, options.context),
      };
      const info = (await this.transporter.sendMail(mailOptions)) as {
        messageId: string;
      };
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `SMTP Email sent: ${info.messageId}`,
        'EmailService'
      );
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to send SMTP email: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'EmailService',
        { stack: (error as Error)?.stack }
      );
      return false;
    }
  }

  /**
   * Sends email via Mailtrap API
   * @param options - Email options
   * @returns Promise resolving to true if successful
   * @private
   */
  private async sendViaAPI(options: EmailOptions): Promise<boolean> {
    try {
      // Use defaults if not present in options
      const extendedOptions = options as EmailOptions & {
        from?: string;
        fromName?: string;
        category?: string;
      };
      const fromEmail = extendedOptions.from || 'noreply@healthcare.com';
      const fromName = extendedOptions.fromName || 'Healthcare App';
      const category = extendedOptions.category || 'Notification';
      await this.mailtrap.send({
        from: { email: fromEmail, name: fromName },
        to: [{ email: options.to }],
        subject: options.subject,
        text: options.text,
        html: options.html || this.getEmailTemplate(options.template, options.context),
        category,
      });
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `API Email sent to ${options.to}`,
        'EmailService'
      );
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to send API email: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'EmailService',
        { stack: (error as Error)?.stack }
      );
      return false;
    }
  }

  /**
   * Gets email template HTML based on template type and context
   * @param template - Email template type
   * @param context - Template context data
   * @returns HTML string for the email
   * @private
   */
  private getEmailTemplate(template: EmailTemplate, context: EmailContext): string {
    switch (template) {
      case EmailTemplate.VERIFICATION:
        return this.getVerificationEmailTemplate(context as VerificationEmailContext);
      case EmailTemplate.PASSWORD_RESET:
        return this.getPasswordResetTemplate(context as PasswordResetEmailContext);
      case EmailTemplate.PASSWORD_RESET_CONFIRMATION:
        return this.getPasswordResetConfirmationTemplate(context as PasswordResetEmailContext);
      case EmailTemplate.OTP_LOGIN:
        return this.getOTPLoginTemplate(context as OTPEmailContext);
      case EmailTemplate.MAGIC_LINK:
        return this.getMagicLinkTemplate(context as MagicLinkEmailContext);
      case EmailTemplate.WELCOME:
        return this.getWelcomeTemplate(context as WelcomeEmailContext);
      case EmailTemplate.LOGIN_NOTIFICATION:
        return this.getLoginNotificationTemplate(context as LoginNotificationEmailContext);
      case EmailTemplate.SECURITY_ALERT:
        return this.getSecurityAlertTemplate(context as SecurityAlertEmailContext);
      case EmailTemplate.SUSPICIOUS_ACTIVITY:
        return this.getSuspiciousActivityTemplate(context as SuspiciousActivityEmailContext);
      default:
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Invalid email template',
          undefined,
          { template: String(template) },
          'EmailService.getEmailTemplate'
        );
    }
  }

  private getVerificationEmailTemplate(context: VerificationEmailContext): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #4a4a4a;">Welcome to Healthcare App!</h2>
        <p>Thank you for signing up. Please verify your email address to complete your registration.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${context.verificationUrl}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">
            Verify Email Address
          </a>
        </div>
        
        <div style="background-color: #f8f8f8; padding: 15px; border-radius: 4px; margin: 20px 0;">
          <p><strong>Note:</strong> This verification link will expire in 24 hours.</p>
        </div>
        
        <p>If you did not create an account with us, please ignore this email.</p>
        
        <p>Best regards,<br>The Healthcare App Team</p>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
          <p>This is an automated message, please do not reply to this email.</p>
        </div>
      </div>
    `;
  }

  private getPasswordResetTemplate(context: PasswordResetEmailContext): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #4a4a4a;">Reset Your Password</h2>
        <p>Hello ${context.name || 'there'},</p>
        <p>You requested to reset your password. Please click the button below to set a new password:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${context.resetUrl}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">
            Reset Password
          </a>
        </div>
        
        <div style="background-color: #f8f8f8; padding: 15px; border-radius: 4px; margin: 20px 0;">
          <p><strong>Note:</strong> This link will expire in ${context.expiryTime || '60 minutes'}.</p>
        </div>
        
        <p>If you didn't request this, please ignore this email or contact support if you have concerns.</p>
        
        <p>Best regards,<br>The Healthcare App Security Team</p>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
          <p>This is an automated security message, please do not reply to this email.</p>
        </div>
      </div>
    `;
  }

  private getPasswordResetConfirmationTemplate(context: PasswordResetEmailContext): string {
    const fallbackLoginUrl =
      this.configService.get<string>('APP_LOGIN_URL') || 'https://app.healthcare/login';
    const loginUrl = (context as EmailContext)['loginUrl'] || fallbackLoginUrl;
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #4a4a4a;">Password Reset Successful</h2>
        <p>Hello ${context.name || 'there'},</p>
        <p>Your password has been successfully reset.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${loginUrl}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">
            Login to Your Account
          </a>
        </div>
        
        <div style="background-color: #e8f5e9; padding: 15px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #4CAF50;">
          <p><strong>Security Notice:</strong> If you did not reset your password, please contact our support team immediately.</p>
        </div>
        
        <p>Best regards,<br>The Healthcare App Security Team</p>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
          <p>This is an automated security message, please do not reply to this email.</p>
        </div>
      </div>
    `;
  }

  private getOTPLoginTemplate(context: OTPEmailContext): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #4a4a4a;">Login Verification Code</h2>
        <p>Hello ${context.name || 'there'},</p>
        <p>Your one-time password (OTP) for login is:</p>
        
        <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #f5f5f5; border-radius: 4px;">
          <h1 style="font-size: 32px; letter-spacing: 5px; color: #333; margin: 0;">${context.otp}</h1>
        </div>
        
        <div style="background-color: #e3f2fd; padding: 15px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #2196F3;">
          <p><strong>Important:</strong> This code will expire in 5 minutes.</p>
          <p>If you didn't request this code, please ignore this email and secure your account.</p>
        </div>
        
        <p>Best regards,<br>The Healthcare App Security Team</p>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
          <p>This is an automated security message, please do not reply to this email.</p>
        </div>
      </div>
    `;
  }

  private getMagicLinkTemplate(context: MagicLinkEmailContext): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #4a4a4a;">Login to Healthcare App</h2>
        <p>Hello ${context.name},</p>
        <p>You requested a magic link to sign in to your Healthcare App account. Click the button below to login:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${context.loginUrl}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">
            Login to Your Account
          </a>
        </div>
        
        <div style="background-color: #f8f8f8; padding: 15px; border-radius: 4px; margin: 20px 0;">
          <p><strong>Note:</strong> This link will expire in ${context.expiryTime}.</p>
        </div>
        
        <p>If you didn't request this link, you can safely ignore this email.</p>
        
        <p>Best regards,<br>The Healthcare App Team</p>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
          <p>This is an automated message, please do not reply to this email.</p>
        </div>
      </div>
    `;
  }

  private getWelcomeTemplate(context: WelcomeEmailContext): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #4a4a4a;">Welcome to Healthcare App!</h2>
        <p>Hello ${context.name || 'there'},</p>
        <p>Thank you for joining Healthcare App. We're excited to have you on board as a ${context.role || 'user'}!</p>
        
        ${
          context.isGoogleAccount
            ? `<p>Your account has been created using Google Sign-In. You can continue to use Google to log in to your account.</p>`
            : `<p>You can now log in to your account using your email and password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${context.loginUrl}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">
              Login to Your Account
            </a>
          </div>`
        }
        
        <p>Access your dashboard to get started:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${context.dashboardUrl}" style="background-color: #2196F3; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">
            Go to Dashboard
          </a>
        </div>
        
        <p>If you have any questions or need assistance, please contact our support team at ${context.supportEmail || 'support@healthcareapp.com'}.</p>
        
        <p>Best regards,<br>The Healthcare App Team</p>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
          <p>This is an automated message, please do not reply to this email.</p>
        </div>
      </div>
    `;
  }

  private getLoginNotificationTemplate(context: LoginNotificationEmailContext): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #4a4a4a;">New Login to Your Account</h2>
        <p>Hello ${context.name || 'there'},</p>
        <p>We detected a new login to your Healthcare App account.</p>
        
        <div style="background-color: #f8f8f8; padding: 15px; border-radius: 4px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #555;">Login Details:</h3>
          <p><strong>Time:</strong> ${context.time}</p>
          <p><strong>Device:</strong> ${context.device || 'Unknown'}</p>
          <p><strong>Browser:</strong> ${context.browser || 'Unknown'}</p>
          <p><strong>Operating System:</strong> ${context.operatingSystem || 'Unknown'}</p>
          <p><strong>IP Address:</strong> ${context.ipAddress || 'Unknown'}</p>
          <p><strong>Location:</strong> ${context.location || 'Unknown'}</p>
        </div>
        
        <p>If this was you, no further action is needed.</p>
        <p>If you don't recognize this login, please secure your account immediately by changing your password.</p>
        
        <p>Best regards,<br>The Healthcare App Security Team</p>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
          <p>This is an automated security notification. Please do not reply to this email.</p>
        </div>
      </div>
    `;
  }

  private getSecurityAlertTemplate(context: SecurityAlertEmailContext): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #d32f2f;">Security Alert</h2>
        <p>Hello ${context.name || 'there'},</p>
        <p>We detected a security concern with your Healthcare App account.</p>
        
        <div style="background-color: #ffebee; padding: 15px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #d32f2f;">
          <p><strong>Alert Time:</strong> ${context.time}</p>
          <p><strong>Action Taken:</strong> ${context.action || 'Security measures have been applied to your account.'}</p>
        </div>
        
        <p>For your security, we recommend:</p>
        <ul>
          <li>Change your password immediately</li>
          <li>Enable two-factor authentication if available</li>
          <li>Review recent account activity</li>
        </ul>
        
        <p>If you have any questions or concerns, please contact our support team immediately.</p>
        
        <p>Best regards,<br>The Healthcare App Security Team</p>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
          <p>This is an important security notification. Please do not ignore this message.</p>
        </div>
      </div>
    `;
  }

  private getSuspiciousActivityTemplate(context: SuspiciousActivityEmailContext): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #ff9800;">Suspicious Activity Detected</h2>
        <p>Hello ${context.name || 'there'},</p>
        <p>We've detected unusual activity on your Healthcare App account that requires additional verification.</p>
        
        <div style="background-color: #fff3e0; padding: 15px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #ff9800;">
          <p><strong>Detection Time:</strong> ${context.time}</p>
          <p><strong>Reason:</strong> Multiple login attempts from unfamiliar devices or locations</p>
        </div>
        
        <p>For your protection, we've temporarily added additional security measures to your account.</p>
        <p>The next time you log in, you'll need to verify your identity through additional steps.</p>
        
        <p>If you believe this is an error or have questions, please contact our support team at ${context.supportEmail || 'support@healthcareapp.com'}.</p>
        
        <p>Best regards,<br>The Healthcare App Security Team</p>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
          <p>This is an automated security notification. Please do not reply to this email.</p>
        </div>
      </div>
    `;
  }

  /**
   * Generates a random OTP
   * @param length - Length of the OTP (default: 6)
   * @returns Generated OTP string
   * @private
   */
  private generateOTP(length: number = 6): string {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
  }

  /**
   * Checks if the email service is healthy and initialized
   * @returns True if service is ready to send emails
   */
  isHealthy(): boolean {
    return this.isInitialized;
  }
}
