/**
 * Email Services Module
 * =====================
 * Module for email-related services (suppression list, unsubscribe, webhooks)
 *
 * @module EmailServicesModule
 * @description Email services module
 */

import { Module, forwardRef } from '@nestjs/common';
import { SuppressionListService } from './suppression-list.service';
import { EmailUnsubscribeService } from './email-unsubscribe.service';
import { EmailUnsubscribeController } from './email-unsubscribe.controller';
import { SESWebhookController, SESWebhookService } from './ses';
import { EmailRateMonitoringService } from './rate-monitoring.service';
import { ClinicEmailMapperService } from './clinic-email-mapper.service';
import { CommunicationResilienceService } from './communication-resilience.service';
import {
  ZeptoMailWebhookController,
  ZeptoMailWebhookService,
  ZeptoMailFileCacheService,
  ZeptoMailBatchService,
  ZeptoMailTemplateService,
  ZeptoMailSuppressionSyncService,
} from './zeptomail';
import { ConfigModule } from '@config/config.module';
import { CommunicationConfigModule } from '@communication/config/communication-config.module';
import { ResilienceModule } from '@core/resilience';
// LoggingModule, DatabaseModule, CacheModule are @Global()
// Note: CommunicationModule is NOT imported here to avoid circular dependency
// CommunicationService is injected via forwardRef in EmailRateMonitoringService

@Module({
  imports: [
    forwardRef(() => ConfigModule),
    forwardRef(() => CommunicationConfigModule),
    forwardRef(() => ResilienceModule),
  ],
  controllers: [EmailUnsubscribeController, SESWebhookController, ZeptoMailWebhookController],
  providers: [
    SuppressionListService,
    EmailUnsubscribeService,
    SESWebhookService,
    ZeptoMailWebhookService,
    EmailRateMonitoringService,
    ClinicEmailMapperService,
    CommunicationResilienceService,
    ZeptoMailFileCacheService,
    ZeptoMailBatchService,
    ZeptoMailTemplateService,
    ZeptoMailSuppressionSyncService,
  ],
  exports: [
    SuppressionListService,
    EmailUnsubscribeService,
    SESWebhookService,
    ZeptoMailWebhookService,
    EmailRateMonitoringService,
    ClinicEmailMapperService,
    CommunicationResilienceService,
    ZeptoMailFileCacheService,
    ZeptoMailBatchService,
    ZeptoMailTemplateService,
    ZeptoMailSuppressionSyncService,
  ],
})
export class EmailServicesModule {}
