import { describe, expect, it } from '@jest/globals';
import {
  cancelRefusal,
  derivePrescriptionPaymentState,
  dispenseStateOf,
  isUnapprovedPrescription,
  cashSettlesInvoice,
  planPrescriptionCash,
  planPrescriptionPaymentAttempt,
  prescriptionBillingRefusal,
  type PrescriptionAttemptRow,
} from '../../../src/services/pharmacy/services/prescription-payment.util';
import { isFutureExpiry } from '../../../src/services/pharmacy/services/medicine-expiry.util';
import { prescriptionPdfFileName } from '../../../src/services/pharmacy/services/prescription-file-name.util';

describe('prescriptionBillingRefusal (B5)', () => {
  it('refuses drafts with the doctor, cancelled and dispensed prescriptions', () => {
    expect(prescriptionBillingRefusal('DRAFT')).toMatch(/approval/);
    expect(prescriptionBillingRefusal('RETURNED')).toMatch(/approval/);
    expect(prescriptionBillingRefusal('CANCELLED')).toMatch(/Cancelled/);
    expect(prescriptionBillingRefusal('FILLED')).toMatch(/dispensed/);
  });

  it('lets open prescriptions be billed', () => {
    expect(prescriptionBillingRefusal('PENDING')).toBeNull();
    expect(prescriptionBillingRefusal('PARTIAL')).toBeNull();
  });

  it('flags only unapproved drafts', () => {
    expect(isUnapprovedPrescription('draft')).toBe(true);
    expect(isUnapprovedPrescription('PENDING')).toBe(false);
  });
});

describe('planPrescriptionCash (B13)', () => {
  it('collects the pending balance by default', () => {
    expect(planPrescriptionCash(2)).toEqual({ ok: true, amount: 2 });
  });

  it('never collects more than the balance (the ₹4 on ₹2 case)', () => {
    expect(planPrescriptionCash(2, 4)).toMatchObject({ ok: false });
    expect(planPrescriptionCash(0, 2)).toMatchObject({ ok: false });
  });

  it('refuses zero or invalid amounts', () => {
    expect(planPrescriptionCash(2, 0)).toMatchObject({ ok: false });
    expect(planPrescriptionCash(2, Number.NaN)).toMatchObject({ ok: false });
  });
});

describe('planPrescriptionPaymentAttempt (B13)', () => {
  const now = new Date('2026-10-22T10:00:00Z');
  const row = (
    id: string,
    minutesAgo: number,
    amount = 2,
    extra: Partial<PrescriptionAttemptRow> = {}
  ): PrescriptionAttemptRow => ({
    id,
    status: 'PENDING',
    amount,
    createdAt: new Date(now.getTime() - minutesAgo * 60_000),
    metadata: { checkout: { orderId: `order-${id}` } },
    ...extra,
  });

  it('reuses the newest live attempt for the same amount and supersedes the rest', () => {
    expect(planPrescriptionPaymentAttempt([row('old', 5), row('new', 1)], 2, now)).toEqual({
      reuseId: 'new',
      supersedeIds: ['old'],
    });
  });

  it('opens a new attempt when the open one expired or the amount changed', () => {
    expect(planPrescriptionPaymentAttempt([row('stale', 60)], 2, now)).toEqual({
      reuseId: null,
      supersedeIds: ['stale'],
    });
    expect(planPrescriptionPaymentAttempt([row('other', 1, 5)], 2, now)).toEqual({
      reuseId: null,
      supersedeIds: ['other'],
    });
  });

  it('never touches settled rows and needs a stored checkout to reuse', () => {
    const rows = [
      row('done', 1, 2, { status: 'COMPLETED' }),
      row('legacy', 1, 2, { metadata: {} }),
    ];
    expect(planPrescriptionPaymentAttempt(rows, 2, now)).toEqual({
      reuseId: null,
      supersedeIds: ['legacy'],
    });
  });
});

describe('cancelRefusal (B13)', () => {
  it('refuses to cancel a prescription with money collected', () => {
    expect(cancelRefusal(2)).toMatch(/Refund/);
    expect(cancelRefusal(0)).toBeNull();
  });
});

