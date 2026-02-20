import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@infrastructure/http';
// Use direct import to avoid circular dependency with barrel exports
import { ConfigModule } from '@config/config.module';
import { LoggingModule } from '@logging';

import { WhatsAppService } from '@communication/channels/whatsapp/whatsapp.service';
import { WhatsAppConfig } from '@communication/channels/whatsapp/whatsapp.config';
import { CommunicationAdaptersModule } from '@communication/adapters/adapters.module';
import { CommunicationConfigModule } from '@communication/config/communication-config.module';
import { WhatsAppWebhookModule } from '@communication/adapters/whatsapp/webhooks/whatsapp-webhook.module';
import { WhatsAppSuppressionService } from '@communication/adapters/whatsapp/whatsapp-suppression.service';

/**
 * WhatsApp Business API Module
 *
 * Provides WhatsApp messaging services with:
 * - WhatsApp Business API integration
 * - Template message support (OTP, appointment reminders, prescriptions)
 * - Document sending (prescriptions, invoices)
 * - HIPAA-compliant logging
 * - Webhook handlers for delivery status
 * - Suppression list management
 *
 * Architecture:
 * - WhatsAppService: Primary service for WhatsApp messaging
 * - WhatsAppConfig: Configuration service for WhatsApp API credentials
 * - DatabaseModule: Optional integration for message delivery logging
 */
@Module({
  imports: [
    forwardRef(() => ConfigModule),
    HttpModule, // HTTP client for WhatsApp API calls
    LoggingModule,

    forwardRef(() => CommunicationAdaptersModule), // Provider adapters
    forwardRef(() => CommunicationConfigModule), // Communication config service (includes ClinicTemplateService)
    WhatsAppWebhookModule, // Webhook handlers
  ],
  providers: [WhatsAppService, WhatsAppConfig, WhatsAppSuppressionService],
  exports: [WhatsAppService, WhatsAppConfig, WhatsAppSuppressionService],
})
export class WhatsAppModule {}
