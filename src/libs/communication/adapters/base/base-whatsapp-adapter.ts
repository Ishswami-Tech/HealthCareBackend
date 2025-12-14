/**
 * Base WhatsApp Adapter
 * =====================
 * Base class for all WhatsApp provider adapters
 * Provides common functionality (validation, retry logic, health checks)
 *
 * @module BaseWhatsAppAdapter
 * @description Base class for WhatsApp adapters following DRY principles
 */

import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';
import type {
  WhatsAppProviderAdapter,
  WhatsAppOptions,
  WhatsAppResult,
  ProviderHealthStatus,
} from '@communication/adapters/interfaces';

/**
 * Base WhatsApp Adapter
 * Abstract base class for all WhatsApp provider adapters
 */
export abstract class BaseWhatsAppAdapter implements WhatsAppProviderAdapter {
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
   * Send message (must be implemented by subclasses)
   */
  abstract send(options: WhatsAppOptions): Promise<WhatsAppResult>;

  /**
   * Verify provider connection (must be implemented by subclasses)
   */
  abstract verify(): Promise<boolean>;

  /**
   * Validate phone number format
   */
  protected isValidPhoneNumber(phone: string): boolean {
    // Basic phone number validation (E.164 format: +1234567890)
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    return phoneRegex.test(phone);
  }

  /**
   * Validate WhatsApp options
   */
  protected validateWhatsAppOptions(options: WhatsAppOptions): void {
    if (!options.to || !this.isValidPhoneNumber(options.to)) {
      throw new Error('Valid recipient phone number is required (E.164 format: +1234567890)');
    }

    // For template messages, templateId is required
    if (options.templateId) {
      // Template message - templateId is sufficient
      return;
    }

    // For regular messages, message content is required
    if (!options.message || options.message.trim().length === 0) {
      throw new Error('Message content is required for non-template messages');
    }
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
          throw lastError;
        }

        const delay = this.retryDelay * Math.pow(2, attempt);
        await this.delay(delay);

        await this.logger.log(
          LogType.NOTIFICATION,
          LogLevel.WARN,
          `WhatsApp send attempt ${attempt + 1} failed, retrying...`,
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

    if (
      this.healthCheckCache &&
      this.lastHealthCheck &&
      now.getTime() - this.lastHealthCheck.getTime() < this.healthCheckCacheTTL
    ) {
      return this.healthCheckCache;
    }

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
  protected createErrorResult(error: Error | string): WhatsAppResult {
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
  protected createSuccessResult(messageId?: string): WhatsAppResult {
    const result: WhatsAppResult = {
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
