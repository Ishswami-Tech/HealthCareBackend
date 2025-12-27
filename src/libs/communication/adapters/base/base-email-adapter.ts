/**
 * Base Email Adapter
 * ===================
 * Base class for all email provider adapters
 * Provides common functionality (validation, retry logic, health checks)
 *
 * @module BaseEmailAdapter
 * @description Base class for email adapters following DRY principles
 */

// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import type {
  EmailProviderAdapter,
  EmailOptions,
  EmailResult,
  ProviderHealthStatus,
} from '@communication/adapters/interfaces';

/**
 * Email size limits (in bytes)
 */
const EMAIL_SIZE_LIMITS = {
  ZEPTOMAIL: 15 * 1024 * 1024, // 15 MB
  AWS_SES: 10 * 1024 * 1024, // 10 MB
  SMTP: 25 * 1024 * 1024, // 25 MB (standard SMTP limit)
  DEFAULT: 10 * 1024 * 1024, // 10 MB default
} as const;

/**
 * Attachment size limits (in bytes)
 */
const ATTACHMENT_SIZE_LIMITS = {
  ZEPTOMAIL: 15 * 1024 * 1024, // 15 MB total
  AWS_SES: 10 * 1024 * 1024, // 10 MB total
  SMTP: 25 * 1024 * 1024, // 25 MB total
  DEFAULT: 10 * 1024 * 1024, // 10 MB default
} as const;

/**
 * Email validation limits
 */
const EMAIL_VALIDATION_LIMITS = {
  MAX_SUBJECT_LENGTH: 998, // RFC 5322 limit
  MAX_BODY_LENGTH: 100 * 1024 * 1024, // 100 MB (very generous)
  MAX_RECIPIENTS: 50, // Reasonable limit
  MAX_ATTACHMENTS: 10, // Reasonable limit
} as const;

/**
 * Disposable email domains (common ones)
 */
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  'tempmail.com',
  'guerrillamail.com',
  'mailinator.com',
  'throwaway.email',
  'temp-mail.org',
  'getnada.com',
  'mohmal.com',
]);

/**
 * Role-based email addresses (should be avoided for transactional emails)
 */
const ROLE_BASED_EMAILS = new Set([
  'admin@',
  'administrator@',
  'postmaster@',
  'hostmaster@',
  'webmaster@',
  'abuse@',
  'noreply@',
  'no-reply@',
  'donotreply@',
  'donot-reply@',
]);

/**
 * Base Email Adapter
 * Abstract base class for all email provider adapters
 */
export abstract class BaseEmailAdapter implements EmailProviderAdapter {
  protected readonly logger: LoggingService;
  protected readonly maxRetries: number = 3;
  protected readonly retryDelay: number = 1000; // 1 second base delay
  protected lastHealthCheck: Date | null = null;
  protected healthCheckCache: ProviderHealthStatus | null = null;
  protected readonly healthCheckCacheTTL: number = 300000; // 5 minutes

  constructor(loggingService: LoggingService) {
    this.logger = loggingService;
  }

  /**
   * Get provider name (must be implemented by subclasses)
   */
  abstract getProviderName(): string;

  /**
   * Send email (must be implemented by subclasses)
   */
  abstract send(options: EmailOptions): Promise<EmailResult>;

  /**
   * Verify provider connection (must be implemented by subclasses)
   */
  abstract verify(): Promise<boolean>;

  /**
   * Get email size limit for this provider
   */
  protected getEmailSizeLimit(): number {
    const providerName = this.getProviderName().toUpperCase();
    switch (providerName) {
      case 'ZEPTOMAIL':
        return EMAIL_SIZE_LIMITS.ZEPTOMAIL;
      case 'AWS_SES':
      case 'SES':
        return EMAIL_SIZE_LIMITS.AWS_SES;
      case 'SMTP':
        return EMAIL_SIZE_LIMITS.SMTP;
      default:
        return EMAIL_SIZE_LIMITS.DEFAULT;
    }
  }

