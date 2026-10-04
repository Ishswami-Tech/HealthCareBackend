/// <reference types="jest" />
/**
 * Manual admin reconciliation confirms a paid appointment even after its own window elapsed.
 * It must not stamp an already-past `confirmationExpiresAt`, or the scheduler would expire the
 * freshly confirmed (and paid) visit on its very next run.
 */

jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));

import { createBillingService } from './billing-test-harness';

type UpdateManyArgs = {
  where: { id: string };
  data: { status: string; confirmationExpiresAt: Date | null };
};

const CLINIC_ID = 'clinic-1';

function setup(appointment: Record<string, unknown>) {
  const updateManyCalls: UpdateManyArgs[] = [];
  const databaseService = {
    findAppointmentByIdSafe: jest.fn().mockResolvedValue(appointment),
    findPaymentsSafe: jest.fn().mockResolvedValue([]),
    executeHealthcareWrite: jest.fn(async (operation: (client: unknown) => Promise<unknown>) =>
      operation({
        appointment: {
          updateMany: async (args: UpdateManyArgs): Promise<{ count: number }> => {
            updateManyCalls.push(args);
            return { count: 1 };
          },
        },
      })
    ),
  };
  const paymentService = {
    verifyPaymentStatus: jest.fn().mockResolvedValue({
      paymentId: 'order-1',
      status: 'completed',
      amount: 500,
      currency: 'INR',
      transactionId: 'cf-tx-1',
      provider: 'cashfree',
      timestamp: new Date(),
    }),
  };
  const harness = createBillingService({ databaseService, paymentService });
  jest
    .spyOn(harness.service, 'createPayment')
    .mockResolvedValue({ id: 'pay-9', metadata: {}, amount: 500 } as never);
  jest.spyOn(harness.service, 'updatePayment').mockResolvedValue({ id: 'pay-9' } as never);
  jest.spyOn(harness.service, 'syncAppointmentAfterPayment').mockResolvedValue(null);
  return { ...harness, updateManyCalls };
}

describe('BillingService.manualReconcileAppointmentPayment', () => {
  it('clamps the expiry to a future moment when the visit window already elapsed', async () => {
    const stale = {
      id: 'apt-1',
      clinicId: CLINIC_ID,
      status: 'EXPIRED',
      type: 'VIDEO_CALL',
      date: new Date(Date.now() - 48 * 3600 * 1000),
      time: '09:00',
      userId: 'user-1',
    };
    const { service, updateManyCalls } = setup(stale);

    await service.manualReconcileAppointmentPayment(CLINIC_ID, 'apt-1', 'admin-1', {
      orderId: 'order-1',
    });

    expect(updateManyCalls).toHaveLength(1);
    const expiry = updateManyCalls[0]?.data.confirmationExpiresAt;
    expect(updateManyCalls[0]?.data.status).toBe('CONFIRMED');
    expect(expiry).toBeInstanceOf(Date);
    expect((expiry as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('keeps the visit-based expiry when the visit is still ahead', async () => {
    const upcoming = {
      id: 'apt-1',
      clinicId: CLINIC_ID,
      status: 'PENDING',
      type: 'VIDEO_CALL',
      date: new Date(Date.now() + 48 * 3600 * 1000),
      time: '09:00',
      userId: 'user-1',
    };
    const { service, updateManyCalls } = setup(upcoming);

    await service.manualReconcileAppointmentPayment(CLINIC_ID, 'apt-1', 'admin-1', {
      orderId: 'order-1',
    });

    const expiry = updateManyCalls[0]?.data.confirmationExpiresAt as Date;
    expect(expiry.getTime()).toBeGreaterThan(Date.now() + 24 * 3600 * 1000);
  });
});
