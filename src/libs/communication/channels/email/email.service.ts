import { Injectable, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
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
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
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
import { ProviderFactory } from '@communication/adapters/factories/provider.factory';
import { CommunicationConfigService } from '@communication/config';
import { SuppressionListService } from '@communication/adapters/email/suppression-list.service';
import { EmailUnsubscribeService } from '@communication/adapters/email/email-unsubscribe.service';

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
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => ProviderFactory))
    private readonly providerFactory: ProviderFactory,
    @Inject(forwardRef(() => CommunicationConfigService))
    private readonly communicationConfigService: CommunicationConfigService,
    @Inject(forwardRef(() => SuppressionListService))
    private readonly suppressionListService: SuppressionListService,
    @Inject(forwardRef(() => EmailUnsubscribeService))
    private readonly unsubscribeService: EmailUnsubscribeService
  ) {}

  /**
   * Initializes the email service on module startup
   * Determines provider and sets up appropriate client
   */
  async onModuleInit(): Promise<void> {
    try {
      // Use ConfigService (which uses dotenv) for environment variable access
      const provider = this.configService.getEnv('EMAIL_PROVIDER', 'smtp');
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
        // Use ConfigService (which uses dotenv) for environment variable access
        const emailConfigData = this.configService.getEmailConfig();
        emailConfig = {
          host: emailConfigData.host || '',
          port: emailConfigData.port || 587,
          secure: emailConfigData.secure || false,
          user: emailConfigData.user || '',
          password: emailConfigData.password || '',
          from:
            emailConfigData.from ||
            this.configService.getEnv('DEFAULT_FROM_EMAIL') ||
            this.configService.getEnv('ZEPTOMAIL_FROM_EMAIL') ||
            this.configService.getEnv('EMAIL_FROM') ||
            'noreply@healthcare.com',
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

      // Try to verify connection, but don't fail initialization if it fails
      // In production/Docker, SMTP servers may not be immediately accessible
      // The service will still be marked as initialized and can attempt to send emails
      try {
        await Promise.race([
          this.transporter.verify(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('SMTP verification timeout')), 5000)
          ),
        ]);
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'SMTP email server is ready and verified',
          'EmailService'
        );
      } catch (verifyError) {
        // Log warning but still mark as initialized
        // In production, SMTP verification may fail due to network/firewall issues
        // but the service can still send emails when needed
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `SMTP verification failed but service will remain available: ${verifyError instanceof Error ? verifyError.message : 'Unknown error'}`,
          'EmailService',
          { stack: verifyError instanceof Error ? verifyError.stack : undefined }
        );
      }

      this.isInitialized = true;
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'SMTP email server initialized (ready to send emails)',
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
   * Initializes API-based email client (ZeptoMail or Mailtrap)
   * @private
   */
  private initAPI(): void {
    try {
      // Check for ZeptoMail token first (primary API provider)
      // Use ConfigService (which uses dotenv) for environment variable access
      const zeptoMailToken = this.configService.getEnv('ZEPTOMAIL_SEND_MAIL_TOKEN');
      const mailtrapToken = this.configService.getEnv('MAILTRAP_API_TOKEN');

      // ZeptoMail is the primary API provider - if token exists, mark as initialized
      // The actual sending will be handled by ZeptoMailEmailAdapter via ProviderFactory
      // This legacy EmailService is mainly for backward compatibility
      if (zeptoMailToken) {
        this.isInitialized = true;
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'ZeptoMail API configured - email service initialized (using ZeptoMail adapter)',
          'EmailService'
        );
        return;
      }

      // Fallback to Mailtrap if ZeptoMail is not configured
      if (mailtrapToken) {
        this.mailtrap = new MailtrapClient({ token: mailtrapToken });
        this.isInitialized = true;
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Mailtrap API client initialized',
          'EmailService'
        );
        return;
      }

      // No API token found
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'No API email provider token found (ZEPTOMAIL_SEND_MAIL_TOKEN or MAILTRAP_API_TOKEN), email service disabled.',
        'EmailService'
      );
      this.isInitialized = false;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to initialize API email service: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'EmailService',
        { stack: (error as Error)?.stack }
      );
      this.isInitialized = false;
    }
  }

  /**
   * Sends an email using the configured provider
   * Supports multi-tenant routing when clinicId is provided
   * @param options - Email options including template and context
   * @returns Promise resolving to true if email was sent successfully
   */
  async sendEmail(options: EmailOptions): Promise<boolean> {
    // If clinicId is provided, use multi-tenant system (sendSimpleEmail)
    const providedClinicId = options.clinicId;
    if (providedClinicId) {
      try {
        // Generate email body from template
        const emailBody = this.getEmailTemplate(options.template, options.context);
        const result = await this.sendSimpleEmail(
          {
            to: options.to,
            subject: options.subject,
            body: options.html || emailBody,
            isHtml: true,
            ...(options.text && !options.html && { body: options.text, isHtml: false }),
          },
          providedClinicId
        );
        return result.success;
      } catch (error) {
        void this.loggingService.log(
          LogType.EMAIL,
          LogLevel.WARN,
          `Failed to send email via multi-tenant system, falling back to legacy: ${error instanceof Error ? error.message : String(error)}`,
          'EmailService',
          { clinicId: providedClinicId }
        );
        // Fall through to legacy system
      }
    }

    // Legacy system (when clinicId is not provided or multi-tenant failed)
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
   * Supports multi-tenant communication via clinicId
   *
   * @param options - Simple email options with body content
   * @param clinicId - Optional clinic ID for multi-tenant provider selection
   * @returns Promise resolving to email result with messageId
   */
  async sendSimpleEmail(
    options: {
      to: string | string[];
      subject: string;
      body: string;
      isHtml?: boolean;
      replyTo?: string;
      cc?: string[];
      bcc?: string[];
      userId?: string; // Optional: for generating unsubscribe links
    },
    clinicId?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

      // Check suppression list for all recipients
      const suppressedEmails: string[] = [];
      const allowedEmails: string[] = [];

      for (const email of toAddresses) {
        const isSuppressed = await this.suppressionListService.isSuppressed(email);
        if (isSuppressed) {
          suppressedEmails.push(email);
          void this.loggingService.log(
            LogType.EMAIL,
            LogLevel.WARN,
            `Email suppressed, skipping send: ${email}`,
            'EmailService',
            { email }
          );
        } else {
          allowedEmails.push(email);
        }
      }

      // If all emails are suppressed, return early
      if (allowedEmails.length === 0) {
        return {
          success: false,
          error: `All recipient emails are suppressed: ${suppressedEmails.join(', ')}`,
        };
      }

      // If some emails are suppressed, log and continue with allowed emails
      if (suppressedEmails.length > 0) {
        void this.loggingService.log(
          LogType.EMAIL,
          LogLevel.WARN,
          `Some emails suppressed, sending only to allowed recipients`,
          'EmailService',
          {
            suppressed: suppressedEmails,
            allowed: allowedEmails,
          }
        );
      }

      // If clinicId is provided, use multi-tenant provider adapter
      if (clinicId) {
        try {
          const adapter = await this.providerFactory.getEmailProviderWithFallback(clinicId);
          if (adapter) {
            // Get fromEmail and fromName from adapter's config (provider-specific)
            const clinicConfig = await this.communicationConfigService.getClinicConfig(clinicId);
            const providerConfig = clinicConfig?.email?.primary;
            const credentials = providerConfig?.credentials as Record<string, string> | undefined;
            const defaultFrom =
              credentials?.['fromEmail'] ||
              credentials?.['from'] ||
              this.configService.getEnv('DEFAULT_FROM_EMAIL') ||
              this.configService.getEnv('ZEPTOMAIL_FROM_EMAIL') ||
              this.configService.getEnv('EMAIL_FROM') ||
              'noreply@healthcare.com';
            const defaultFromName =
              credentials?.['fromName'] ||
              this.configService.getEnv('DEFAULT_FROM_NAME') ||
              this.configService.getEnv('ZEPTOMAIL_FROM_NAME') ||
              this.configService.getEnv('APP_NAME') ||
              'Healthcare App';

            // Send to all recipients
            // Use adapter's EmailOptions interface
            type AdapterEmailOptions = {
              to: string | string[];
              from: string;
              fromName?: string;
              subject: string;
              body: string;
              html?: boolean;
              cc?: string | string[];
              bcc?: string | string[];
              replyTo?: string;
            };
            // Generate unsubscribe URL for each recipient
            const results = await Promise.allSettled(
              allowedEmails.map(async to => {
                // Generate unsubscribe URL
                const unsubscribeUrl = this.unsubscribeService.generateUnsubscribeUrl(
                  to,
                  options.userId
                );

                // Add unsubscribe footer to body if HTML
                let emailBody = options.body;
                if (options.isHtml !== false) {
                  const { generateUnsubscribeFooter } =
                    await import('@communication/templates/emailTemplates/unsubscribe-footer');
                  emailBody = options.body + generateUnsubscribeFooter(unsubscribeUrl);
                }

                const emailOptions: AdapterEmailOptions = {
                  to,
                  from: defaultFrom,
                  fromName: defaultFromName,
                  subject: options.subject,
                  body: emailBody,
                  html: options.isHtml !== false,
                };
                if (options.replyTo) {
                  emailOptions.replyTo = options.replyTo;
                }
                if (options.cc && options.cc.length > 0) {
                  emailOptions.cc = options.cc;
                }
                if (options.bcc && options.bcc.length > 0) {
                  emailOptions.bcc = options.bcc;
                }
                const result = await adapter.send(emailOptions);
                return result;
              })
            );

            const allSuccessful = results.every(r => r.status === 'fulfilled' && r.value.success);
            const firstResult = results[0];

            if (
              allSuccessful &&
              firstResult &&
              firstResult.status === 'fulfilled' &&
              firstResult.value.success
            ) {
              return {
                success: true,
                messageId:
                  firstResult.value.messageId || `email:${toAddresses.join(',')}:${Date.now()}`,
              };
            }

            const errorMessage =
              firstResult && firstResult.status === 'fulfilled'
                ? firstResult.value.error || 'Failed to send email'
                : 'Failed to send email';

            return {
              success: false,
              error: errorMessage,
            };
          }
        } catch (error) {
          void this.loggingService.log(
            LogType.EMAIL,
            LogLevel.WARN,
            `Failed to use clinic-specific email provider, falling back to global: ${error instanceof Error ? error.message : String(error)}`,
            'EmailService',
            { clinicId }
          );
          // Fall through to global provider
        }
      }

      // Fallback to global provider (existing behavior)
      if (!this.isInitialized) {
        void this.loggingService.log(
          LogType.EMAIL,
          LogLevel.WARN,
          'Email service is not initialized, skipping email send',
          'EmailService'
        );
        return { success: false, error: 'Service not initialized' };
      }

      const emailContent = options.body;
      const baseEmailOptions: EmailOptions = {
        to: toAddresses[0]!,
        subject: options.subject,
        template: EmailTemplate.WELCOME,
        context: {},
        ...(options.isHtml !== false ? { html: emailContent } : { text: emailContent }),
      };

      // Generate unsubscribe URLs and add to body
      const results = await Promise.allSettled(
        allowedEmails.map(async (to, index) => {
          // Generate unsubscribe URL
          const unsubscribeUrl = this.unsubscribeService.generateUnsubscribeUrl(to, options.userId);

          // Add unsubscribe footer to body if HTML
          let emailBody = options.body;
          if (options.isHtml !== false) {
            const { generateUnsubscribeFooter } =
              await import('@communication/templates/emailTemplates/unsubscribe-footer');
            emailBody = options.body + generateUnsubscribeFooter(unsubscribeUrl);
          }

          const emailOptions: EmailOptions = {
            ...baseEmailOptions,
            to,
            html: emailBody,
          };

          if (index === 0) {
            return await this.sendEmail(emailOptions);
          } else {
            return await this.sendEmail(emailOptions);
          }
        })
      );

      const allSuccessful = results.every(r => r.status === 'fulfilled' && r.value === true);
      const firstResult = results[0];

      if (allSuccessful && firstResult && firstResult.status === 'fulfilled' && firstResult.value) {
        return {
          success: true,
          messageId: `email:${allowedEmails.join(',')}:${Date.now()}`,
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
   * Check if email is suppressed before sending
   */
  async isEmailSuppressed(email: string): Promise<boolean> {
    return await this.suppressionListService.isSuppressed(email);
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
        // Use ConfigService (which uses dotenv) for environment variable access
        const emailConfigData = this.configService.getEmailConfig();
        emailConfig = {
          host: emailConfigData.host || '',
          port: emailConfigData.port || 587,
          secure: emailConfigData.secure || false,
          user: emailConfigData.user || '',
          password: emailConfigData.password || '',
          from:
            emailConfigData.from ||
            this.configService.getEnv('DEFAULT_FROM_EMAIL') ||
            this.configService.getEnv('ZEPTOMAIL_FROM_EMAIL') ||
            this.configService.getEnv('EMAIL_FROM') ||
            'noreply@healthcare.com',
        } as EmailConfig;
      }
      const mailOptions = {
        from:
          emailConfig?.from ||
          this.configService.getEnv('DEFAULT_FROM_EMAIL') ||
          this.configService.getEnv('ZEPTOMAIL_FROM_EMAIL') ||
          this.configService.getEnv('EMAIL_FROM') ||
          'noreply@healthcare.com',
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
      const fromEmail =
        extendedOptions.from ||
        this.configService.getEnv('DEFAULT_FROM_EMAIL') ||
        this.configService.getEnv('ZEPTOMAIL_FROM_EMAIL') ||
        this.configService.getEnv('EMAIL_FROM') ||
        'noreply@healthcare.com';
      const fromName =
        extendedOptions.fromName ||
        this.configService.getEnv('DEFAULT_FROM_NAME') ||
        this.configService.getEnv('ZEPTOMAIL_FROM_NAME') ||
        this.configService.getEnv('APP_NAME') ||
        'Healthcare App';
      const category =
        extendedOptions.category || this.configService.getEnv('EMAIL_CATEGORY', 'Notification');
      const mailOptions: {
        from: { email: string; name: string };
        to: { email: string }[];
        subject: string;
        text?: string;
        html: string;
        category?: string;
      } = {
        from: { email: fromEmail, name: fromName },
        to: [{ email: options.to }],
        subject: options.subject,
        html: options.html || this.getEmailTemplate(options.template, options.context),
      };
      if (options.text) {
        mailOptions.text = options.text;
      }
      if (category) {
        mailOptions.category = category;
      }
      await this.mailtrap.send(mailOptions);
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `API Email sent to ${options.to}`,
        'EmailService'
      );
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // If unauthorized, disable the service to prevent further errors
      if (errorMessage.includes('Unauthorized') || errorMessage.includes('401')) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Email service authentication failed (Unauthorized). Disabling email service. Error: ${errorMessage}`,
          'EmailService'
        );
        this.isInitialized = false;
        return false;
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to send API email: ${errorMessage}`,
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
    // Add app name and support email to context if not present
    const appName =
      (context['appName'] as string | undefined) ||
      this.configService.getEnv('APP_NAME') ||
      'Healthcare App';
    const supportEmail =
      (context['supportEmail'] as string | undefined) ||
      this.configService.getEnv('SUPPORT_EMAIL') ||
      this.configService.getEnv('DEFAULT_FROM_EMAIL') ||
      'support@healthcareapp.com';

    const enrichedContext: EmailContext = {
      ...context,
      appName,
      supportEmail,
    };

    switch (template) {
      case EmailTemplate.VERIFICATION:
        return generateVerificationTemplate(enrichedContext as VerificationEmailContext);
      case EmailTemplate.PASSWORD_RESET:
        return generatePasswordResetRequestTemplate(enrichedContext as PasswordResetEmailContext);
      case EmailTemplate.PASSWORD_RESET_CONFIRMATION: {
        // Use ConfigService (which uses dotenv) for environment variable access
        const fallbackLoginUrl =
          this.configService.getEnv('APP_LOGIN_URL') ||
          (this.configService.getEnv('FRONTEND_URL') || '') + '/login' ||
          'https://app.healthcare/login';
        const loginUrl = (enrichedContext['loginUrl'] as string | undefined) || fallbackLoginUrl;
        return generatePasswordResetConfirmationTemplate(
          enrichedContext as PasswordResetEmailContext,
          loginUrl
        );
      }
      case EmailTemplate.OTP_LOGIN:
        return generateOTPLoginTemplate(enrichedContext as OTPEmailContext);
      case EmailTemplate.MAGIC_LINK:
        return generateMagicLinkTemplate(enrichedContext as MagicLinkEmailContext);
      case EmailTemplate.WELCOME:
        return generateWelcomeTemplate(enrichedContext as WelcomeEmailContext);
      case EmailTemplate.LOGIN_NOTIFICATION:
        return generateLoginNotificationTemplate(enrichedContext as LoginNotificationEmailContext);
      case EmailTemplate.SECURITY_ALERT:
        return generateSecurityAlertTemplate(enrichedContext as SecurityAlertEmailContext);
      case EmailTemplate.SUSPICIOUS_ACTIVITY:
        return generateSuspiciousActivityTemplate(
          enrichedContext as SuspiciousActivityEmailContext
        );
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
