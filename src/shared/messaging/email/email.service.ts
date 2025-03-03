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
      case EmailTemplate.OTP_LOGIN:
        return this.getOTPLoginTemplate(context);
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
      <h1>Password Reset Request</h1>
      <p>You requested to reset your password. Click the link below to proceed:</p>
      <a href="${context.resetUrl}">Reset Password</a>
      <p>This link will expire in 1 hour.</p>
      <p>If you didn't request this, please ignore this email.</p>
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
} 