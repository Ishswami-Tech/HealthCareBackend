/// <reference types="jest" />
/**
 * payment.completed listener: a payment that settles AFTER the appointment left the booking flow
 * (hold expired, cancelled, already done) must not resurrect it. The appointment stays untouched, NO
 * payout is prepared for the visit that never takes place, and a `billing.payment.late_settlement`
 * event is emitted (admin-visible). There are no refunds for visits that never take place: nothing
 * is refunded, nothing refund-related is persisted.
 *
 * Also covers the appointment.completed payout-readiness handler: it reads the ids out of the event
 * envelope and is safe to run twice.
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
import { LogLevel } from '@core/types';
import { computeConfirmationExpiresAt } from '@services/appointments/core/confirmation-window.util';

type WriteArgs = { where: Record<string, unknown>; data: Record<string, unknown> };

const CLINIC_ID = 'clinic-1';
const APPOINTMENT_ID = 'apt-1';
const PAYMENT_ID = 'pay-1';

function appointmentFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: APPOINTMENT_ID,
    clinicId: CLINIC_ID,
    status: 'PENDING',
    type: 'VIDEO_CALL',
    date: new Date(Date.now() + 24 * 3600 * 1000),
    time: '10:00',
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    patient: { user: { name: 'Pat Ient' } },
    doctor: { user: { name: 'Doc Tor' } },
    clinic: { name: 'Clinic' },
    ...overrides,
  };
}

interface Setup {
  listener: BillingEventsListener;
  writes: WriteArgs[];
  databaseService: {
    findAppointmentByIdSafe: jest.Mock;
    executeHealthcareWrite: jest.Mock;
    executeHealthcareRead: jest.Mock;
  };
  billingService: {
    preparePayoutForAppointmentPayment: jest.Mock;
    syncAppointmentAfterPayment: jest.Mock;
    markPayoutReadyForCompletedAppointment: jest.Mock;
  };
  eventService: { emit: jest.Mock };
  loggingService: { log: jest.Mock };
  emailService: { sendSimpleEmail: jest.Mock };
}

function setup(
  readSequence: Array<Record<string, unknown>>,
  options: { writeCount?: number; latestStatus?: string } = {}
): Setup {
  const writes: WriteArgs[] = [];
  const reads = [...readSequence];
  const databaseService = {
    findAppointmentByIdSafe: jest.fn(async () => (reads.length > 1 ? reads.shift() : reads[0])),
    executeHealthcareWrite: jest.fn(async (operation: (client: unknown) => Promise<unknown>) =>
      operation({
        appointment: {
          updateMany: async (args: WriteArgs): Promise<{ count: number }> => {
            writes.push(args);
            return { count: options.writeCount ?? 1 };
          },
        },
      })
    ),
    executeHealthcareRead: jest.fn(async (operation: (client: unknown) => Promise<unknown>) =>
      operation({
        appointment: {
          findFirst: async (): Promise<{ status: string } | null> =>
            options.latestStatus ? { status: options.latestStatus } : null,
        },
      })
    ),
  };
  const billingService = {
    preparePayoutForAppointmentPayment: jest.fn().mockResolvedValue(undefined),
    syncAppointmentAfterPayment: jest.fn().mockResolvedValue(undefined),
    markPayoutReadyForCompletedAppointment: jest.fn().mockResolvedValue(undefined),
  };
  const eventService = { emit: jest.fn().mockResolvedValue(undefined) };
  const loggingService = { log: jest.fn().mockResolvedValue(undefined) };
  const emailService = { sendSimpleEmail: jest.fn().mockResolvedValue({ success: true }) };
  const listener = new BillingEventsListener(
    billingService as never,
    databaseService as never,
    loggingService as never,
    eventService as never,
    emailService as never,
    {} as never
  );
  return {
    listener,
    writes,
    databaseService,
    billingService,
    eventService,
    loggingService,
    emailService,
  };
}

function paymentCompletedEvent(): Record<string, unknown> {
  return {
    source: 'BillingService',
    category: 'billing',
    clinicId: CLINIC_ID,
    payload: {
      appointmentId: APPOINTMENT_ID,
      paymentId: PAYMENT_ID,
      status: 'completed',
      clinicId: CLINIC_ID,
      amount: 500,
    },
  };
}

function emittedEvents(eventService: { emit: jest.Mock }, name: string): unknown[][] {
  return eventService.emit.mock.calls.filter((call: unknown[]) => call[0] === name);
}

describe('BillingEventsListener.handlePaymentCompleted - late settlement', () => {
  describe('appointments still in the booking flow are confirmed', () => {
    it('moves PENDING to SCHEDULED then CONFIRMED with writes conditional on the prior status', async () => {
      const { listener, writes, eventService } = setup([
        appointmentFixture({ status: 'PENDING' }),
        appointmentFixture({ status: 'SCHEDULED' }),
      ]);

      await listener.handlePaymentCompleted(paymentCompletedEvent());

      expect(writes).toHaveLength(2);
      // Step 1: PENDING -> SCHEDULED, only if the row is still PENDING/SCHEDULED, in its clinic.
      expect(writes[0]?.where).toMatchObject({ id: APPOINTMENT_ID, clinicId: CLINIC_ID });
      expect([...((writes[0]?.where['status'] as { in: string[] }).in ?? [])].sort()).toEqual([
        'FOLLOW_UP_SCHEDULED',
        'PENDING',
        'SCHEDULED',
      ]);
      expect(writes[0]?.data).toMatchObject({ status: 'SCHEDULED', paymentExpiresAt: null });
      // Step 2: SCHEDULED -> CONFIRMED, only if the row is still SCHEDULED.
      expect(writes[1]?.where).toEqual({
        id: APPOINTMENT_ID,
        clinicId: CLINIC_ID,
        status: 'SCHEDULED',
      });
      expect(writes[1]?.data['status']).toBe('CONFIRMED');
      expect(emittedEvents(eventService, 'billing.payment.late_settlement')).toHaveLength(0);
      expect(emittedEvents(eventService, 'appointment.confirmed')).toHaveLength(1);
    });

    it('confirms a SCHEDULED appointment in one conditional step with its own-start expiry', async () => {
      const scheduled = appointmentFixture({ status: 'SCHEDULED' });
      // The re-read after the write sees the row as CONFIRMED, so no second step follows.
      const { listener, writes } = setup([scheduled, appointmentFixture({ status: 'CONFIRMED' })]);

      await listener.handlePaymentCompleted(paymentCompletedEvent());

      expect(writes).toHaveLength(1);
      expect((writes[0]?.where['status'] as { in: string[] }).in).toContain('SCHEDULED');
      const data = writes[0]?.data as { status: string; confirmationExpiresAt: Date };
      expect(data.status).toBe('CONFIRMED');
      expect(data.confirmationExpiresAt.getTime()).toBe(
        (computeConfirmationExpiresAt(scheduled as never) as Date).getTime()
      );
    });

    it('keeps an already CONFIRMED appointment as it is: only the payment hold is released', async () => {
      const { listener, writes, eventService } = setup([
        appointmentFixture({
          status: 'CONFIRMED',
          confirmationExpiresAt: computeConfirmationExpiresAt(appointmentFixture() as never),
        }),
      ]);

      await listener.handlePaymentCompleted(paymentCompletedEvent());

      expect(writes).toHaveLength(1);
      // No status, no expiry in the write: the Prisma middleware has nothing to re-stamp.
      expect(writes[0]?.data).toEqual({ paymentExpiresAt: null });
      // Never writes onto a released appointment.
      expect(writes[0]?.where['status']).toEqual({
        notIn: expect.arrayContaining(['EXPIRED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']),
      });
      expect(emittedEvents(eventService, 'billing.payment.late_settlement')).toHaveLength(0);
    });

    it('prepares the payout exactly once, after the appointment was settled by the payment', async () => {
      const { listener, writes, billingService } = setup([
        appointmentFixture({ status: 'PENDING' }),
        appointmentFixture({ status: 'SCHEDULED' }),
      ]);
      let writesWhenPrepared = -1;
      billingService.preparePayoutForAppointmentPayment.mockImplementation(async () => {
        writesWhenPrepared = writes.length;
      });

      await listener.handlePaymentCompleted(paymentCompletedEvent());

      expect(billingService.preparePayoutForAppointmentPayment).toHaveBeenCalledTimes(1);
      expect(billingService.preparePayoutForAppointmentPayment).toHaveBeenCalledWith(
        PAYMENT_ID,
        CLINIC_ID
      );
      // Prepared AFTER the conditional status write, not before the settled check.
      expect(writesWhenPrepared).toBeGreaterThanOrEqual(1);
    });

    it('prepares the payout for an already CONFIRMED appointment (hold release only)', async () => {
      const { listener, billingService } = setup([
        appointmentFixture({
          status: 'CONFIRMED',
          confirmationExpiresAt: computeConfirmationExpiresAt(appointmentFixture() as never),
        }),
      ]);

      await listener.handlePaymentCompleted(paymentCompletedEvent());

      expect(billingService.preparePayoutForAppointmentPayment).toHaveBeenCalledTimes(1);
    });

    it('does not move an IN_PROGRESS appointment back to CONFIRMED', async () => {
      const { listener, writes } = setup([appointmentFixture({ status: 'IN_PROGRESS' })]);

      await listener.handlePaymentCompleted(paymentCompletedEvent());

      expect(writes).toHaveLength(1);
      expect(writes[0]?.data).toEqual({ paymentExpiresAt: null });
    });
  });

  describe('appointments that are already over are left alone', () => {
    it.each(['EXPIRED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'])(
      'leaves a %s appointment untouched, prepares no payout and emits late_settlement',
      async status => {
        const { listener, writes, eventService, loggingService, billingService, emailService } =
          setup([appointmentFixture({ status })]);

        await listener.handlePaymentCompleted(paymentCompletedEvent());

        // Nothing written, nothing confirmed, nobody told the booking is confirmed.
        expect(writes).toHaveLength(0);
        expect(emittedEvents(eventService, 'appointment.confirmed')).toHaveLength(0);
        expect(billingService.syncAppointmentAfterPayment).not.toHaveBeenCalled();
        expect(emailService.sendSimpleEmail).not.toHaveBeenCalled();

        // No payout record is attached to a visit that will never happen.
        expect(billingService.preparePayoutForAppointmentPayment).not.toHaveBeenCalled();

        // Admins get the event, with what is needed to find the payment and the clinic.
        const flagged = emittedEvents(eventService, 'billing.payment.late_settlement');
        expect(flagged).toHaveLength(1);
        expect(flagged[0]?.[1]).toMatchObject({
          clinicId: CLINIC_ID,
          paymentId: PAYMENT_ID,
          appointmentId: APPOINTMENT_ID,
          appointmentStatus: status,
          amount: 500,
        });

        // And a WARN in the log.
        expect(loggingService.log).toHaveBeenCalledWith(
          expect.anything(),
          LogLevel.WARN,
          expect.stringContaining(`already ${status}`),
          'BillingEventsListener',
          expect.objectContaining({ paymentId: PAYMENT_ID, appointmentId: APPOINTMENT_ID })
        );
      }
    );

    it('never refunds (no refunds for visits that never take place)', async () => {
      const { listener, billingService } = setup([appointmentFixture({ status: 'EXPIRED' })]);
      const refundSpy = jest.fn();
      (billingService as unknown as Record<string, unknown>)['refundPayment'] = refundSpy;

      await listener.handlePaymentCompleted(paymentCompletedEvent());

      expect(refundSpy).not.toHaveBeenCalled();
    });

    it('does not let a failing event bus break the listener', async () => {
      const { listener, writes, eventService } = setup([appointmentFixture({ status: 'EXPIRED' })]);
      eventService.emit.mockRejectedValue(new Error('bus down'));

      await expect(
        listener.handlePaymentCompleted(paymentCompletedEvent())
      ).resolves.toBeUndefined();
      expect(writes).toHaveLength(0);
    });

    it('flags the payment when the row expired between the read and the conditional write', async () => {
      // The (cached) read still says PENDING; the conditional write matches nothing because the
      // scheduler expired the hold meanwhile, and the re-check confirms EXPIRED.
      const { listener, writes, eventService, databaseService, billingService } = setup(
        [appointmentFixture({ status: 'PENDING' })],
        { writeCount: 0, latestStatus: 'EXPIRED' }
      );

      await listener.handlePaymentCompleted(paymentCompletedEvent());

      expect(writes).toHaveLength(1);
      expect(databaseService.executeHealthcareRead).toHaveBeenCalledTimes(1);
      expect(emittedEvents(eventService, 'billing.payment.late_settlement')).toHaveLength(1);
      expect(billingService.preparePayoutForAppointmentPayment).not.toHaveBeenCalled();
      expect(emittedEvents(eventService, 'appointment.confirmed')).toHaveLength(0);
    });

    it('carries on when the conditional write lost a race to a legitimate confirmation', async () => {
      const { listener, writes, eventService } = setup(
        [appointmentFixture({ status: 'PENDING' }), appointmentFixture({ status: 'CONFIRMED' })],
        { writeCount: 0, latestStatus: 'CONFIRMED' }
      );

      await listener.handlePaymentCompleted(paymentCompletedEvent());

      expect(writes).toHaveLength(1);
      expect(emittedEvents(eventService, 'billing.payment.late_settlement')).toHaveLength(0);
      expect(emittedEvents(eventService, 'appointment.confirmed')).toHaveLength(1);
    });
  });
});

describe('BillingEventsListener.handleAppointmentCompleted', () => {
  it('reads the ids out of the EventService envelope (enterprise emit)', async () => {
    const { listener, billingService } = setup([appointmentFixture()]);

    await listener.handleAppointmentCompleted({
      clinicId: CLINIC_ID,
      payload: { appointmentId: APPOINTMENT_ID, clinicId: CLINIC_ID },
    });

    expect(billingService.markPayoutReadyForCompletedAppointment).toHaveBeenCalledWith(
      APPOINTMENT_ID,
      CLINIC_ID
    );
  });

  it('reads the ids out of a plain emit() envelope that has no top-level clinicId', async () => {
    const { listener, billingService } = setup([appointmentFixture()]);

    await listener.handleAppointmentCompleted({
      payload: { appointmentId: APPOINTMENT_ID, clinicId: CLINIC_ID },
    });

    expect(billingService.markPayoutReadyForCompletedAppointment).toHaveBeenCalledWith(
      APPOINTMENT_ID,
      CLINIC_ID
    );
  });

  it('still accepts the flat shape', async () => {
    const { listener, billingService } = setup([appointmentFixture()]);

    await listener.handleAppointmentCompleted({
      appointmentId: APPOINTMENT_ID,
      clinicId: CLINIC_ID,
    });

    expect(billingService.markPayoutReadyForCompletedAppointment).toHaveBeenCalledTimes(1);
  });

  it('ignores an event without ids', async () => {
    const { listener, billingService } = setup([appointmentFixture()]);

    await listener.handleAppointmentCompleted({ payload: {} });

    expect(billingService.markPayoutReadyForCompletedAppointment).not.toHaveBeenCalled();
  });

  it('is safe to run twice for the same completion (both routes, or enterprise + plain emit)', async () => {
    const { listener, billingService } = setup([appointmentFixture()]);
    const event = { clinicId: CLINIC_ID, payload: { appointmentId: APPOINTMENT_ID } };

    await listener.handleAppointmentCompleted(event);
    await listener.handleAppointmentCompleted(event);

    // The handler just delegates; BillingService.markPayoutReadyForCompletedAppointment returns
    // early for a payout that is already PAYOUT_READY / PAYOUT_SUCCESS (idempotent by design).
    expect(billingService.markPayoutReadyForCompletedAppointment).toHaveBeenCalledTimes(2);
  });

  it('logs instead of throwing when marking the payout ready fails', async () => {
    const { listener, billingService, loggingService } = setup([appointmentFixture()]);
    billingService.markPayoutReadyForCompletedAppointment.mockRejectedValue(new Error('db down'));

    await expect(
      listener.handleAppointmentCompleted({
        payload: { appointmentId: APPOINTMENT_ID, clinicId: CLINIC_ID },
      })
    ).resolves.toBeUndefined();
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('db down'),
      'BillingEventsListener',
      expect.objectContaining({ appointmentId: APPOINTMENT_ID, clinicId: CLINIC_ID })
    );
  });
});
