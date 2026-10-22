/**
 * Which invoices are "online checkouts" bound to the payment window.
 *
 * Product rule (owner): the 15-minute payment window voids ONLY online checkouts the patient
 * opens through the gateway: a video consultation payment and a plan (subscription) purchase or
 * renewal. Every desk-raised bill (consultation invoice from reception / the visit, pharmacy and
 * prescription bills, clinic-admin invoices, the invoice-reminder flow) stays PENDING and payable
 * until it is paid or voided by hand; only its individual gateway attempt rows expire, so a new
 * attempt can be made.
 */

export interface CheckoutInvoiceShape {
  readonly subscriptionId?: string | null;
  readonly metadata?: unknown;
}

const VIDEO_TYPES: ReadonlySet<string> = new Set(['VIDEO_CALL', 'VIDEO']);
const PLAN_PAYMENT_KINDS: ReadonlySet<string> = new Set([
  'SUBSCRIPTION',
  'PLAN',
  'PLAN_PURCHASE',
  'PLAN_RENEWAL',
  'SUBSCRIPTION_RENEWAL',
]);

function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/** True for a video-appointment payment or a plan purchase / renewal invoice. */
export function isOnlineCheckoutInvoice(invoice: CheckoutInvoiceShape | null | undefined): boolean {
  if (!invoice) return false;
  if (typeof invoice.subscriptionId === 'string' && invoice.subscriptionId.length > 0) {
    return true;
  }
  const metadata =
    invoice.metadata && typeof invoice.metadata === 'object' && !Array.isArray(invoice.metadata)
      ? (invoice.metadata as Record<string, unknown>)
      : {};
  if (
    VIDEO_TYPES.has(text(metadata, 'appointmentType')) ||
    VIDEO_TYPES.has(text(metadata, 'serviceType'))
  ) {
    return true;
  }
  return (
    PLAN_PAYMENT_KINDS.has(text(metadata, 'paymentFor')) ||
    PLAN_PAYMENT_KINDS.has(text(metadata, 'revenueModel'))
  );
}
