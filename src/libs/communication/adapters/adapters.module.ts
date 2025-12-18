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
import { CommunicationConfigModule } from '../config/communication-config.module';

// Email adapters
import { SMTPEmailAdapter } from './email/smtp-email.adapter';
import { SESEmailAdapter } from './email/ses-email.adapter';
import { SendGridEmailAdapter } from './email/sendgrid-email.adapter';

// WhatsApp adapters
import { MetaWhatsAppAdapter } from './whatsapp/meta-whatsapp.adapter';
import { TwilioWhatsAppAdapter } from './whatsapp/twilio-whatsapp.adapter';

@Module({
  imports: [
    HttpModule, // Required for WhatsApp adapters
    forwardRef(() => LoggingModule),
    forwardRef(() => CommunicationConfigModule),
  ],
  providers: [
    // Factory
    ProviderFactory,
    // Email adapters (not singletons - created per clinic)
    SMTPEmailAdapter,
    SESEmailAdapter,
    SendGridEmailAdapter,
    // WhatsApp adapters (not singletons - created per clinic)
    MetaWhatsAppAdapter,
    TwilioWhatsAppAdapter,
  ],
  exports: [ProviderFactory],
})
export class CommunicationAdaptersModule {}
