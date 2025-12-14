/**
 * AWS SES Email Adapter
 * ======================
 * AWS SES email provider adapter
 * Wraps existing SESEmailService to implement EmailProviderAdapter interface
 *
 * @module SESEmailAdapter
 * @description AWS SES email adapter for multi-tenant communication
 */

import { Injectable } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';
import { BaseEmailAdapter } from '../base/base-email-adapter';
import type { EmailOptions, EmailResult } from '@communication/adapters/interfaces';
import type { ProviderConfig } from '@communication/config';

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

  constructor(loggingService: LoggingService) {
    super(loggingService);
  }

  /**
   * Initialize adapter with clinic-specific configuration
   */
  initialize(config: ProviderConfig): void {
    this.config = config;

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

      const command = new SendEmailCommand({
        Source: this.fromName ? `${this.fromName} <${this.fromEmail}>` : this.fromEmail,
        Destination: {
          ToAddresses: toAddresses,
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
