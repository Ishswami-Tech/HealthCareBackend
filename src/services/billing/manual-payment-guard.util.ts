/**
 * Guard for manually recorded invoice payments (cash / UPI / card at the desk).
 *
 * Decides, from the invoice state read under its row lock, whether a
 * "record payment" request may create a COMPLETED payment, is a replay of one
 * already recorded, or must be refused:
 *  - only PENDING invoices (unpaid or partially paid) accept money; PAID and
 *    VOID invoices are refused (409);
 *  - the amount is capped at the remaining balance: an amount above it is a
 *    400, never an overpayment;
 *  - a request carrying the same `Idempotency-Key`, or the same method +
 *    transaction reference as a payment already completed on the invoice, is a
 *    replay: the existing payment is returned and nothing new is collected.
 *
 * Amounts are compared in paise so float rounding never leaves a residue.
 */

export interface ManualPaymentRow {
  id: string;
  status: string;
  amount: number | string | null;
  method: string | null;
  transactionId: string | null;
  metadata?: unknown;
}

export interface ManualPaymentInput {
  invoiceStatus: string;
  totalAmount: number;
  payments: readonly ManualPaymentRow[];
  method: string;
  requestedAmount?: number | undefined;
  transactionId?: string | undefined;
  idempotencyKey?: string | undefined;
}

export type ManualPaymentRejectReason =
  'NOT_PAYABLE' | 'FULLY_PAID' | 'EXCEEDS_BALANCE' | 'INVALID_AMOUNT';

export type ManualPaymentPlan =
  | { kind: 'reject'; reason: ManualPaymentRejectReason; message: string; balance: number }
  | { kind: 'replay'; paymentId: string }
  | { kind: 'create'; amount: number; balance: number; settlesInvoice: boolean };

const toPaise = (value: number): number => Math.round(value * 100);
const fromPaise = (paise: number): number => paise / 100;

function formatRupees(value: number): string {
  return `₹${value.toFixed(2)}`;
}

function normaliseReference(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function metadataIdempotencyKey(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
  const value = (metadata as Record<string, unknown>)['idempotencyKey'];
  return typeof value === 'string' ? value : '';
}

function isCompleted(payment: ManualPaymentRow): boolean {
  return String(payment.status).toUpperCase() === 'COMPLETED';
}

/** Sum of COMPLETED payments, in paise. */
export function completedPaise(payments: readonly ManualPaymentRow[]): number {
  return payments
    .filter(isCompleted)
    .reduce((sum, payment) => sum + toPaise(Number(payment.amount ?? 0)), 0);
}

/** The completed payment this request replays, if any. */
export function findReplayedPayment(
  payments: readonly ManualPaymentRow[],
  input: Pick<ManualPaymentInput, 'method' | 'transactionId' | 'idempotencyKey'>
): ManualPaymentRow | null {
  const completed = payments.filter(isCompleted);
  const key = (input.idempotencyKey ?? '').trim();
  if (key) {
    const byKey = completed.find(payment => metadataIdempotencyKey(payment.metadata) === key);
    if (byKey) return byKey;
  }
  const reference = normaliseReference(input.transactionId);
  if (reference) {
    const method = String(input.method).toUpperCase();
    const byReference = completed.find(
      payment =>
        String(payment.method ?? '').toUpperCase() === method &&
        normaliseReference(payment.transactionId) === reference
    );
    if (byReference) return byReference;
  }
  return null;
}

export function planManualInvoicePayment(input: ManualPaymentInput): ManualPaymentPlan {
  const replayed = findReplayedPayment(input.payments, input);
  if (replayed) {
    return { kind: 'replay', paymentId: replayed.id };
  }

  const totalPaise = Math.max(0, toPaise(Number(input.totalAmount) || 0));
  const balancePaise = Math.max(0, totalPaise - completedPaise(input.payments));
  const balance = fromPaise(balancePaise);
  const status = String(input.invoiceStatus).toUpperCase();

  if (status === 'PAID') {
    return {
      kind: 'reject',
      reason: 'FULLY_PAID',
      message: 'Invoice is already paid',
      balance: 0,
    };
  }
  if (status !== 'PENDING') {
    return {
      kind: 'reject',
      reason: 'NOT_PAYABLE',
      message: `A ${status.toLowerCase()} invoice cannot take payments`,
      balance,
    };
  }
  if (balancePaise <= 0) {
    return {
      kind: 'reject',
      reason: 'FULLY_PAID',
      message: 'Invoice is already fully paid',
      balance: 0,
    };
  }

  const requested = input.requestedAmount;
  if (requested !== undefined && (!Number.isFinite(requested) || toPaise(requested) <= 0)) {
    return {
      kind: 'reject',
      reason: 'INVALID_AMOUNT',
      message: 'Payment amount must be greater than zero',
      balance,
    };
  }
  const amountPaise = requested === undefined ? balancePaise : toPaise(requested);
  if (amountPaise > balancePaise) {
    return {
      kind: 'reject',
      reason: 'EXCEEDS_BALANCE',
      message: `Amount ${formatRupees(fromPaise(amountPaise))} exceeds the remaining balance of ${formatRupees(balance)}`,
      balance,
    };
  }

  return {
    kind: 'create',
    amount: fromPaise(amountPaise),
    balance,
    settlesInvoice: amountPaise === balancePaise,
  };
}
