/**
 * Razorpay Payment Adapter
 * ========================
 * Razorpay payment provider adapter
 * Implements PaymentProviderAdapter interface
 *
 * @module RazorpayPaymentAdapter
 * @description Razorpay payment adapter for multi-tenant payment processing
 */

import { Injectable } from '@nestjs/common';
import { createRequire } from 'module';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';
import { BasePaymentAdapter } from '../base/base-payment-adapter';
import type {
  PaymentIntentOptions,
  PaymentResult,
  PaymentStatusOptions,
  PaymentStatusResult,
  RefundOptions,
  RefundResult,
  WebhookVerificationOptions,
  PaymentProviderConfig,
} from '@core/types/payment.types';

// Razorpay SDK types - dynamically imported to handle missing package
interface RazorpayInstance {
  orders: {
    create(options: RazorpayOrderOptions): Promise<RazorpayOrder>;
    fetch(orderId: string): Promise<RazorpayOrder>;
  };
  payments: {
    fetch(paymentId: string): Promise<RazorpayPayment>;
    capture(paymentId: string, amount: number, currency: string): Promise<RazorpayPayment>;
  };
  refunds: {
    create(options: RazorpayRefundOptions): Promise<RazorpayRefund>;
  };
  utility: {
    verifyPaymentSignature(params: RazorpayWebhookParams): boolean;
  };
}

interface RazorpayOrderOptions {
  amount: number; // Amount in paise (smallest currency unit)
  currency: string;
  receipt?: string;
  notes?: Record<string, string>;
}

interface RazorpayOrder {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
  attempts: number;
  notes: Record<string, string>;
  created_at: number;
}

interface RazorpayPayment {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  order_id: string;
  method: string;
  description: string;
  created_at: number;
  captured: boolean;
}

interface RazorpayRefundOptions {
  payment_id: string;
  amount?: number; // Partial refund if specified
  notes?: Record<string, string>;
}

interface RazorpayRefund {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  payment_id: string;
  status: string;
  created_at: number;
}

interface RazorpayWebhookParams {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

let RazorpayClass: (new (keyId: string, keySecret: string) => RazorpayInstance) | null = null;

/**
 * Load Razorpay SDK if package is installed
 * Uses createRequire to handle optional dependency gracefully
 * @see https://nodejs.org/api/module.html#module_module_createrequire_filename
 */
function loadRazorpaySDK(): void {
  if (RazorpayClass !== null) {
    return;
  }

  try {
    // Use createRequire for safe dynamic module loading
    const requireFn = createRequire(__filename);
    const razorpayModule = requireFn('razorpay') as {
      default: new (keyId: string, keySecret: string) => RazorpayInstance;
    };
    if (razorpayModule && razorpayModule.default) {
      RazorpayClass = razorpayModule.default;
    }
  } catch {
    // Razorpay package not installed - will throw error on initialization
    RazorpayClass = null;
  }
}

/**
 * Razorpay Payment Adapter
 * Handles payment processing via Razorpay API
 */
@Injectable()
export class RazorpayPaymentAdapter extends BasePaymentAdapter {
  private razorpay: RazorpayInstance | null = null;
  private keyId: string = '';
  private keySecret: string = '';

  constructor(loggingService: LoggingService) {
    super(loggingService);
  }

  /**
   * Initialize adapter with clinic-specific configuration
   */
  initialize(config: PaymentProviderConfig): void {
    this.config = config;

    // Load Razorpay package if not already loaded
    loadRazorpaySDK();

    if (!RazorpayClass) {
      throw new Error('razorpay package is not installed. Install it with: npm install razorpay');
    }

    if (!config.credentials || typeof config.credentials !== 'object') {
      throw new Error('Razorpay credentials are required');
    }

    // Type-safe credential extraction
    // Check if credentials are encrypted
    if ('encrypted' in config.credentials) {
      throw new Error('Razorpay credentials must be decrypted before use');
    }

    // At this point, TypeScript knows credentials is Record<string, string>
    const credentials = config.credentials;

    this.keyId = credentials['keyId'] || credentials['key_id'] || '';
    this.keySecret = credentials['keySecret'] || credentials['key_secret'] || '';

    if (!this.keyId || !this.keySecret) {
      throw new Error('Razorpay keyId and keySecret are required');
    }

    try {
      if (!RazorpayClass) {
        throw new Error('RazorpayClass is not available');
      }
      this.razorpay = new RazorpayClass(this.keyId, this.keySecret);
    } catch (error) {
      // Log error asynchronously but don't await to avoid blocking initialization
      this.logger
        .log(
          LogType.PAYMENT,
          LogLevel.ERROR,
          'Failed to initialize Razorpay instance',
          'RazorpayPaymentAdapter',
          {
            error: error instanceof Error ? error.message : String(error),
          }
        )
        .catch(() => {
          // Silently handle logging errors during initialization
        });
      throw error;
    }
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'razorpay';
  }

