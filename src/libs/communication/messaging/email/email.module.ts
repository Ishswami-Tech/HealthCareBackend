import { Module } from '@nestjs/common';
import { EmailService } from '@communication/messaging/email/email.service';
import { EmailController } from '@communication/messaging/email/email.controller';
import { EmailTemplatesService } from '@communication/messaging/email/email-templates.service';
import { EmailQueueService } from '@communication/messaging/email/email-queue.service';
import { SESEmailService } from '@communication/messaging/email/ses-email.service';
import { ConfigModule } from '@config';
import { LoggingModule } from '@infrastructure/logging';
import { DatabaseModule } from '@infrastructure/database';
import { BullModule } from '@nestjs/bullmq';
import { EMAIL_QUEUE } from '@infrastructure/queue';

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
    // ConfigModule is @Global() - email config is already loaded in config.module.ts
    ConfigModule,
    LoggingModule,
    DatabaseModule, // Optional: For email delivery logging/audit trails
    // QueueModule is already imported globally via AppModule.forRoot()
    BullModule.registerQueue({
      name: EMAIL_QUEUE,
    }), // Register queue for @InjectQueue decorator
  ],
  controllers: [EmailController],
  providers: [EmailService, EmailTemplatesService, EmailQueueService, SESEmailService],
  exports: [EmailService, EmailTemplatesService, EmailQueueService, SESEmailService],
})
export class EmailModule {}
