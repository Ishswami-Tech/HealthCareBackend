/**
 * Base Payment Adapter
 * ====================
 * Base class for all payment provider adapters
 * Provides common functionality (validation, retry logic, health checks)
 *
 * @module BasePaymentAdapter
 * @description Base class for payment adapters following DRY principles
 */

import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';
import type {
  PaymentProviderAdapter,
  PaymentIntentOptions,
  PaymentResult,
  PaymentStatusOptions,
  PaymentStatusResult,
  RefundOptions,
  RefundResult,
  WebhookVerificationOptions,
  PaymentProviderConfig,
} from '@core/types/payment.types';
import type { ProviderHealthStatus } from '@communication/adapters/interfaces/provider-health-status.types';

/**
 * Base Payment Adapter
 * Abstract base class for all payment provider adapters
 */
export abstract class BasePaymentAdapter implements PaymentProviderAdapter {
  protected readonly logger: LoggingService;
  protected readonly maxRetries: number = 3;
  protected readonly retryDelay: number = 1000; // 1 second base delay
  protected lastHealthCheck: Date | null = null;
  protected healthCheckCache: ProviderHealthStatus | null = null;
  protected readonly healthCheckCacheTTL: number = 300000; // 5 minutes
  protected config: PaymentProviderConfig | null = null; // Protected to allow subclasses to set

  constructor(loggingService: LoggingService) {
    this.logger = loggingService;
  }

  /**
   * Initialize adapter with provider-specific configuration
   */
  abstract initialize(config: PaymentProviderConfig): void;

  /**
   * Get provider name (must be implemented by subclasses)
   */
  abstract getProviderName(): string;

  /**
   * Create payment intent (must be implemented by subclasses)
   */
  abstract createPaymentIntent(options: PaymentIntentOptions): Promise<PaymentResult>;

  /**
   * Verify payment status (must be implemented by subclasses)
   */
  abstract verifyPayment(options: PaymentStatusOptions): Promise<PaymentStatusResult>;

  /**
   * Process refund (must be implemented by subclasses)
   */
  abstract refund(options: RefundOptions): Promise<RefundResult>;

  /**
   * Verify webhook signature (must be implemented by subclasses)
   */
  abstract verifyWebhook(options: WebhookVerificationOptions): Promise<boolean>;

  /**
   * Verify provider connection (must be implemented by subclasses)
   */
  abstract verify(): Promise<boolean>;

  /**
   * Validate payment intent options
   */
  protected validatePaymentIntentOptions(options: PaymentIntentOptions): void {
    if (!options.amount || options.amount <= 0) {
      throw new Error('Payment amount must be greater than 0');
    }

    if (!options.currency || options.currency.trim().length === 0) {
      throw new Error('Currency is required');
    }

    // Validate currency code format (ISO 4217)
    if (!/^[A-Z]{3}$/.test(options.currency)) {
      throw new Error('Invalid currency code format (must be ISO 4217, e.g., INR, USD)');
    }

    // For subscriptions, validate subscription fields
    if (options.isSubscription) {
      if (!options.subscriptionId) {
        throw new Error('Subscription ID is required for subscription payments');
      }
      if (!options.subscriptionInterval) {
        throw new Error('Subscription interval is required for subscription payments');
      }
    }

    // For appointments, validate appointment fields
    if (options.appointmentId) {
      if (!options.appointmentType) {
        throw new Error('Appointment type is required when appointmentId is provided');
      }
      if (!options.clinicId) {
        throw new Error('Clinic ID is required when appointmentId is provided');
      }
    }
  }

  /**
   * Validate refund options
   */
  protected validateRefundOptions(options: RefundOptions): void {
    if (!options.paymentId || options.paymentId.trim().length === 0) {
      throw new Error('Payment ID is required for refund');
    }

    if (options.amount !== undefined && options.amount <= 0) {
      throw new Error('Refund amount must be greater than 0');
    }
  }

  /**
   * Execute operation with retry logic (exponential backoff)
   */
  protected async executeWithRetry<T>(
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
          LogType.PAYMENT,
          LogLevel.WARN,
          `Payment operation attempt ${attempt + 1} failed, retrying...`,
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
    let healthy: boolean;
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
      const error = err instanceof Error ? err.message : String(err);
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
  protected createErrorResult(error: Error | string): PaymentResult {
    return {
      success: false,
      error: error instanceof Error ? error.message : error,
      provider: this.getProviderName(),
      amount: 0,
      currency: 'INR',
      status: 'failed',
      timestamp: new Date(),
    };
  }

  /**
   * Create success result
   */
  protected createSuccessResult(
    paymentId: string,
    amount: number,
    currency: string,
    transactionId?: string,
    orderId?: string
  ): PaymentResult {
    const result: PaymentResult = {
      success: true,
      paymentId,
      amount,
      currency,
      status: 'completed',
      provider: this.getProviderName(),
      timestamp: new Date(),
    };

    if (transactionId) {
      result.transactionId = transactionId;
    }

    if (orderId) {
      result.orderId = orderId;
    }

    return result;
  }

  /**
   * Create pending result
   */
  protected createPendingResult(
    paymentId: string,
    amount: number,
    currency: string,
    orderId?: string
  ): PaymentResult {
    return {
      success: true,
      paymentId,
      amount,
      currency,
      status: 'pending',
      provider: this.getProviderName(),
      timestamp: new Date(),
      ...(orderId && { orderId }),
    };
  }
}
