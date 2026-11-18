/// <reference types="jest" />
/**
 * Checkout retries on Cashfree: an earlier order is handed back only while the patient can still
 * pay it for the same amount, and that is decided with a read-only lookup instead of re-sending
 * a create that Cashfree answers with 409.
 */
jest.mock('@infrastructure/http', () => ({ HttpService: class {} }));
jest.mock('@logging', () => ({ LoggingService: class {} }));

import { CashfreePaymentAdapter } from '@payment/adapters/cashfree/cashfree-payment.adapter';
import { PaymentProvider } from '@core/types';

const ORDER_ID = 'INV-2026-000344abcd1234';
const inMinutes = (minutes: number): string =>
  new Date(Date.now() + minutes * 60_000).toISOString();

function order(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cf_order_id: 1,
    order_id: ORDER_ID,
    entity: 'order',
    order_currency: 'INR',
    order_amount: 590,
    order_status: 'ACTIVE',
    order_expiry_time: inMinutes(10),
    created_at: inMinutes(-5),
    payment_session_id: 'session_abc',
    ...overrides,
  };
}

const httpError = (status: number) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });

function setup() {
  const http = { get: jest.fn(), post: jest.fn() };
  const logger = { log: jest.fn().mockResolvedValue(undefined) };
  const adapter = new CashfreePaymentAdapter(logger as never, http as never);
  adapter.initialize({
    provider: PaymentProvider.CASHFREE,
    enabled: true,
    credentials: { appId: 'app', secretKey: 'secret', environment: 'sandbox' },
  } as never);
  // No real back-off between create retries in tests.
  (adapter as unknown as { delay: () => Promise<void> }).delay = () => Promise.resolve();
  return { adapter, http };
}

describe('CashfreePaymentAdapter.resumePaymentIntent', () => {
  it('hands back an active order for the same amount, without creating anything', async () => {
    const { adapter, http } = setup();
    http.get.mockResolvedValue({ data: order() });

    const outcome = await adapter.resumePaymentIntent({
      orderId: ORDER_ID,
      amount: 59000,
      currency: 'INR',
    });

    expect(outcome.resumable).toBe(true);
    if (!outcome.resumable) return;
    expect(outcome.result.orderId).toBe(ORDER_ID);
    expect(outcome.result.metadata?.['paymentSessionId']).toBe('session_abc');
    expect(http.post).not.toHaveBeenCalled();
    // A lookup must not be logged as an error by the HTTP layer.
    expect(http.get.mock.calls[0][1]).toMatchObject({ suppressErrorLogging: true });
  });

  it.each([
    ['paid', { order_status: 'PAID' }],
    ['expired', { order_status: 'EXPIRED' }],
    ['not_active', { order_status: 'TERMINATED' }],
    ['amount_mismatch', { order_amount: 500 }],
    ['amount_mismatch', { order_currency: 'USD' }],
    ['expired', { order_expiry_time: inMinutes(2) }],
    ['expired', { order_expiry_time: 'not-a-date' }],
    ['no_session', { payment_session_id: undefined }],
  ])('refuses to reuse the order: %s (%o)', async (reason, overrides) => {
    const { adapter, http } = setup();
    http.get.mockResolvedValue({ data: order(overrides) });

    const outcome = await adapter.resumePaymentIntent({
      orderId: ORDER_ID,
      amount: 59000,
      currency: 'INR',
    });

    expect(outcome).toMatchObject({ resumable: false, reason });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('reports an unknown order as not_found', async () => {
    const { adapter, http } = setup();
    http.get.mockRejectedValue(httpError(404));

    await expect(
      adapter.resumePaymentIntent({ orderId: ORDER_ID, amount: 59000, currency: 'INR' })
    ).resolves.toEqual({ resumable: false, reason: 'not_found' });
  });

  it('rethrows a failed lookup so the caller can fall back', async () => {
    const { adapter, http } = setup();
    http.get.mockRejectedValue(httpError(503));

    await expect(
      adapter.resumePaymentIntent({ orderId: ORDER_ID, amount: 59000, currency: 'INR' })
    ).rejects.toThrow('503');
  });
});

describe('CashfreePaymentAdapter.createPaymentIntent duplicate order (409)', () => {
  const intent = {
    amount: 59000,
    currency: 'INR',
    orderId: ORDER_ID,
    customerId: 'user-1',
    customerPhone: '+919999999999',
    appointmentId: 'appt-1',
    appointmentType: 'VIDEO_CALL' as const,
    clinicId: 'clinic-1',
  };

  it('returns the existing order when it is still payable', async () => {
    const { adapter, http } = setup();
    http.post.mockRejectedValue(httpError(409));
    http.get.mockResolvedValue({ data: order() });

    const result = await adapter.createPaymentIntent(intent);

    expect(result.success).toBe(true);
    expect(result.metadata?.['paymentSessionId']).toBe('session_abc');
  });

  it.each([
    ['an expired order', { order_status: 'EXPIRED' }],
    ['a paid order', { order_status: 'PAID' }],
    ['an order for a different amount', { order_amount: 100 }],
  ])('fails instead of returning %s', async (_label, overrides) => {
    const { adapter, http } = setup();
    http.post.mockRejectedValue(httpError(409));
    http.get.mockResolvedValue({ data: order(overrides) });

    const result = await adapter.createPaymentIntent(intent);

    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot be reused');
    expect(http.post).toHaveBeenCalledTimes(1);
  });
});
