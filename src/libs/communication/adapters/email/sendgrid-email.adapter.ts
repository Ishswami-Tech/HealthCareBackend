/**
 * SendGrid Email Adapter
 * ======================
 * SendGrid email provider adapter
 * Implements EmailProviderAdapter interface
 *
 * @module SendGridEmailAdapter
 * @description SendGrid email adapter for multi-tenant communication
 */

import { Injectable } from '@nestjs/common';
import { createRequire } from 'module';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';
import { BaseEmailAdapter } from '../base/base-email-adapter';
import type { EmailOptions, EmailResult } from '@communication/adapters/interfaces';
import type { ProviderConfig } from '@communication/config';

// SendGrid MailService - dynamically imported to handle missing package
// Type definition for SendGrid MailService
interface SendGridMailService {
  setApiKey(apiKey: string): void;
  send(msg: SendGridMessage): Promise<[SendGridResponse, unknown]>;
}

interface SendGridMessage {
  to: string | string[];
  from: string | { email: string; name: string };
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: string;
    type: string;
    disposition: string;
  }>;
}

interface SendGridResponse {
  headers: {
    'x-message-id'?: string[];
    [key: string]: string[] | undefined;
  };
}

let MailServiceClass: (new () => SendGridMailService) | null = null;

// Load SendGrid MailService if package is installed
// Uses createRequire to handle optional dependency gracefully
// @see https://nodejs.org/api/module.html#module_module_createrequire_filename
function loadSendGridMailService(): void {
  if (MailServiceClass !== null) {
    return;
  }

  try {
    // Use createRequire for safe dynamic module loading
    // This is the recommended Node.js approach for dynamic requires in CommonJS
    const requireFn = createRequire(__filename);
    const sendgridModule = requireFn('@sendgrid/mail') as {
      MailService: new () => SendGridMailService;
    };
    if (sendgridModule && sendgridModule.MailService) {
      MailServiceClass = sendgridModule.MailService;
    }
  } catch {
    // SendGrid package not installed - will throw error on initialization
    MailServiceClass = null;
  }
}

/**
 * SendGrid Email Adapter
 * Handles email sending via SendGrid API
 */
@Injectable()
export class SendGridEmailAdapter extends BaseEmailAdapter {
  private mailService: SendGridMailService | null = null;
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

    // Load SendGrid package if not already loaded
    loadSendGridMailService();

    if (!MailServiceClass) {
      throw new Error(
        '@sendgrid/mail package is not installed. Install it with: npm install @sendgrid/mail'
      );
    }

    if (!config.credentials || typeof config.credentials !== 'object') {
      throw new Error('SendGrid credentials are required');
    }

    const credentials = config.credentials as Record<string, string>;
    const apiKey = credentials['apiKey'];

    if (!apiKey) {
      throw new Error('SendGrid API key is required');
    }

    this.fromEmail = credentials['fromEmail'] || credentials['from'] || '';
    this.fromName = credentials['fromName'] || '';

    if (!this.fromEmail) {
      throw new Error('SendGrid fromEmail is required');
    }

    try {
      if (!MailServiceClass) {
        throw new Error('MailServiceClass is not available');
      }
      this.mailService = new MailServiceClass();
      this.mailService.setApiKey(apiKey);
    } catch (error) {
      // Log error synchronously (can't use await in non-async function)
      void this.logger.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to initialize SendGrid mail service',
        'SendGridEmailAdapter',
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
    return 'sendgrid';
  }

  /**
   * Verify SendGrid connection
   */
  async verify(): Promise<boolean> {
    if (!this.mailService) {
      return false;
    }

    try {
      // SendGrid doesn't have a simple verify endpoint
      // We'll just check if the service is initialized
      return this.mailService !== null && this.mailService.setApiKey !== undefined;
    } catch (error) {
      await this.logger.log(
        LogType.EMAIL,
        LogLevel.WARN,
        'SendGrid verification failed',
        'SendGridEmailAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  /**
   * Send email via SendGrid
   */
  async send(options: EmailOptions): Promise<EmailResult> {
    if (!this.mailService) {
      return this.createErrorResult('SendGrid adapter not initialized');
    }

    try {
      // Validate options
      this.validateEmailOptions(options);

      const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

      const msg = {
        to: toAddresses,
        from: this.fromName
          ? {
              email: this.fromEmail,
              name: this.fromName,
            }
          : this.fromEmail,
        subject: options.subject,
        ...(options.html !== false ? { html: options.body } : { text: options.body }),
        ...(options.cc && {
          cc: Array.isArray(options.cc) ? options.cc : [options.cc],
        }),
        ...(options.bcc && {
          bcc: Array.isArray(options.bcc) ? options.bcc : [options.bcc],
        }),
        ...(options.replyTo && { replyTo: options.replyTo }),
        ...(options.attachments && {
          attachments: options.attachments.map(att => ({
            filename: att.filename,
            content: att.content.toString('base64'),
            type: att.contentType || 'application/octet-stream',
            disposition: 'attachment',
          })),
        }),
      };

      // Send with retry
      const [response] = await this.sendWithRetry(async () => {
        if (!this.mailService) {
          throw new Error('SendGrid mail service not initialized');
        }
        return await this.mailService.send(msg);
      });

      const messageId = response?.headers?.['x-message-id']?.[0] || undefined;

      await this.logger.log(
        LogType.EMAIL,
        LogLevel.INFO,
        'SendGrid email sent successfully',
        'SendGridEmailAdapter',
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
        'Failed to send SendGrid email',
        'SendGridEmailAdapter',
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
