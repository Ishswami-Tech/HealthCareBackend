import { describe, expect, it } from '@jest/globals';
import {
  findReplayedPayment,
  planManualInvoicePayment,
  type ManualPaymentRow,
} from '../../../src/services/billing/manual-payment-guard.util';

function paid(id: string, amount: number, extra: Partial<ManualPaymentRow> = {}): ManualPaymentRow {
  return {
    id,
    status: 'COMPLETED',
    amount,
    method: 'CASH',
    transactionId: null,
    metadata: {},
    ...extra,
  };
}

const base = { invoiceStatus: 'PENDING', totalAmount: 500, method: 'CASH' };

describe('planManualInvoicePayment (B15)', () => {
  it('defaults to the remaining balance and settles the invoice', () => {
    expect(planManualInvoicePayment({ ...base, payments: [] })).toEqual({
      kind: 'create',
      amount: 500,
      balance: 500,
      settlesInvoice: true,
    });
  });

  it('accepts a partial payment against the balance', () => {
    expect(
      planManualInvoicePayment({ ...base, payments: [paid('a', 200)], requestedAmount: 100 })
    ).toEqual({ kind: 'create', amount: 100, balance: 300, settlesInvoice: false });
  });

  it('refuses an overpayment instead of recording it', () => {
    const plan = planManualInvoicePayment({
      ...base,
      payments: [paid('a', 499)],
      requestedAmount: 2,
    });
    expect(plan).toMatchObject({ kind: 'reject', reason: 'EXCEEDS_BALANCE', balance: 1 });
  });

  it('refuses any payment on a PAID or VOID invoice', () => {
    expect(
      planManualInvoicePayment({ ...base, invoiceStatus: 'PAID', payments: [paid('a', 500)] })
    ).toMatchObject({ kind: 'reject', reason: 'FULLY_PAID' });
    expect(
      planManualInvoicePayment({ ...base, invoiceStatus: 'VOID', payments: [] })
    ).toMatchObject({ kind: 'reject', reason: 'NOT_PAYABLE' });
  });

  it('refuses when completed payments already cover a still-PENDING invoice', () => {
    expect(planManualInvoicePayment({ ...base, payments: [paid('a', 500)] })).toMatchObject({
      kind: 'reject',
      reason: 'FULLY_PAID',
    });
  });

  it('refuses zero, negative and non-finite amounts', () => {
    for (const requestedAmount of [0, -5, Number.NaN, 0.004]) {
      expect(planManualInvoicePayment({ ...base, payments: [], requestedAmount })).toMatchObject({
        kind: 'reject',
        reason: 'INVALID_AMOUNT',
      });
    }
  });

  it('compares in paise, so float residue never blocks the exact balance', () => {
    expect(
      planManualInvoicePayment({
        ...base,
        totalAmount: 0.3,
        payments: [paid('a', 0.1)],
        requestedAmount: 0.2,
      })
    ).toEqual({ kind: 'create', amount: 0.2, balance: 0.2, settlesInvoice: true });
  });

  it('ignores failed / pending rows when computing the balance', () => {
    const rows = [paid('a', 100, { status: 'FAILED' }), paid('b', 100, { status: 'PENDING' })];
    expect(planManualInvoicePayment({ ...base, payments: rows })).toMatchObject({
      kind: 'create',
      amount: 500,
    });
  });
});

describe('replays (Idempotency-Key and transaction reference)', () => {
  it('replays a request carrying an Idempotency-Key already recorded, even after PAID', () => {
    const rows = [paid('first', 500, { metadata: { idempotencyKey: 'desk-1' } })];
    expect(
      planManualInvoicePayment({
        ...base,
        invoiceStatus: 'PAID',
        payments: rows,
        idempotencyKey: 'desk-1',
      })
    ).toEqual({ kind: 'replay', paymentId: 'first' });
  });

  it('replays the same method + reference (case and spaces ignored)', () => {
    const rows = [paid('upi-1', 200, { method: 'UPI', transactionId: 'UTR123' })];
    expect(findReplayedPayment(rows, { method: 'UPI', transactionId: ' utr123 ' })?.id).toBe(
      'upi-1'
    );
    expect(findReplayedPayment(rows, { method: 'CARD', transactionId: 'UTR123' })).toBeNull();
  });

  it('does not replay against a failed attempt with the same reference', () => {
    const rows = [paid('x', 200, { method: 'UPI', transactionId: 'UTR9', status: 'FAILED' })];
    expect(findReplayedPayment(rows, { method: 'UPI', transactionId: 'UTR9' })).toBeNull();
  });
});
