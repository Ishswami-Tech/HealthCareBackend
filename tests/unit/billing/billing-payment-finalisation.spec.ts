/// <reference types="jest" />
/**
 * Payment finalisation driven through a STATEFUL fake database (real compare-and-set semantics,
 * real interleaving) - not spies. The real BillingService methods run; only the gateway, the
 * event bus and the PDF renderer are stubbed.
 *
 * Proven here: two overlapping deliveries grant exactly one subscription period / one ledger row /
 * one receipt; a crash between the claim and the side effects is repaired exactly once; a lost
 * acknowledgement still ends with the side effects applied once; a legitimate winner is never
 * flagged as a duplicate; amounts are verified before an invoice is PAID or a plan activated.
 */

jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));

import { ForbiddenException } from '@nestjs/common';
import {
  CLINIC_ID,
  ageClaim,
  createFinalisationWorld,
  gatewayResult,
  waitFor,
} from './billing-finalisation-world';

function marker(
  world: ReturnType<typeof createFinalisationWorld>,
  paymentId = 'pay-1'
): {
  claimToken: string;
  claimedAt: string;
  sideEffectsAppliedAt: string | null;
} {
  return world.db.metadata('payment', paymentId)['finalisation'] as {
    claimToken: string;
    claimedAt: string;
    sideEffectsAppliedAt: string | null;
  };
}

function ledgerEntries(
  world: ReturnType<typeof createFinalisationWorld>,
  paymentId = 'pay-1'
): number {
  const payout = world.db.metadata('payment', paymentId)['payout'] as
    { ledger: unknown[] } | undefined;
  return payout?.ledger.length ?? 0;
}

function renewedIds(world: ReturnType<typeof createFinalisationWorld>): string[] {
  const metadata = world.db.row('subscription', 'sub-1')['metadata'] as {
    renewedPaymentIds?: string[];
  } | null;
  return metadata?.renewedPaymentIds ?? [];
}

describe('payment finalisation - concurrent deliveries', () => {
  it('grants exactly one period, one ledger row, one receipt and no duplicate flag when two deliveries race', async () => {
    const world = createFinalisationWorld();

    const [first, second] = await Promise.all([world.deliver(), world.deliver()]);

    // One delivery won the claim and finalised; the other only reported "processing"/duplicate.
    const processing = [first, second].filter(result => result.processing === true);
    expect(processing.length).toBeLessThanOrEqual(1);

    expect(world.db.row('subscription', 'sub-1')['status']).toBe('ACTIVE');
    expect(renewedIds(world)).toEqual(['pay-1']);
    const sub = world.db.row('subscription', 'sub-1');
    const periodMs =
      (sub['currentPeriodEnd'] as Date).getTime() - (sub['currentPeriodStart'] as Date).getTime();
    expect(periodMs).toBeGreaterThan(27 * 24 * 3600 * 1000);
    expect(periodMs).toBeLessThan(32 * 24 * 3600 * 1000); // ONE interval, never two

    expect(world.events('billing.subscription.renewed')).toHaveLength(1);
    expect(world.events('billing.receipt.paid')).toHaveLength(1);
    expect(world.generatePdf).toHaveBeenCalledTimes(1);
    expect(ledgerEntries(world)).toBe(1);
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(1);
    expect(world.events('billing.payment.duplicate_settlement')).toHaveLength(0);
    expect(world.db.row('invoice', 'inv-1')['status']).toBe('PAID');
    expect(marker(world).sideEffectsAppliedAt).not.toBeNull();
    expect(world.db.metadata('payment', 'pay-1')['settlementReview']).toBeUndefined();
  });

  it('answers "processing" and runs NOTHING while the winner is still working (young claim)', async () => {
    const world = createFinalisationWorld();
    const release = world.db.gate('subscription.updateMany');

    const winner = world.deliver();
    await waitFor(() => world.db.count('subscription.updateMany') >= 1, 'winner at the gate');

    const callsBefore = world.db.calls.length;
    const follower = await world.deliver();

    expect(follower.processing).toBe(true);
    // The follower re-read the payment, nothing more: no write, no event.
    const followerCalls = world.db.calls.slice(callsBefore);
    expect(followerCalls.filter(call => call.endsWith('.updateMany'))).toEqual([]);
    expect(world.db.row('subscription', 'sub-1')['status']).toBe('INCOMPLETE');

    release();
    await winner;
    expect(renewedIds(world)).toEqual(['pay-1']);
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(1);
  });

  it('a delivery after the finalisation finished is a pure duplicate: read-only, no second effect', async () => {
    const world = createFinalisationWorld();
    await world.deliver();
    const writesBefore = world.db.calls.filter(call => call.endsWith('.updateMany')).length;
    const eventsBefore = world.eventService['emit']?.mock.calls.length ?? 0;

    const duplicate = await world.deliver();

    expect(duplicate.processing).toBeUndefined();
    expect(world.db.calls.filter(call => call.endsWith('.updateMany')).length).toBe(writesBefore);
    expect(world.eventService['emit']?.mock.calls.length ?? 0).toBe(eventsBefore);
    expect(renewedIds(world)).toEqual(['pay-1']);
    expect(world.events('billing.payment.duplicate_settlement')).toHaveLength(0);
  });
});

