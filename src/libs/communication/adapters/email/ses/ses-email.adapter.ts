/**
 * AWS SES Email Adapter
 * ======================
 * AWS SES email provider adapter
 * Wraps existing SESEmailService to implement EmailProviderAdapter interface
 *
 * @module SESEmailAdapter
 * @description AWS SES email adapter for multi-tenant communication
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { BaseEmailAdapter } from '@communication/adapters/base/base-email-adapter';
import type { EmailOptions, EmailResult } from '@communication/adapters/interfaces';
import type { ProviderConfig } from '@communication/config';
import { SuppressionListService } from '@communication/adapters/email/suppression-list.service';

/**
 * AWS SES Email Adapter
 * Handles email sending via AWS SES
 */
@Injectable()
export class SESEmailAdapter extends BaseEmailAdapter {
  private sesClient: SESClient | null = null;
  private config: ProviderConfig | null = null;
  private fromEmail: string = '';
  private fromName: string = '';
  private clinicId: string | undefined = undefined; // Store clinicId for multi-tenant support

  constructor(
    loggingService: LoggingService,
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
      throw new Error('SES credentials are required');
    }

    const credentials = config.credentials as Record<string, string>;
    const region = credentials['region'] || 'us-east-1';
    const accessKeyId = credentials['accessKeyId'];
    const secretAccessKey = credentials['secretAccessKey'];
    this.fromEmail = credentials['fromEmail'] || credentials['from'] || '';
    this.fromName = credentials['fromName'] || '';

    if (!accessKeyId || !secretAccessKey || !this.fromEmail) {
      throw new Error('SES accessKeyId, secretAccessKey, and fromEmail are required');
    }

    try {
      this.sesClient = new SESClient({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    } catch (error) {
      // Log error synchronously (can't use await in non-async function)
      void this.logger.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to create SES client',
        'SESEmailAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          clinicId,
        }
      );
      throw error;
    }
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'aws_ses';
  }

  /**
   * Verify SES connection
   */
  async verify(): Promise<boolean> {
    if (!this.sesClient) {
      return false;
    }

    try {
      // Try to get send quota (lightweight operation to verify connection)
      // For now, just check if client is initialized
      return this.sesClient !== null;
    } catch (error) {
      await this.logger.log(
        LogType.EMAIL,
        LogLevel.WARN,
        'SES verification failed',
        'SESEmailAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  /**
   * Send email via AWS SES
   */
  async send(options: EmailOptions): Promise<EmailResult> {
    if (!this.sesClient) {
      return this.createErrorResult('SES adapter not initialized');
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
            'SESEmailAdapter',
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
          'SESEmailAdapter',
          {
            suppressed: suppressedEmails,
            allowed: allowedEmails,
          }
        );
      }

      const command = new SendEmailCommand({
        Source: this.fromName ? `${this.fromName} <${this.fromEmail}>` : this.fromEmail,
        Destination: {
          ToAddresses: allowedEmails,
          ...(options.cc && {
            CcAddresses: Array.isArray(options.cc) ? options.cc : [options.cc],
          }),
          ...(options.bcc && {
            BccAddresses: Array.isArray(options.bcc) ? options.bcc : [options.bcc],
          }),
        },
        Message: {
          Subject: {
            Data: options.subject,
            Charset: 'UTF-8',
          },
          Body:
            options.html !== false
              ? {
                  Html: {
                    Data: options.body,
                    Charset: 'UTF-8',
                  },
                }
              : {
                  Text: {
                    Data: options.body,
                    Charset: 'UTF-8',
                  },
                },
        },
        ...(options.replyTo && { ReplyToAddresses: [options.replyTo] }),
      });

      // Send with retry
      const response = await this.sendWithRetry(async () => {
        return await this.sesClient!.send(command);
      });

      await this.logger.log(
        LogType.EMAIL,
        LogLevel.INFO,
        'SES email sent successfully',
        'SESEmailAdapter',
        {
          messageId: response.MessageId,
          to: options.to,
          subject: options.subject,
        }
      );

      return this.createSuccessResult(response.MessageId);
    } catch (error) {
      await this.logger.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to send SES email',
        'SESEmailAdapter',
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
