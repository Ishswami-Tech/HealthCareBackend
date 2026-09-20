/**
 * Payment Types
 * =============
 * Centralized payment-related type definitions
 * Follows the same pattern as other core types
 *
 * @module PaymentTypes
 * @description Payment provider adapter interfaces and types
 */

import type { ProviderHealthStatus } from '@communication/adapters/interfaces/provider-health-status.types';

/**
 * Payment Intent Options
 * Used for creating payment intents (one-time payments, subscriptions)
 */
export interface PaymentIntentOptions {
  amount: number; // Amount in smallest currency unit (paise for INR)
  currency: string; // ISO currency code (e.g., 'INR')
  orderId?: string; // Optional order ID for tracking
  customerId?: string; // Customer/user ID
  customerEmail?: string;
  customerPhone?: string;
  customerName?: string;
  description?: string;
  metadata?: Record<string, string | number | boolean>;
  // Subscription-specific fields
  isSubscription?: boolean;
  subscriptionId?: string;
  subscriptionInterval?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  // Appointment-specific fields
  appointmentId?: string;
  appointmentType?: 'VIDEO_CALL' | 'IN_PERSON' | 'HOME_VISIT';
  clinicId?: string;
  // Invoice and prescription fields
  invoiceId?: string;
  prescriptionId?: string;
}

/**
 * Payment Result
 */
export interface PaymentResult {
  success: boolean;
  paymentId?: string;
  transactionId?: string;
  orderId?: string;
  amount: number;
  currency: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'refunded';
  provider: string;
  paymentMethod?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
  // Provider-specific response data
  providerResponse?: unknown;
}

/**
 * Refund Options
 */
export interface RefundOptions {
  paymentId: string;
  amount?: number; // Partial refund if specified, full refund if omitted
  reason?: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Refund Result
 */
export interface RefundResult {
  success: boolean;
  refundId?: string;
  paymentId: string;
  amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  provider: string;
  error?: string;
  timestamp: Date;
  providerResponse?: unknown;
}

/**
 * Payment Status Check Options
 */
export interface PaymentStatusOptions {
  paymentId: string;
  orderId?: string;
}

/**
 * Payment Status Result
 */
export interface PaymentStatusResult {
  paymentId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'refunded';
  amount: number;
  currency: string;
  transactionId?: string;
  provider: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Webhook Verification Options
 */
export interface WebhookVerificationOptions {
  payload: string | Record<string, unknown>;
  signature: string;
  timestamp?: string;
}

/**
 * Payment Provider Adapter Interface
 * All payment providers must implement this interface
 */
export interface PaymentProviderAdapter {
  /**
   * Initialize adapter with provider-specific configuration
   */
  initialize(config: PaymentProviderConfig): void;

  /**
   * Create a payment intent (for one-time payments or subscriptions)
   */
  createPaymentIntent(options: PaymentIntentOptions): Promise<PaymentResult>;

  /**
   * Verify payment status
   */
  verifyPayment(options: PaymentStatusOptions): Promise<PaymentStatusResult>;

  /**
   * Process refund
   */
  refund(options: RefundOptions): Promise<RefundResult>;

  /**
   * Fetch refund status by refund identifier
   */
  getRefundStatus?(refundId: string): Promise<RefundResult>;

  /**
   * Verify webhook signature
   */
  verifyWebhook(options: WebhookVerificationOptions): Promise<boolean>;

  /**
   * Verify provider connection/credentials
   */
  verify(): Promise<boolean>;

  /**
   * Get provider health status
   */
  getHealthStatus(): Promise<ProviderHealthStatus>;

  /**
   * Get provider name
   */
  getProviderName(): string;

  /**
   * Declare what identifier types this provider's verification endpoint accepts.
   * Used by the callback layer to avoid passing the wrong ID type to the gateway.
   */
  getVerificationCapability(): PaymentVerificationCapability;

  /**
   * Whether this gateway refuses to create an order without a customer phone
   * number (Cashfree, for example, makes `customer_phone` mandatory).
   *
   * `PaymentService` consults this before attempting a provider so a request with
   * no phone on file is routed to a provider that can actually serve it, instead
   * of spending a failed attempt and a failure cooldown on a guaranteed rejection.
   *
   * Defaults to `false` when not implemented.
   */
  requiresCustomerPhone?(): boolean;
}

/**
 * Payment Provider Configuration
 */
export interface PaymentProviderConfig {
  provider: PaymentProvider;
  enabled: boolean;
  credentials: Record<string, string> | { encrypted: string }; // Encrypted or plain
  settings?: Record<string, unknown>;
  priority?: number; // Lower number = higher priority
}

/**
 * Payment ID type used by a provider's verification endpoint.
 *
 * - `order_id`:     Gateway's order/session endpoint accepts order IDs (e.g., Cashfree, PhonePe)
 * - `payment_id`:   Gateway's payment endpoint accepts payment transaction IDs (e.g., Razorpay)
 * - `either`:       Gateway can resolve by either order or payment ID (e.g., Zoho)
 */
export type PaymentIdType = 'order_id' | 'payment_id' | 'either';

/**
 * Declares what identifier types a provider's `verifyPayment` endpoint accepts.
 */
export interface PaymentVerificationCapability {
  /** The primary ID type the gateway expects */
  readonly idType: PaymentIdType;
  /** Whether the gateway can verify using an order/session ID */
  canVerifyByOrderId(): boolean;
  /** Whether the gateway can verify using a payment/transaction ID */
  canVerifyByPaymentId(): boolean;
  /** Whether the gateway requires the payment to be captured before verification succeeds */
  requiresCapturedPayment(): boolean;
  /**
   * Whether a given ID is actually usable against the gateway's payment endpoint.
   *
   * `canVerifyByPaymentId()` only states that the endpoint EXISTS; it cannot tell
   * whether the caller's ID is really a payment ID. Providers with distinguishable
   * ID formats (e.g. Razorpay's `pay_` vs `order_` prefixes) implement this so the
   * callback layer does not send an order ID to a payment-only endpoint.
   *
   * When not implemented, callers should assume any non-empty ID is acceptable.
   */
  isVerifiablePaymentId?(id: string): boolean;
}

/**
 * Payment Provider Enum
 */
export enum PaymentProvider {
  RAZORPAY = 'razorpay',
  CASHFREE = 'cashfree',
  PHONEPE = 'phonepe',
  ZOHO = 'zoho',
  EASEBUZZ = 'easebuzz',
  PAYTM = 'paytm',
  PAYU = 'payu',
  STRIPE = 'stripe', // For future use
}

/**
 * Clinic Payment Configuration
 * Used by PaymentConfigService for multi-tenant payment configuration
 */
export interface ClinicPaymentConfig {
  clinicId: string;
  payment: {
    primary?: PaymentProviderConfig;
    fallback?: PaymentProviderConfig[];
    defaultCurrency?: string;
    defaultProvider?: PaymentProvider;
  };
  createdAt: Date;
  updatedAt: Date;
}
