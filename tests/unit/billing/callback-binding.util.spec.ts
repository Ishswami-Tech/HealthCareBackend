import { describe, expect, it } from '@jest/globals';
import {
  checkCallbackBinding,
  recordedOrderIds,
  type CallbackBindingPayment,
} from '../../../src/services/billing/callback-binding.util';

const victim: CallbackBindingPayment = {
  id: 'pay-victim',
  clinicId: 'clinic-1',
  appointmentId: 'apt-victim',
  invoiceId: 'inv-victim',
  subscriptionId: null,
  transactionId: 'order_victim',
  metadata: { orderId: 'order_victim', provider: 'cashfree' },
};

describe('checkCallbackBinding (callback replay)', () => {
  it('binds an order the payment recorded itself', () => {
    expect(
      checkCallbackBinding({
        payment: victim,
        callbackOrderId: 'order_victim',
        gateway: { currency: 'INR', metadata: { order_id: 'order_victim' } },
      })
    ).toEqual({ ok: true, via: 'recorded_order' });
  });

  it('rejects another paid order of the same amount (never confirm payment X with order Y)', () => {
    expect(
      checkCallbackBinding({
        payment: victim,
        callbackOrderId: 'order_attacker',
        gateway: {
          currency: 'INR',
          metadata: {
            order_id: 'order_attacker',
            order_tags: { appointmentId: 'apt-attacker', clinicId: 'clinic-1' },
          },
        },
      })
    ).toEqual({ ok: false, reason: 'GATEWAY_TAG_MISMATCH' });

    expect(
      checkCallbackBinding({
        payment: victim,
        callbackOrderId: 'order_untagged',
        gateway: { currency: 'INR', metadata: { order_id: 'order_untagged' } },
      })
    ).toEqual({ ok: false, reason: 'ORDER_NOT_OF_PAYMENT' });
  });

  it('accepts a bridge order whose gateway tags name this payment appointment', () => {
    expect(
      checkCallbackBinding({
        payment: victim,
        callbackOrderId: 'order_bridge',
        gateway: {
          currency: 'INR',
          metadata: { order_id: 'order_bridge', order_tags: { appointmentId: 'apt-victim' } },
        },
      })
    ).toEqual({ ok: true, via: 'gateway_tags' });
  });

  it('rejects a recorded order whose gateway tags point at another appointment', () => {
    expect(
      checkCallbackBinding({
        payment: victim,
        callbackOrderId: 'order_victim',
        gateway: { metadata: { order_tags: { appointmentId: 'apt-other' } } },
      })
    ).toEqual({ ok: false, reason: 'GATEWAY_TAG_MISMATCH' });
  });

  it('rejects a gateway answer for a different order than the one asked about', () => {
    expect(
      checkCallbackBinding({
        payment: victim,
        callbackOrderId: 'order_victim',
        gateway: { metadata: { order_id: 'order_other' } },
      })
    ).toEqual({ ok: false, reason: 'GATEWAY_ORDER_MISMATCH' });
  });

  it('rejects a non-INR currency', () => {
    expect(
      checkCallbackBinding({
        payment: victim,
        callbackOrderId: 'order_victim',
        gateway: { currency: 'usd' },
      })
    ).toEqual({ ok: false, reason: 'CURRENCY_MISMATCH' });
  });

  it('knows the superseded order, the intent id, the invoice number and the row id', () => {
    const ids = recordedOrderIds({
      id: 'pay-1',
      transactionId: null,
      appointmentId: null,
      metadata: {
        orderId: 'o-new',
        supersededOrderId: 'o-old',
        paymentIntentId: 'intent-1',
        invoiceNumber: 'INV-2026-000001',
      },
    });
    expect([...ids].sort()).toEqual(
      ['INV-2026-000001', 'intent-1', 'o-new', 'o-old', 'pay-1'].sort()
    );
  });
});
