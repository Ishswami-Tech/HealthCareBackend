/**
 * Communication Adapters Module
 * ==============================
 * Module for registering communication provider adapters
 *
 * @module CommunicationAdaptersModule
 * @description Module for provider adapters
 */

import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@infrastructure/http';
import { LoggingModule } from '@logging';
import { ProviderFactory } from './factories/provider.factory';
import { CommunicationConfigModule } from '@communication/config/communication-config.module';
import { EmailServicesModule } from '@communication/adapters/email/email-services.module';

// Email adapters
import { SMTPEmailAdapter } from '@communication/adapters/email/smtp-email.adapter';
import { SESEmailAdapter } from '@communication/adapters/email/ses/ses-email.adapter';
import { ZeptoMailEmailAdapter } from '@communication/adapters/email/zeptomail/zeptomail-email.adapter';

// WhatsApp adapters
import { MetaWhatsAppAdapter } from '@communication/adapters/whatsapp/meta-whatsapp.adapter';
import { TwilioWhatsAppAdapter } from '@communication/adapters/whatsapp/twilio-whatsapp.adapter';

@Module({
  imports: [
    HttpModule, // Required for WhatsApp adapters
    forwardRef(() => LoggingModule),
    forwardRef(() => CommunicationConfigModule),
    forwardRef(() => EmailServicesModule), // Email services (suppression list, unsubscribe)
  ],
  providers: [
    // Factory
    ProviderFactory,
    // Email adapters (not singletons - created per clinic)
    SMTPEmailAdapter,
    SESEmailAdapter,
    ZeptoMailEmailAdapter,
    // WhatsApp adapters (not singletons - created per clinic)
    MetaWhatsAppAdapter,
    TwilioWhatsAppAdapter,
  ],
  exports: [ProviderFactory],
})
export class CommunicationAdaptersModule {}
