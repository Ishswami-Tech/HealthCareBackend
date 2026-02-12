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
 * Payment Provider Enum
 */
export enum PaymentProvider {
  RAZORPAY = 'razorpay',
  CASHFREE = 'cashfree',
  PHONEPE = 'phonepe',
  STRIPE = 'stripe', // For future use
  PAYU = 'payu', // For future use
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
