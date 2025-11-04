import { Module } from '@nestjs/common';
import { EmailService } from '@communication/messaging/email/email.service';
import { EmailController } from '@communication/messaging/email/email.controller';
import { EmailTemplatesService } from '@communication/messaging/email/email-templates.service';
import { EmailQueueService } from '@communication/messaging/email/email-queue.service';
import { SESEmailService } from '@communication/messaging/email/ses-email.service';
import { ConfigModule } from '@nestjs/config';
import { LoggingModule } from '@infrastructure/logging';
import { DatabaseModule } from '@infrastructure/database';

/**
 * Email Module
 *
 * Provides email services with:
 * - SMTP and Mailtrap API support
 * - AWS SES integration
 * - Email queue management (BullMQ)
 * - Email templates for healthcare notifications
 * - HIPAA-compliant logging
 *
 * Architecture:
 * - EmailService: Primary service for sending emails
 * - EmailTemplatesService: Template generation for healthcare emails
 * - EmailQueueService: Queue management for bulk email operations
 * - SESEmailService: AWS SES backup/alternative provider
 */
@Module({
  imports: [
    ConfigModule.forFeature(() => ({
      email: {
        host: process.env['EMAIL_HOST'],
        port: parseInt(process.env['EMAIL_PORT'] || '587', 10),
        secure: process.env['EMAIL_SECURE'] === 'true',
        user: process.env['EMAIL_USER'],
        password: process.env['EMAIL_PASSWORD'],
        from: process.env['EMAIL_FROM'],
      },
    })),
    LoggingModule,
    DatabaseModule, // Optional: For email delivery logging/audit trails
  ],
  controllers: [EmailController],
  providers: [EmailService, EmailTemplatesService, EmailQueueService, SESEmailService],
  exports: [EmailService, EmailTemplatesService, EmailQueueService, SESEmailService],
})
export class EmailModule {}
