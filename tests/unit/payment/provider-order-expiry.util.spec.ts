import { describe, expect, it } from '@jest/globals';
import { PaymentProvider } from '../../../src/libs/core/types/payment.types';
import {
  buildProviderOrderExpiry,
  secondsUntil,
  ZOHO_SESSION_MAX_EXPIRY_SECONDS,
} from '../../../src/libs/payment/provider-order-expiry.util';
import { PROVIDER_EXPIRY_BUFFER_SECONDS } from '../../../src/config/payment-window.config';

const NOW = new Date('2026-10-21T17:00:00.000Z');
// Default window: 15 minutes, plus the provider buffer.
const WINDOW_PLUS_BUFFER_SECONDS = 15 * 60 + PROVIDER_EXPIRY_BUFFER_SECONDS;

describe('buildProviderOrderExpiry', () => {
  it('sends Cashfree order_expiry_time in IST at window + buffer', () => {
    const expiry = buildProviderOrderExpiry(PaymentProvider.CASHFREE, NOW);
    expect(expiry.enforcedByProvider).toBe(true);
    expect(expiry.requestFields).toEqual({ order_expiry_time: '2026-10-21T22:46:00+05:30' });
    expect(secondsUntil(expiry.expiresAt, NOW)).toBe(WINDOW_PLUS_BUFFER_SECONDS);
  });

  it('sends PhonePe expireAfter in seconds', () => {
    const expiry = buildProviderOrderExpiry(PaymentProvider.PHONEPE, NOW);
    expect(expiry.requestFields).toEqual({ expireAfter: WINDOW_PLUS_BUFFER_SECONDS });
  });

  it('clamps the Zoho session expires_in to the 900s maximum', () => {
    const expiry = buildProviderOrderExpiry(PaymentProvider.ZOHO, NOW);
    expect(expiry.enforcedByProvider).toBe(true);
    expect(expiry.requestFields).toEqual({ expires_in: ZOHO_SESSION_MAX_EXPIRY_SECONDS });
    // Clamped: the session closes no later than window + buffer.
    expect(secondsUntil(expiry.expiresAt, NOW)).toBe(ZOHO_SESSION_MAX_EXPIRY_SECONDS);
  });

  it('gives Razorpay only a client checkout timeout (orders have no expiry)', () => {
    const expiry = buildProviderOrderExpiry(PaymentProvider.RAZORPAY, NOW);
    expect(expiry.enforcedByProvider).toBe(false);
    expect(expiry.requestFields).toEqual({ checkoutTimeoutSeconds: WINDOW_PLUS_BUFFER_SECONDS });
  });

  it.each([PaymentProvider.PAYTM, PaymentProvider.PAYU, PaymentProvider.EASEBUZZ])(
    'sends nothing for %s and leaves the expiry to the sweep',
    provider => {
      const expiry = buildProviderOrderExpiry(provider, NOW);
      expect(expiry.enforcedByProvider).toBe(false);
      expect(expiry.requestFields).toEqual({});
      expect(secondsUntil(expiry.expiresAt, NOW)).toBe(WINDOW_PLUS_BUFFER_SECONDS);
    }
  );

  it('never reports negative seconds', () => {
    expect(secondsUntil(new Date(NOW.getTime() - 5000), NOW)).toBe(0);
  });
});
