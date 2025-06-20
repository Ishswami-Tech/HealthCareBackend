import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailTemplate, EmailOptions } from '../../../libs/types/email.types';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private isInitialized = false;

  constructor(
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.initializeTransporter();
  }

  private async initializeTransporter() {
    try {
      const emailConfig = this.configService.get('email');
      if (!emailConfig) {
        throw new Error('Email configuration not found');
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
          rejectUnauthorized: false
        }
      });

      // Verify connection
      await this.transporter.verify();
      this.isInitialized = true;
      this.logger.log('Email server is ready to send messages');

    } catch (error) {
      this.logger.error('Failed to initialize email transporter:', error);
      this.isInitialized = false;
      throw error;
    }
  }

  isHealthy(): boolean {
    return this.isInitialized && !!this.transporter;
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      const emailConfig = this.configService.get('email');
      if (!emailConfig) {
        throw new Error('Email configuration not found');
      }

      const mailOptions = {
        from: emailConfig.from,
        to: options.to,
        subject: options.subject,
        html: this.getEmailTemplate(options.template, options.context),
      };

      const info = await this.transporter.sendMail(mailOptions);
      
      this.logger.debug(`Email sent: ${info.messageId}`);
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`, error.stack);
      return false;
    }
  }

  private getEmailTemplate(template: EmailTemplate, context: any): string {
    switch (template) {
      case EmailTemplate.VERIFICATION:
        return this.getVerificationEmailTemplate(context);
      case EmailTemplate.PASSWORD_RESET:
        return this.getPasswordResetTemplate(context);
      case EmailTemplate.PASSWORD_RESET_CONFIRMATION:
        return this.getPasswordResetConfirmationTemplate(context);
      case EmailTemplate.OTP_LOGIN:
        return this.getOTPLoginTemplate(context);
      case EmailTemplate.MAGIC_LINK:
        return this.getMagicLinkTemplate(context);
      case EmailTemplate.WELCOME:
        return this.getWelcomeTemplate(context);
      case EmailTemplate.LOGIN_NOTIFICATION:
        return this.getLoginNotificationTemplate(context);
      case EmailTemplate.SECURITY_ALERT:
        return this.getSecurityAlertTemplate(context);
      case EmailTemplate.SUSPICIOUS_ACTIVITY:
        return this.getSuspiciousActivityTemplate(context);
      default:
        throw new Error('Invalid email template');
    }
  }

  private getVerificationEmailTemplate(context: any): string {
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

  private getPasswordResetTemplate(context: any): string {
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

  private getPasswordResetConfirmationTemplate(context: any): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #4a4a4a;">Password Reset Successful</h2>
        <p>Hello ${context.name || 'there'},</p>
        <p>Your password has been successfully reset.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${context.loginUrl}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">
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

  private getOTPLoginTemplate(context: any): string {
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

  private getMagicLinkTemplate(context: { loginUrl: string; name: string; expiryTime: string }): string {
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

  private getWelcomeTemplate(context: any): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #4a4a4a;">Welcome to Healthcare App!</h2>
        <p>Hello ${context.name || 'there'},</p>
        <p>Thank you for joining Healthcare App. We're excited to have you on board as a ${context.role || 'user'}!</p>
        
        ${context.isGoogleAccount ? 
          `<p>Your account has been created using Google Sign-In. You can continue to use Google to log in to your account.</p>` : 
          `<p>You can now log in to your account using your email and password:</p>
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

  private getLoginNotificationTemplate(context: any): string {
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

  private getSecurityAlertTemplate(context: any): string {
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

  private getSuspiciousActivityTemplate(context: any): string {
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

  private generateOTP(length: number = 6): string {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
  }
} 