  /**
   * Get attachment size limit for this provider
   */
  protected getAttachmentSizeLimit(): number {
    const providerName = this.getProviderName().toUpperCase();
    switch (providerName) {
      case 'ZEPTOMAIL':
        return ATTACHMENT_SIZE_LIMITS.ZEPTOMAIL;
      case 'AWS_SES':
      case 'SES':
        return ATTACHMENT_SIZE_LIMITS.AWS_SES;
      case 'SMTP':
        return ATTACHMENT_SIZE_LIMITS.SMTP;
      default:
        return ATTACHMENT_SIZE_LIMITS.DEFAULT;
    }
  }

  /**
   * Calculate email size (approximate)
   */
  protected calculateEmailSize(options: EmailOptions): number {
    let size = 0;

    // Subject size
    size += Buffer.byteLength(options.subject || '', 'utf-8');

    // Body size
    size += Buffer.byteLength(options.body || '', 'utf-8');

    // Headers size (approximate)
    size += 500; // Base headers

    // From/To/CC/BCC headers
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    size += recipients.reduce((sum, email) => sum + Buffer.byteLength(email, 'utf-8'), 0);

    if (options.cc) {
      const ccRecipients = Array.isArray(options.cc) ? options.cc : [options.cc];
      size += ccRecipients.reduce((sum, email) => sum + Buffer.byteLength(email, 'utf-8'), 0);
    }

    if (options.bcc) {
      const bccRecipients = Array.isArray(options.bcc) ? options.bcc : [options.bcc];
      size += bccRecipients.reduce((sum, email) => sum + Buffer.byteLength(email, 'utf-8'), 0);
    }

    // Attachments size
    if (options.attachments) {
      size += options.attachments.reduce((sum, att) => {
        if (Buffer.isBuffer(att.content)) {
          return sum + att.content.length;
        }
        return sum + Buffer.byteLength(att.content, 'utf-8');
      }, 0);
    }

    return size;
  }

  /**
   * Validate email options with comprehensive checks
   */
  protected validateEmailOptions(options: EmailOptions): void {
    // Basic required fields
    if (!options.to || (Array.isArray(options.to) && options.to.length === 0)) {
      throw new Error('Recipient email address is required');
    }

    if (!options.subject || options.subject.trim().length === 0) {
      throw new Error('Email subject is required');
    }

    if (!options.body || options.body.trim().length === 0) {
      throw new Error('Email body is required');
    }

    if (!options.from || !this.isValidEmail(options.from)) {
      throw new Error('Valid sender email address is required');
    }

    // Subject length validation
    if (options.subject.length > EMAIL_VALIDATION_LIMITS.MAX_SUBJECT_LENGTH) {
      throw new Error(
        `Email subject exceeds maximum length of ${EMAIL_VALIDATION_LIMITS.MAX_SUBJECT_LENGTH} characters`
      );
    }

    // Body length validation
    if (options.body.length > EMAIL_VALIDATION_LIMITS.MAX_BODY_LENGTH) {
      throw new Error(
        `Email body exceeds maximum length of ${EMAIL_VALIDATION_LIMITS.MAX_BODY_LENGTH} bytes`
      );
    }

    // Recipient count validation
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    if (recipients.length > EMAIL_VALIDATION_LIMITS.MAX_RECIPIENTS) {
      throw new Error(
        `Maximum ${EMAIL_VALIDATION_LIMITS.MAX_RECIPIENTS} recipients allowed per email`
      );
    }

    // Validate recipient emails
    for (const recipient of recipients) {
      this.validateEmailAddress(recipient, 'recipient');
    }

    // Validate CC emails if provided
    if (options.cc) {
      const ccRecipients = Array.isArray(options.cc) ? options.cc : [options.cc];
      if (ccRecipients.length > EMAIL_VALIDATION_LIMITS.MAX_RECIPIENTS) {
        throw new Error(
          `Maximum ${EMAIL_VALIDATION_LIMITS.MAX_RECIPIENTS} CC recipients allowed per email`
        );
      }
      for (const cc of ccRecipients) {
        this.validateEmailAddress(cc, 'CC');
      }
    }

    // Validate BCC emails if provided
    if (options.bcc) {
      const bccRecipients = Array.isArray(options.bcc) ? options.bcc : [options.bcc];
      if (bccRecipients.length > EMAIL_VALIDATION_LIMITS.MAX_RECIPIENTS) {
        throw new Error(
          `Maximum ${EMAIL_VALIDATION_LIMITS.MAX_RECIPIENTS} BCC recipients allowed per email`
        );
      }
      for (const bcc of bccRecipients) {
        this.validateEmailAddress(bcc, 'BCC');
      }
    }

    // Validate sender email
    this.validateEmailAddress(options.from, 'sender', true);

    // Validate attachments
    if (options.attachments) {
      if (options.attachments.length > EMAIL_VALIDATION_LIMITS.MAX_ATTACHMENTS) {
        throw new Error(
          `Maximum ${EMAIL_VALIDATION_LIMITS.MAX_ATTACHMENTS} attachments allowed per email`
        );
      }

      const attachmentSizeLimit = this.getAttachmentSizeLimit();
      let totalAttachmentSize = 0;

      for (const attachment of options.attachments) {
        if (!attachment.filename || attachment.filename.trim().length === 0) {
          throw new Error('Attachment filename is required');
        }

        let attachmentSize: number;
        if (Buffer.isBuffer(attachment.content)) {
          attachmentSize = attachment.content.length;
        } else {
          attachmentSize = Buffer.byteLength(attachment.content, 'utf-8');
        }

        if (attachmentSize > attachmentSizeLimit) {
          throw new Error(
            `Attachment "${attachment.filename}" exceeds maximum size of ${attachmentSizeLimit / 1024 / 1024} MB`
          );
        }

        totalAttachmentSize += attachmentSize;
      }

      if (totalAttachmentSize > attachmentSizeLimit) {
        throw new Error(
          `Total attachment size exceeds maximum of ${attachmentSizeLimit / 1024 / 1024} MB`
        );
      }
    }

    // Validate total email size
    const emailSize = this.calculateEmailSize(options);
    const emailSizeLimit = this.getEmailSizeLimit();

    if (emailSize > emailSizeLimit) {
      throw new Error(
        `Email size (${(emailSize / 1024 / 1024).toFixed(2)} MB) exceeds maximum of ${emailSizeLimit / 1024 / 1024} MB for ${this.getProviderName()}`
      );
    }
  }