describe('dispenseStateOf (B3)', () => {
  it('goes back to PENDING when a full reversal leaves nothing dispensed', () => {
    expect(
      dispenseStateOf([
        { quantity: 2, dispensedQuantity: 0 },
        { quantity: 1, dispensedQuantity: 0 },
      ])
    ).toBe('PENDING');
  });

  it('is PARTIAL while something is dispensed and FILLED when nothing remains', () => {
    expect(
      dispenseStateOf([
        { quantity: 2, dispensedQuantity: 2 },
        { quantity: 1, dispensedQuantity: 0 },
      ])
    ).toBe('PARTIAL');
    expect(dispenseStateOf([{ quantity: 2, dispensedQuantity: 2 }])).toBe('FILLED');
  });
});

describe('isFutureExpiry (B7)', () => {
  const now = new Date('2026-10-22T10:00:00Z');

  it('accepts only an expiry after today (IST day)', () => {
    expect(isFutureExpiry(new Date('2026-10-23T00:00:00Z'), now)).toBe(true);
    expect(isFutureExpiry(new Date('2026-10-22T00:00:00Z'), now)).toBe(false);
    expect(isFutureExpiry(new Date('2025-01-01T00:00:00Z'), now)).toBe(false);
    expect(isFutureExpiry(new Date('invalid'), now)).toBe(false);
  });
});

describe('derivePrescriptionPaymentState (pendingAmount vs status consistency)', () => {
  it('keeps pendingAmount, paymentStatus and canDispense in step', () => {
    expect(derivePrescriptionPaymentState({ totalAmount: 2, collectedAmount: 0 })).toEqual({
      totalAmount: 2,
      paidAmount: 0,
      pendingAmount: 2,
      paymentStatus: 'PENDING',
      canDispense: false,
    });
    expect(derivePrescriptionPaymentState({ totalAmount: 2, collectedAmount: 1 })).toMatchObject({
      pendingAmount: 1,
      paymentStatus: 'PARTIAL',
      canDispense: false,
    });
    expect(
      derivePrescriptionPaymentState({ totalAmount: 0.3, collectedAmount: 0.1 + 0.2 })
    ).toMatchObject({
      pendingAmount: 0,
      paymentStatus: 'PAID',
    });
  });

  it('treats a zero total and a PAID invoice as settled', () => {
    expect(derivePrescriptionPaymentState({ totalAmount: 0, collectedAmount: 0 })).toMatchObject({
      pendingAmount: 0,
      paymentStatus: 'PAID',
      canDispense: true,
    });
    expect(
      derivePrescriptionPaymentState({ totalAmount: 5, collectedAmount: 0, invoiceStatus: 'PAID' })
    ).toEqual({
      totalAmount: 5,
      paidAmount: 5,
      pendingAmount: 0,
      paymentStatus: 'PAID',
      canDispense: true,
    });
  });
});

describe('prescriptionPdfFileName', () => {
  it('is <RxNumber>_<PatientName>.pdf with a header-safe name', () => {
    expect(prescriptionPdfFileName('RX-2026-000123', 'Priya Sharma')).toBe(
      'RX-2026-000123_Priya_Sharma.pdf'
    );
    expect(prescriptionPdfFileName('RX-1', 'Renée  "O\'Neil"/../x')).toBe(
      'RX-1_Renee_O_Neil_.._x.pdf'
    );
    expect(prescriptionPdfFileName(null, '  ')).toBe('Prescription_Patient.pdf');
    expect(prescriptionPdfFileName('RX-1', 'प्रिया')).toBe('RX-1_Patient.pdf');
  });
});

describe('cashSettlesInvoice (N3)', () => {
  it('settles when prior payments plus this cash cover the total', () => {
    expect(cashSettlesInvoice(0, 200, 200)).toBe(true);
    expect(cashSettlesInvoice(100, 100, 200)).toBe(true);
    expect(cashSettlesInvoice(0, 250, 200)).toBe(true);
  });

  it('leaves partial collections and zero totals unsettled', () => {
    expect(cashSettlesInvoice(0, 100, 200)).toBe(false);
    expect(cashSettlesInvoice(0, 0, 0)).toBe(false);
  });
});
