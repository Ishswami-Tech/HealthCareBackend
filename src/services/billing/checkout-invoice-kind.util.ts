/**
 * Which invoices are "online checkouts" bound to the payment window.
 *
 * Product rule (owner): the 15-minute payment window voids ONLY online checkouts the patient
 * opens through the gateway: a video consultation payment and a plan (subscription) purchase or
 * renewal. Every desk-raised bill (consultation invoice from reception / the visit, pharmacy and
 * prescription bills, clinic-admin invoices, the invoice-reminder flow) stays PENDING and payable
 * until it is paid or voided by hand; only its individual gateway attempt rows expire, so a new
 * attempt can be made.
 *
 * Desk fallback (owner rule: reception can always help): a plan invoice that a staff member took
 * over for collection at the desk (`metadata.collectionChannel = 'DESK'`) is no longer an online
 * checkout. It stays payable until cash / UPI-at-desk is recorded against it, and the plan
 * purchase waiting on it is not expired by the window either.
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

/** `Invoice.metadata.collectionChannel` of a bill a staff member collects at the desk. */
export const DESK_COLLECTION_CHANNEL = 'DESK';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/** True for a video-appointment payment or a plan purchase / renewal invoice. */
export function isOnlineCheckoutInvoice(invoice: CheckoutInvoiceShape | null | undefined): boolean {
  if (!invoice) return false;
  if (isDeskCollectedInvoice(invoice)) return false;
  if (typeof invoice.subscriptionId === 'string' && invoice.subscriptionId.length > 0) {
    return true;
  }
  const metadata = asRecord(invoice.metadata);
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

/** True when a staff member took the invoice over for collection at the desk. */
export function isDeskCollectedInvoice(invoice: CheckoutInvoiceShape | null | undefined): boolean {
  if (!invoice) return false;
  return text(asRecord(invoice.metadata), 'collectionChannel') === DESK_COLLECTION_CHANNEL;
}

/**
 * Invoice metadata with the desk-collection marker (who took it over, when). Returns a new
 * object; an existing marker keeps its original actor and time (idempotent takeover).
 */
export function withDeskCollectionMarker(
  metadata: unknown,
  actor: { userId?: string | null; role?: string | null },
  now: Date
): Record<string, unknown> {
  const current = asRecord(metadata);
  if (text(current, 'collectionChannel') === DESK_COLLECTION_CHANNEL) {
    return { ...current };
  }
  return {
    ...current,
    collectionChannel: DESK_COLLECTION_CHANNEL,
    deskCollection: {
      claimedBy: actor.userId ?? null,
      claimedByRole: actor.role ?? null,
      claimedAt: now.toISOString(),
    },
  };
}
