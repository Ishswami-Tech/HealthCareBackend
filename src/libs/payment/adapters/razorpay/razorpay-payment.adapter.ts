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
import * as crypto from 'crypto';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';
import { BasePaymentAdapter } from '../base/base-payment-adapter';
import { HealthcareError } from '@core/errors/healthcare-error.class';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { toError } from '@core/errors/error-message.util';
import type {
  PaymentIntentOptions,
  PaymentResult,
  PaymentStatusOptions,
  PaymentStatusResult,
  RefundOptions,
  RefundResult,
  WebhookVerificationOptions,
  PaymentProviderConfig,
  PaymentVerificationCapability,
} from '@core/types/payment.types';

// Razorpay SDK types - dynamically imported to handle missing package
interface RazorpayInstance {
  orders: {
    create(options: RazorpayOrderOptions): Promise<RazorpayOrder>;
    fetch(orderId: string): Promise<RazorpayOrder>;
    /**
     * List every payment attempt made against an order.
     * This is the only way to verify a Razorpay payment when the caller holds an
     * order ID rather than a `pay_*` payment ID (e.g. the handoff callback).
     * @see https://razorpay.com/docs/api/orders/fetch-payments
     */
    fetchPayments(orderId: string): Promise<RazorpayOrderPayments>;
  };
  payments: {
    fetch(paymentId: string): Promise<RazorpayPayment>;
    capture(paymentId: string, amount: number, currency: string): Promise<RazorpayPayment>;
  };
  refunds: {
    create(options: RazorpayRefundOptions): Promise<RazorpayRefund>;
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

interface RazorpayOrderPayments {
  entity: string;
  count: number;
  items: RazorpayPayment[];
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

interface RazorpaySdkConfig {
  key_id?: string;
  key_secret?: string;
  oauthToken?: string;
  headers?: Record<string, string>;
}

let RazorpayClass: (new (config: RazorpaySdkConfig) => RazorpayInstance) | null = null;

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
      default?: new (config: RazorpaySdkConfig) => RazorpayInstance;
      new (config: RazorpaySdkConfig): RazorpayInstance;
    };
    const RazorpayExport = razorpayModule?.default || razorpayModule;
    if (typeof RazorpayExport === 'function') {
      RazorpayClass = RazorpayExport as new (config: RazorpaySdkConfig) => RazorpayInstance;
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
  private webhookSecret: string = '';

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
      throw new Error('razorpay package is not installed. Install it with: yarn add razorpay');
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
    this.webhookSecret = credentials['webhookSecret'] || credentials['webhook_secret'] || '';

    if (!this.keyId || !this.keySecret) {
      throw new Error('Razorpay keyId and keySecret are required');
    }

    try {
      if (!RazorpayClass) {
        throw new Error('RazorpayClass is not available');
      }
      this.razorpay = new RazorpayClass({
        key_id: this.keyId,
        key_secret: this.keySecret,
      });
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
   * Razorpay's `payments.fetch()` requires a payment ID (`pay_*`); an order ID
   * (`order_*`) passed to it fails with `BAD_REQUEST_ERROR`.
   *
   * Order IDs ARE verifiable, just via a different endpoint
   * (`orders.fetchPayments()`), which `verifyPayment()` routes to automatically.
   * `isVerifiablePaymentId` lets the callback layer detect the common case where
   * an order ID has been carried in a `paymentId` field so it does not get sent
   * to the payment endpoint.
   */
  getVerificationCapability(): PaymentVerificationCapability {
    return {
      idType: 'either',
      canVerifyByOrderId: () => true,
      canVerifyByPaymentId: () => true,
      requiresCapturedPayment: () => true,
      isVerifiablePaymentId: (id: string) => RazorpayPaymentAdapter.isPaymentId(id),
    };
  }

  /** Razorpay payment IDs are prefixed `pay_`. */
  private static isPaymentId(id: string | undefined): boolean {
    return typeof id === 'string' && id.startsWith('pay_');
  }

  /** Razorpay order IDs are prefixed `order_`. */
  private static isOrderId(id: string | undefined): boolean {
    return typeof id === 'string' && id.startsWith('order_');
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

      // PaymentIntentOptions.amount is already in the smallest currency unit.
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
          // Persist the customer's contact on the order so it is recoverable and
          // so the frontend checkout can prefill it (see prefill note below).
          ...(options.customerPhone && { customerPhone: options.customerPhone }),
          ...(options.customerEmail && { customerEmail: options.customerEmail }),
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

      // Return pending result (payment needs to be completed on frontend).
      // Echo the customer contact back in metadata so the frontend Razorpay
      // Checkout can set `prefill.contact`/`prefill.email` — Razorpay does not
      // read contact from the order, so without this the checkout asks the
      // customer to type their mobile number even though we already have it.
      const pending = this.createPendingResult(
        order.id,
        options.amount,
        options.currency,
        order.id
      );
      const prefill: Record<string, string> = {
        ...(options.customerPhone && { contact: options.customerPhone }),
        ...(options.customerEmail && { email: options.customerEmail }),
        ...(options.customerName && { name: options.customerName }),
      };
      // The public key id lets clients (web + payment bridge) open Checkout for THIS
      // order. Without it the bridge treated the order as incomplete and created a
      // second gateway order that had no local payment record.
      pending.metadata = {
        ...(pending.metadata || {}),
        razorpayKeyId: this.keyId,
        ...(Object.keys(prefill).length > 0 ? { prefill } : {}),
      };
      return pending;
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
   * Fetch a single payment by its `pay_*` identifier.
   */
  private async fetchPaymentById(paymentId: string): Promise<RazorpayPayment> {
    return await this.executeWithRetry(async () => {
      if (!this.razorpay) {
        throw new Error('Razorpay instance not initialized');
      }
      return await this.razorpay.payments.fetch(paymentId);
    });
  }

  /**
   * Resolve the most relevant payment attempt made against an order.
   *
   * Returns `null` when the order exists but has no payment attempt yet, which is
   * a legitimate state (customer opened checkout and abandoned it).
   */
  private async fetchPaymentForOrder(orderId: string): Promise<RazorpayPayment | null> {
    const orderPayments = await this.executeWithRetry(async () => {
      if (!this.razorpay) {
        throw new Error('Razorpay instance not initialized');
      }
      return await this.razorpay.orders.fetchPayments(orderId);
    });

    const items = Array.isArray(orderPayments.items) ? orderPayments.items : [];
    if (items.length === 0) {
      return null;
    }

    // An order can hold several attempts (failed retries then a success).
    // Rank settled outcomes ahead of failures, then prefer the newest attempt.
    const rank = (payment: RazorpayPayment): number => {
      if (payment.status === 'captured' || payment.captured) return 0;
      if (payment.status === 'authorized') return 1;
      if (payment.status === 'refunded') return 2;
      return 3;
    };

    return (
      [...items].sort(
        (left, right) => rank(left) - rank(right) || right.created_at - left.created_at
      )[0] ?? null
    );
  }

  /**
   * Verify payment status via Razorpay.
   *
   * The handoff callback only ever holds the ORDER id, because a `pay_*` payment
   * id does not exist until the customer finishes checkout. Passing an `order_*`
   * id to `payments.fetch()` fails with `BAD_REQUEST_ERROR`, so this routes by ID
   * shape and uses the order's payment list when only an order id is available.
   */
  async verifyPayment(options: PaymentStatusOptions): Promise<PaymentStatusResult> {
    if (!this.razorpay) {
      throw new Error('Razorpay adapter not initialized');
    }

    const suppliedId = options.paymentId;
    const paymentId = RazorpayPaymentAdapter.isPaymentId(suppliedId) ? suppliedId : undefined;
    const orderId = RazorpayPaymentAdapter.isOrderId(suppliedId)
      ? suppliedId
      : options.orderId && RazorpayPaymentAdapter.isOrderId(options.orderId)
        ? options.orderId
        : undefined;

    if (!paymentId && !orderId) {
      // Log the offending ids; keep them out of the thrown error (see note below
      // on HttpExceptionFilter leaking metadata into responses).
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Razorpay verification called with neither a payment id (pay_*) nor an order id (order_*)',
        'RazorpayPaymentAdapter',
        { suppliedId, suppliedOrderId: options.orderId }
      );

      throw new HealthcareError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        'Razorpay verification requires a valid payment or order identifier',
        undefined,
        undefined,
        'RazorpayPaymentAdapter.verifyPayment'
      );
    }

    try {
      const payment = paymentId
        ? await this.fetchPaymentById(paymentId)
        : await this.fetchPaymentForOrder(orderId!);

      if (!payment) {
        // Order created but not paid yet. Report pending rather than throwing so
        // the callback completes and the webhook remains the source of truth.
        await this.logger.log(
          LogType.PAYMENT,
          LogLevel.INFO,
          'Razorpay order has no payment attempt yet; reporting pending',
          'RazorpayPaymentAdapter',
          { orderId }
        );

        return {
          paymentId: suppliedId,
          status: 'pending',
          amount: 0,
          currency: 'INR',
          provider: this.getProviderName(),
          timestamp: new Date(),
          metadata: { orderId, noPaymentAttempt: true },
        };
      }

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
      // A HealthcareError from a nested call is already structured — do not re-wrap.
      if (error instanceof HealthcareError) {
        throw error;
      }

      const normalized = toError(error);

      // Full detail goes to the log only. It is deliberately NOT attached to the
      // thrown HealthcareError: the global HttpExceptionFilter copies error
      // metadata straight into the client response body without sanitization, so
      // gateway codes and internal ids would otherwise leak to the caller.
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify Razorpay payment',
        'RazorpayPaymentAdapter',
        {
          error: normalized.message,
          ...(normalized.code && { gatewayCode: normalized.code }),
          ...(normalized.statusCode !== undefined && { gatewayStatusCode: normalized.statusCode }),
          suppliedId,
          resolvedBy: paymentId ? 'payment_id' : 'order_id',
          ...(orderId && { orderId }),
        }
      );

      throw new HealthcareError(
        ErrorCode.PAYMENT_SERVICE_FAILED,
        'Razorpay payment verification failed',
        undefined,
        undefined,
        'RazorpayPaymentAdapter.verifyPayment'
      );
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
        ...(options.amount && { amount: Math.round(options.amount) }),
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
   * Verify webhook signature from Razorpay
   */
  async verifyWebhook(options: WebhookVerificationOptions): Promise<boolean> {
    if (!this.webhookSecret) {
      return false;
    }

    try {
      const payload =
        typeof options.payload === 'string' ? options.payload : JSON.stringify(options.payload);
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex');

      if (options.signature.length !== expectedSignature.length) {
        return false;
      }

      return crypto.timingSafeEqual(
        Buffer.from(options.signature, 'utf8'),
        Buffer.from(expectedSignature, 'utf8')
      );
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