  /**
   * Verify Razorpay connection
   */
  async verify(): Promise<boolean> {
    if (!this.razorpay) {
      return false;
    }

    try {
      // Razorpay doesn't have a simple verify endpoint
      // We'll just check if the instance is initialized
      return this.razorpay !== null && this.razorpay.orders !== undefined;
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'Razorpay verification failed',
        'RazorpayPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  /**
   * Create payment intent (order) via Razorpay
   */
  async createPaymentIntent(options: PaymentIntentOptions): Promise<PaymentResult> {
    if (!this.razorpay) {
      return this.createErrorResult('Razorpay adapter not initialized');
    }

    try {
      // Validate options
      this.validatePaymentIntentOptions(options);

      // Convert amount to paise (Razorpay uses smallest currency unit)
      const amountInPaise = Math.round(options.amount);

      // Create order in Razorpay
      const orderOptions: RazorpayOrderOptions = {
        amount: amountInPaise,
        currency: options.currency.toUpperCase(),
        ...(options.orderId && { receipt: options.orderId }),
        notes: {
          ...(options.customerId && { customerId: options.customerId }),
          ...(options.appointmentId && { appointmentId: options.appointmentId }),
          ...(options.appointmentType && { appointmentType: options.appointmentType }),
          ...(options.clinicId && { clinicId: options.clinicId }),
          ...(options.isSubscription && { isSubscription: 'true' }),
          ...(options.subscriptionId && { subscriptionId: options.subscriptionId }),
          ...(options.description && { description: options.description }),
          ...(options.metadata &&
            Object.entries(options.metadata).reduce(
              (acc, [key, value]) => {
                acc[key] = String(value);
                return acc;
              },
              {} as Record<string, string>
            )),
        },
      };

      // Create order with retry
      const order = await this.executeWithRetry(async () => {
        if (!this.razorpay) {
          throw new Error('Razorpay instance not initialized');
        }
        return await this.razorpay.orders.create(orderOptions);
      });

      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Razorpay payment intent created successfully',
        'RazorpayPaymentAdapter',
        {
          orderId: order.id,
          amount: options.amount,
          currency: options.currency,
          appointmentId: options.appointmentId,
        }
      );

      // Return pending result (payment needs to be completed on frontend)
      return this.createPendingResult(order.id, options.amount, options.currency, order.id);
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to create Razorpay payment intent',
        'RazorpayPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          amount: options.amount,
          currency: options.currency,
        }
      );

      return this.createErrorResult(error instanceof Error ? error : String(error));
    }
  }

