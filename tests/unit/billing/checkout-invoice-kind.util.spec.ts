import { describe, expect, it } from '@jest/globals';
import {
  DESK_COLLECTION_CHANNEL,
  isDeskCollectedInvoice,
  isOnlineCheckoutInvoice,
  withDeskCollectionMarker,
} from '../../../src/services/billing/checkout-invoice-kind.util';

describe('isOnlineCheckoutInvoice (payment-window void applies only to these)', () => {
  it('a video consultation payment is an online checkout', () => {
    expect(isOnlineCheckoutInvoice({ metadata: { appointmentType: 'VIDEO_CALL' } })).toBe(true);
    expect(isOnlineCheckoutInvoice({ metadata: { serviceType: 'video_call' } })).toBe(true);
  });

  it('a plan purchase / renewal is an online checkout', () => {
    expect(isOnlineCheckoutInvoice({ subscriptionId: 'sub-1', metadata: {} })).toBe(true);
    expect(isOnlineCheckoutInvoice({ metadata: { paymentFor: 'SUBSCRIPTION' } })).toBe(true);
  });

  it('desk-raised bills are not: consultation, pharmacy, admin invoices', () => {
    expect(isOnlineCheckoutInvoice({ metadata: { appointmentType: 'IN_PERSON' } })).toBe(false);
    expect(
      isOnlineCheckoutInvoice({ metadata: { prescriptionId: 'rx-1', paymentFor: 'PHARMACY' } })
    ).toBe(false);
    expect(isOnlineCheckoutInvoice({ subscriptionId: null, metadata: null })).toBe(false);
    expect(isOnlineCheckoutInvoice(null)).toBe(false);
  });
});

describe('desk collection marker (PG-04 desk fallback)', () => {
  const actor = { userId: 'staff-1', role: 'RECEPTIONIST' };
  const now = new Date('2026-10-31T10:00:00.000Z');

  it('a plan invoice taken over by the desk is no longer an online checkout', () => {
    const metadata = withDeskCollectionMarker({ planId: 'plan-1' }, actor, now);
    expect(isDeskCollectedInvoice({ subscriptionId: 'sub-1', metadata })).toBe(true);
    expect(isOnlineCheckoutInvoice({ subscriptionId: 'sub-1', metadata })).toBe(false);
  });

  it('an online plan checkout without the marker keeps its payment window', () => {
    expect(isDeskCollectedInvoice({ subscriptionId: 'sub-1', metadata: {} })).toBe(false);
    expect(isOnlineCheckoutInvoice({ subscriptionId: 'sub-1', metadata: {} })).toBe(true);
    expect(isDeskCollectedInvoice(null)).toBe(false);
  });

  it('the marker keeps existing metadata, records who took it over, and does not mutate input', () => {
    const original = { planId: 'plan-1', periodEnd: '2026-11-30T00:00:00.000Z' };
    const marked = withDeskCollectionMarker(original, actor, now);
    expect(original).toEqual({ planId: 'plan-1', periodEnd: '2026-11-30T00:00:00.000Z' });
    expect(marked).toMatchObject({
      planId: 'plan-1',
      collectionChannel: DESK_COLLECTION_CHANNEL,
      deskCollection: { claimedBy: 'staff-1', claimedByRole: 'RECEPTIONIST' },
    });
  });

  it('a second takeover is idempotent: the first actor and time are kept', () => {
    const first = withDeskCollectionMarker({}, actor, now);
    const second = withDeskCollectionMarker(
      first,
      { userId: 'staff-2', role: 'CLINIC_ADMIN' },
      new Date(now.getTime() + 60_000)
    );
    expect(second).toEqual(first);
  });
});
