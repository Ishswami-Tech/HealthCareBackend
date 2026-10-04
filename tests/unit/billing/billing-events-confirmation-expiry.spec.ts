/// <reference types="jest" />
/**
 * payment.completed listener: the appointment's `confirmationExpiresAt` must come from the
 * visit's own start (+ active window), never from "now + window".
 *
 * Regression: the listener re-sent `status: CONFIRMED` for a row handlePaymentCallback had
 * already confirmed; the Prisma middleware then re-stamped `confirmationExpiresAt = now + window`,
 * so a video visit paid today for tomorrow expired tonight and the scheduler expired a PAID visit.
 */

jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));
// The listener only needs BillingService as an injection token; its collaborators are mocks below.
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));

import { BillingEventsListener } from '@services/billing/billing.events';
import { computeConfirmationExpiresAt } from '@services/appointments/core/confirmation-window.util';
import { resolvePaidConfirmationExpiresAt } from '@services/billing/billing-payment-finalisation.util';

type UpdateArgs = { where: Record<string, unknown>; data: Record<string, unknown> };

const CLINIC_ID = 'clinic-1';
const APPOINTMENT_ID = 'apt-1';

function tomorrowAt(time: string): { date: Date; time: string } {
  const date = new Date(Date.now() + 24 * 3600 * 1000);
  return { date, time };
}

function appointmentFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { date, time } = tomorrowAt('10:00');
  return {
    id: APPOINTMENT_ID,
    clinicId: CLINIC_ID,
    status: 'PENDING',
    type: 'VIDEO_CALL',
    date,
    time,
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    patient: { user: { name: 'Pat Ient' } },
    doctor: { user: { name: 'Doc Tor' } },
    clinic: { name: 'Clinic' },
    ...overrides,
  };
}

function setup(readSequence: Array<Record<string, unknown>>) {
  const updates: UpdateArgs[] = [];
  const reads = [...readSequence];
  const databaseService = {
    findAppointmentByIdSafe: jest.fn(async () => (reads.length > 1 ? reads.shift() : reads[0])),
    executeHealthcareWrite: jest.fn(async (operation: (client: unknown) => Promise<unknown>) =>
      operation({
        appointment: {
          // The listener's writes are conditional on the prior status, hence updateMany.
          updateMany: async (args: UpdateArgs): Promise<{ count: number }> => {
            updates.push(args);
            return { count: 1 };
          },
        },
      })
    ),
  };
  const billingService = {
    preparePayoutForAppointmentPayment: jest.fn().mockResolvedValue(undefined),
    syncAppointmentAfterPayment: jest.fn().mockResolvedValue(undefined),
  };
  const listener = new BillingEventsListener(
    billingService as never,
    databaseService as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    { emit: jest.fn().mockResolvedValue(undefined) } as never,
    { sendEmail: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never
  );
  return { listener, updates, databaseService };
}

function paymentCompletedEvent(): Record<string, unknown> {
  return {
    source: 'BillingService',
    category: 'billing',
    clinicId: CLINIC_ID,
    payload: {
      appointmentId: APPOINTMENT_ID,
      paymentId: 'pay-1',
      status: 'completed',
      clinicId: CLINIC_ID,
      amount: 500,
    },
  };
}

describe('BillingEventsListener.handlePaymentCompleted - confirmationExpiresAt', () => {
  it('does not re-send CONFIRMED for an appointment the callback already confirmed', async () => {
    const confirmed = appointmentFixture({
      status: 'CONFIRMED',
      confirmationExpiresAt: computeConfirmationExpiresAt(appointmentFixture() as never),
    });
    const { listener, updates } = setup([confirmed]);

    await listener.handlePaymentCompleted(paymentCompletedEvent());

    expect(updates).toHaveLength(1);
    // No `status` in the write => the Prisma middleware has nothing to re-stamp.
    expect(updates[0]?.data).toEqual({ paymentExpiresAt: null });
  });

  it('confirms a paid PENDING video visit with an expiry derived from its own start', async () => {
    const pending = appointmentFixture({ status: 'PENDING' });
    const scheduled = appointmentFixture({ status: 'SCHEDULED' });
    const { listener, updates } = setup([pending, scheduled]);

    await listener.handlePaymentCompleted(paymentCompletedEvent());

    expect(updates).toHaveLength(2);
    expect(updates[0]?.data['status']).toBe('SCHEDULED');
    expect(updates[0]?.data['paymentExpiresAt']).toBeNull();

    const confirm = updates[1]?.data as { status: string; confirmationExpiresAt: Date };
    expect(confirm.status).toBe('CONFIRMED');
    const expected = computeConfirmationExpiresAt(scheduled as never) as Date;
    expect(confirm.confirmationExpiresAt.getTime()).toBe(expected.getTime());
    // Paid today for tomorrow: the expiry must not be "tonight".
    expect(confirm.confirmationExpiresAt.getTime()).toBeGreaterThan(Date.now() + 12 * 3600 * 1000);
  });

  it('passes an explicit, correct expiry when a non-pending row is confirmed in one step', async () => {
    const scheduled = appointmentFixture({ status: 'SCHEDULED' });
    const { listener, updates } = setup([scheduled]);

    await listener.handlePaymentCompleted(paymentCompletedEvent());

    const first = updates[0]?.data as { status: string; confirmationExpiresAt: Date };
    expect(first.status).toBe('CONFIRMED');
    expect(first.confirmationExpiresAt.getTime()).toBe(
      (computeConfirmationExpiresAt(scheduled as never) as Date).getTime()
    );
  });
});

describe('resolvePaidConfirmationExpiresAt', () => {
  it('returns the visit start + window for a future visit', () => {
    const appointment = appointmentFixture();
    const resolved = resolvePaidConfirmationExpiresAt(appointment as never);
    expect(resolved.getTime()).toBe(
      (computeConfirmationExpiresAt(appointment as never) as Date).getTime()
    );
  });

  it('never returns a past expiry: a long-elapsed visit is clamped to now + window', () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    const appointment = appointmentFixture({ date: yesterday, time: '09:00' });
    const now = new Date();

    const resolved = resolvePaidConfirmationExpiresAt(appointment as never, now);

    expect(resolved.getTime()).toBeGreaterThan(now.getTime());
  });

  it('falls back to now + window when the visit date cannot be derived', () => {
    const now = new Date();
    const resolved = resolvePaidConfirmationExpiresAt({ date: null, time: null }, now);
    expect(resolved.getTime()).toBeGreaterThan(now.getTime());
  });
});
