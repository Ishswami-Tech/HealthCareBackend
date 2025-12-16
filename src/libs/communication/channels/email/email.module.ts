import { Module, forwardRef } from '@nestjs/common';
import { EmailService } from '@communication/channels/email/email.service';
import { EmailController } from '@communication/channels/email/email.controller';
import { EmailTemplatesService } from '@communication/channels/email/email-templates.service';
import { EmailQueueService } from '@communication/channels/email/email-queue.service';
import { SESEmailService } from '@communication/channels/email/ses-email.service';
// Use direct import to avoid circular dependency with barrel exports
import { ConfigModule } from '@config/config.module';
// LoggingModule is @Global() - LoggingService is available without explicit import
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from '@infrastructure/queue';
import { CommunicationAdaptersModule } from '@communication/adapters/adapters.module';
import { CommunicationConfigModule } from '@communication/config/communication-config.module';

/**
 * Safely check if cache is enabled
 * Uses environment variable directly to avoid module loading issues
 */
function isCacheEnabledSafe(): boolean {
  try {
    const cacheEnabled = process.env['CACHE_ENABLED'];
    return cacheEnabled?.toLowerCase() === 'true';
  } catch {
    return false;
  }
}

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
    // Use forwardRef to break circular dependency with ConfigModule
    forwardRef(() => ConfigModule),
    // LoggingModule is @Global() - LoggingService is available without explicit import
    // DatabaseModule is @Global() - DatabaseService is available without explicit import
    forwardRef(() => CommunicationAdaptersModule), // Provider adapters
    forwardRef(() => CommunicationConfigModule), // Communication config service
    // QueueModule is already imported globally via AppModule.forRoot()
    // Only register queue if cache is enabled (Bull requires Redis/Dragonfly)
    // Use direct environment variable check to avoid module loading issues
    ...(isCacheEnabledSafe()
      ? [
          BullModule.registerQueue({
            name: QueueService.EMAIL_QUEUE,
          }), // Register queue for @InjectQueue decorator
        ]
      : []),
  ],
  controllers: [EmailController],
  providers: [EmailService, EmailTemplatesService, EmailQueueService, SESEmailService],
  exports: [EmailService, EmailTemplatesService, EmailQueueService, SESEmailService],
})
export class EmailModule {}
