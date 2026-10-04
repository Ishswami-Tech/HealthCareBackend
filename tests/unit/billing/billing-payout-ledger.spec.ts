/// <reference types="jest" />
/**
 * Payout / ledger metadata writes are compare-and-set on the payment row: written at most once,
 * never over a concurrent metadata writer (the finalisation marker), and never for a payment that
 * was flagged as a duplicate / underpayment.
 */

jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));

import { CLINIC_ID, createFinalisationWorld } from './billing-finalisation-world';
import type { FinalisationWorld } from './billing-finalisation-world';

function appointmentPaymentWorld(metadata: Record<string, unknown> = {}): FinalisationWorld {
  return createFinalisationWorld({
    subscription: null,
    invoice: { subscriptionId: null },
    payment: {
      subscriptionId: null,
      appointmentId: 'apt-1',
      status: 'COMPLETED',
      metadata: {
        orderId: 'order-1',
        finalisation: {
          claimToken: 't',
          claimedAt: new Date().toISOString(),
          sideEffectsAppliedAt: null,
        },
        ...metadata,
      },
    },
    appointment: {
      id: 'apt-1',
      clinicId: CLINIC_ID,
      doctorId: 'doctor-1',
      status: 'CONFIRMED',
      patient: { userId: 'user-1' },
    },
  });
}

describe('BillingService.preparePayoutForAppointmentPayment', () => {
  it('prepares the payout exactly once, even for concurrent calls, keeping other metadata', async () => {
    const world = appointmentPaymentWorld();

    await Promise.all([
      world.service.preparePayoutForAppointmentPayment('pay-1', CLINIC_ID),
      world.service.preparePayoutForAppointmentPayment('pay-1', CLINIC_ID),
      world.service.preparePayoutForAppointmentPayment('pay-1', CLINIC_ID),
    ]);

    const metadata = world.db.metadata('payment', 'pay-1');
    const payout = metadata['payout'] as { state: string; ledger: unknown[] };
    expect(payout.state).toBe('PAYOUT_PENDING');
    expect(payout.ledger).toHaveLength(2); // PLATFORM_CREDIT + DOCTOR_PAYABLE_CREDIT, once
    expect(metadata['finalisation']).toBeDefined(); // the marker was not clobbered
    expect(metadata['orderId']).toBe('order-1');
  });

  it('prepares nothing for a payment flagged as a duplicate settlement', async () => {
    const world = appointmentPaymentWorld({
      settlementReview: { reason: 'DUPLICATE_SETTLEMENT', status: 'PENDING_REVIEW' },
    });

    await world.service.preparePayoutForAppointmentPayment('pay-1', CLINIC_ID);

    expect(world.db.metadata('payment', 'pay-1')['payout']).toBeUndefined();
  });

  it('prepares nothing for a payment that is not COMPLETED', async () => {
    const world = createFinalisationWorld({
      subscription: null,
      invoice: null,
      payment: { subscriptionId: null, appointmentId: 'apt-1', status: 'PENDING' },
      appointment: { id: 'apt-1', clinicId: CLINIC_ID, doctorId: 'doctor-1', status: 'PENDING' },
    });

    await world.service.preparePayoutForAppointmentPayment('pay-1', CLINIC_ID);

    expect(world.db.metadata('payment', 'pay-1')['payout']).toBeUndefined();
  });
});

describe('BillingService.prepareLedgerForSubscriptionPayment', () => {
  function completedSubscriptionPayment(metadata: Record<string, unknown> = {}): FinalisationWorld {
    return createFinalisationWorld({ payment: { status: 'COMPLETED', metadata } });
  }

  it('records the revenue once per payment, however often it is called', async () => {
    const world = completedSubscriptionPayment();

    await Promise.all([
      world.service.prepareLedgerForSubscriptionPayment('pay-1', CLINIC_ID),
      world.service.prepareLedgerForSubscriptionPayment('pay-1', CLINIC_ID),
    ]);
    await world.service.prepareLedgerForSubscriptionPayment('pay-1', CLINIC_ID);

    const payout = world.db.metadata('payment', 'pay-1')['payout'] as {
      state: string;
      ledger: unknown[];
    };
    expect(payout.state).toBe('REVENUE_RECORDED');
    expect(payout.ledger).toHaveLength(1);
    expect(world.db.metadata('payment', 'pay-1')['revenueModel']).toBe('SUBSCRIPTION');
  });

  it('writes no revenue for a payment flagged as a duplicate / underpayment', async () => {
    const world = completedSubscriptionPayment({
      settlementReview: { reason: 'UNDERPAYMENT', status: 'PENDING_REVIEW' },
    });

    await world.service.prepareLedgerForSubscriptionPayment('pay-1', CLINIC_ID);

    expect(world.db.metadata('payment', 'pay-1')['payout']).toBeUndefined();
  });

  it('uses the override subscription id when the payment row carries none', async () => {
    const world = createFinalisationWorld({
      payment: { status: 'COMPLETED', subscriptionId: null },
    });

    await world.service.prepareLedgerForSubscriptionPayment('pay-1', CLINIC_ID);
    expect(world.db.metadata('payment', 'pay-1')['payout']).toBeUndefined();

    await world.service.prepareLedgerForSubscriptionPayment('pay-1', CLINIC_ID, 'sub-1');
    expect(world.db.metadata('payment', 'pay-1')['payout']).toBeDefined();
  });
});