describe('payment finalisation - crash between the claim and the side effects', () => {
  it('repairs the full set exactly once after the grace window, and never before', async () => {
    const world = createFinalisationWorld();
    world.db.failOnce('subscription.updateMany');

    await expect(world.deliver()).rejects.toThrow('injected failure');

    // State left by the crash: claimed + invoice settled, nothing else.
    expect(world.db.row('payment', 'pay-1')['status']).toBe('COMPLETED');
    expect(world.db.row('invoice', 'inv-1')['status']).toBe('PAID');
    expect(world.db.row('subscription', 'sub-1')['status']).toBe('INCOMPLETE');
    expect(marker(world).sideEffectsAppliedAt).toBeNull();
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(0);

    // A retry inside the grace window must not race a worker that may still be alive.
    const early = await world.deliver();
    expect(early.processing).toBe(true);
    expect(world.db.row('subscription', 'sub-1')['status']).toBe('INCOMPLETE');

    // After the grace window the winner is presumed crashed: the FULL set is re-applied once.
    ageClaim(world.db, 'pay-1', 5 * 60 * 1000);
    const repaired = await world.deliver();
    expect(repaired.processing).toBeUndefined();
    expect(world.db.row('subscription', 'sub-1')['status']).toBe('ACTIVE');
    expect(renewedIds(world)).toEqual(['pay-1']);
    expect(ledgerEntries(world)).toBe(1);
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(1);
    // The receipt left by the crashed run is not sent a second time.
    expect(world.events('billing.receipt.paid')).toHaveLength(1);
    expect(marker(world).sideEffectsAppliedAt).not.toBeNull();
    expect(world.events('billing.payment.duplicate_settlement')).toHaveLength(0);

    // Replays after the repair change nothing.
    const writes = world.db.calls.filter(call => call.endsWith('.updateMany')).length;
    await world.deliver();
    expect(world.db.calls.filter(call => call.endsWith('.updateMany')).length).toBe(writes);
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(1);
  });

  it('two repair runs at once take the claim over only once', async () => {
    const world = createFinalisationWorld();
    world.db.failOnce('subscription.updateMany');
    await expect(world.deliver()).rejects.toThrow();
    ageClaim(world.db, 'pay-1', 5 * 60 * 1000);

    const results = await Promise.all([world.deliver(), world.deliver()]);

    expect(results.filter(result => result.processing === true).length).toBeLessThanOrEqual(1);
    expect(renewedIds(world)).toEqual(['pay-1']);
    expect(ledgerEntries(world)).toBe(1);
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(1);
    expect(world.events('billing.subscription.renewed')).toHaveLength(1);
  });

  it('the sweeper repairs a stalled finalisation nobody polls for', async () => {
    const world = createFinalisationWorld();
    world.db.failOnce('subscription.updateMany');
    await expect(world.deliver()).rejects.toThrow();
    // Not yet stale: nothing to repair.
    await expect(world.service.repairStalledPaymentFinalisations()).resolves.toBe(0);

    ageClaim(world.db, 'pay-1', 5 * 60 * 1000);
    // The sweeper only looks at rows idle for the grace window: age the row itself too.
    world.db.row('payment', 'pay-1')['updatedAt'] = new Date(Date.now() - 5 * 60 * 1000);

    await expect(world.service.repairStalledPaymentFinalisations()).resolves.toBe(1);
    expect(world.db.row('subscription', 'sub-1')['status']).toBe('ACTIVE');
    expect(marker(world).sideEffectsAppliedAt).not.toBeNull();
  });
});

