import { Module } from '@nestjs/common';
import { ConfigModule } from '@config';
import { LoggingModule } from '@infrastructure/logging';
import { DatabaseModule } from '@infrastructure/database';
import { WhatsAppService } from '@communication/channels/whatsapp/whatsapp.service';
import { WhatsAppConfig } from '@communication/channels/whatsapp/whatsapp.config';

/**
 * WhatsApp Business API Module
 *
 * Provides WhatsApp messaging services with:
 * - WhatsApp Business API integration
 * - Template message support (OTP, appointment reminders, prescriptions)
 * - Document sending (prescriptions, invoices)
 * - HIPAA-compliant logging
 *
 * Architecture:
 * - WhatsAppService: Primary service for WhatsApp messaging
 * - WhatsAppConfig: Configuration service for WhatsApp API credentials
 * - DatabaseModule: Optional integration for message delivery logging
 */
@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    DatabaseModule, // Optional: For message delivery logging/audit trails
  ],
  providers: [WhatsAppService, WhatsAppConfig],
  exports: [WhatsAppService, WhatsAppConfig],
})
export class WhatsAppModule {}
