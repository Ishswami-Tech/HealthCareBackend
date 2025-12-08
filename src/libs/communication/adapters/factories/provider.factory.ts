/**
 * Provider Factory
 * =================
 * Factory for creating provider adapter instances
 * Follows Factory pattern for provider instantiation
 *
 * @module ProviderFactory
 * @description Provider adapter factory
 */

import { Injectable } from '@nestjs/common';
import { EmailProviderAdapter, WhatsAppProviderAdapter, SMSProviderAdapter } from '../interfaces';
import {
  CommunicationConfigService,
  EmailProvider,
  WhatsAppProvider,
  SMSProvider,
} from '../../config/communication-config.service';

/**
 * Provider Factory
 * Creates provider adapter instances based on configuration
 */
@Injectable()
export class ProviderFactory {
  constructor(private readonly configService: CommunicationConfigService) {}

  /**
   * Create email provider adapter
   */
  async createEmailProvider(
    clinicId: string,
    _provider: EmailProvider
  ): Promise<EmailProviderAdapter | null> {
    const config = await this.configService.getClinicConfig(clinicId);
    if (!config) {
      return null;
    }

    // Adapter implementations will be added when concrete adapters are created
    // Placeholder for: SMTPEmailAdapter, SESEmailAdapter, SendGridAdapter, etc.
    return null;
  }

  /**
   * Create WhatsApp provider adapter
   */
  async createWhatsAppProvider(
    clinicId: string,
    _provider: WhatsAppProvider
  ): Promise<WhatsAppProviderAdapter | null> {
    const config = await this.configService.getClinicConfig(clinicId);
    if (!config) {
      return null;
    }

    // Adapter implementations will be added when concrete adapters are created
    // Placeholder for: MetaBusinessAdapter, TwilioWhatsAppAdapter, MessageBirdWhatsAppAdapter, etc.
    return null;
  }

  /**
   * Create SMS provider adapter
   */
  async createSMSProvider(
    clinicId: string,
    _provider: SMSProvider
  ): Promise<SMSProviderAdapter | null> {
    const config = await this.configService.getClinicConfig(clinicId);
    if (!config) {
      return null;
    }

    // Adapter implementations will be added when concrete adapters are created
    // Placeholder for: TwilioSMSAdapter, AWSSNSAdapter, MessageBirdSMSAdapter, etc.
    return null;
  }
}
