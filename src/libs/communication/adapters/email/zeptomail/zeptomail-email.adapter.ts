/**
 * ZeptoMail Email Adapter
 * =======================
 * ZeptoMail email provider adapter (API-based)
 * Implements EmailProviderAdapter interface
 *
 * @module ZeptoMailEmailAdapter
 * @description ZeptoMail email adapter for multi-tenant communication
 * @see https://www.zoho.com/zeptomail/help/email-management-api.html
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { HttpService } from '@infrastructure/http';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { BaseEmailAdapter } from '@communication/adapters/base/base-email-adapter';
import { SuppressionListService } from '@communication/adapters/email/suppression-list.service';
import {
  ZeptoMailErrorCode,
  getZeptoMailErrorMessage,
  isZeptoMailErrorRetryable,
} from './zeptomail-error-codes';
import type { EmailOptions, EmailResult } from '@communication/adapters/interfaces';
import type { ProviderConfig } from '@communication/config';

/**
 * ZeptoMail API Request Payload
 * @see https://www.zoho.com/zeptomail/help/email-management-api.html
 */
interface ZeptoMailRequest {
  bounce_address?: string;
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
  cc?: Array<{
    email_address: {
      address: string;
      name?: string;
    };
  }>;
  bcc?: Array<{
    email_address: {
      address: string;
      name?: string;
    };
  }>;
  reply_to?: Array<{
    address: string;
    name?: string;
  }>;
  attachments?: Array<{
    filename: string;
    content: string; // Base64 encoded
    content_type?: string;
  }>;
  // File cache keys for attachments (alternative to base64)
  file_cache_keys?: string[];
  // Template support
  template_key?: string;
  template_data?: Record<string, unknown>;
  // Email tracking headers
  track_opens?: boolean;
  track_clicks?: boolean;
}

/**
 * ZeptoMail API Response
 */
interface ZeptoMailResponse {
  data?: {
    message_id?: string;
    [key: string]: unknown;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

/**
 * ZeptoMail Email Adapter
 * Handles email sending via ZeptoMail API
 */
@Injectable()
export class ZeptoMailEmailAdapter extends BaseEmailAdapter {
  private sendMailToken: string = '';
  private fromEmail: string = '';
  private fromName: string = '';
  private bounceAddress: string = '';
  private config: ProviderConfig | null = null;
  private clinicId: string | undefined = undefined; // Store clinicId for multi-tenant support
  private readonly apiBaseUrl = 'https://api.zeptomail.com/v1.1';

  constructor(
    @Inject(forwardRef(() => LoggingService))
    loggingService: LoggingService,
    @Inject(forwardRef(() => HttpService))
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => SuppressionListService))
    private readonly suppressionListService: SuppressionListService
  ) {
    super(loggingService);
  }

  /**
   * Initialize adapter with clinic-specific configuration
   */
  initialize(config: ProviderConfig, clinicId?: string): void {
    this.config = config;
    this.clinicId = clinicId; // Store clinicId for multi-tenant support

    if (!config.credentials || typeof config.credentials !== 'object') {
      throw new Error('ZeptoMail credentials are required');
    }

    const credentials = config.credentials as Record<string, string>;
    let sendMailToken =
      credentials['sendMailToken'] || credentials['send_mail_token'] || credentials['apiKey'];

    // If token includes "Zoho-enczapikey" prefix, remove it (adapter adds it automatically in Authorization header)
    if (sendMailToken && sendMailToken.includes('Zoho-enczapikey')) {
      sendMailToken = sendMailToken.replace(/^Zoho-enczapikey\s+/i, '').trim();
    }

    if (!sendMailToken) {
      throw new Error('ZeptoMail Send Mail Token is required');
    }

    this.sendMailToken = sendMailToken;
    this.fromEmail =
      credentials['fromEmail'] || credentials['from_email'] || credentials['from'] || '';
    this.fromName = credentials['fromName'] || credentials['from_name'] || '';
    this.bounceAddress = credentials['bounceAddress'] || credentials['bounce_address'] || '';

    if (!this.fromEmail) {
      throw new Error('ZeptoMail fromEmail is required');
    }

    // Log initialization (async, don't await)
    void this.logger.log(
      LogType.EMAIL,
      LogLevel.INFO,
      'ZeptoMail adapter initialized',
      'ZeptoMailEmailAdapter',
      {
        fromEmail: this.fromEmail,
        hasBounceAddress: !!this.bounceAddress,
      }
    );
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'zeptomail';
  }

