/**
 * Invoice amount rules.
 *
 *   total = amount + tax - discount   (computed in paise)
 *
 * Always: amount, tax and discount are finite and >= 0, and the discount never
 * exceeds amount + tax (a negative total is never stored).
 * Billable invoices (every invoice raised through `POST /billing/invoices`)
 * additionally need amount > 0 and total > 0. Internal flows that settle a
 * waived fee pass `allowZeroTotal` to keep their zero-amount invoice.
 */

import { ConflictException } from '@nestjs/common';

export interface InvoiceAmountInput {
  amount: number;
  tax?: number | null | undefined;
  discount?: number | null | undefined;
}

export type InvoiceAmountCheck = { ok: true; totalAmount: number } | { ok: false; message: string };

const toPaise = (value: number): number => Math.round(value * 100);

export function checkInvoiceAmounts(
  input: InvoiceAmountInput,
  options: { allowZeroTotal?: boolean } = {}
): InvoiceAmountCheck {
  const amount = Number(input.amount);
  const tax = Number(input.tax ?? 0);
  const discount = Number(input.discount ?? 0);

  if (![amount, tax, discount].every(Number.isFinite)) {
    return { ok: false, message: 'Invoice amount, tax and discount must be numbers' };
  }
  if (amount < 0 || tax < 0 || discount < 0) {
    return { ok: false, message: 'Invoice amount, tax and discount cannot be negative' };
  }
  const grossPaise = toPaise(amount) + toPaise(tax);
  const discountPaise = toPaise(discount);
  if (discountPaise > grossPaise) {
    return { ok: false, message: 'Discount cannot exceed the invoice amount plus tax' };
  }
  const totalPaise = grossPaise - discountPaise;
  if (!options.allowZeroTotal) {
    if (toPaise(amount) <= 0) {
      return { ok: false, message: 'Invoice amount must be greater than zero' };
    }
    if (totalPaise <= 0) {
      return { ok: false, message: 'Invoice total must be greater than zero' };
    }
  }
  return { ok: true, totalAmount: totalPaise / 100 };
}

/** Message returned when a receipt PDF is requested for an invoice that is not paid yet. */
export const RECEIPT_AFTER_PAYMENT_MESSAGE = 'Receipt is available after payment';

/**
 * Receipt PDFs exist only for settled invoices (product rule): a PENDING bill
 * (unpaid or partially paid) or a VOID one has no receipt.
 */
export function isReceiptAvailable(invoiceStatus: string | null | undefined): boolean {
  return String(invoiceStatus ?? '').toUpperCase() === 'PAID';
}

/** Throws a 409 when the invoice has no receipt yet. */
export function assertReceiptAvailable(invoiceStatus: string | null | undefined): void {
  if (!isReceiptAvailable(invoiceStatus)) {
    throw new ConflictException(RECEIPT_AFTER_PAYMENT_MESSAGE);
  }
}

/** 409 for a WhatsApp "receipt" on an unpaid invoice: only a payment reminder fits then. */
export const WHATSAPP_RECEIPT_UNPAID_MESSAGE =
  'This invoice is not paid yet, so there is no receipt to send. Send a payment reminder instead.';

/** Throws a 409 unless the invoice is PAID (receipts go out only after payment). */
export function assertWhatsAppReceiptAllowed(invoiceStatus: string | null | undefined): void {
  if (!isReceiptAvailable(invoiceStatus)) {
    throw new ConflictException(WHATSAPP_RECEIPT_UNPAID_MESSAGE);
  }
}

/**
 * A bill raised by staff over HTTP always starts PENDING: the client may not mark it PAID (or set
 * paidAt) on create; money is recorded through record-payment, which writes the ledger. Returns
 * the input without its client-sent settlement fields; the caller sets status PENDING.
 */
export function stripClientSettlement<T extends { status?: unknown; paidAt?: unknown }>(
  input: T
): Omit<T, 'status' | 'paidAt'> {
  const { status: _status, paidAt: _paidAt, ...rest } = input;
  return rest;
}

