/**
 * WhatsApp Webhook Module
 * =======================
 * Module for WhatsApp webhook handlers
 *
 * @module WhatsAppWebhookModule
 * @description WhatsApp webhook module
 */

import { Module } from '@nestjs/common';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
// LoggingModule, DatabaseModule are @Global()

@Module({
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppWebhookService],
  exports: [WhatsAppWebhookService],
})
export class WhatsAppWebhookModule {}
