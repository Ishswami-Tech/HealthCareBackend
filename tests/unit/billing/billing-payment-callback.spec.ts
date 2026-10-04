/// <reference types="jest" />
/**
 * BillingService payment-side building blocks that the finalisation protocol relies on:
 *  - markInvoiceAsPaid is atomic (one receipt, however many callers race);
 *  - renewSubscriptionAfterPayment is idempotent per payment id (one payment never buys two
 *    intervals), optimistic against a concurrent renewal, and keeps activation-only semantics;
 *  - invoices with a live payment are never reused for a new gateway order;
 *  - a plan of another clinic can never be subscribed to.
 *
 * The claim / repair / duplicate / amount behaviour of handlePaymentCallback itself is covered by
 * billing-payment-finalisation.spec.ts, which runs against a stateful fake database.
 */

jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));

import { NotFoundException } from '@nestjs/common';
import { createBillingService } from './billing-test-harness';
import { CLINIC_ID, createFinalisationWorld } from './billing-finalisation-world';
import type { FinalisationWorld } from './billing-finalisation-world';

type RenewFn = (
  subscriptionId: string,
  options?: { activationOnly?: boolean; paymentId?: string; clinicId?: string }
) => Promise<void>;
type PrivateApi = { renewSubscriptionAfterPayment: RenewFn };

function planFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub-1',
    userId: 'user-1',
    clinicId: CLINIC_ID,
    planId: 'plan-1',
    status: 'INCOMPLETE',
    currentPeriodStart: new Date(Date.now() - 3 * 24 * 3600 * 1000),
    currentPeriodEnd: new Date(Date.now() + 27 * 24 * 3600 * 1000),
    appointmentsUsed: 0,
    appointmentsRemaining: 4,
    plan: {
      id: 'plan-1',
      name: 'Gold',
      amount: 100,
      currency: 'INR',
      interval: 'MONTHLY',
      intervalCount: 1,
      isUnlimitedAppointments: false,
      appointmentsIncluded: 4,
    },
    ...overrides,
  };
}

describe('BillingService.markInvoiceAsPaid', () => {
  it('is idempotent: an already-PAID invoice is returned untouched (no second receipt)', async () => {
    const paidInvoice = { id: 'inv-1', userId: 'user-1', clinicId: CLINIC_ID, status: 'PAID' };
    const databaseService = {
      findInvoiceByIdSafe: jest.fn().mockResolvedValue(paidInvoice),
      updateInvoiceSafe: jest.fn(),
    };
    const { service, eventService } = createBillingService({ databaseService });

    await expect(service.markInvoiceAsPaid('inv-1')).resolves.toBe(paidInvoice);
    expect(databaseService.updateInvoiceSafe).not.toHaveBeenCalled();
    expect(eventService['emit']).not.toHaveBeenCalled();
  });

  it('is atomic: racing callers perform ONE transition and send ONE receipt', async () => {
    const world = createFinalisationWorld();

    await Promise.all([
      world.service.markInvoiceAsPaid('inv-1'),
      world.service.markInvoiceAsPaid('inv-1'),
      world.service.markInvoiceAsPaid('inv-1'),
    ]);

    expect(world.db.row('invoice', 'inv-1')['status']).toBe('PAID');
    expect(world.events('billing.receipt.paid')).toHaveLength(1);
    expect(world.generatePdf).toHaveBeenCalledTimes(1);
  });
});