  /**
   * Validate email address with enhanced checks
   */
  protected validateEmailAddress(
    email: string,
    type: string,
    allowRoleBased: boolean = false
  ): void {
    // Basic format validation
    if (!this.isValidEmail(email)) {
      throw new Error(`Invalid ${type} email address format: ${email}`);
    }

    const emailLower = email.toLowerCase();
    const emailParts = emailLower.split('@');
    const domain = emailParts.length > 1 ? emailParts[1] : undefined;

    // Check for disposable email domains (warn but don't block)
    if (domain && DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
      void this.logger.log(
        LogType.EMAIL,
        LogLevel.WARN,
        `Disposable email domain detected: ${email}`,
        this.getProviderName(),
        { email, domain, type }
      );
    }

    // Check for role-based emails (only block for recipients)
    if (!allowRoleBased) {
      for (const roleEmail of ROLE_BASED_EMAILS) {
        if (emailLower.startsWith(roleEmail)) {
          throw new Error(
            `Role-based email addresses (${roleEmail}) are not allowed for ${type} addresses`
          );
        }
      }
    }

    // Check for common invalid patterns
    if (emailLower.includes('..') || emailLower.startsWith('.') || emailLower.endsWith('.')) {
      throw new Error(`Invalid ${type} email address format: ${email}`);
    }

    // Check domain length
    if (!domain || domain.length > 255) {
      throw new Error(`Invalid ${type} email domain length: ${email}`);
    }
  }

  /**
   * Validate email address format (RFC 5322 compliant)
   */
  protected isValidEmail(email: string): boolean {
    if (!email || typeof email !== 'string') {
      return false;
    }

    // RFC 5322 compliant regex (simplified but robust)
    const emailRegex =
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

    // Basic length checks
    if (email.length > 254) {
      // RFC 5321 limit
      return false;
    }

    const parts = email.split('@');
    if (parts.length !== 2) {
      return false;
    }

    const localPart = parts[0];
    const domain = parts[1];

    // Local part validation
    if (!localPart || localPart.length === 0 || localPart.length > 64) {
      // RFC 5321 limit
      return false;
    }

    // Domain validation
    if (!domain || domain.length === 0 || domain.length > 255) {
      return false;
    }

    // Check for valid TLD
    const domainParts = domain.split('.');
    if (domainParts.length < 2) {
      return false;
    }

    const tld = domainParts[domainParts.length - 1];
    if (!tld || tld.length < 2 || !/^[a-zA-Z]+$/.test(tld)) {
      return false;
    }

    return emailRegex.test(email);
  }

