/**
 * Meta WhatsApp Business API Adapter
 * ===================================
 * Meta (Facebook) WhatsApp Business API adapter
 * Implements WhatsAppProviderAdapter interface
 *
 * @module MetaWhatsAppAdapter
 * @description Meta WhatsApp adapter for multi-tenant communication
 */

import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { BaseWhatsAppAdapter } from '../base/base-whatsapp-adapter';
import type { WhatsAppOptions, WhatsAppResult } from '@communication/adapters/interfaces';
import type { ProviderConfig } from '@communication/config';

/**
 * Meta WhatsApp Business API Adapter
 * Handles WhatsApp messaging via Meta Business API
 */
@Injectable()
export class MetaWhatsAppAdapter extends BaseWhatsAppAdapter {
  private httpService: HttpService | null = null;
  private config: ProviderConfig | null = null;
  private apiUrl: string = '';
  private apiKey: string = '';
  private phoneNumberId: string = '';
  private businessAccountId: string = '';

  constructor(loggingService: LoggingService, httpService: HttpService) {
    super(loggingService);
    this.httpService = httpService;
  }

  /**
   * Initialize adapter with clinic-specific configuration
   */
  initialize(config: ProviderConfig): void {
    this.config = config;

    if (!config.credentials || typeof config.credentials !== 'object') {
      throw new Error('Meta WhatsApp credentials are required');
    }

    const credentials = config.credentials as Record<string, string>;
    this.apiUrl = credentials['apiUrl'] || 'https://graph.facebook.com/v18.0';
    this.apiKey = credentials['apiKey'] || credentials['accessToken'] || '';
    this.phoneNumberId = credentials['phoneNumberId'] || '';
    this.businessAccountId = credentials['businessAccountId'] || '';

    if (!this.apiKey || !this.phoneNumberId) {
      throw new Error('Meta WhatsApp API key and phoneNumberId are required');
    }
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'meta_business';
  }

  /**
   * Verify Meta WhatsApp connection
   */
  async verify(): Promise<boolean> {
    if (!this.httpService || !this.phoneNumberId) {
      return false;
    }

    try {
      // Verify by getting phone number info
      const response = await firstValueFrom(
        this.httpService.get(`${this.apiUrl}/${this.phoneNumberId}`, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          params: {
            fields: 'verified_name',
          },
        })
      );

      return response.status === 200;
    } catch (error) {
      await this.logger.log(
        LogType.NOTIFICATION,
        LogLevel.WARN,
        'Meta WhatsApp verification failed',
        'MetaWhatsAppAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  /**
   * Send WhatsApp message via Meta API
   */
  async send(options: WhatsAppOptions): Promise<WhatsAppResult> {
    if (!this.httpService || !this.phoneNumberId) {
      return this.createErrorResult('Meta WhatsApp adapter not initialized');
    }

    try {
      this.validateWhatsAppOptions(options);

      // Determine if this is a template or regular message
      const isTemplate = !!options.templateId;
      const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

      let payload: Record<string, unknown>;

      if (isTemplate) {
        // Template message
        payload = {
          messaging_product: 'whatsapp',
          to: options.to,
          type: 'template',
          template: {
            name: options.templateId,
            language: {
              code: options.language || 'en',
            },
            ...(options.templateParams && {
              components: [
                {
                  type: 'body',
                  parameters: Object.entries(options.templateParams).map(([_, value]) => ({
                    type: 'text',
                    text: String(value),
                  })),
                },
              ],
            }),
          },
        };
      } else {
        // Regular text message
        payload = {
          messaging_product: 'whatsapp',
          to: options.to,
          type: 'text',
          text: {
            body: options.message,
          },
        };
      }

      const response = await this.sendWithRetry(async () => {
        if (!this.httpService) {
          throw new Error('HTTP service not initialized');
        }
        return await firstValueFrom(
          this.httpService.post<{
            messages?: Array<{ id?: string }>;
            [key: string]: unknown;
          }>(url, payload, {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
          })
        );
      });

      const messageId = response.data?.messages?.[0]?.id;

      await this.logger.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        `Meta WhatsApp ${isTemplate ? 'template' : 'message'} sent successfully`,
        'MetaWhatsAppAdapter',
        {
          messageId,
          to: options.to,
          ...(isTemplate && { templateId: options.templateId }),
        }
      );

      return this.createSuccessResult(messageId);
    } catch (error) {
      await this.logger.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        `Failed to send Meta WhatsApp ${options.templateId ? 'template' : 'message'}`,
        'MetaWhatsAppAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          to: options.to,
          ...(options.templateId && { templateId: options.templateId }),
        }
      );

      return this.createErrorResult(error instanceof Error ? error : String(error));
    }
  }
}
