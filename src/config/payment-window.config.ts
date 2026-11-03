/**
 * Payment window - single source of truth.
 *
 * Every payment the app opens (VIDEO_CALL booking, plan purchase / renewal, invoice, pharmacy
 * bill) must be completed within this many minutes of being opened. The same value drives:
 * - the backend sweeps that expire unpaid attempts (and the checkout waiting on them),
 * - the expiry sent to the payment provider when the order is created, so the provider itself
 *   refuses a payment after the window,
 * - the `paymentExpiresAt` returned to web / mobile for their countdowns.
 *
 * `PAYMENT_WINDOW_MINUTES` (falls back to the older `VIDEO_PAYMENT_WINDOW_MINUTES`), default 15,
 * clamped to 15..60: Cashfree does not accept an order expiry less than 15 minutes ahead.
 */
import { getEnv } from './environment/utils';

export const DEFAULT_PAYMENT_WINDOW_MINUTES = 15;

/** Smallest order expiry Cashfree accepts, in minutes from now. */
export const PROVIDER_MIN_ORDER_EXPIRY_MINUTES = 15;

/**
 * Extra time the provider keeps an order open after our window, so a payment the patient
 * submitted in the last seconds can still be confirmed. The sweeps only expire an attempt once
 * this buffer has passed too, so the provider has always stopped accepting it by then.
 */
export const PROVIDER_EXPIRY_BUFFER_SECONDS = 60;

export function getPaymentWindowMinutes(): number {
  const raw = getEnv('PAYMENT_WINDOW_MINUTES') || getEnv('VIDEO_PAYMENT_WINDOW_MINUTES');
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.max(Math.floor(parsed), PROVIDER_MIN_ORDER_EXPIRY_MINUTES), 60);
  }
  return DEFAULT_PAYMENT_WINDOW_MINUTES;
}

/** When the provider should stop accepting a payment for an order opened at `openedAt`. */
export function getProviderOrderExpiry(openedAt: Date = new Date()): Date {
  return new Date(
    openedAt.getTime() + getPaymentWindowMinutes() * 60_000 + PROVIDER_EXPIRY_BUFFER_SECONDS * 1000
  );
}

/** ISO 8601 in IST (`2026-10-21T23:10:00+05:30`), the format Cashfree documents. */
export function toIstIsoString(date: Date): string {
  const shifted = new Date(date.getTime() + 330 * 60_000);
  return `${shifted.toISOString().slice(0, 19)}+05:30`;
}