  /**
   * Check if error is retryable
   */
  protected isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return true; // Retry unknown errors
    }

    // Check if error has retryable property (set by ZeptoMail adapter)
    if ('retryable' in error && typeof error.retryable === 'boolean') {
      return error.retryable;
    }

    const errorMessage = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();

    // Network errors - retryable
    if (
      errorMessage.includes('timeout') ||
      errorMessage.includes('network') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('enotfound') ||
      errorName.includes('timeout')
    ) {
      return true;
    }

    // Rate limit errors - retryable with longer delay
    if (
      errorMessage.includes('rate limit') ||
      errorMessage.includes('too many requests') ||
      errorMessage.includes('429')
    ) {
      return true;
    }

    // Server errors (5xx) - retryable
    if (
      errorMessage.includes('500') ||
      errorMessage.includes('502') ||
      errorMessage.includes('503') ||
      errorMessage.includes('504') ||
      errorMessage.includes('server error') ||
      errorMessage.includes('internal server error')
    ) {
      return true;
    }

    // Client errors (4xx) - generally not retryable
    if (
      errorMessage.includes('400') ||
      errorMessage.includes('401') ||
      errorMessage.includes('403') ||
      errorMessage.includes('404') ||
      errorMessage.includes('invalid') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('forbidden')
    ) {
      return false;
    }

    // Default: retry unknown errors
    return true;
  }

  /**
   * Send with retry logic (exponential backoff with smart retry strategy)
   */
  protected async sendWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = this.maxRetries
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable
        if (!this.isRetryableError(lastError)) {
          // Non-retryable error - throw immediately
          throw lastError;
        }

        if (attempt === maxRetries - 1) {
          // Last attempt failed
          throw lastError;
        }

        // Calculate delay based on error type
        let delay = this.retryDelay * Math.pow(2, attempt);

        // Longer delay for rate limit errors
        const errorMessage = lastError.message.toLowerCase();
        if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
          delay = delay * 2; // Double the delay for rate limits
        }

        await this.delay(delay);

        await this.logger.log(
          LogType.EMAIL,
          LogLevel.WARN,
          `Email send attempt ${attempt + 1} failed, retrying...`,
          this.getProviderName(),
          {
            attempt: attempt + 1,
            maxRetries,
            error: lastError.message,
            retryable: true,
            nextRetryIn: `${delay}ms`,
          }
        );
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Delay helper
   */
  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get provider health status (with caching)
   */
  async getHealthStatus(): Promise<ProviderHealthStatus> {
    const now = new Date();

    // Return cached health status if still valid
    if (
      this.healthCheckCache &&
      this.lastHealthCheck &&
      now.getTime() - this.lastHealthCheck.getTime() < this.healthCheckCacheTTL
    ) {
      return this.healthCheckCache;
    }

    // Perform health check
    const startTime = Date.now();
    let healthy = false;
    let error: string | undefined;

    try {
      healthy = await this.verify();
      const latency = Date.now() - startTime;

      this.healthCheckCache = {
        healthy,
        latency,
        lastChecked: now,
      };

      this.lastHealthCheck = now;
      return this.healthCheckCache;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      const latency = Date.now() - startTime;

      this.healthCheckCache = {
        healthy: false,
        latency,
        lastChecked: now,
        error,
      };

      this.lastHealthCheck = now;
      return this.healthCheckCache;
    }
  }

  /**
   * Create error result
   */
  protected createErrorResult(error: Error | string): EmailResult {
    return {
      success: false,
      error: error instanceof Error ? error.message : error,
      provider: this.getProviderName(),
      timestamp: new Date(),
    };
  }

  /**
   * Create success result
   */
  protected createSuccessResult(messageId?: string): EmailResult {
    const result: EmailResult = {
      success: true,
      provider: this.getProviderName(),
      timestamp: new Date(),
    };
    if (messageId) {
      result.messageId = messageId;
    }
    return result;
  }
}
