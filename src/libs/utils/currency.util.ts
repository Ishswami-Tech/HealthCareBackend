export function formatCurrencyFromMinorUnits(
  amount: number,
  currency = 'INR',
  locale = 'en-IN'
): string {
  const normalizedAmount = Number.isFinite(amount) ? amount / 100 : 0;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(normalizedAmount);
}

/** Payment / invoice statuses that count as paid (generic, Cashfree SUCCESS, Razorpay CAPTURED). */
const PAID_PAYMENT_STATUSES: ReadonlySet<string> = new Set([
  'PAID',
  'COMPLETED',
  'SUCCESS',
  'CAPTURED',
]);

/** Canonical status normalisation: trim, collapse spaces/hyphens to `_`, upper-case. */
/**
 * Formats an amount already expressed in major units (rupees), e.g. `Payment.amount`, which
 * the billing tables store as a rupee float. Use formatCurrencyFromMinorUnits only for
 * provider amounts carried in paise.
 */
export function formatCurrency(amount: number, currency = 'INR', locale = 'en-IN'): string {
  const normalizedAmount = Number.isFinite(amount) ? amount : 0;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(normalizedAmount);
}

export function normalizePaymentStatus(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return '';
  }

  return String(value)
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
}

/** The single "is this payment status a paid one" predicate (status-only, not appointment-level). */
export function isPaidPaymentStatus(value: unknown): boolean {
  return PAID_PAYMENT_STATUSES.has(normalizePaymentStatus(value));
}