describe('payment finalisation - lost acknowledgement', () => {
  it('a claim that committed but reported "0 rows" is recognised by its token and finishes the job once', async () => {
    const world = createFinalisationWorld();
    world.db.loseNextClaimAck = true;

    const result = await world.deliver();

    expect(result.processing).toBeUndefined();
    expect(world.db.row('payment', 'pay-1')['status']).toBe('COMPLETED');
    expect(world.db.row('subscription', 'sub-1')['status']).toBe('ACTIVE');
    expect(renewedIds(world)).toEqual(['pay-1']);
    expect(ledgerEntries(world)).toBe(1);
    expect(world.events('billing.receipt.paid')).toHaveLength(1);
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(1);
    expect(marker(world).sideEffectsAppliedAt).not.toBeNull();
    expect(world.events('billing.payment.duplicate_settlement')).toHaveLength(0);
  });
});

describe('payment finalisation - stale read cache', () => {
  it('re-decides from the fresh row when the cached snapshot said PENDING but the payment had FAILED', async () => {
    const world = createFinalisationWorld({ payment: { status: 'FAILED' } });
    const stale = { ...world.db.row('payment', 'pay-1'), status: 'PENDING' };
    world.db.service.findPaymentByIdSafe.mockImplementationOnce(async () => stale);

    await world.deliver();

    // The claim on the stale PENDING observed status matched nothing; the retry on FAILED won.
    expect(world.db.row('payment', 'pay-1')['status']).toBe('COMPLETED');
    expect(world.db.row('subscription', 'sub-1')['status']).toBe('ACTIVE');
    expect(renewedIds(world)).toEqual(['pay-1']);
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(1);
  });

  it('flags a late settlement when the cached snapshot said PENDING but the payment was CANCELLED', async () => {
    const world = createFinalisationWorld({ payment: { status: 'CANCELLED' } });
    const stale = { ...world.db.row('payment', 'pay-1'), status: 'PENDING' };
    world.db.service.findPaymentByIdSafe.mockImplementationOnce(async () => stale);

    await world.deliver();

    expect(world.db.row('payment', 'pay-1')['status']).toBe('CANCELLED');
    expect(world.events('billing.payment.late_settlement')).toHaveLength(1);
    expect(world.db.row('subscription', 'sub-1')['status']).toBe('INCOMPLETE');
  });
});