  /**
   * Verify payment status via Razorpay
   */
  async verifyPayment(options: PaymentStatusOptions): Promise<PaymentStatusResult> {
    if (!this.razorpay) {
      throw new Error('Razorpay adapter not initialized');
    }

    try {
      // Fetch payment details from Razorpay
      const payment = await this.executeWithRetry(async () => {
        if (!this.razorpay) {
          throw new Error('Razorpay instance not initialized');
        }
        return await this.razorpay.payments.fetch(options.paymentId);
      });

      // Map Razorpay status to our status
      let status: PaymentStatusResult['status'];
      switch (payment.status) {
        case 'authorized':
        case 'captured':
          status = 'completed';
          break;
        case 'failed':
          status = 'failed';
          break;
        case 'refunded':
          status = 'refunded';
          break;
        default:
          status = payment.captured ? 'completed' : 'pending';
      }

      return {
        paymentId: payment.id,
        status,
        amount: payment.amount / 100, // Convert from paise to currency unit
        currency: payment.currency,
        transactionId: payment.id,
        provider: this.getProviderName(),
        timestamp: new Date(payment.created_at * 1000),
        metadata: {
          orderId: payment.order_id,
          method: payment.method,
          description: payment.description,
          captured: payment.captured,
        },
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify Razorpay payment',
        'RazorpayPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          paymentId: options.paymentId,
        }
      );
      throw error;
    }
  }

  /**
   * Process refund via Razorpay
   */
  async refund(options: RefundOptions): Promise<RefundResult> {
    if (!this.razorpay) {
      return {
        success: false,
        paymentId: options.paymentId,
        amount: 0,
        status: 'failed',
        provider: this.getProviderName(),
        error: 'Razorpay adapter not initialized',
        timestamp: new Date(),
      };
    }

    try {
      // Validate options
      this.validateRefundOptions(options);

      // Create refund in Razorpay
      const refundOptions: RazorpayRefundOptions = {
        payment_id: options.paymentId,
        ...(options.amount && { amount: Math.round(options.amount) }), // Convert to paise
        notes: {
          ...(options.reason && { reason: options.reason }),
          ...(options.metadata &&
            Object.entries(options.metadata).reduce(
              (acc, [key, value]) => {
                acc[key] = String(value);
                return acc;
              },
              {} as Record<string, string>
            )),
        },
      };

      const refund = await this.executeWithRetry(async () => {
        if (!this.razorpay) {
          throw new Error('Razorpay instance not initialized');
        }
        return await this.razorpay.refunds.create(refundOptions);
      });

      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Razorpay refund processed successfully',
        'RazorpayPaymentAdapter',
        {
          refundId: refund.id,
          paymentId: options.paymentId,
          amount: refund.amount / 100,
        }
      );

      return {
        success: refund.status === 'processed',
        refundId: refund.id,
        paymentId: options.paymentId,
        amount: refund.amount / 100, // Convert from paise
        status: refund.status === 'processed' ? 'completed' : 'processing',
        provider: this.getProviderName(),
        timestamp: new Date(refund.created_at * 1000),
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to process Razorpay refund',
        'RazorpayPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          paymentId: options.paymentId,
        }
      );

      return {
        success: false,
        paymentId: options.paymentId,
        amount: 0,
        status: 'failed',
        provider: this.getProviderName(),
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }

  /**
   * Extract and normalize webhook parameters from payload
   */
  private extractWebhookParams(payload: Record<string, unknown>): {
    orderId: string;
    paymentId: string;
  } {
    const orderId = payload['razorpay_order_id'];
    const paymentId = payload['razorpay_payment_id'];

    // Safely convert to string, avoiding object stringification
    const orderIdStr =
      typeof orderId === 'string'
        ? orderId
        : typeof orderId === 'number' || typeof orderId === 'boolean'
          ? String(orderId)
          : '';
    const paymentIdStr =
      typeof paymentId === 'string'
        ? paymentId
        : typeof paymentId === 'number' || typeof paymentId === 'boolean'
          ? String(paymentId)
          : '';

    return { orderId: orderIdStr, paymentId: paymentIdStr };
  }

  /**
   * Verify webhook signature from Razorpay
   */
  async verifyWebhook(options: WebhookVerificationOptions): Promise<boolean> {
    if (!this.razorpay) {
      return false;
    }

    try {
      // Razorpay webhook verification
      // The payload should contain razorpay_order_id, razorpay_payment_id, razorpay_signature
      const payload =
        typeof options.payload === 'string'
          ? (JSON.parse(options.payload) as Record<string, unknown>)
          : options.payload;

      const { orderId, paymentId } = this.extractWebhookParams(payload);

      const webhookParams: RazorpayWebhookParams = {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: options.signature,
      };

      return this.razorpay.utility.verifyPaymentSignature(webhookParams);
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify Razorpay webhook',
        'RazorpayPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }
}
