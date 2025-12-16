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
   * Validate email options
   */
  protected validateEmailOptions(options: EmailOptions): void {
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

    // Validate recipient emails
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    for (const recipient of recipients) {
      if (!this.isValidEmail(recipient)) {
        throw new Error(`Invalid recipient email address: ${recipient}`);
      }
    }

    // Validate CC emails if provided
    if (options.cc) {
      const ccRecipients = Array.isArray(options.cc) ? options.cc : [options.cc];
      for (const cc of ccRecipients) {
        if (!this.isValidEmail(cc)) {
          throw new Error(`Invalid CC email address: ${cc}`);
        }
      }
    }

    // Validate BCC emails if provided
    if (options.bcc) {
      const bccRecipients = Array.isArray(options.bcc) ? options.bcc : [options.bcc];
      for (const bcc of bccRecipients) {
        if (!this.isValidEmail(bcc)) {
          throw new Error(`Invalid BCC email address: ${bcc}`);
        }
      }
    }
  }

  /**
   * Validate email address format
   */
  protected isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Send with retry logic (exponential backoff)
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

        if (attempt === maxRetries - 1) {
          // Last attempt failed
          throw lastError;
        }

        // Exponential backoff: 1s, 2s, 4s
        const delay = this.retryDelay * Math.pow(2, attempt);
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
