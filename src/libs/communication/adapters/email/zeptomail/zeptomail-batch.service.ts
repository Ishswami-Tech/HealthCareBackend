/**
 * ZeptoMail Batch Email Service
 * =============================
 * Handles batch email sending via ZeptoMail Batch API
 * @see https://www.zoho.com/zeptomail/help/email-management-api.html
 *
 * @module ZeptoMailBatchService
 * @description ZeptoMail batch email sending service
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { HttpService } from '@infrastructure/http';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { SuppressionListService } from '@communication/adapters/email/suppression-list.service';
import type { EmailOptions } from '@communication/adapters/interfaces';

export interface BatchEmailResult {
  success: boolean;
  totalSent: number;
  totalFailed: number;
  messageIds: string[];
  errors: Array<{ email: string; error: string }>;
}

interface ZeptoMailBatchRequest {
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
  subject: string;
  htmlbody?: string;
  textbody?: string;
  bounce_address?: string;
  track_opens?: boolean;
  track_clicks?: boolean;
}

@Injectable()
export class ZeptoMailBatchService {
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
   * Send batch emails via ZeptoMail Batch API
   * @param emails - Array of email options
   * @param clinicId - Optional clinic ID for suppression list checking
   * @returns Batch sending result
   */
  async sendBatch(
    emails: Array<EmailOptions & { to: string }>, // Batch API requires single 'to' per email
    clinicId?: string
  ): Promise<BatchEmailResult> {
    if (!this.sendMailToken || !this.fromEmail) {
      return {
        success: false,
        totalSent: 0,
        totalFailed: emails.length,
        messageIds: [],
        errors: emails.map(e => {
          const addr = Array.isArray(e.to) ? e.to[0] : e.to;
          return {
            email: addr || 'unknown',
            error: 'ZeptoMail batch service not initialized',
          };
        }),
      };
    }

    const results: BatchEmailResult = {
      success: true,
      totalSent: 0,
      totalFailed: 0,
      messageIds: [],
      errors: [],
    };

    // Process emails in batches (ZeptoMail batch API limit)
    const batchSize = 100; // ZeptoMail batch API typically supports up to 100 emails per request
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      const batchResult = await this.sendBatchChunk(batch, clinicId);

      results.totalSent += batchResult.totalSent;
      results.totalFailed += batchResult.totalFailed;
      results.messageIds.push(...batchResult.messageIds);
      results.errors.push(...batchResult.errors);
    }

    results.success = results.totalFailed === 0;

    await this.loggingService.log(
      LogType.EMAIL,
      results.success ? LogLevel.INFO : LogLevel.WARN,
      `ZeptoMail batch email send completed`,
      'ZeptoMailBatchService',
      {
        totalSent: results.totalSent,
        totalFailed: results.totalFailed,
        totalEmails: emails.length,
      }
    );

    return results;
  }

  /**
   * Send a chunk of emails (up to batchSize)
   */
  private async sendBatchChunk(
    emails: Array<EmailOptions & { to: string }>,
    clinicId?: string
  ): Promise<BatchEmailResult> {
    const results: BatchEmailResult = {
      success: true,
      totalSent: 0,
      totalFailed: 0,
      messageIds: [],
      errors: [],
    };

    // Filter suppressed emails
    const allowedEmails: Array<EmailOptions & { to: string }> = [];

    for (const email of emails) {
      const toAddr = Array.isArray(email.to) ? email.to[0] : email.to;
      const emailAddress = toAddr || '';
      const isSuppressed = await this.suppressionListService.isSuppressed(emailAddress, clinicId);

      if (isSuppressed) {
        results.totalFailed++;
        results.errors.push({
          email: emailAddress || 'unknown',
          error: 'Email address is suppressed',
        });
      } else {
        allowedEmails.push(email);
      }
    }

    if (allowedEmails.length === 0) {
      return results;
    }

    // Build batch request payload
    const batchPayload: ZeptoMailBatchRequest[] = allowedEmails.map(email => {
      const toAddr = Array.isArray(email.to) ? email.to[0] : email.to;
      const emailAddress = toAddr || '';
      return {
        from: {
          address: email.from || this.fromEmail,
          ...(this.fromName || email.fromName
            ? { name: this.fromName || email.fromName || '' }
            : {}),
        },
        to: [
          {
            email_address: {
              address: emailAddress,
            },
          },
        ],
        subject: email.subject,
        ...(email.html !== false ? { htmlbody: email.body } : { textbody: email.body }),
        ...(this.bounceAddress && { bounce_address: this.bounceAddress }),
        track_opens: true,
        track_clicks: true,
      };
    });

    try {
      const response = await this.httpService.post<{
        data?: Array<{ message_id?: string; [key: string]: unknown }>;
        error?: { code?: string; message?: string };
      }>(`${this.apiBaseUrl}/email/batch`, batchPayload, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Zoho-enczapikey ${this.sendMailToken}`,
          'User-Agent': 'HealthcareApp/1.0',
        },
        timeout: 60000, // 60 seconds for batch requests
      });

      if (response.data?.error) {
        // Batch failed entirely
        results.success = false;
        results.totalFailed = allowedEmails.length;
        results.errors.push(
          ...allowedEmails.map(e => {
            const addr = Array.isArray(e.to) ? e.to[0] : e.to;
            return {
              email: addr || 'unknown',
              error: response.data.error?.message || 'Batch send failed',
            };
          })
        );
        return results;
      }

      // Process individual results
      const responseData = response.data?.data || [];
      for (let i = 0; i < allowedEmails.length; i++) {
        const email = allowedEmails[i];
        if (!email) continue;
        const emailAddr = Array.isArray(email.to) ? email.to[0] : email.to;
        const emailAddress = emailAddr || 'unknown';
        const result = responseData[i];

        if (result && 'message_id' in result && result.message_id) {
          results.totalSent++;
          results.messageIds.push(String(result.message_id));
        } else {
          results.totalFailed++;
          results.errors.push({
            email: emailAddress,
            error: 'No message ID returned',
          });
        }
      }

      return results;
    } catch (error) {
      // Batch request failed
      results.success = false;
      results.totalFailed = allowedEmails.length;
      results.errors.push(
        ...allowedEmails.map(e => {
          const addr = Array.isArray(e.to) ? e.to[0] : e.to;
          return {
            email: addr || 'unknown',
            error: error instanceof Error ? error.message : String(error),
          };
        })
      );

      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'ZeptoMail batch email send failed',
        'ZeptoMailBatchService',
        {
          error: error instanceof Error ? error.message : String(error),
          batchSize: allowedEmails.length,
        }
      );

      return results;
    }
  }
}
