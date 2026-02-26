import { Module, forwardRef } from '@nestjs/common';
import { EmailService } from '@communication/channels/email/email.service';
import { EmailTemplatesService } from '@communication/channels/email/email-templates.service';
import { EmailQueueService } from '@communication/channels/email/email-queue.service';
import { SESEmailService } from '@communication/channels/email/ses-email.service';
// Use direct import to avoid circular dependency with barrel exports
import { ConfigModule } from '@config/config.module';
import { HttpModule } from '@infrastructure/http';
// LoggingModule is @Global() - LoggingService is available without explicit import
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from '@infrastructure/queue';
import { CommunicationAdaptersModule } from '@communication/adapters/adapters.module';
import { CommunicationConfigModule } from '@communication/config/communication-config.module';
import { EmailServicesModule } from '@communication/adapters/email/email-services.module';

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
 */
@Module({
  imports: [
    // Use forwardRef to break circular dependency with ConfigModule
    forwardRef(() => ConfigModule),
    HttpModule, // Required for ZeptoMail direct API calls in EmailService
    forwardRef(() => CommunicationAdaptersModule),
    forwardRef(() => CommunicationConfigModule),
    forwardRef(() => EmailServicesModule),
    ...(isCacheEnabledSafe()
      ? [
          BullModule.registerQueue({
            name: QueueService.EMAIL_QUEUE,
          }),
        ]
      : []),
  ],

  controllers: [],
  providers: [EmailService, EmailTemplatesService, EmailQueueService, SESEmailService],
  exports: [EmailService, EmailTemplatesService, EmailQueueService, SESEmailService],
})
export class EmailModule {}