describe('payment finalisation - amount verification', () => {
  it('leaves the invoice PENDING and the plan INCOMPLETE when the payment does not cover the total', async () => {
    const world = createFinalisationWorld(
      { payment: { amount: 100 } },
      gatewayResult({ amount: 100 })
    );

    await world.deliver();

    expect(world.db.row('invoice', 'inv-1')['status']).toBe('PENDING');
    expect(world.db.row('subscription', 'sub-1')['status']).toBe('INCOMPLETE');
    expect(renewedIds(world)).toEqual([]);
    expect(ledgerEntries(world)).toBe(0);
    expect(world.events('billing.receipt.paid')).toHaveLength(0);
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(0);
    expect(world.events('billing.payment.underpaid')).toHaveLength(1);
    const review = world.db.metadata('payment', 'pay-1')['settlementReview'] as {
      reason: string;
      status: string;
    };
    expect(review).toMatchObject({ reason: 'UNDERPAYMENT', status: 'PENDING_REVIEW' });
    // The decision is final for this delivery: a replay does not flag again.
    await world.deliver();
    expect(world.events('billing.payment.underpaid')).toHaveLength(1);
  });

  it('settles the invoice once COMPLETED payments add up to the total (compared in paise)', async () => {
    const world = createFinalisationWorld(
      { payment: { amount: 60 } },
      gatewayResult({ amount: 60, transactionId: 'cf-tx-a' })
    );
    await world.deliver();
    expect(world.db.row('invoice', 'inv-1')['status']).toBe('PENDING');

    world.db.seed('payment', {
      id: 'pay-2',
      clinicId: CLINIC_ID,
      userId: 'user-1',
      invoiceId: 'inv-1',
      subscriptionId: 'sub-1',
      appointmentId: null,
      amount: 58,
      status: 'PENDING',
      transactionId: 'order-2',
      metadata: { orderId: 'order-2' },
    });
    world.paymentService['verifyPaymentStatus']?.mockResolvedValue(
      gatewayResult({ amount: 58, transactionId: 'cf-tx-b', paymentId: 'order-2' })
    );

    await world.deliver('pay-2', 'order-2');

    expect(world.db.row('invoice', 'inv-1')['status']).toBe('PAID');
    expect(world.db.metadata('invoice', 'inv-1')['settledByPaymentId']).toBe('pay-2');
    expect(world.db.row('subscription', 'sub-1')['status']).toBe('ACTIVE');
    expect(renewedIds(world)).toEqual(['pay-2']);
  });

  it('does not activate a plan paid without an invoice for less than the plan price', async () => {
    const world = createFinalisationWorld(
      { invoice: null, payment: { amount: 50 } },
      gatewayResult({ amount: 50 })
    );

    await world.deliver();

    expect(world.db.row('subscription', 'sub-1')['status']).toBe('INCOMPLETE');
    expect(renewedIds(world)).toEqual([]);
    expect(world.events('billing.payment.underpaid')).toHaveLength(1);
  });

  it('activates a plan paid without an invoice when the payment reaches the plan price', async () => {
    const world = createFinalisationWorld(
      { invoice: null, payment: { amount: 100 } },
      gatewayResult({ amount: 100 })
    );

    await world.deliver();

    expect(world.db.row('subscription', 'sub-1')['status']).toBe('ACTIVE');
    expect(renewedIds(world)).toEqual(['pay-1']);
  });
});

describe('payment finalisation - duplicate and late settlements', () => {
  it('flags a genuinely different second payment on a settled invoice: no plan period, no revenue', async () => {
    const world = createFinalisationWorld();
    await world.deliver();
    const periodEnd = (world.db.row('subscription', 'sub-1')['currentPeriodEnd'] as Date).getTime();

    world.db.seed('payment', {
      id: 'pay-2',
      clinicId: CLINIC_ID,
      userId: 'user-1',
      invoiceId: 'inv-1',
      subscriptionId: 'sub-1',
      appointmentId: null,
      amount: 118,
      status: 'PENDING',
      transactionId: 'order-2',
      metadata: { orderId: 'order-2' },
    });
    world.paymentService['verifyPaymentStatus']?.mockResolvedValue(
      gatewayResult({ transactionId: 'cf-tx-2', paymentId: 'order-2' })
    );

    await world.deliver('pay-2', 'order-2');

    expect((world.db.row('subscription', 'sub-1')['currentPeriodEnd'] as Date).getTime()).toBe(
      periodEnd
    );
    expect(renewedIds(world)).toEqual(['pay-1']);
    expect(ledgerEntries(world, 'pay-2')).toBe(0);
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(1);
    expect(world.events('billing.payment.duplicate_settlement')).toHaveLength(1);
    expect(world.db.metadata('payment', 'pay-2')['settlementReview']).toMatchObject({
      reason: 'DUPLICATE_SETTLEMENT',
      status: 'PENDING_REVIEW',
    });
    // The legitimate winner is untouched.
    expect(world.db.metadata('payment', 'pay-1')['settlementReview']).toBeUndefined();
    expect(world.events('billing.receipt.paid')).toHaveLength(1);
  });

  it('flags a second paid gateway order for an already settled payment instead of dropping it', async () => {
    const world = createFinalisationWorld();
    await world.deliver();
    const before = world.db.row('payment', 'pay-1')['status'];

    world.paymentService['verifyPaymentStatus']?.mockResolvedValue(
      gatewayResult({ transactionId: 'cf-tx-other', paymentId: 'order-9', amount: 118 })
    );
    await world.deliver('pay-1', 'order-9');
    await world.deliver('pay-1', 'order-9'); // redelivery of the same extra order: no spam

    expect(world.db.row('payment', 'pay-1')['status']).toBe(before);
    expect(world.events('billing.payment.duplicate_settlement')).toHaveLength(1);
    const review = world.db.metadata('payment', 'pay-1')['settlementReview'] as {
      settlements: Array<{ transactionId: string }>;
    };
    expect(review.settlements.map(item => item.transactionId)).toEqual(['cf-tx-other']);
    expect(renewedIds(world)).toEqual(['pay-1']);
  });

  it('never treats a redelivery of the settled order as a second payment', async () => {
    const world = createFinalisationWorld();
    await world.deliver();
    await world.deliver();
    await world.deliver();

    expect(world.events('billing.payment.duplicate_settlement')).toHaveLength(0);
    expect(world.db.metadata('payment', 'pay-1')['settlementReview']).toBeUndefined();
  });

  it.each(['CANCELLED', 'EXPIRED'])(
    'a gateway success for a locally %s payment emits late_settlement and changes nothing',
    async status => {
      const world = createFinalisationWorld({ payment: { status } });

      await world.deliver();

      expect(world.db.row('payment', 'pay-1')['status']).toBe(status);
      expect(world.events('billing.payment.late_settlement')).toHaveLength(1);
      expect(world.db.row('subscription', 'sub-1')['status']).toBe('INCOMPLETE');
      expect(world.db.row('invoice', 'inv-1')['status']).toBe('PENDING');
      // No refund machinery: nothing is persisted for a late settlement.
      expect(world.db.metadata('payment', 'pay-1')['settlementReview']).toBeUndefined();
      expect(world.db.count('payment.updateMany')).toBe(0);
    }
  );
});

