/**
 * Pure rules for prescription billing at the medicine desk.
 *
 *  - Only an approved, open prescription can be billed: DRAFT / RETURNED are
 *    still with the doctor, CANCELLED and FILLED are closed.
 *  - Cash is capped at the pending balance (computed in paise).
 *  - One open online attempt per prescription: a live attempt for the same
 *    amount is reused, every other open attempt is superseded.
 *  - A prescription with money collected against it is never cancelled
 *    silently: the payment has to be refunded first (no automatic refunds).
 *  - Dispense status follows the dispensed quantities: everything handed out
 *    -> FILLED, something -> PARTIAL, nothing (e.g. after a full reversal)
 *    -> PENDING.
 */
import { attemptExpiresAt } from '@services/billing/payment-window.util';

export type PrescriptionDispenseState = 'PENDING' | 'PARTIAL' | 'FILLED';

const toPaise = (value: number): number => Math.round(value * 100);

/** Why a prescription cannot take a payment now, or null when it can. */
export function prescriptionBillingRefusal(status: string | null | undefined): string | null {
  const normalised = String(status ?? '').toUpperCase();
  if (normalised === 'DRAFT' || normalised === 'RETURNED') {
    return "This prescription is awaiting the doctor's approval and cannot be billed yet";
  }
  if (normalised === 'CANCELLED') return 'Cancelled prescriptions cannot be paid';
  if (normalised === 'FILLED') return 'Prescription has already been dispensed';
  return null;
}

/** True for statuses a patient must not see billed (still with the doctor). */
export function isUnapprovedPrescription(status: string | null | undefined): boolean {
  const normalised = String(status ?? '').toUpperCase();
  return normalised === 'DRAFT' || normalised === 'RETURNED';
}

export type CashPlan = { ok: true; amount: number } | { ok: false; message: string };

/** The cash amount to record, capped at the pending balance. */
export function planPrescriptionCash(pendingAmount: number, requested?: number): CashPlan {
  const pendingPaise = Math.max(0, toPaise(pendingAmount));
  if (pendingPaise <= 0) {
    return { ok: false, message: 'Prescription is already paid' };
  }
  if (requested !== undefined && (!Number.isFinite(requested) || toPaise(requested) <= 0)) {
    return { ok: false, message: 'Cash amount must be greater than zero' };
  }
  const amountPaise = requested === undefined ? pendingPaise : toPaise(requested);
  if (amountPaise > pendingPaise) {
    return {
      ok: false,
      message: `Cash amount exceeds pending amount of INR ${(pendingPaise / 100).toFixed(2)}`,
    };
  }
  return { ok: true, amount: amountPaise / 100 };
}

/**
 * True when the payments already collected plus this cash collection cover the
 * invoice total (all in paise), i.e. the invoice must move to PAID in the same
 * transaction. A zero/negative total is never "settled" here: free dispenses are
 * settled after dispense instead.
 */
export function cashSettlesInvoice(
  alreadyPaidPaise: number,
  cashPaise: number,
  invoiceTotalPaise: number
): boolean {
  if (!(invoiceTotalPaise > 0)) return false;
  return alreadyPaidPaise + cashPaise >= invoiceTotalPaise;
}

export interface PrescriptionAttemptRow {
  id: string;
  status: string;
  amount: number | null;
  metadata?: unknown;
  createdAt: Date | string;
}

export interface PrescriptionAttemptPlan {
  reuseId: string | null;
  supersedeIds: string[];
}

function hasCheckout(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const checkout = (metadata as Record<string, unknown>)['checkout'];
  return Boolean(checkout && typeof checkout === 'object' && !Array.isArray(checkout));
}

function timeOf(value: Date | string): number {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * Open (PENDING) online attempts of one prescription -> which one to reuse and
 * which to supersede. Reused: the newest attempt still inside its payment
 * window, for exactly the pending amount, whose checkout was stored.
 */
export function planPrescriptionPaymentAttempt(
  rows: readonly PrescriptionAttemptRow[],
  pendingAmount: number,
  now: Date = new Date()
): PrescriptionAttemptPlan {
  const open = rows
    .filter(row => String(row.status).toUpperCase() === 'PENDING')
    .sort((left, right) => timeOf(right.createdAt) - timeOf(left.createdAt));
  const reuse = open.find(
    row =>
      attemptExpiresAt(row).getTime() > now.getTime() &&
      toPaise(Number(row.amount ?? 0)) === toPaise(pendingAmount) &&
      hasCheckout(row.metadata)
  );
  return {
    reuseId: reuse?.id ?? null,
    supersedeIds: open.filter(row => row.id !== reuse?.id).map(row => row.id),
  };
}

/** Why a prescription with `paidAmount` collected cannot be cancelled, or null. */
export function cancelRefusal(paidAmount: number): string | null {
  return toPaise(paidAmount) > 0
    ? 'This prescription has a recorded payment. Refund it first, then cancel.'
    : null;
}

export interface DispenseQuantityItem {
  quantity?: number | null;
  dispensedQuantity?: number | null;
}

export function dispenseStateOf(items: readonly DispenseQuantityItem[]): PrescriptionDispenseState {
  const remaining = (item: DispenseQuantityItem): number =>
    Math.max(0, Number(item.quantity ?? 0) - Number(item.dispensedQuantity ?? 0));
  if (items.every(item => remaining(item) <= 0)) return 'FILLED';
  return items.some(item => Number(item.dispensedQuantity ?? 0) > 0) ? 'PARTIAL' : 'PENDING';
}

export interface PrescriptionPaymentState {
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  paymentStatus: 'PENDING' | 'PARTIAL' | 'PAID';
  canDispense: boolean;
}

/**
 * Amounts and status of a prescription bill, derived once (in paise) so they always agree:
 * nothing to pay (zero total) or a PAID invoice -> pendingAmount 0 and PAID; otherwise
 * pending = total - collected, PARTIAL while something is collected.
 */
export function derivePrescriptionPaymentState(input: {
  totalAmount: number;
  collectedAmount: number;
  invoiceStatus?: string | null | undefined;
}): PrescriptionPaymentState {
  const totalPaise = Math.max(0, toPaise(Number(input.totalAmount) || 0));
  const collectedPaise = Math.max(0, toPaise(Number(input.collectedAmount) || 0));
  const invoicePaid = String(input.invoiceStatus ?? '').toUpperCase() === 'PAID';
  const settled = totalPaise <= 0 || invoicePaid || collectedPaise >= totalPaise;
  const paidPaise = settled ? Math.max(collectedPaise, totalPaise) : collectedPaise;
  const pendingPaise = settled ? 0 : totalPaise - collectedPaise;
  return {
    totalAmount: totalPaise / 100,
    paidAmount: paidPaise / 100,
    pendingAmount: pendingPaise / 100,
    paymentStatus: settled ? 'PAID' : collectedPaise > 0 ? 'PARTIAL' : 'PENDING',
    canDispense: settled,
  };
}