describe('BillingService.renewSubscriptionAfterPayment', () => {
  function renewHarness(subscription: Record<string, unknown>): {
    world: FinalisationWorld;
    renew: RenewFn;
  } {
    const world = createFinalisationWorld({ subscription });
    const renew: RenewFn = (subscriptionId, options) =>
      (world.service as unknown as PrivateApi).renewSubscriptionAfterPayment(subscriptionId, {
        clinicId: CLINIC_ID,
        ...options,
      });
    return { world, renew };
  }

  it('starts a first activation at the payment time, not at checkout creation', async () => {
    const { world, renew } = renewHarness({});

    await renew('sub-1', { paymentId: 'pay-1' });

    const row = world.db.row('subscription', 'sub-1');
    expect(row['status']).toBe('ACTIVE');
    expect(Date.now() - (row['currentPeriodStart'] as Date).getTime()).toBeLessThan(10_000);
    expect((row['currentPeriodEnd'] as Date).getTime()).toBeGreaterThan(
      (row['currentPeriodStart'] as Date).getTime()
    );
  });

  it('keeps a deliberately future-dated period on first activation', async () => {
    const futureStart = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    const futureEnd = new Date(Date.now() + 35 * 24 * 3600 * 1000);
    const { world, renew } = renewHarness({
      currentPeriodStart: futureStart,
      currentPeriodEnd: futureEnd,
    });

    await renew('sub-1', { paymentId: 'pay-1' });

    const row = world.db.row('subscription', 'sub-1');
    expect(row['status']).toBe('ACTIVE');
    expect((row['currentPeriodStart'] as Date).getTime()).toBe(futureStart.getTime());
    expect((row['currentPeriodEnd'] as Date).getTime()).toBe(futureEnd.getTime());
  });

  it('extends an ACTIVE plan from its period end on a normal renewal', async () => {
    const periodEnd = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    const { world, renew } = renewHarness({ status: 'ACTIVE', currentPeriodEnd: periodEnd });

    await renew('sub-1', { paymentId: 'pay-1' });

    expect((world.db.row('subscription', 'sub-1')['currentPeriodStart'] as Date).getTime()).toBe(
      periodEnd.getTime()
    );
  });

  it('one payment id can never buy two intervals; a different payment id can', async () => {
    const { world, renew } = renewHarness({
      status: 'ACTIVE',
      currentPeriodEnd: new Date(Date.now() + 10 * 24 * 3600 * 1000),
    });

    await renew('sub-1', { paymentId: 'pay-1' });
    const afterFirst = (
      world.db.row('subscription', 'sub-1')['currentPeriodEnd'] as Date
    ).getTime();
    await renew('sub-1', { paymentId: 'pay-1' });
    await renew('sub-1', { paymentId: 'pay-1' });

    expect((world.db.row('subscription', 'sub-1')['currentPeriodEnd'] as Date).getTime()).toBe(
      afterFirst
    );
    expect(world.events('billing.subscription.renewed')).toHaveLength(1);

    await renew('sub-1', { paymentId: 'pay-2' });
    expect(
      (world.db.row('subscription', 'sub-1')['currentPeriodEnd'] as Date).getTime()
    ).toBeGreaterThan(afterFirst);
    expect(world.db.metadata('subscription', 'sub-1')['renewedPaymentIds']).toEqual([
      'pay-1',
      'pay-2',
    ]);
  });

  it('concurrent renewals for the SAME payment extend the period once (optimistic write)', async () => {
    const { world, renew } = renewHarness({
      status: 'ACTIVE',
      currentPeriodEnd: new Date(Date.now() + 10 * 24 * 3600 * 1000),
    });
    const originalEnd = (
      world.db.row('subscription', 'sub-1')['currentPeriodEnd'] as Date
    ).getTime();

    await Promise.all([
      renew('sub-1', { paymentId: 'pay-1' }),
      renew('sub-1', { paymentId: 'pay-1' }),
      renew('sub-1', { paymentId: 'pay-1' }),
    ]);

    const end = (world.db.row('subscription', 'sub-1')['currentPeriodEnd'] as Date).getTime();
    expect(end).toBeGreaterThan(originalEnd);
    expect(end).toBeLessThan(originalEnd + 32 * 24 * 3600 * 1000); // one interval, not three
    expect(world.events('billing.subscription.renewed')).toHaveLength(1);
  });

  it('activation-only never touches an ACTIVE plan', async () => {
    const { world, renew } = renewHarness({ status: 'ACTIVE' });
    const before = world.db.count('subscription.updateMany');

    await renew('sub-1', { activationOnly: true, paymentId: 'pay-1' });

    expect(world.db.count('subscription.updateMany')).toBe(before);
  });

  it('does not abort when cache invalidation fails after the plan was activated', async () => {
    const { world, renew } = renewHarness({});
    world.db.service.invalidateEntityCache.mockRejectedValue(new Error('cache down'));

    await expect(renew('sub-1', { paymentId: 'pay-1' })).resolves.toBeUndefined();
    expect(world.db.row('subscription', 'sub-1')['status']).toBe('ACTIVE');
  });
});

