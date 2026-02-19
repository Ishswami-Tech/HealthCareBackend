/**
 * Provider Factory
 * =================
 * Factory for creating provider adapter instances
 * Follows Factory pattern for provider instantiation
 *
 * @module ProviderFactory
 * @description Provider adapter factory
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { HttpService } from '@infrastructure/http';
import {
  EmailProviderAdapter,
  WhatsAppProviderAdapter,
  SMSProviderAdapter,
} from '@communication/adapters/interfaces';
import {
  CommunicationConfigService,
  EmailProvider,
  WhatsAppProvider,
  SMSProvider,
} from '@communication/config';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { SuppressionListService } from '@communication/adapters/email/suppression-list.service';

// Email adapters
import { SMTPEmailAdapter } from '@communication/adapters/email/smtp-email.adapter';
import { SESEmailAdapter } from '@communication/adapters/email/ses/ses-email.adapter';
import { ZeptoMailEmailAdapter } from '@communication/adapters/email/zeptomail/zeptomail-email.adapter';

// WhatsApp adapters
import { MetaWhatsAppAdapter } from '@communication/adapters/whatsapp/meta-whatsapp.adapter';
import { TwilioWhatsAppAdapter } from '@communication/adapters/whatsapp/twilio-whatsapp.adapter';

/**
 * Provider Factory
 * Creates provider adapter instances based on configuration
 */
@Injectable()
export class ProviderFactory {
  // Adapter instances cache (per clinic, per provider)
  private emailAdapterCache = new Map<string, EmailProviderAdapter>();
  private whatsappAdapterCache = new Map<string, WhatsAppProviderAdapter>();
  private smsAdapterCache = new Map<string, SMSProviderAdapter>();

