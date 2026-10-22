import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_RENEWAL_WINDOW_DAYS,
  findPurchaseBlock,
  isDuplicatePeriodPayment,
  isRenewalOpen,
  isRunning,
  renewalOpensAt,
  type GuardSubscription,
} from '../../../src/services/billing/subscription-purchase-guard.util';

const NOW = new Date('2026-10-21T18:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function sub(overrides: Partial<GuardSubscription>): GuardSubscription {
  return {
    id: 'sub-1',
    status: 'ACTIVE',
    planId: 'plan-ayurveda',
    currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY),
    ...overrides,
  };
}

describe('isRunning', () => {
  it('is true for an ACTIVE / TRIALING plan whose period has not ended', () => {
    expect(isRunning(sub({}), NOW)).toBe(true);
    expect(isRunning(sub({ status: 'TRIALING' }), NOW)).toBe(true);
    expect(isRunning(sub({ currentPeriodEnd: new Date(NOW.getTime() - 1) }), NOW)).toBe(false);
    for (const status of ['INCOMPLETE', 'INCOMPLETE_EXPIRED', 'PAST_DUE', 'CANCELLED']) {
      expect(isRunning(sub({ status }), NOW)).toBe(false);
    }
  });
});

describe('findPurchaseBlock (one plan per patient per clinic)', () => {
  const noLivePayment = () => false;

  it('refuses a new purchase of ANY plan while a plan of the clinic is running', () => {
    const block = findPurchaseBlock({
      subscriptions: [sub({})],
      planId: 'another-plan',
      now: NOW,
      hasLivePayment: noLivePayment,
    });
    expect(block?.kind).toBe('running-plan');
    expect(block?.subscription.id).toBe('sub-1');
  });

  it('refuses while another plan purchase is waiting on a live payment', () => {
    const block = findPurchaseBlock({
      subscriptions: [sub({ id: 'pending', status: 'INCOMPLETE', planId: 'plan-a' })],
      planId: 'plan-b',
      now: NOW,
      hasLivePayment: id => id === 'pending',
    });
    expect(block).toEqual({
      kind: 'payment-pending',
      subscription: expect.objectContaining({ id: 'pending' }),
    });
  });

  it('allows the purchase after a lapse, an abandoned checkout, or for the same unpaid plan', () => {
    const subscriptions = [
      sub({ id: 'lapsed', status: 'PAST_DUE' }),
      sub({ id: 'expired', currentPeriodEnd: new Date(NOW.getTime() - DAY) }),
      sub({ id: 'abandoned', status: 'INCOMPLETE', planId: 'plan-a' }),
      sub({ id: 'same-plan', status: 'INCOMPLETE', planId: 'plan-b' }),
    ];
    expect(
      findPurchaseBlock({
        subscriptions,
        planId: 'plan-b',
        now: NOW,
        hasLivePayment: id => id === 'same-plan',
      })
    ).toBeNull();
  });
});

describe('renewal window', () => {
  it(`opens ${DEFAULT_RENEWAL_WINDOW_DAYS} days before the end of the paid period`, () => {
    const end = new Date(NOW.getTime() + 30 * DAY);
    expect(renewalOpensAt(sub({ currentPeriodEnd: end }), 7)).toEqual(
      new Date(end.getTime() - 7 * DAY)
    );
    expect(isRenewalOpen(sub({}), NOW, 7)).toBe(false);
    expect(
      isRenewalOpen(sub({ currentPeriodEnd: new Date(NOW.getTime() + 6 * DAY) }), NOW, 7)
    ).toBe(true);
  });

  it('is always open for a plan that is not running (unpaid, lapsed, expired)', () => {
    expect(isRenewalOpen(sub({ status: 'INCOMPLETE' }), NOW, 7)).toBe(true);
    expect(isRenewalOpen(sub({ status: 'PAST_DUE' }), NOW, 7)).toBe(true);
    expect(isRenewalOpen(sub({ currentPeriodEnd: new Date(NOW.getTime() - DAY) }), NOW, 7)).toBe(
      true
    );
  });
});

describe('isDuplicatePeriodPayment', () => {
  const invoicePeriodEnd = '2026-11-21T17:40:23.197Z';

  it('flags a second payment once another payment already moved the plan past that period', () => {
    // INV-2026-000051: issued for the period ending 21 Nov 17:40; INV-2026-000050 then activated
    // the plan with a fresh period ending 21 Nov 17:51 -> the second payment is a duplicate.
    expect(
      isDuplicatePeriodPayment({
        subscription: sub({ currentPeriodEnd: new Date('2026-11-21T17:51:00.000Z') }),
        invoicePeriodEnd,
        alreadyRenewedBy: ['payment-50'],
        paymentId: 'payment-51',
      })
    ).toBe(true);
  });

  it('lets the first activation and a normal renewal of the current period through', () => {
    expect(
      isDuplicatePeriodPayment({
        subscription: sub({ status: 'INCOMPLETE' }),
        invoicePeriodEnd,
        alreadyRenewedBy: [],
        paymentId: 'payment-50',
      })
    ).toBe(false);
    expect(
      isDuplicatePeriodPayment({
        subscription: sub({ currentPeriodEnd: new Date(invoicePeriodEnd) }),
        invoicePeriodEnd,
        alreadyRenewedBy: [],
        paymentId: 'renewal',
      })
    ).toBe(false);
  });

  it('never flags a replay of the payment that renewed, or an invoice without a period', () => {
    const moved = sub({ currentPeriodEnd: new Date('2026-12-21T17:51:00.000Z') });
    expect(
      isDuplicatePeriodPayment({
        subscription: moved,
        invoicePeriodEnd,
        alreadyRenewedBy: ['payment-50'],
        paymentId: 'payment-50',
      })
    ).toBe(false);
    expect(
      isDuplicatePeriodPayment({
        subscription: moved,
        invoicePeriodEnd: null,
        alreadyRenewedBy: [],
        paymentId: 'payment-51',
      })
    ).toBe(false);
  });
});