describe('BillingService.createSubscription plan clinic check', () => {
  it('rejects a plan that belongs to another clinic', async () => {
    const databaseService = {
      findBillingPlanByIdSafe: jest.fn().mockResolvedValue({
        id: 'plan-x',
        interval: 'MONTHLY',
        intervalCount: 1,
        clinicId: 'clinic-other',
      }),
      findSubscriptionsSafe: jest.fn().mockResolvedValue([]),
      createSubscriptionSafe: jest.fn(),
    };
    const { service } = createBillingService({ databaseService });

    await expect(
      service.createSubscription({
        userId: 'user-1',
        clinicId: CLINIC_ID,
        planId: 'plan-x',
      } as never)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(databaseService.createSubscriptionSafe).not.toHaveBeenCalled();
  });
});

describe('BillingService.processSubscriptionPayment invoice reuse', () => {
  const pendingInvoice = (payments: Array<{ status: string }>) => ({
    id: 'inv-old',
    invoiceNumber: 'INV-2026-000001',
    userId: 'user-1',
    clinicId: CLINIC_ID,
    status: 'PENDING',
    totalAmount: 100,
    createdAt: new Date(),
    payments,
  });

  function reuseHarness(payments: Array<{ status: string }>) {
    const databaseService = {
      findSubscriptionByIdSafe: jest.fn().mockResolvedValue(planFixture({ status: 'ACTIVE' })),
      findInvoicesSafe: jest.fn().mockResolvedValue([pendingInvoice(payments)]),
      findUserByIdSafe: jest.fn().mockResolvedValue({ id: 'user-1' }),
    };
    const harness = createBillingService({ databaseService });
    const createInvoice = jest.spyOn(harness.service, 'createInvoice').mockResolvedValue({
      id: 'inv-new',
      invoiceNumber: 'INV-2026-000002',
      totalAmount: 100,
    } as never);
    return { ...harness, createInvoice };
  }

  // The harness configures no backend URL, so the call stops right after the invoice decision.
  const STOP = 'API URL is not configured in application config';

  it('does NOT reuse an invoice that already has an open (PENDING) payment attempt', async () => {
    const { service, createInvoice } = reuseHarness([{ status: 'PENDING' }]);

    await expect(service.processSubscriptionPayment('sub-1')).rejects.toThrow(STOP);
    expect(createInvoice).toHaveBeenCalledTimes(1);
  });

  it('does NOT reuse an invoice that already has a COMPLETED payment', async () => {
    const { service, createInvoice } = reuseHarness([{ status: 'COMPLETED' }]);

    await expect(service.processSubscriptionPayment('sub-1')).rejects.toThrow(STOP);
    expect(createInvoice).toHaveBeenCalledTimes(1);
  });

  it('reuses an invoice whose earlier attempts all failed or were cancelled', async () => {
    const { service, createInvoice } = reuseHarness([
      { status: 'FAILED' },
      { status: 'CANCELLED' },
    ]);

    await expect(service.processSubscriptionPayment('sub-1')).rejects.toThrow(STOP);
    expect(createInvoice).not.toHaveBeenCalled();
  });

  it('reuses an invoice that has no payment attempt at all', async () => {
    const { service, createInvoice } = reuseHarness([]);

    await expect(service.processSubscriptionPayment('sub-1')).rejects.toThrow(STOP);
    expect(createInvoice).not.toHaveBeenCalled();
  });
});

describe('BillingService.createSubscription reuse of an unpaid subscription', () => {
  it('clears cancelAtPeriodEnd / cancelledAt so a re-subscribe is not cancelled on payment', async () => {
    const cancelled = planFixture({
      status: 'INCOMPLETE',
      cancelAtPeriodEnd: true,
      cancelledAt: new Date(),
      createdAt: new Date(),
    });
    const plan = {
      id: 'plan-1',
      interval: 'MONTHLY',
      intervalCount: 1,
      isUnlimitedAppointments: false,
      appointmentsIncluded: 4,
      trialPeriodDays: 0,
    };
    const databaseService = {
      findBillingPlanByIdSafe: jest.fn().mockResolvedValue(plan),
      findSubscriptionsSafe: jest.fn().mockResolvedValue([cancelled]),
      updateSubscriptionSafe: jest.fn().mockResolvedValue({ id: 'sub-1' }),
    };
    const { service } = createBillingService({ databaseService });

    await service.createSubscription({
      userId: 'user-1',
      clinicId: CLINIC_ID,
      planId: 'plan-1',
    } as never);

    const [, update] = databaseService.updateSubscriptionSafe.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(update['cancelAtPeriodEnd']).toBe(false);
    expect(update['cancelledAt']).toBeNull();
  });
});
