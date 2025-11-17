import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@config';
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
import {
  generateVerificationTemplate,
  generatePasswordResetRequestTemplate,
  generatePasswordResetConfirmationTemplate,
  generateOTPLoginTemplate,
  generateMagicLinkTemplate,
  generateWelcomeTemplate,
  generateLoginNotificationTemplate,
  generateSecurityAlertTemplate,
  generateSuspiciousActivityTemplate,
} from '@communication/templates/emailTemplates';

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
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Initializes the email service on module startup
   * Determines provider and sets up appropriate client
   */
  async onModuleInit(): Promise<void> {
    try {
      // Safely get provider with fallback to process.env
      let provider: string;
      try {
        provider =
          this.configService?.get<string>('EMAIL_PROVIDER') ||
          process.env['EMAIL_PROVIDER'] ||
          'smtp';
      } catch {
        provider = process.env['EMAIL_PROVIDER'] || 'smtp';
      }
      this.provider = provider as 'smtp' | 'api';

      if (this.provider === 'smtp') {
        await this.initSMTP();
      } else {
        this.initAPI();
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to initialize email service: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'EmailService',
        { stack: error instanceof Error ? error.stack : undefined }
      );
      this.isInitialized = false;
    }
  }

  /**
   * Initializes SMTP transporter
   * @private
   */
  private async initSMTP(): Promise<void> {
    try {
      // Safely get email config with fallback to process.env
      let emailConfig: EmailConfig | undefined;
      try {
        emailConfig = this.configService?.get<EmailConfig>('email');
      } catch {
        // Fallback to process.env if ConfigService fails
        emailConfig = {
          host: process.env['EMAIL_HOST'] || '',
          port: parseInt(process.env['EMAIL_PORT'] || '587', 10),
          secure: process.env['EMAIL_SECURE'] === 'true',
          user: process.env['EMAIL_USER'] || '',
          password: process.env['EMAIL_PASSWORD'] || '',
          from: process.env['EMAIL_FROM'] || 'noreply@healthcare.com',
        } as EmailConfig;
      }

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
      // Safely get token with fallback to process.env
      let token: string | undefined;
      try {
        token = this.configService?.get<string>('MAILTRAP_API_TOKEN');
      } catch {
        token = process.env['MAILTRAP_API_TOKEN'];
      }

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
   * Sends a simple body-based email without templates
   * This method provides a unified interface for simple email sending
   * and handles provider selection internally (SMTP, Mailtrap, SES, etc.)
   *
   * @param options - Simple email options with body content
   * @returns Promise resolving to email result with messageId
   */
  async sendSimpleEmail(options: {
    to: string | string[];
    subject: string;
    body: string;
    isHtml?: boolean;
    replyTo?: string;
    cc?: string[];
    bcc?: string[];
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.isInitialized) {
      void this.loggingService.log(
        LogType.EMAIL,
        LogLevel.WARN,
        'Email service is not initialized, skipping email send',
        'EmailService'
      );
      return { success: false, error: 'Service not initialized' };
    }

    try {
      const toAddresses = Array.isArray(options.to) ? options.to : [options.to];
      const emailContent = options.body;

      // Use EmailOptions with html/text field and a simple template
      // The html/text field will take precedence over template in sendViaSMTP/sendViaAPI
      const baseEmailOptions: EmailOptions = {
        to: toAddresses[0]!, // EmailService.sendEmail expects single recipient
        subject: options.subject,
        template: EmailTemplate.WELCOME, // Dummy template, html/text will be used instead
        context: {},
        ...(options.isHtml !== false ? { html: emailContent } : { text: emailContent }),
      };

      // Send to all recipients if multiple
      const results = await Promise.allSettled(
        toAddresses.map(async (to, index) => {
          if (index === 0) {
            // First recipient uses the prepared options
            return await this.sendEmail(baseEmailOptions);
          } else {
            // Additional recipients
            return await this.sendEmail({
              ...baseEmailOptions,
              to,
            });
          }
        })
      );

      const allSuccessful = results.every(r => r.status === 'fulfilled' && r.value === true);
      const firstResult = results[0];

      if (allSuccessful && firstResult && firstResult.status === 'fulfilled' && firstResult.value) {
        return {
          success: true,
          messageId: `email:${toAddresses.join(',')}:${Date.now()}`,
        };
      }

      let errorMessage = 'Failed to send email';
      if (firstResult && firstResult.status === 'rejected') {
        const reason = firstResult.reason as unknown;
        if (reason instanceof Error) {
          errorMessage = reason.message;
        } else if (typeof reason === 'string') {
          errorMessage = reason;
        }
      }

      return {
        success: false,
        error: errorMessage,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to send simple email',
        'EmailService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          to: options.to,
          subject: options.subject,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
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
      // Safely get email config with fallback to process.env
      let emailConfig: EmailConfig | undefined;
      try {
        emailConfig = this.configService?.get<EmailConfig>('email');
      } catch {
        // Fallback to process.env if ConfigService fails
        emailConfig = {
          host: process.env['EMAIL_HOST'] || '',
          port: parseInt(process.env['EMAIL_PORT'] || '587', 10),
          secure: process.env['EMAIL_SECURE'] === 'true',
          user: process.env['EMAIL_USER'] || '',
          password: process.env['EMAIL_PASSWORD'] || '',
          from: process.env['EMAIL_FROM'] || 'noreply@healthcare.com',
        } as EmailConfig;
      }
      const mailOptions = {
        from: emailConfig?.from || 'noreply@healthcare.com',
        to: options.to,
        subject: options.subject,
        html: options.html || this.getEmailTemplate(options.template, options.context),
        ...(options.text && { text: options.text }),
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
        return generateVerificationTemplate(context as VerificationEmailContext);
      case EmailTemplate.PASSWORD_RESET:
        return generatePasswordResetRequestTemplate(context as PasswordResetEmailContext);
      case EmailTemplate.PASSWORD_RESET_CONFIRMATION: {
        const fallbackLoginUrl =
          this.configService?.get<string>('APP_LOGIN_URL') ||
          process.env['APP_LOGIN_URL'] ||
          'https://app.healthcare/login';
        const loginUrl = context['loginUrl'] as string | undefined;
        return generatePasswordResetConfirmationTemplate(
          context as PasswordResetEmailContext,
          loginUrl || fallbackLoginUrl
        );
      }
      case EmailTemplate.OTP_LOGIN:
        return generateOTPLoginTemplate(context as OTPEmailContext);
      case EmailTemplate.MAGIC_LINK:
        return generateMagicLinkTemplate(context as MagicLinkEmailContext);
      case EmailTemplate.WELCOME:
        return generateWelcomeTemplate(context as WelcomeEmailContext);
      case EmailTemplate.LOGIN_NOTIFICATION:
        return generateLoginNotificationTemplate(context as LoginNotificationEmailContext);
      case EmailTemplate.SECURITY_ALERT:
        return generateSecurityAlertTemplate(context as SecurityAlertEmailContext);
      case EmailTemplate.SUSPICIOUS_ACTIVITY:
        return generateSuspiciousActivityTemplate(context as SuspiciousActivityEmailContext);
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
