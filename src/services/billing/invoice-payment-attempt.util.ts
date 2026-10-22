/**
 * Rules for the payment attempts recorded against one invoice.
 *
 * Each press of "Pay" used to insert a new PENDING payment row, even though the gateway order of
 * an invoice is the same every time (its id is derived from the invoice). Two rows for one order
 * showed up as two transactions, and a callback could bind to either of them. These helpers keep
 * a single open attempt per invoice: the open row for the same gateway order is reused, every
 * other open row is closed as superseded.
 */

/** The fields of a payment row these rules look at. */
export interface PaymentAttemptRow {
  id: string;
  status: string;
  transactionId?: string | null;
  metadata?: unknown;
  createdAt: Date | string;
}

export interface InvoiceAttemptPlan {
  /** The open row to reuse for this attempt, or null when a new row must be created. */
  reuseId: string | null;
  /** Open rows to close as superseded (never includes `reuseId`). */
  supersedeIds: string[];
}

/** Metadata key and value written on an attempt that a newer attempt replaced. */
export const SUPERSEDED_REASON = 'SUPERSEDED_BY_NEW_ATTEMPT';
/** Metadata value written on an open attempt that was closed because the invoice was paid. */
export const CLOSED_AFTER_SETTLEMENT_REASON = 'INVOICE_SETTLED_BY_OTHER_PAYMENT';

const OPEN_STATUS = 'PENDING';

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function timeOf(value: Date | string): number {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function newestFirst<T extends PaymentAttemptRow>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => timeOf(right.createdAt) - timeOf(left.createdAt));
}

/** The gateway order a payment row was opened for (metadata.orderId, else its transaction id). */
export function attemptOrderId(row: Pick<PaymentAttemptRow, 'metadata' | 'transactionId'>): string {
  const metadata =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
  const fromMetadata = metadata?.['orderId'];
  if (typeof fromMetadata === 'string' && fromMetadata.trim()) {
    return fromMetadata.trim();
  }
  return typeof row.transactionId === 'string' ? row.transactionId.trim() : '';
}

/** The provider a payment row was opened with (metadata.provider), lower-case, or ''. */
export function attemptProvider(row: Pick<PaymentAttemptRow, 'metadata'>): string {
  const metadata =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
  const provider = metadata?.['provider'];
  return typeof provider === 'string' ? provider.trim().toLowerCase() : '';
}

export function isOpenAttempt(row: Pick<PaymentAttemptRow, 'status'>): boolean {
  return upper(row.status) === OPEN_STATUS;
}

/**
 * Decides how a new payment attempt for an invoice is recorded, given every payment row of that
 * invoice and the gateway order the attempt uses. The newest open row for the same order is
 * reused; every other open row is superseded. Settled rows (completed, refunded, failed, ...)
 * are never touched.
 */
export function planInvoicePaymentAttempt(
  rows: readonly PaymentAttemptRow[],
  orderId: string,
  provider = ''
): InvoiceAttemptPlan {
  const open = newestFirst(rows.filter(isOpenAttempt));
  const wanted = orderId.trim();
  const wantedProvider = provider.trim().toLowerCase();
  // Same order at the same provider only: the same id at another provider is another order.
  const sameProvider = (row: PaymentAttemptRow): boolean =>
    !wantedProvider || !attemptProvider(row) || attemptProvider(row) === wantedProvider;
  const reuse = wanted
    ? open.find(row => attemptOrderId(row) === wanted && sameProvider(row))
    : undefined;
  return {
    reuseId: reuse?.id ?? null,
    supersedeIds: open.filter(row => row.id !== reuse?.id).map(row => row.id),
  };
}

/**
 * The open attempts to close once `settledPaymentId` has paid the invoice: every other PENDING
 * row. They can no longer be paid usefully, and leaving them open shows a second "pending"
 * payment for an invoice that is already paid.
 */
export function openAttemptsToClose(
  rows: readonly PaymentAttemptRow[],
  settledPaymentId: string
): string[] {
  return rows.filter(row => isOpenAttempt(row) && row.id !== settledPaymentId).map(row => row.id);
}

/**
 * The gateway order for a new attempt on an invoice. The newest open attempt that is still live
 * (inside its payment window) keeps its order, so the patient resumes the same checkout and a
 * double click maps onto one order. Otherwise a fresh order: the base id when it was never used,
 * else `<base>-<n>`, because a provider refuses to reopen an expired or failed order id.
 */
export function chooseInvoiceOrderId(
  rows: readonly PaymentAttemptRow[],
  baseOrderId: string,
  isLive: (row: PaymentAttemptRow) => boolean
): string {
  const live = newestFirst(rows.filter(row => isOpenAttempt(row) && isLive(row))).find(row =>
    Boolean(attemptOrderId(row))
  );
  if (live) {
    return attemptOrderId(live);
  }
  const used = new Set(rows.map(row => attemptOrderId(row)).filter(Boolean));
  if (!used.has(baseOrderId)) {
    return baseOrderId;
  }
  let attempt = 2;
  while (used.has(`${baseOrderId}-${attempt}`)) {
    attempt += 1;
  }
  return `${baseOrderId}-${attempt}`;
}

const CALLBACK_PREFERENCE: Readonly<Record<string, number>> = {
  COMPLETED: 0,
  PENDING: 1,
};

/**
 * Several rows can carry the same gateway reference (older duplicate attempts for one order).
 * A gateway callback must bind to the row that matters: the completed one if any, else the
 * newest open one, else the newest row. Closed duplicates are only chosen when nothing else
 * matches, so a late callback cannot land on a superseded row while a live one exists.
 */
export function pickCallbackPayment<T extends PaymentAttemptRow>(rows: readonly T[]): T | null {
  const rank = (row: T): number => CALLBACK_PREFERENCE[upper(row.status)] ?? 2;
  return (
    [...rows].sort((left, right) => {
      const byRank = rank(left) - rank(right);
      return byRank !== 0 ? byRank : timeOf(right.createdAt) - timeOf(left.createdAt);
    })[0] ?? null
  );
}
