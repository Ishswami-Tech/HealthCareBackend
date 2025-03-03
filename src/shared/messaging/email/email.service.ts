import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaService } from '../kafka/kafka.service';
import { EmailTemplate, EmailOptions } from '../../../libs/types/email.types';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private configService: ConfigService,
    private kafkaService: KafkaService,
  ) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    try {
      this.transporter = nodemailer.createTransport({
        host: this.configService.get<string>('EMAIL_HOST'),
        port: parseInt(this.configService.get<string>('EMAIL_PORT')),
        secure: false,
        auth: {
          user: this.configService.get<string>('EMAIL_USER'),
          pass: this.configService.get<string>('EMAIL_PASSWORD'),
        },
        tls: {
          ciphers: 'SSLv3',
          rejectUnauthorized: false
        }
      });

      // Verify connection
      this.transporter.verify((error, success) => {
        if (error) {
          this.logger.error('Email transporter verification failed:', error);
        } else {
          this.logger.log('Email server is ready to send messages');
        }
      });

    } catch (error) {
      this.logger.error('Failed to initialize email transporter:', error);
    }
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      const mailOptions = {
        from: this.configService.get('EMAIL_FROM'),
        to: options.to,
        subject: options.subject,
        html: this.getEmailTemplate(options.template, options.context),
      };

      const info = await this.transporter.sendMail(mailOptions);
      
      this.logger.debug(`Email sent: ${info.messageId}`);
      
      // Log email event to Kafka
      await this.kafkaService.sendMessage('email.sent', {
        messageId: info.messageId,
        to: options.to,
        template: options.template,
        timestamp: new Date(),
        success: true
      });

      return true;
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`, error.stack);
      
      // Log failed email attempt
      await this.kafkaService.sendMessage('email.failed', {
        to: options.to,
        template: options.template,
        timestamp: new Date(),
        error: error.message
      });

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
      default:
        throw new Error('Invalid email template');
    }
  }

  private getVerificationEmailTemplate(context: any): string {
    return `
      <h1>Welcome to HealthCare!</h1>
      <p>Please verify your email by clicking the link below:</p>
      <a href="${context.verificationUrl}">Verify Email</a>
      <p>This link will expire in 24 hours.</p>
    `;
  }

  private getPasswordResetTemplate(context: any): string {
    return `
      <h1>Reset Your Password</h1>
      <p>Hello ${context.name || 'there'},</p>
      <p>You requested to reset your password. Please click the link below to set a new password:</p>
      <a href="${context.resetUrl}">Reset Password</a>
      <p>This link will expire in ${context.expiryTime || '60 minutes'}.</p>
      <p>If you didn't request this, please ignore this email or contact support if you have concerns.</p>
    `;
  }

  private getPasswordResetConfirmationTemplate(context: any): string {
    return `
      <h1>Password Reset Successful</h1>
      <p>Hello ${context.name || 'there'},</p>
      <p>Your password has been successfully reset.</p>
      <p>You can now login with your new password:</p>
      <a href="${context.loginUrl}">Login to Your Account</a>
      <p>If you did not reset your password, please contact our support team immediately.</p>
    `;
  }

  private getOTPLoginTemplate(context: any): string {
    return `
      <h1>Login Verification Code</h1>
      <p>Your OTP for login is:</p>
      <h2>${context.otp}</h2>
      <p>This code will expire in 5 minutes.</p>
      <p>If you didn't request this code, please secure your account.</p>
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
        <p>This link will expire in ${context.expiryTime}.</p>
        <p>If you didn't request this link, you can safely ignore this email.</p>
        <p>Best regards,<br>The Healthcare App Team</p>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
          <p>This is an automated message, please do not reply to this email.</p>
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