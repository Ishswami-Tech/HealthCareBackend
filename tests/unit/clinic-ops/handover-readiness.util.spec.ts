import { describe, expect, it } from '@jest/globals';
import {
  checkHandoverReadiness,
  type HandoverReadinessItem,
} from '../../../src/services/clinic-ops/services/handover-readiness.util';

const item = (
  quantity: number,
  dispensedQuantity: number,
  unitPrice: number
): HandoverReadinessItem => ({ quantity, dispensedQuantity, unitPrice });

describe('checkHandoverReadiness (B4)', () => {
  it('allows a paid, fully dispensed prescription', () => {
    expect(
      checkHandoverReadiness({ status: 'FILLED', items: [item(2, 2, 1)], paidAmount: 2 })
    ).toEqual({ ok: true });
  });

  it('refuses an unpaid prescription even when dispensed', () => {
    const result = checkHandoverReadiness({
      status: 'FILLED',
      items: [item(2, 2, 1)],
      paidAmount: 1,
    });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.message).toMatch(/payment/i);
  });

  it('accepts a PAID invoice as payment', () => {
    expect(
      checkHandoverReadiness({
        status: 'FILLED',
        items: [item(2, 2, 1)],
        paidAmount: 0,
        invoiceStatus: 'PAID',
      })
    ).toEqual({ ok: true });
  });

  it('accepts a zero-priced prescription without payment', () => {
    expect(
      checkHandoverReadiness({ status: 'FILLED', items: [item(2, 2, 0)], paidAmount: 0 })
    ).toEqual({ ok: true });
  });

  it('refuses a paid but undispensed prescription', () => {
    const result = checkHandoverReadiness({
      status: 'PENDING',
      items: [item(2, 0, 1)],
      paidAmount: 2,
    });
    expect(result.ok ? '' : result.message).toMatch(/dispense/i);
  });

  it('allows a partial dispense only when something was dispensed', () => {
    expect(
      checkHandoverReadiness({ status: 'PARTIAL', items: [item(2, 1, 1)], paidAmount: 2 })
    ).toEqual({ ok: true });
    expect(
      checkHandoverReadiness({ status: 'PARTIAL', items: [item(2, 0, 1)], paidAmount: 2 })
    ).toMatchObject({ ok: false });
  });

  it('refuses drafts, returned drafts and cancelled prescriptions', () => {
    for (const status of ['DRAFT', 'RETURNED', 'CANCELLED']) {
      expect(
        checkHandoverReadiness({ status, items: [item(1, 1, 0)], paidAmount: 0 })
      ).toMatchObject({ ok: false });
    }
  });
});
