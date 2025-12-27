/**
 * Twilio WhatsApp Adapter
 * =======================
 * Twilio WhatsApp provider adapter
 * Implements WhatsAppProviderAdapter interface
 *
 * @module TwilioWhatsAppAdapter
 * @description Twilio WhatsApp adapter for multi-tenant communication
 */

import { Injectable } from '@nestjs/common';
import { HttpService } from '@infrastructure/http';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { BaseWhatsAppAdapter } from '@communication/adapters/base/base-whatsapp-adapter';
import type { WhatsAppOptions, WhatsAppResult } from '@communication/adapters/interfaces';
import type { ProviderConfig } from '@communication/config';

/**
 * Twilio WhatsApp Adapter
 * Handles WhatsApp messaging via Twilio API
 */
@Injectable()
export class TwilioWhatsAppAdapter extends BaseWhatsAppAdapter {
  private httpService: HttpService | null = null;
  private config: ProviderConfig | null = null;
  private accountSid: string = '';
  private authToken: string = '';
  private fromNumber: string = '';

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
      throw new Error('Twilio WhatsApp credentials are required');
    }

    const credentials = config.credentials as Record<string, string>;
    this.accountSid = credentials['accountSid'] || '';
    this.authToken = credentials['authToken'] || '';
    this.fromNumber = credentials['fromNumber'] || '';

    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      throw new Error('Twilio WhatsApp accountSid, authToken, and fromNumber are required');
    }
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'twilio';
  }

  /**
   * Verify Twilio connection
   */
  async verify(): Promise<boolean> {
    if (!this.httpService || !this.accountSid) {
      return false;
    }

    try {
      // Verify by getting account info
      const response = await this.httpService.get(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}.json`,
        {
          auth: {
            username: this.accountSid,
            password: this.authToken,
          },
        }
      );

      return response.status === 200;
    } catch (error) {
      await this.logger.log(
        LogType.NOTIFICATION,
        LogLevel.WARN,
        'Twilio WhatsApp verification failed',
        'TwilioWhatsAppAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  /**
   * Send WhatsApp message via Twilio
   */
  async send(options: WhatsAppOptions): Promise<WhatsAppResult> {
    if (!this.httpService || !this.accountSid) {
      return this.createErrorResult('Twilio WhatsApp adapter not initialized');
    }

    try {
      this.validateWhatsAppOptions(options);

      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

      const formData = new URLSearchParams();
      formData.append('From', this.fromNumber);
      formData.append('To', options.to);

      if (options.templateId) {
        // Template message (Twilio uses ContentSid for templates)
        formData.append('ContentSid', options.templateId);
        if (options.templateParams) {
          Object.entries(options.templateParams).forEach(([key, value]) => {
            formData.append(`ContentVariables[${key}]`, String(value));
          });
        }
      } else {
        // Regular text message
        if (!options.message) {
          throw new Error('Message content is required for non-template messages');
        }
        formData.append('Body', options.message);
      }

      const response = await this.sendWithRetry(async () => {
        if (!this.httpService) {
          throw new Error('HTTP service not initialized');
        }
        return await this.httpService.post<{ sid?: string }>(url, formData.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          auth: {
            username: this.accountSid,
            password: this.authToken,
          },
        });
      });

      const responseData = response.data;
      const messageId: string | undefined =
        responseData && typeof responseData === 'object' && 'sid' in responseData
          ? responseData.sid
          : undefined;

      await this.logger.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        'Twilio WhatsApp message sent successfully',
        'TwilioWhatsAppAdapter',
        {
          messageId,
          to: options.to,
        }
      );

      return this.createSuccessResult(messageId);
    } catch (error) {
      await this.logger.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        'Failed to send Twilio WhatsApp message',
        'TwilioWhatsAppAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          to: options.to,
        }
      );

      return this.createErrorResult(error instanceof Error ? error : String(error));
    }
  }
}