  constructor(
    private readonly configService: CommunicationConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => HttpService))
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => SuppressionListService))
    private readonly suppressionListService: SuppressionListService
  ) {}

  /**
   * Create email provider adapter with fallback
   */
  async createEmailProvider(
    clinicId: string,
    provider?: EmailProvider
  ): Promise<EmailProviderAdapter | null> {
    const config = await this.configService.getClinicConfig(clinicId);
    if (!config || !config.email.primary) {
      return null;
    }

    const providerType = provider || (config.email.primary.provider as EmailProvider);
    const cacheKey = `${clinicId}:${providerType}`;

    // Check cache
    if (this.emailAdapterCache.has(cacheKey)) {
      return this.emailAdapterCache.get(cacheKey)!;
    }

    let adapter: EmailProviderAdapter | null;

    try {
      switch (providerType) {
        case EmailProvider.SMTP:
          adapter = new SMTPEmailAdapter(this.loggingService, this.suppressionListService);
          (adapter as SMTPEmailAdapter).initialize(config.email.primary, clinicId);
          break;

        case EmailProvider.AWS_SES:
          adapter = new SESEmailAdapter(this.loggingService, this.suppressionListService);
          (adapter as SESEmailAdapter).initialize(config.email.primary, clinicId);
          break;

        case EmailProvider.ZEPTOMAIL:
          adapter = new ZeptoMailEmailAdapter(
            this.loggingService,
            this.httpService,
            this.suppressionListService
          );
          (adapter as ZeptoMailEmailAdapter).initialize(config.email.primary, clinicId);
          break;

        default:
          await this.loggingService.log(
            LogType.EMAIL,
            LogLevel.WARN,
            `Unsupported email provider: ${providerType}`,
            'ProviderFactory',
            { clinicId, provider: providerType }
          );
          return null;
      }

      if (adapter) {
        this.emailAdapterCache.set(cacheKey, adapter);
      }

      return adapter;
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        `Failed to create email provider adapter: ${error instanceof Error ? error.message : String(error)}`,
        'ProviderFactory',
        {
          clinicId,
          provider: providerType,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return null;
    }
  }

  /**
   * Create email provider adapter with fallback
   */
  async getEmailProviderWithFallback(clinicId: string): Promise<EmailProviderAdapter | null> {
    const config = await this.configService.getClinicConfig(clinicId);
    if (!config || !config.email.primary) {
      return null;
    }

    // Try primary provider
    let adapter = await this.createEmailProvider(
      clinicId,
      config.email.primary.provider as EmailProvider
    );

    if (adapter) {
      const healthStatus = await adapter.getHealthStatus();
      if (healthStatus.healthy) {
        return adapter;
      }
    }

    // Try fallback providers
    if (config.email.fallback && config.email.fallback.length > 0) {
      for (const fallbackConfig of config.email.fallback) {
        adapter = await this.createEmailProvider(
          clinicId,
          fallbackConfig.provider as EmailProvider
        );
        if (adapter) {
          const healthStatus = await adapter.getHealthStatus();
          if (healthStatus.healthy) {
            await this.loggingService.log(
              LogType.EMAIL,
              LogLevel.WARN,
              `Using fallback email provider: ${fallbackConfig.provider}`,
              'ProviderFactory',
              {
                clinicId,
                primaryProvider: config.email.primary.provider,
                fallbackProvider: fallbackConfig.provider,
              }
            );
            return adapter;
          }
        }
      }
    }

    return adapter; // Return primary even if unhealthy (let caller handle)
  }

  /**
   * Create WhatsApp provider adapter
   */
  async createWhatsAppProvider(
    clinicId: string,
    provider?: WhatsAppProvider
  ): Promise<WhatsAppProviderAdapter | null> {
    const config = await this.configService.getClinicConfig(clinicId);
    if (!config || !config.whatsapp.primary) {
      return null;
    }

    const providerType = provider || (config.whatsapp.primary.provider as WhatsAppProvider);
    const cacheKey = `${clinicId}:${providerType}`;

    // Check cache
    if (this.whatsappAdapterCache.has(cacheKey)) {
      return this.whatsappAdapterCache.get(cacheKey)!;
    }

    let adapter: WhatsAppProviderAdapter | null;

    try {
      switch (providerType) {
        case WhatsAppProvider.META_BUSINESS:
          adapter = new MetaWhatsAppAdapter(this.loggingService, this.httpService);
          (adapter as MetaWhatsAppAdapter).initialize(config.whatsapp.primary);
          break;

        case WhatsAppProvider.TWILIO:
          adapter = new TwilioWhatsAppAdapter(this.loggingService, this.httpService);
          (adapter as TwilioWhatsAppAdapter).initialize(config.whatsapp.primary);
          break;

        default:
          await this.loggingService.log(
            LogType.NOTIFICATION,
            LogLevel.WARN,
            `Unsupported WhatsApp provider: ${providerType}`,
            'ProviderFactory',
            { clinicId, provider: providerType }
          );
          return null;
      }

      if (adapter) {
        this.whatsappAdapterCache.set(cacheKey, adapter);
      }

      return adapter;
    } catch (error) {
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        `Failed to create WhatsApp provider adapter: ${error instanceof Error ? error.message : String(error)}`,
        'ProviderFactory',
        {
          clinicId,
          provider: providerType,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return null;
    }
  }

  /**
   * Create WhatsApp provider adapter with fallback
   */
  async getWhatsAppProviderWithFallback(clinicId: string): Promise<WhatsAppProviderAdapter | null> {
    const config = await this.configService.getClinicConfig(clinicId);
    if (!config || !config.whatsapp.primary) {
      return null;
    }

    // Try primary provider
    let adapter = await this.createWhatsAppProvider(
      clinicId,
      config.whatsapp.primary.provider as WhatsAppProvider
    );

    if (adapter) {
      const healthStatus = await adapter.getHealthStatus();
      if (healthStatus.healthy) {
        return adapter;
      }
    }

    // Try fallback providers
    if (config.whatsapp.fallback && config.whatsapp.fallback.length > 0) {
      for (const fallbackConfig of config.whatsapp.fallback) {
        adapter = await this.createWhatsAppProvider(
          clinicId,
          fallbackConfig.provider as WhatsAppProvider
        );
        if (adapter) {
          const healthStatus = await adapter.getHealthStatus();
          if (healthStatus.healthy) {
            await this.loggingService.log(
              LogType.NOTIFICATION,
              LogLevel.WARN,
              `Using fallback WhatsApp provider: ${fallbackConfig.provider}`,
              'ProviderFactory',
              {
                clinicId,
                primaryProvider: config.whatsapp.primary.provider,
                fallbackProvider: fallbackConfig.provider,
              }
            );
            return adapter;
          }
        }
      }
    }

    return adapter; // Return primary even if unhealthy (let caller handle)
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

    // SMS adapters to be implemented
    return null;
  }

  /**
   * Clear adapter cache for a clinic (useful when config changes)
   */
  clearCache(clinicId: string): void {
    // Clear email adapters
    for (const key of this.emailAdapterCache.keys()) {
      if (key.startsWith(`${clinicId}:`)) {
        this.emailAdapterCache.delete(key);
      }
    }

    // Clear WhatsApp adapters
    for (const key of this.whatsappAdapterCache.keys()) {
      if (key.startsWith(`${clinicId}:`)) {
        this.whatsappAdapterCache.delete(key);
      }
    }

    // Clear SMS adapters
    for (const key of this.smsAdapterCache.keys()) {
      if (key.startsWith(`${clinicId}:`)) {
        this.smsAdapterCache.delete(key);
      }
    }
  }
}
