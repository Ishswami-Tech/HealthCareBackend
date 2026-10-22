import { describe, expect, it } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import {
  INVOICE_NOT_EDITABLE_MESSAGE,
  RECEIPT_AFTER_PAYMENT_MESSAGE,
  USE_RECORD_PAYMENT_MESSAGE,
  WHATSAPP_RECEIPT_UNPAID_MESSAGE,
  assertPendingEditApplied,
  assertReceiptAvailable,
  assertWhatsAppReceiptAllowed,
  checkInvoiceAmounts,
  checkInvoiceEdit,
  isReceiptAvailable,
  stripClientSettlement,
} from '../../../src/services/billing/invoice-amount.util';

describe('checkInvoiceAmounts (B26)', () => {
  it('computes the total in paise', () => {
    expect(checkInvoiceAmounts({ amount: 100.1, tax: 18.02, discount: 0.12 })).toEqual({
      ok: true,
      totalAmount: 118,
    });
  });

  it('refuses a discount above amount + tax (negative total)', () => {
    expect(checkInvoiceAmounts({ amount: 100, tax: 0, discount: 150 })).toMatchObject({
      ok: false,
    });
    expect(
      checkInvoiceAmounts({ amount: 100, discount: 150 }, { allowZeroTotal: true })
    ).toMatchObject({ ok: false });
  });

  it('refuses a zero amount or a zero total on a billable invoice', () => {
    expect(checkInvoiceAmounts({ amount: 0 })).toMatchObject({ ok: false });
    expect(checkInvoiceAmounts({ amount: 100, discount: 100 })).toMatchObject({ ok: false });
  });

  it('lets internal waived invoices keep a zero total', () => {
    expect(checkInvoiceAmounts({ amount: 0 }, { allowZeroTotal: true })).toEqual({
      ok: true,
      totalAmount: 0,
    });
  });

  it('refuses negative or non-numeric parts', () => {
    expect(checkInvoiceAmounts({ amount: 100, tax: -1 })).toMatchObject({ ok: false });
    expect(checkInvoiceAmounts({ amount: Number.NaN })).toMatchObject({ ok: false });
  });
});

describe('receipt availability (B16)', () => {
  it('is only for PAID invoices', () => {
    expect(isReceiptAvailable('PAID')).toBe(true);
    expect(isReceiptAvailable('paid')).toBe(true);
    for (const status of ['PENDING', 'VOID', '', null, undefined]) {
      expect(isReceiptAvailable(status)).toBe(false);
    }
  });

  it('throws a 409 with the product message otherwise', () => {
    expect(() => assertReceiptAvailable('PAID')).not.toThrow();
    try {
      assertReceiptAvailable('PENDING');
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
      expect((error as ConflictException).message).toBe(RECEIPT_AFTER_PAYMENT_MESSAGE);
    }
  });
});

describe('staff invoice create / WhatsApp receipt gates', () => {
  it('drops a client-sent status / paidAt on create', () => {
    expect(
      stripClientSettlement({ amount: 100, status: 'PAID', paidAt: '2026-10-22', userId: 'u' })
    ).toEqual({ amount: 100, userId: 'u' });
  });

  it('refuses a WhatsApp receipt (409) unless the invoice is PAID', () => {
    expect(() => assertWhatsAppReceiptAllowed('PENDING')).toThrow(ConflictException);
    expect(() => assertWhatsAppReceiptAllowed(null)).toThrow(WHATSAPP_RECEIPT_UNPAID_MESSAGE);
    expect(() => assertWhatsAppReceiptAllowed('paid')).not.toThrow();
  });
});

describe('checkInvoiceEdit (generic PUT /billing/invoices/:id)', () => {
  it('lets descriptive fields, line items and amounts through on a PENDING invoice', () => {
    expect(
      checkInvoiceEdit('PENDING', { description: 'x', lineItems: {}, amount: 10, discount: 1 })
    ).toBeNull();
  });

  it('treats a status equal to the current one as a no-op', () => {
    expect(checkInvoiceEdit('PENDING', { status: 'PENDING', description: 'x' })).toBeNull();
  });

  it.each([
    [{ status: 'PAID' }],
    [{ status: 'VOID' }],
    [{ paidAt: '2026-10-01T00:00:00Z' }],
    [{ amountPaid: 100 }],
  ])('refuses settlement fields %j with a 400 pointing to record payment', data => {
    expect(checkInvoiceEdit('PENDING', data)).toEqual({
      status: 400,
      message: USE_RECORD_PAYMENT_MESSAGE,
    });
  });

  it.each(['PAID', 'VOID', 'paid'])('refuses any edit of a %s invoice with a 409', status => {
    expect(checkInvoiceEdit(status, { description: 'x' })).toEqual({
      status: 409,
      message: INVOICE_NOT_EDITABLE_MESSAGE,
    });
  });
});

describe('assertPendingEditApplied (conditional PENDING write)', () => {
  it('returns the updated invoice when the guarded write matched', () => {
    const invoice = { id: 'inv-1', status: 'PENDING' };
    expect(assertPendingEditApplied(invoice)).toBe(invoice);
  });

  it.each([null, undefined])(
    'throws a 409 when the write matched no PENDING row (%p: concurrent payment won)',
    missed => {
      try {
        assertPendingEditApplied(missed);
        throw new Error('expected a refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getStatus()).toBe(409);
        expect((error as ConflictException).message).toBe(INVOICE_NOT_EDITABLE_MESSAGE);
      }
    }
  );
});
