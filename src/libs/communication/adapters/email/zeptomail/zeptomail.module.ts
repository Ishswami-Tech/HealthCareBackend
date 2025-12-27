/**
 * ZeptoMail Module
 * ================
 * Module for ZeptoMail email provider services
 *
 * @module ZeptoMailModule
 * @description ZeptoMail email provider module
 */

import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@infrastructure/http';
import { ZeptoMailEmailAdapter } from './zeptomail-email.adapter';
import { ZeptoMailBatchService } from './zeptomail-batch.service';
import { ZeptoMailTemplateService } from './zeptomail-template.service';
import { ZeptoMailFileCacheService } from './zeptomail-file-cache.service';
import { ZeptoMailSuppressionSyncService } from './zeptomail-suppression-sync.service';
import { ZeptoMailWebhookController } from './webhooks/zeptomail-webhook.controller';
import { ZeptoMailWebhookService } from './webhooks/zeptomail-webhook.service';
import { EmailServicesModule } from '@communication/adapters/email/email-services.module';

@Module({
  imports: [
    HttpModule,
    forwardRef(() => EmailServicesModule), // For SuppressionListService
  ],
  controllers: [ZeptoMailWebhookController],
  providers: [
    ZeptoMailEmailAdapter,
    ZeptoMailBatchService,
    ZeptoMailTemplateService,
    ZeptoMailFileCacheService,
    ZeptoMailSuppressionSyncService,
    ZeptoMailWebhookService,
  ],
  exports: [
    ZeptoMailEmailAdapter,
    ZeptoMailBatchService,
    ZeptoMailTemplateService,
    ZeptoMailFileCacheService,
    ZeptoMailSuppressionSyncService,
    ZeptoMailWebhookService,
  ],
})
export class ZeptoMailModule {}
