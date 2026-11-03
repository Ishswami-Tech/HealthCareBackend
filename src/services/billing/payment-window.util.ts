/**
 * The payment window of a checkout: a payment attempt that is not completed within this many
 * minutes of being opened is closed, and the checkout it belongs to (a plan purchase invoice,
 * a waiting subscription) expires with it.
 *
 * The window is the shared one (`@config/payment-window.config`, default 15 minutes) that also
 * drives VIDEO_CALL bookings and the order expiry sent to the provider, so every checkout of the
 * app expires on the same clock.
 */
import {
  PROVIDER_EXPIRY_BUFFER_SECONDS,
  getPaymentWindowMinutes,
} from '@config/payment-window.config';

/** Metadata key on a payment row: when its payment window closes (ISO string). */
export const PAYMENT_EXPIRES_AT_KEY = 'paymentExpiresAt';

/** Payments handled per run, so one run stays well inside the one-minute schedule. */
export const PAYMENT_WINDOW_BATCH_SIZE = 50;

/** Seconds the cross-replica lock is held; just under the one-minute schedule. */
export const PAYMENT_WINDOW_LOCK_TTL_SECONDS = 50;

export const PAYMENT_WINDOW_LOCK_KEY = 'lock:cron:billing:payment-window-expiry';

/**
 * When the gateway cannot be asked (outage, unknown order), an attempt is still expired once it
 * is this far past its window, so it can never stay open forever. A late payment for it is then
 * flagged as a late settlement by the finaliser, never silently granted or lost.
 */
export const GATEWAY_UNREACHABLE_GRACE_MS = 60 * 60 * 1000;

export function paymentWindowMinutes(): number {
  return getPaymentWindowMinutes();
}

/** The provider keeps an order open this much longer than our window (see the config). */
export const PROVIDER_EXPIRY_BUFFER_MS = PROVIDER_EXPIRY_BUFFER_SECONDS * 1000;

export function paymentWindowMs(): number {
  return paymentWindowMinutes() * 60 * 1000;
}

/** When a payment attempt opened at `openedAt` stops being payable. */
export function paymentWindowEnd(openedAt: Date, windowMs: number = paymentWindowMs()): Date {
  return new Date(openedAt.getTime() + windowMs);
}

function validDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * When the window of a payment row closes: the `paymentExpiresAt` stamped on it when the
 * attempt was opened (or re-opened), else its creation time plus the window.
 */
export function attemptExpiresAt(
  row: { metadata?: unknown; createdAt: Date | string },
  windowMs: number = paymentWindowMs()
): Date {
  const metadata =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
  const stamped = validDate(metadata?.[PAYMENT_EXPIRES_AT_KEY]);
  if (stamped) {
    return stamped;
  }
  const created = validDate(row.createdAt) ?? new Date(0);
  return paymentWindowEnd(created, windowMs);
}

/** The attempt can no longer be paid by the patient (its window, as shown to them, is over). */
export function isPastPaymentWindow(
  row: { metadata?: unknown; createdAt: Date | string },
  now: Date,
  windowMs: number = paymentWindowMs()
): boolean {
  return attemptExpiresAt(row, windowMs).getTime() <= now.getTime();
}

/**
 * The attempt may be expired by the sweep: its window AND the provider's buffer are over, so the
 * provider has stopped accepting a payment for its order.
 */
export function isReadyToExpire(
  row: { metadata?: unknown; createdAt: Date | string },
  now: Date,
  windowMs: number = paymentWindowMs()
): boolean {
  return attemptExpiresAt(row, windowMs).getTime() + PROVIDER_EXPIRY_BUFFER_MS <= now.getTime();
}

export type WindowVerdict = 'settled' | 'expire' | 'retry';

/**
 * What the payment-window sweep does with one attempt after asking the gateway:
 * - the payment is COMPLETED (the gateway said paid): nothing more, it was finalised normally;
 * - the gateway answered and it is not paid: expire the checkout;
 * - the gateway could not be asked: retry next run, unless the attempt is already far past its
 *   window, then expire it anyway.
 */
export function decideWindowVerdict(args: {
  verifiedStatus: string | null;
  gatewayReachable: boolean;
  expiresAt: Date;
  now: Date;
}): WindowVerdict {
  if (String(args.verifiedStatus ?? '').toUpperCase() === 'COMPLETED') {
    return 'settled';
  }
  if (args.gatewayReachable) {
    return 'expire';
  }
  return args.now.getTime() - args.expiresAt.getTime() >= GATEWAY_UNREACHABLE_GRACE_MS
    ? 'expire'
    : 'retry';
}

/**
 * The window end shown for an invoice: the latest window among its open (PENDING) attempts, or
 * null when it has none.
 */
export function invoicePaymentExpiresAt(
  payments: ReadonlyArray<{ status?: string | null; metadata?: unknown; createdAt: Date | string }>,
  windowMs: number = paymentWindowMs()
): Date | null {
  const ends = payments
    .filter(payment => String(payment.status ?? '').toUpperCase() === 'PENDING')
    .map(payment => attemptExpiresAt(payment, windowMs).getTime());
  return ends.length > 0 ? new Date(Math.max(...ends)) : null;
}
