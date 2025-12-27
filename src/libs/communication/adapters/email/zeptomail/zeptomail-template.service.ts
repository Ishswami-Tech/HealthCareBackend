/**
 * ZeptoMail Template Service
 * ===========================
 * Handles ZeptoMail template-based email sending
 * @see https://www.zoho.com/zeptomail/help/api/email-templates.html
 *
 * @module ZeptoMailTemplateService
 * @description ZeptoMail template email sending service
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { HttpService } from '@infrastructure/http';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { SuppressionListService } from '@communication/adapters/email/suppression-list.service';

export interface TemplateEmailOptions {
  to: string | string[];
  templateKey: string;
  templateData?: Record<string, unknown>;
  from?: string;
  fromName?: string;
  subject?: string; // Optional, can be set in template
  clinicId?: string;
}

export interface TemplateEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface ZeptoMailTemplateRequest {
  from: {
    address: string;
    name?: string;
  };
  to: Array<{
    email_address: {
      address: string;
      name?: string;
    };
  }>;
  template_key: string;
  template_data?: Record<string, unknown>;
  subject?: string;
  bounce_address?: string;
  track_opens?: boolean;
  track_clicks?: boolean;
}

@Injectable()
export class ZeptoMailTemplateService {
  private readonly apiBaseUrl = 'https://api.zeptomail.com/v1.1';
  private sendMailToken: string = '';
  private fromEmail: string = '';
  private fromName: string = '';
  private bounceAddress: string = '';

  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => HttpService))
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => SuppressionListService))
    private readonly suppressionListService: SuppressionListService
  ) {}

  /**
   * Initialize with credentials
   */
  initialize(
    sendMailToken: string,
    fromEmail: string,
    fromName?: string,
    bounceAddress?: string
  ): void {
    this.sendMailToken = sendMailToken;
    this.fromEmail = fromEmail;
    this.fromName = fromName || '';
    this.bounceAddress = bounceAddress || '';
  }

  /**
   * Send email using ZeptoMail template
   */
  async sendTemplateEmail(options: TemplateEmailOptions): Promise<TemplateEmailResult> {
    if (!this.sendMailToken || !this.fromEmail) {
      return {
        success: false,
        error: 'ZeptoMail template service not initialized',
      };
    }

    try {
      const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

      // Check suppression list
      const suppressedEmails: string[] = [];
      const allowedEmails: string[] = [];

      for (const email of toAddresses) {
        const isSuppressed = await this.suppressionListService.isSuppressed(
          email,
          options.clinicId
        );
        if (isSuppressed) {
          suppressedEmails.push(email);
        } else {
          allowedEmails.push(email);
        }
      }

      if (allowedEmails.length === 0) {
        return {
          success: false,
          error: `All recipient emails are suppressed: ${suppressedEmails.join(', ')}`,
        };
      }

      // Build template request payload
      const payload: ZeptoMailTemplateRequest = {
        from: {
          address: options.from || this.fromEmail,
          ...(this.fromName || options.fromName
            ? { name: this.fromName || options.fromName || '' }
            : {}),
        },
        to: allowedEmails.map(email => ({
          email_address: {
            address: email,
          },
        })),
        template_key: options.templateKey,
        ...(options.templateData && { template_data: options.templateData }),
        ...(options.subject && { subject: options.subject }),
        ...(this.bounceAddress && { bounce_address: this.bounceAddress }),
        track_opens: true,
        track_clicks: true,
      };

      const response = await this.httpService.post<{
        data?: { message_id?: string; [key: string]: unknown };
        error?: { code?: string; message?: string };
      }>(`${this.apiBaseUrl}/email/template`, payload, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Zoho-enczapikey ${this.sendMailToken}`,
          'User-Agent': 'HealthcareApp/1.0',
        },
        timeout: 30000,
      });

      if (response.data?.error) {
        const errorMessage = response.data.error.message || 'ZeptoMail template API error';
        await this.loggingService.log(
          LogType.EMAIL,
          LogLevel.ERROR,
          `ZeptoMail template email failed: ${errorMessage}`,
          'ZeptoMailTemplateService',
          {
            templateKey: options.templateKey,
            to: options.to,
            errorCode: response.data.error.code,
          }
        );

        return {
          success: false,
          error: errorMessage,
        };
      }

      const messageId = response.data?.data?.message_id;

      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.INFO,
        'ZeptoMail template email sent successfully',
        'ZeptoMailTemplateService',
        {
          messageId,
          templateKey: options.templateKey,
          to: options.to,
        }
      );

      const result: TemplateEmailResult = { success: true };
      if (messageId) {
        result.messageId = String(messageId);
      }
      return result;
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to send ZeptoMail template email',
        'ZeptoMailTemplateService',
        {
          error: error instanceof Error ? error.message : String(error),
          templateKey: options.templateKey,
          to: options.to,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send batch template emails
   */
  async sendBatchTemplateEmails(emails: Array<TemplateEmailOptions & { to: string }>): Promise<{
    success: boolean;
    totalSent: number;
    totalFailed: number;
    messageIds: string[];
    errors: Array<{ email: string; error: string }>;
  }> {
    // Use batch template API if available, otherwise send individually
    const results = {
      success: true,
      totalSent: 0,
      totalFailed: 0,
      messageIds: [] as string[],
      errors: [] as Array<{ email: string; error: string }>,
    };

    for (const email of emails) {
      const result = await this.sendTemplateEmail(email);
      if (result.success) {
        results.totalSent++;
        if (result.messageId) {
          results.messageIds.push(result.messageId);
        }
      } else {
        results.totalFailed++;
        const toAddr = Array.isArray(email.to) ? email.to[0] : email.to;
        results.errors.push({
          email: toAddr || 'unknown',
          error: result.error || 'Unknown error',
        });
      }
    }

    results.success = results.totalFailed === 0;
    return results;
  }
}
