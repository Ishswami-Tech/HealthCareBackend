/// <reference types="jest" />
/**
 * Subscription appointment quota, driven through the stateful fake database:
 *  - book-appointment links only the holder's OWN appointment of the SAME clinic;
 *  - the link + quota change is atomic: concurrent bookings can never overspend the plan;
 *  - cancel-subscription-appointment is idempotent and never restores above the plan limit.
 */

jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createBillingService } from './billing-test-harness';
import type { MockMap } from './billing-test-harness';
import { FakeBillingDb } from './billing-fake-db';
import type { Row } from './billing-fake-db';
import { CLINIC_ID } from './billing-finalisation-world';

const HOLDER = { userId: 'user-1', role: 'PATIENT', clinicId: CLINIC_ID };

function appointment(id: string, overrides: Row = {}): Row {
  return {
    id,
    clinicId: CLINIC_ID,
    userId: 'user-1',
    patientId: 'patient-1',
    subscriptionId: null,
    isSubscriptionBased: false,
    patient: { userId: 'user-1' },
    ...overrides,
  };
}

function setup(subscription: Row = {}) {
  const db = new FakeBillingDb();
  db.seed('billingPlan', {
    id: 'plan-1',
    name: 'Gold',
    amount: 100,
    interval: 'MONTHLY',
    intervalCount: 1,
    isUnlimitedAppointments: false,
    appointmentsIncluded: 4,
    clinicId: CLINIC_ID,
  });
  db.seed('subscription', {
    id: 'sub-1',
    userId: 'user-1',
    clinicId: CLINIC_ID,
    planId: 'plan-1',
    status: 'ACTIVE',
    currentPeriodStart: new Date(Date.now() - 24 * 3600 * 1000),
    currentPeriodEnd: new Date(Date.now() + 20 * 24 * 3600 * 1000),
    appointmentsUsed: 0,
    appointmentsRemaining: 4,
    metadata: null,
    ...subscription,
  });
  const harness = createBillingService({ databaseService: db.service as unknown as MockMap });
  return { db, ...harness };
}

function quota(db: FakeBillingDb): { used: number; remaining: number } {
  const row = db.row('subscription', 'sub-1');
  return { used: Number(row['appointmentsUsed']), remaining: Number(row['appointmentsRemaining']) };
}

