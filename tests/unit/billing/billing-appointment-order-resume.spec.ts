/// <reference types="jest" />
/**
 * Which gateway order a VIDEO_CALL checkout retry opens: the earlier order while the patient can
 * still pay it, never a second order once the first was paid, and a fresh order id otherwise.
 */
jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));

import { ConflictException } from '@nestjs/common';
import { PaymentProvider } from '@core/types';
import { createBillingService } from './billing-test-harness';

type ResolveArgs = {
  clinicId: string;
  invoice: { id: string; invoiceNumber: string };
  existingGatewayOrderId?: string;
  existingProvider?: string;
  requestedProvider?: PaymentProvider;
  amountMinor: number;
};
type Resolved = { gatewayOrderId: string; resumedIntent: unknown };

const invoice = { id: 'abcd1234-ffff-eeee', invoiceNumber: 'INV-2026-000344' };
const FIRST_ORDER_ID = 'INV-2026-000344abcd1234';

function setup(resumePaymentIntent: jest.Mock = jest.fn()) {
  const harness = createBillingService({ paymentService: { resumePaymentIntent } });
  const resolve = (args: Partial<ResolveArgs>): Promise<Resolved> =>
    (
      harness.service as unknown as {
        resolveAppointmentGatewayOrder: (a: ResolveArgs) => Promise<Resolved>;
      }
    ).resolveAppointmentGatewayOrder({
      clinicId: 'clinic-1',
      invoice,
      amountMinor: 59000,
      ...args,
    });
  return { resolve, resumePaymentIntent };
}

describe('BillingService.resolveAppointmentGatewayOrder', () => {
  it('a first attempt uses the invoice order id and asks the gateway nothing', async () => {
    const { resolve, resumePaymentIntent } = setup();

    await expect(resolve({})).resolves.toEqual({
      gatewayOrderId: FIRST_ORDER_ID,
      resumedIntent: null,
    });
    expect(resumePaymentIntent).not.toHaveBeenCalled();
  });

  it('a retry hands back the earlier order while it is still payable', async () => {
    const intent = { success: true, orderId: FIRST_ORDER_ID };
    const { resolve, resumePaymentIntent } = setup(
      jest.fn().mockResolvedValue({ resumable: true, result: intent })
    );

    const resolved = await resolve({
      existingGatewayOrderId: FIRST_ORDER_ID,
      existingProvider: PaymentProvider.CASHFREE,
    });

    expect(resolved).toEqual({ gatewayOrderId: FIRST_ORDER_ID, resumedIntent: intent });
    expect(resumePaymentIntent).toHaveBeenCalledWith(
      'clinic-1',
      { orderId: FIRST_ORDER_ID, amount: 59000, currency: 'INR' },
      PaymentProvider.CASHFREE
    );
  });

  it.each(['expired', 'not_active', 'amount_mismatch', 'not_found', 'no_session'])(
    'an unusable earlier order (%s) gets a fresh order id',
    async reason => {
      const { resolve } = setup(jest.fn().mockResolvedValue({ resumable: false, reason }));

      const resolved = await resolve({
        existingGatewayOrderId: FIRST_ORDER_ID,
        existingProvider: PaymentProvider.CASHFREE,
      });

      expect(resolved.resumedIntent).toBeNull();
      expect(resolved.gatewayOrderId).not.toBe(FIRST_ORDER_ID);
      expect(resolved.gatewayOrderId).toMatch(/^INV-2026-000344[a-z0-9]{1,8}$/);
    }
  );

  it('never opens a second order when the earlier one was already paid', async () => {
    const { resolve } = setup(jest.fn().mockResolvedValue({ resumable: false, reason: 'paid' }));

    await expect(
      resolve({
        existingGatewayOrderId: FIRST_ORDER_ID,
        existingProvider: PaymentProvider.CASHFREE,
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps the earlier order id when the gateway cannot answer', async () => {
    const { resolve } = setup(jest.fn().mockResolvedValue(undefined));

    await expect(
      resolve({
        existingGatewayOrderId: FIRST_ORDER_ID,
        existingProvider: PaymentProvider.CASHFREE,
      })
    ).resolves.toEqual({ gatewayOrderId: FIRST_ORDER_ID, resumedIntent: null });
  });

  it.each([
    ['the earlier provider is unknown', { existingProvider: 'not-a-provider' }],
    ['the earlier provider is missing', {}],
    [
      'the checkout asks for another provider',
      { existingProvider: PaymentProvider.CASHFREE, requestedProvider: PaymentProvider.RAZORPAY },
    ],
  ])('does not look the order up when %s', async (_label, extra) => {
    const { resolve, resumePaymentIntent } = setup();

    await expect(
      resolve({ existingGatewayOrderId: FIRST_ORDER_ID, ...(extra as Partial<ResolveArgs>) })
    ).resolves.toEqual({ gatewayOrderId: FIRST_ORDER_ID, resumedIntent: null });
    expect(resumePaymentIntent).not.toHaveBeenCalled();
  });
});
