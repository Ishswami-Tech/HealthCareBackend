import { describe, expect, it } from '@jest/globals';
import {
  pickDeskPlanInvoice,
  shouldActivatePlanAfterDeskPayment,
} from '../../../src/services/billing/desk-plan-invoice.util';

// Fixture plan: the price is whatever the clinic's plan record says; the helper only compares it.
const fixturePlan = { price: 1234.5, gstRatePercent: 18 };
const planTotal =
  Math.round(fixturePlan.price * (1 + fixturePlan.gstRatePercent / 100) * 100) / 100;
const patient = { userId: 'user-1', clinicId: 'clinic-1' };

function invoice(
  id: string,
  overrides: Partial<{
    userId: string;
    clinicId: string;
    status: string;
    totalAmount: number;
    createdAt: string;
  }> = {}
) {
  return {
    id,
    userId: patient.userId,
    clinicId: patient.clinicId,
    status: 'PENDING',
    totalAmount: planTotal,
    createdAt: '2026-10-31T09:00:00.000Z',
    ...overrides,
  };
}

describe('pickDeskPlanInvoice', () => {
  const expected = { ...patient, totalAmount: planTotal };

  it('reuses the newest open bill of the plan period', () => {
    const picked = pickDeskPlanInvoice(
      [invoice('old'), invoice('new', { createdAt: '2026-10-31T10:00:00.000Z' })],
      expected
    );
    expect(picked?.id).toBe('new');
  });

  it('ignores paid / void bills, other patients, other clinics and other amounts', () => {
    const picked = pickDeskPlanInvoice(
      [
        invoice('void', { status: 'VOID' }),
        invoice('paid', { status: 'PAID' }),
        invoice('other-user', { userId: 'user-2' }),
        invoice('other-clinic', { clinicId: 'clinic-2' }),
        invoice('other-amount', { totalAmount: planTotal + 1 }),
      ],
      expected
    );
    expect(picked).toBeNull();
  });

  it('compares totals in paise (float noise does not create a second bill)', () => {
    const picked = pickDeskPlanInvoice(
      [invoice('noisy', { totalAmount: planTotal + 0.001 })],
      expected
    );
    expect(picked?.id).toBe('noisy');
  });

  it('returns null when there is no open bill (a new desk bill is raised)', () => {
    expect(pickDeskPlanInvoice([], expected)).toBeNull();
  });
});

describe('shouldActivatePlanAfterDeskPayment', () => {
  it('activates only when the desk payment settles a plan invoice', () => {
    expect(
      shouldActivatePlanAfterDeskPayment({ settlesInvoice: true, subscriptionId: 'sub-1' })
    ).toBe(true);
    expect(
      shouldActivatePlanAfterDeskPayment({ settlesInvoice: false, subscriptionId: 'sub-1' })
    ).toBe(false);
    expect(shouldActivatePlanAfterDeskPayment({ settlesInvoice: true, subscriptionId: null })).toBe(
      false
    );
    expect(shouldActivatePlanAfterDeskPayment({ settlesInvoice: true, subscriptionId: '  ' })).toBe(
      false
    );
  });
});