describe('BillingService.bookAppointmentWithSubscription', () => {
  it("links the holder's own appointment and reserves one slot", async () => {
    const { db, service } = setup();
    db.seed('appointment', appointment('apt-1'));

    await service.bookAppointmentWithSubscription('sub-1', 'apt-1', HOLDER);

    expect(db.row('appointment', 'apt-1')['subscriptionId']).toBe('sub-1');
    expect(db.row('appointment', 'apt-1')['isSubscriptionBased']).toBe(true);
    expect(quota(db)).toEqual({ used: 1, remaining: 3 });
  });

  it('refuses an appointment of another clinic - and touches nothing', async () => {
    const { db, service } = setup();
    db.seed('appointment', appointment('apt-x', { clinicId: 'clinic-other' }));

    await expect(
      service.bookAppointmentWithSubscription('sub-1', 'apt-x', HOLDER)
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(db.row('appointment', 'apt-x')['subscriptionId']).toBeNull();
    expect(quota(db)).toEqual({ used: 0, remaining: 4 });
  });

  it("refuses somebody else's appointment in the same clinic - and touches nothing", async () => {
    const { db, service } = setup();
    db.seed(
      'appointment',
      appointment('apt-v', { userId: 'victim', patient: { userId: 'victim' } })
    );

    await expect(
      service.bookAppointmentWithSubscription('sub-1', 'apt-v', HOLDER)
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(db.row('appointment', 'apt-v')['subscriptionId']).toBeNull();
    expect(db.row('appointment', 'apt-v')['isSubscriptionBased']).toBe(false);
    expect(quota(db)).toEqual({ used: 0, remaining: 4 });
  });

  it('refuses an unknown appointment', async () => {
    const { service } = setup();

    await expect(
      service.bookAppointmentWithSubscription('sub-1', 'ghost', HOLDER)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is idempotent for an appointment already linked to this subscription', async () => {
    const { db, service } = setup();
    db.seed('appointment', appointment('apt-1'));

    await service.bookAppointmentWithSubscription('sub-1', 'apt-1', HOLDER);
    await service.bookAppointmentWithSubscription('sub-1', 'apt-1', HOLDER);

    expect(quota(db)).toEqual({ used: 1, remaining: 3 });
  });

  it('refuses an appointment already covered by another subscription', async () => {
    const { db, service } = setup();
    db.seed('appointment', appointment('apt-1', { subscriptionId: 'sub-other' }));

    await expect(
      service.bookAppointmentWithSubscription('sub-1', 'apt-1', HOLDER)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(quota(db)).toEqual({ used: 0, remaining: 4 });
  });

  it('refuses another patient using this subscription', async () => {
    const { db, service } = setup();
    db.seed('appointment', appointment('apt-1'));

    await expect(
      service.bookAppointmentWithSubscription('sub-1', 'apt-1', {
        userId: 'user-2',
        role: 'PATIENT',
        clinicId: CLINIC_ID,
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(quota(db)).toEqual({ used: 0, remaining: 4 });
  });

  it('can never overspend the quota: concurrent bookings book exactly `remaining` appointments', async () => {
    const { db, service } = setup({ appointmentsRemaining: 2, appointmentsUsed: 2 });
    for (let index = 0; index < 6; index += 1) {
      db.seed('appointment', appointment(`apt-${index}`));
    }

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_unused, index) =>
        service.bookAppointmentWithSubscription('sub-1', `apt-${index}`, HOLDER)
      )
    );

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    expect(quota(db)).toEqual({ used: 4, remaining: 0 });
    const linked = [...db.tables.appointment.values()].filter(
      row => row['subscriptionId'] === 'sub-1'
    );
    expect(linked).toHaveLength(2);
    // The losers were rolled back: not linked, not flagged.
    const unlinked = [...db.tables.appointment.values()].filter(
      row => row['subscriptionId'] === null
    );
    expect(unlinked.every(row => row['isSubscriptionBased'] === false)).toBe(true);
  });

  it('does not touch the quota of an unlimited plan', async () => {
    const { db, service } = setup();
    db.row('billingPlan', 'plan-1')['isUnlimitedAppointments'] = true;
    db.seed('appointment', appointment('apt-1'));

    await service.bookAppointmentWithSubscription('sub-1', 'apt-1', HOLDER);

    expect(db.row('appointment', 'apt-1')['subscriptionId']).toBe('sub-1');
    expect(quota(db)).toEqual({ used: 0, remaining: 4 });
  });
});

describe('BillingService.cancelSubscriptionAppointment', () => {
  it('restores exactly one slot and unlinks the appointment', async () => {
    const { db, service } = setup({ appointmentsRemaining: 3, appointmentsUsed: 1 });
    db.seed(
      'appointment',
      appointment('apt-1', { subscriptionId: 'sub-1', isSubscriptionBased: true })
    );

    await service.cancelSubscriptionAppointment('apt-1', HOLDER);

    expect(db.row('appointment', 'apt-1')['subscriptionId']).toBeNull();
    expect(db.row('appointment', 'apt-1')['isSubscriptionBased']).toBe(false);
    expect(quota(db)).toEqual({ used: 0, remaining: 4 });
  });

  it('is idempotent: repeated and concurrent calls restore the slot once', async () => {
    const { db, service } = setup({ appointmentsRemaining: 2, appointmentsUsed: 2 });
    db.seed(
      'appointment',
      appointment('apt-1', { subscriptionId: 'sub-1', isSubscriptionBased: true })
    );

    await Promise.all([
      service.cancelSubscriptionAppointment('apt-1', HOLDER),
      service.cancelSubscriptionAppointment('apt-1', HOLDER),
      service.cancelSubscriptionAppointment('apt-1', HOLDER),
    ]);
    await service.cancelSubscriptionAppointment('apt-1', HOLDER);

    expect(quota(db)).toEqual({ used: 1, remaining: 3 });
  });

  it('uses used - 1 / remaining + 1 and never goes above the plan limit', async () => {
    const { db, service } = setup({ appointmentsRemaining: 4, appointmentsUsed: 1 });
    db.seed(
      'appointment',
      appointment('apt-1', { subscriptionId: 'sub-1', isSubscriptionBased: true })
    );

    await service.cancelSubscriptionAppointment('apt-1', HOLDER);

    const { remaining } = quota(db);
    expect(remaining).toBe(4); // plan limit (appointmentsIncluded)
    expect(db.row('appointment', 'apt-1')['subscriptionId']).toBeNull();
  });

  it("a patient cannot cancel through somebody else's subscription", async () => {
    const { db, service } = setup({ appointmentsRemaining: 3, appointmentsUsed: 1 });
    db.seed(
      'appointment',
      appointment('apt-1', { subscriptionId: 'sub-1', isSubscriptionBased: true })
    );

    await expect(
      service.cancelSubscriptionAppointment('apt-1', {
        userId: 'user-2',
        role: 'PATIENT',
        clinicId: CLINIC_ID,
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(quota(db)).toEqual({ used: 1, remaining: 3 });
    expect(db.row('appointment', 'apt-1')['subscriptionId']).toBe('sub-1');
  });

  it('does nothing for an appointment that is not subscription based', async () => {
    const { db, service } = setup();
    db.seed('appointment', appointment('apt-1'));

    await expect(service.cancelSubscriptionAppointment('apt-1', HOLDER)).resolves.toBeUndefined();
    expect(quota(db)).toEqual({ used: 0, remaining: 4 });
  });
});
