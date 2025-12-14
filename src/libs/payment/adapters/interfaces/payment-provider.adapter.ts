/**
 * Payment Provider Adapter Interface
 * ===================================
 * Base interface for all payment provider adapters
 * Follows Strategy pattern for provider-agnostic payment processing
 *
 * @module PaymentProviderAdapter
 * @description Payment provider adapter interface
 * @deprecated Types have been moved to @core/types/payment.types.ts
 * This file now re-exports types from the centralized location for backward compatibility
 */

// Re-export all payment types from centralized location
export type {
  PaymentIntentOptions,
  PaymentResult,
  RefundOptions,
  RefundResult,
  PaymentStatusOptions,
  PaymentStatusResult,
  WebhookVerificationOptions,
  PaymentProviderAdapter,
  PaymentProviderConfig,
} from '@core/types/payment.types';

export { PaymentProvider } from '@core/types/payment.types';