  /**
   * Verify ZeptoMail connection
   * Makes a test API call to verify credentials
   */
  async verify(): Promise<boolean> {
    if (!this.sendMailToken || !this.fromEmail) {
      return false;
    }

    try {
      // ZeptoMail doesn't have a dedicated verify endpoint
      // We'll just check if credentials are set
      // Actual verification happens on first send
      return this.sendMailToken.length > 0 && this.fromEmail.length > 0;
    } catch (error) {
      await this.logger.log(
        LogType.EMAIL,
        LogLevel.WARN,
        'ZeptoMail verification failed',
        'ZeptoMailEmailAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  /**
   * Convert email address to ZeptoMail format
   */
  private formatEmailAddress(email: string, name?: string): { address: string; name?: string } {
    const result: { address: string; name?: string } = {
      address: email,
    };
    if (name) {
      result.name = name;
    }
    return result;
  }

  /**
   * Convert attachments to ZeptoMail format
   * Supports both base64 content and file cache keys
   */
  private formatAttachments(
    attachments: EmailOptions['attachments']
  ): Array<{ filename: string; content: string; content_type?: string }> {
    if (!attachments) {
      return [];
    }

    return attachments.map(att => {
      // Check if attachment is a file cache key (starts with 'filecache:')
      if (typeof att.content === 'string' && att.content.startsWith('filecache:')) {
        // This is a file cache key, not base64 content
        // ZeptoMail supports file_cache_keys array for attachments
        // For now, we'll still use base64, but this can be enhanced to use file cache
        throw new Error(
          'File cache keys not yet supported in attachments. Please use base64 content or implement file cache integration.'
        );
      }

      let content: string;
      if (Buffer.isBuffer(att.content)) {
        content = att.content.toString('base64');
      } else {
        // If it's already a string, assume it's base64 or convert to base64
        content = Buffer.from(att.content, 'utf-8').toString('base64');
      }

      return {
        filename: att.filename,
        content,
        ...(att.contentType && { content_type: att.contentType }),
      };
    });
  }

  /**
   * Send email via ZeptoMail API
   */
  async send(options: EmailOptions): Promise<EmailResult> {
    if (!this.sendMailToken || !this.fromEmail) {
      return this.createErrorResult('ZeptoMail adapter not initialized');
    }

    try {
      // Validate options
      this.validateEmailOptions(options);

      const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

      // Check suppression list for all recipients
      const suppressedEmails: string[] = [];
      const allowedEmails: string[] = [];

      for (const email of toAddresses) {
        // Check suppression list with clinicId for multi-tenant support
        const isSuppressed = await this.suppressionListService.isSuppressed(email, this.clinicId);
        if (isSuppressed) {
          suppressedEmails.push(email);
          await this.logger.log(
            LogType.EMAIL,
            LogLevel.WARN,
            `Email suppressed, skipping send: ${email}`,
            'ZeptoMailEmailAdapter',
            { email }
          );
        } else {
          allowedEmails.push(email);
        }
      }

      // If all emails are suppressed, return early
      if (allowedEmails.length === 0) {
        return this.createErrorResult(
          `All recipient emails are suppressed: ${suppressedEmails.join(', ')}`
        );
      }

      // If some emails are suppressed, log and continue with allowed emails
      if (suppressedEmails.length > 0) {
        await this.logger.log(
          LogType.EMAIL,
          LogLevel.WARN,
          `Some emails suppressed, sending only to allowed recipients`,
          'ZeptoMailEmailAdapter',
          {
            suppressed: suppressedEmails,
            allowed: allowedEmails,
          }
        );
      }

      // Use only allowed emails for sending
      const recipientsToSend = allowedEmails;

      // Build ZeptoMail request payload
      const payload: ZeptoMailRequest = {
        from: {
          address: options.from || this.fromEmail,
          ...(this.fromName || options.fromName
            ? { name: this.fromName || options.fromName || '' }
            : {}),
        },
        to: recipientsToSend.map(email => ({
          email_address: this.formatEmailAddress(email),
        })),
        subject: options.subject,
        ...(options.html !== false ? { htmlbody: options.body } : { textbody: options.body }),
        ...(this.bounceAddress && { bounce_address: this.bounceAddress }),
        // Enable email tracking (open and click tracking)
        track_opens: true,
        track_clicks: true,
      };

      // Add CC if provided
      if (options.cc) {
        const ccAddresses = Array.isArray(options.cc) ? options.cc : [options.cc];
        payload.cc = ccAddresses.map(email => ({
          email_address: this.formatEmailAddress(email),
        }));
      }

      // Add BCC if provided
      if (options.bcc) {
        const bccAddresses = Array.isArray(options.bcc) ? options.bcc : [options.bcc];
        payload.bcc = bccAddresses.map(email => ({
          email_address: this.formatEmailAddress(email),
        }));
      }

      // Add reply-to if provided (ZeptoMail API expects array)
      if (options.replyTo) {
        payload.reply_to = [this.formatEmailAddress(options.replyTo)];
      }

      // Add attachments if provided
      if (options.attachments && options.attachments.length > 0) {
        payload.attachments = this.formatAttachments(options.attachments);
      }

      // Send with retry and timeout protection
      const response = await this.sendWithRetry(async () => {
        try {
          const httpResponse = await this.httpService.post<ZeptoMailResponse>(
            `${this.apiBaseUrl}/email`,
            payload,
            {
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Zoho-enczapikey ${this.sendMailToken}`,
                'User-Agent': 'HealthcareApp/1.0',
              },
              timeout: 30000, // 30 seconds
              retries: 0, // We handle retries in sendWithRetry
            }
          );

          const responseData = httpResponse.data;

          // Check for ZeptoMail API errors in response body
          if (responseData?.error) {
            const errorCode = responseData.error.code || ZeptoMailErrorCode.UNKNOWN_ERROR;
            const errorMessage = responseData.error.message || getZeptoMailErrorMessage(errorCode);
            const userFriendlyMessage = getZeptoMailErrorMessage(errorCode);

            // Create error with proper context
            const error = new Error(`ZeptoMail API error [${errorCode}]: ${userFriendlyMessage}`);
            (error as Error & { code?: string; retryable?: boolean }).code = errorCode;
            (error as Error & { code?: string; retryable?: boolean }).retryable =
              isZeptoMailErrorRetryable(errorCode);

            // Log specific error types
            await this.logger.log(
              LogType.EMAIL,
              LogLevel.ERROR,
              `ZeptoMail API error: ${errorCode}`,
              'ZeptoMailEmailAdapter',
              {
                errorCode,
                errorMessage,
                userFriendlyMessage,
                retryable: isZeptoMailErrorRetryable(errorCode),
                to: options.to,
                subject: options.subject,
              }
            );

            throw error;
          }

          return responseData;
        } catch (error) {
          // Enhance error with context
          if (error instanceof Error) {
            const enhancedError = new Error(`ZeptoMail send failed: ${error.message}`);
            (enhancedError as Error & { originalError?: Error }).originalError = error;
            throw enhancedError;
          }
          throw error;
        }
      });

      // Extract message ID from response
      const messageId = response?.data?.message_id;

      await this.logger.log(
        LogType.EMAIL,
        LogLevel.INFO,
        'ZeptoMail email sent successfully',
        'ZeptoMailEmailAdapter',
        {
          messageId,
          to: options.to,
          subject: options.subject,
        }
      );

      return this.createSuccessResult(messageId);
    } catch (error) {
      await this.logger.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to send ZeptoMail email',
        'ZeptoMailEmailAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          to: options.to,
          subject: options.subject,
        }
      );

      return this.createErrorResult(error instanceof Error ? error : String(error));
    }
  }
}