/** 400 for a generic invoice update that tries to settle the invoice. */
export const USE_RECORD_PAYMENT_MESSAGE =
  'Use record payment (or mark paid) to settle an invoice; status cannot be changed here';

/** 409 for a generic update of a settled (PAID) or cancelled (VOID) invoice. */
export const INVOICE_NOT_EDITABLE_MESSAGE = 'Only pending invoices can be edited';

/** Fields that settle an invoice; only record-payment / mark-paid may write them. */
const SETTLEMENT_FIELDS = ['status', 'paidAt', 'amountPaid', 'paidAmount'] as const;

/**
 * Generic invoice edits (PUT /billing/invoices/:id) are limited to descriptive fields, line
 * items and amount/tax/discount on a PENDING invoice. Returns the reason the edit is refused,
 * or null when it may proceed. A `status` equal to the current one is a no-op, not a refusal.
 */
export function checkInvoiceEdit(
  currentStatus: string | null | undefined,
  data: Record<string, unknown>
): { status: 400 | 409; message: string } | null {
  const current = String(currentStatus ?? '').toUpperCase();
  const requestedStatus = data['status'];
  const changesStatus =
    requestedStatus !== undefined &&
    requestedStatus !== null &&
    (typeof requestedStatus !== 'string' || requestedStatus.toUpperCase() !== current);
  const settles = SETTLEMENT_FIELDS.some(
    field => field !== 'status' && data[field] !== undefined && data[field] !== null
  );
  if (changesStatus || settles) {
    return { status: 400, message: USE_RECORD_PAYMENT_MESSAGE };
  }
  if (current !== 'PENDING') {
    return { status: 409, message: INVOICE_NOT_EDITABLE_MESSAGE };
  }
  return null;
}

/**
 * Result guard for the conditional PENDING-invoice write: a null result means the
 * `WHERE status = 'PENDING'` matched no row, i.e. a concurrent payment / void got there first.
 * Throws the same 409 as the up-front check so the client sees one consistent refusal.
 */
export function assertPendingEditApplied<T>(updated: T | null | undefined): T {
  if (updated === null || updated === undefined) {
    throw new ConflictException(INVOICE_NOT_EDITABLE_MESSAGE);
  }
  return updated;
}

/** 409 for "Pay" on an invoice that can no longer be paid (voided, or its visit is over). */
export const INVOICE_NOT_PAYABLE_MESSAGE =
  'This bill is no longer payable because the visit expired or was cancelled. Please book a new appointment.';

/** Appointment statuses whose bill can no longer be paid. */
const UNPAYABLE_APPOINTMENT_STATUSES: ReadonlySet<string> = new Set([
  'EXPIRED',
  'CANCELLED',
  'NO_SHOW',
]);

/**
 * Why "Pay" on this invoice is refused, or null when it may proceed. A PAID invoice is a 400
 * ("already paid"); a VOID invoice, or one whose linked appointment expired / was cancelled, is a
 * 409 (the bill is dead even if a system void has not landed yet).
 */
export function checkInvoicePayable(
  invoiceStatus: string | null | undefined,
  linkedAppointmentStatus?: string | null
): { status: 400 | 409; message: string } | null {
  const current = String(invoiceStatus ?? '').toUpperCase();
  if (current === 'PAID') {
    return { status: 400, message: 'Invoice is already paid' };
  }
  if (current === 'VOID') {
    return { status: 409, message: INVOICE_NOT_PAYABLE_MESSAGE };
  }
  const appointmentStatus = String(linkedAppointmentStatus ?? '').toUpperCase();
  if (UNPAYABLE_APPOINTMENT_STATUSES.has(appointmentStatus)) {
    return { status: 409, message: INVOICE_NOT_PAYABLE_MESSAGE };
  }
  return null;
}

/** 400 when an edited total would drop below what has already been collected. */
export const TOTAL_BELOW_COLLECTED_MESSAGE =
  'Invoice total cannot be lower than the amount already collected';