describe('payment finalisation - ownership of the payment targets', () => {
  it('rejects a payment whose invoice belongs to another clinic and changes nothing', async () => {
    const world = createFinalisationWorld({ invoice: { clinicId: 'clinic-other' } });

    await expect(world.deliver()).rejects.toBeInstanceOf(ForbiddenException);

    expect(world.db.row('payment', 'pay-1')['status']).toBe('PENDING');
    expect(world.db.row('invoice', 'inv-1')['status']).toBe('PENDING');
    expect(world.db.row('subscription', 'sub-1')['status']).toBe('INCOMPLETE');
  });

  it('rejects a payment whose subscription belongs to another user', async () => {
    const world = createFinalisationWorld({ subscription: { userId: 'someone-else' } });

    await expect(world.deliver()).rejects.toBeInstanceOf(ForbiddenException);
    expect(world.db.row('payment', 'pay-1')['status']).toBe('PENDING');
  });
});

describe('payment finalisation - appointment payments (VIDEO_CALL)', () => {
  function appointmentWorld(appointment: Record<string, unknown>) {
    return createFinalisationWorld(
      {
        subscription: null,
        invoice: { subscriptionId: null },
        payment: { subscriptionId: null, appointmentId: 'apt-1' },
        appointment: {
          id: 'apt-1',
          clinicId: CLINIC_ID,
          userId: 'user-1',
          patientId: 'patient-1',
          doctorId: 'doctor-1',
          type: 'VIDEO_CALL',
          status: 'PENDING',
          paymentExpiresAt: new Date(Date.now() + 3600 * 1000),
          date: new Date(Date.now() + 24 * 3600 * 1000),
          time: '10:00',
          patient: { userId: 'user-1' },
          ...appointment,
        },
      },
      gatewayResult()
    );
  }

  it('confirms a PENDING appointment whose payment window is open', async () => {
    const world = appointmentWorld({});

    const result = await world.deliver();

    expect(world.db.row('appointment', 'apt-1')['status']).toBe('CONFIRMED');
    expect(world.db.row('appointment', 'apt-1')['confirmationExpiresAt']).toBeInstanceOf(Date);
    expect(result.appointment).toBeDefined();
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(1);
  });

  it('never confirms an appointment whose payment window already lapsed', async () => {
    const world = appointmentWorld({ paymentExpiresAt: new Date(Date.now() - 1000) });

    const result = await world.deliver();

    expect(world.db.row('appointment', 'apt-1')['status']).toBe('PENDING');
    expect(result.appointment).toBeUndefined();
    // The completed payment is still announced: the listener decides (late settlement).
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(1);
  });

  it.each(['CANCELLED', 'EXPIRED', 'COMPLETED', 'IN_PROGRESS'])(
    'never moves a %s appointment to CONFIRMED',
    async status => {
      const world = appointmentWorld({ status });

      await world.deliver();

      expect(world.db.row('appointment', 'apt-1')['status']).toBe(status);
    }
  );
});

