import { describe, expect, it } from '@jest/globals';
import {
  attemptOrderId,
  chooseInvoiceOrderId,
  openAttemptsToClose,
  pickCallbackPayment,
  planInvoicePaymentAttempt,
  type PaymentAttemptRow,
} from '../../../src/services/billing/invoice-payment-attempt.util';

const ORDER = 'INV-2026-000050599c4282';

function row(
  id: string,
  status: string,
  createdAt: string,
  orderId: string | null = ORDER
): PaymentAttemptRow {
  return {
    id,
    status,
    createdAt: new Date(createdAt),
    transactionId: orderId,
    metadata: orderId ? { orderId } : {},
  };
}

describe('planInvoicePaymentAttempt', () => {
  it('creates a row when the invoice has no open attempt', () => {
    expect(planInvoicePaymentAttempt([], ORDER)).toEqual({ reuseId: null, supersedeIds: [] });
    expect(planInvoicePaymentAttempt([row('a', 'FAILED', '2026-10-21T17:00:00Z')], ORDER)).toEqual({
      reuseId: null,
      supersedeIds: [],
    });
  });

  it('reuses the newest open row of the same order and supersedes the older duplicate', () => {
    // The double press of INV-2026-000050: two PENDING rows for one gateway order.
    const rows = [
      row('first', 'PENDING', '2026-10-21T17:08:50Z'),
      row('second', 'PENDING', '2026-10-21T17:10:28Z'),
    ];
    expect(planInvoicePaymentAttempt(rows, ORDER)).toEqual({
      reuseId: 'second',
      supersedeIds: ['first'],
    });
  });

  it('supersedes open rows of another order and never touches settled rows', () => {
    const rows = [
      row('old-order', 'PENDING', '2026-10-21T17:00:00Z', 'OTHER-ORDER'),
      row('paid', 'COMPLETED', '2026-10-20T10:00:00Z'),
      row('refunded', 'REFUNDED', '2026-10-19T10:00:00Z'),
    ];
    expect(planInvoicePaymentAttempt(rows, ORDER)).toEqual({
      reuseId: null,
      supersedeIds: ['old-order'],
    });
  });
});

describe('planInvoicePaymentAttempt across providers', () => {
  it('does not reuse the same order id opened at another provider', () => {
    const cashfree: PaymentAttemptRow = {
      ...row('cashfree-row', 'PENDING', '2026-10-21T17:00:00Z'),
      metadata: { orderId: ORDER, provider: 'cashfree' },
    };
    expect(planInvoicePaymentAttempt([cashfree], ORDER, 'payu')).toEqual({
      reuseId: null,
      supersedeIds: ['cashfree-row'],
    });
    expect(planInvoicePaymentAttempt([cashfree], ORDER, 'CASHFREE')).toEqual({
      reuseId: 'cashfree-row',
      supersedeIds: [],
    });
  });
});

describe('chooseInvoiceOrderId', () => {
  const live = () => true;
  const lapsed = () => false;

  it('uses the invoice order when it was never used', () => {
    expect(chooseInvoiceOrderId([], ORDER, live)).toBe(ORDER);
  });

  it('keeps the order of a live open attempt (resume / double click)', () => {
    expect(chooseInvoiceOrderId([row('a', 'PENDING', '2026-10-21T17:00:00Z')], ORDER, live)).toBe(
      ORDER
    );
  });

  it('opens a fresh order once the previous one lapsed or failed', () => {
    const rows = [row('a', 'PENDING', '2026-10-21T17:00:00Z')];
    expect(chooseInvoiceOrderId(rows, ORDER, lapsed)).toBe(`${ORDER}-2`);
    const more = [...rows, row('b', 'EXPIRED', '2026-10-21T17:20:00Z', `${ORDER}-2`)];
    expect(chooseInvoiceOrderId(more, ORDER, lapsed)).toBe(`${ORDER}-3`);
  });
});

describe('openAttemptsToClose', () => {
  it('closes every other open attempt once one payment settled the invoice', () => {
    const rows = [
      row('settled', 'COMPLETED', '2026-10-21T17:08:50Z'),
      row('dup', 'PENDING', '2026-10-21T17:10:28Z'),
      row('failed', 'FAILED', '2026-10-21T17:11:00Z'),
    ];
    expect(openAttemptsToClose(rows, 'settled')).toEqual(['dup']);
  });
});

describe('pickCallbackPayment', () => {
  it('prefers the completed row, then the newest open row, never a closed duplicate first', () => {
    const cancelled = row('cancelled', 'CANCELLED', '2026-10-21T17:12:00Z');
    const older = row('older', 'PENDING', '2026-10-21T17:08:50Z');
    const newer = row('newer', 'PENDING', '2026-10-21T17:10:28Z');
    expect(pickCallbackPayment([cancelled, older, newer])?.id).toBe('newer');
    const paid = row('paid', 'COMPLETED', '2026-10-21T17:00:00Z');
    expect(pickCallbackPayment([cancelled, newer, paid])?.id).toBe('paid');
    expect(pickCallbackPayment([cancelled])?.id).toBe('cancelled');
    expect(pickCallbackPayment([])).toBeNull();
  });
});

describe('attemptOrderId', () => {
  it('reads metadata.orderId, falling back to the transaction id', () => {
    expect(attemptOrderId({ metadata: { orderId: 'X' }, transactionId: 'Y' })).toBe('X');
    expect(attemptOrderId({ metadata: null, transactionId: 'Y' })).toBe('Y');
    expect(attemptOrderId({ metadata: [], transactionId: null })).toBe('');
  });
});
