/**
 * AWS SES Module
 * ==============
 * Module for AWS SES email provider services
 *
 * @module SESModule
 * @description AWS SES email provider module
 */

import { Module, forwardRef } from '@nestjs/common';
import { SESEmailAdapter } from './ses-email.adapter';
import { SESWebhookController } from './webhooks/ses-webhook.controller';
import { SESWebhookService } from './webhooks/ses-webhook.service';
import { EmailServicesModule } from '@communication/adapters/email/email-services.module';

@Module({
  imports: [
    forwardRef(() => EmailServicesModule), // For SuppressionListService and ClinicEmailMapperService
  ],
  controllers: [SESWebhookController],
  providers: [SESEmailAdapter, SESWebhookService],
  exports: [SESEmailAdapter, SESWebhookService],
})
export class SESModule {}