describe('manual reconcile of a COMPLETED payment whose appointment is unconfirmed', () => {
  it('confirms the appointment (window or not) once, and refuses a second repair', async () => {
    const world = createFinalisationWorld(
      {
        subscription: null,
        invoice: { subscriptionId: null },
        payment: {
          subscriptionId: null,
          appointmentId: 'apt-1',
          status: 'COMPLETED',
          metadata: {
            orderId: 'order-1',
            provider: 'cashfree',
            finalisation: {
              claimToken: 'old',
              claimedAt: new Date().toISOString(),
              sideEffectsAppliedAt: new Date().toISOString(),
            },
          },
        },
        appointment: {
          id: 'apt-1',
          clinicId: CLINIC_ID,
          userId: 'user-1',
          patientId: 'patient-1',
          doctorId: 'doctor-1',
          type: 'VIDEO_CALL',
          status: 'PENDING',
          paymentExpiresAt: new Date(Date.now() - 3600 * 1000),
          date: new Date(Date.now() + 24 * 3600 * 1000),
          time: '10:00',
          patient: { userId: 'user-1' },
        },
      },
      gatewayResult()
    );

    const outcome = await world.service.manualReconcileAppointmentPayment(
      CLINIC_ID,
      'apt-1',
      'admin-1',
      { orderId: 'order-1' }
    );

    expect(world.db.row('appointment', 'apt-1')['status']).toBe('CONFIRMED');
    expect((outcome.appointment as { id: string }).id).toBe('apt-1');
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(1);

    await expect(
      world.service.manualReconcileAppointmentPayment(CLINIC_ID, 'apt-1', 'admin-1', {
        orderId: 'order-1',
      })
    ).rejects.toThrow('already marked completed');
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(1);
  });

  it('completes a half-finalised payment (claim without side effects) through the repair path', async () => {
    const world = createFinalisationWorld(
      {
        subscription: null,
        invoice: { subscriptionId: null },
        payment: {
          subscriptionId: null,
          appointmentId: 'apt-1',
          status: 'COMPLETED',
          metadata: {
            orderId: 'order-1',
            finalisation: {
              claimToken: 'crashed',
              claimedAt: new Date().toISOString(),
              sideEffectsAppliedAt: null,
            },
          },
        },
        appointment: {
          id: 'apt-1',
          clinicId: CLINIC_ID,
          userId: 'user-1',
          patientId: 'patient-1',
          doctorId: 'doctor-1',
          type: 'VIDEO_CALL',
          status: 'PENDING',
          paymentExpiresAt: new Date(Date.now() + 3600 * 1000),
          date: new Date(Date.now() + 24 * 3600 * 1000),
          time: '10:00',
          patient: { userId: 'user-1' },
        },
      },
      gatewayResult()
    );

    await world.service.manualReconcileAppointmentPayment(CLINIC_ID, 'apt-1', 'admin-1', {
      orderId: 'order-1',
    });

    // Young claim, but an admin forces the repair.
    expect(world.db.row('appointment', 'apt-1')['status']).toBe('CONFIRMED');
    expect(world.db.row('invoice', 'inv-1')['status']).toBe('PAID');
    expect(marker(world).sideEffectsAppliedAt).not.toBeNull();
    expect(world.enterpriseEvents('payment.completed')).toHaveLength(1);
  });
});
