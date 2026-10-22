import { describe, expect, it } from '@jest/globals';
import { isOnlineCheckoutInvoice } from '../../../src/services/billing/checkout-invoice-kind.util';

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
