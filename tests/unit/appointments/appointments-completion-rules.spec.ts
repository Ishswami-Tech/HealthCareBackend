/**
 * Who may complete a video visit (its doctor and the clinic admin of its clinic, nobody else), the
 * audit trail of an administrator's completion, and the single definition of "paid (or comped)" the
 * completion gate shares with the video room. Same completion flow behind PATCH :id/status
 * COMPLETED, POST :id/complete and bulk completion.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));

import { Role } from '@core/types/enums.types';
import { LogType } from '@core/types/logging.types';
import type { CompleteAppointmentDto, UpdateAppointmentStatusDto } from '@dtos/appointment.dto';
import { AppointmentStatus } from '@dtos/appointment.dto';
import type { Row } from './test-helpers';
import {
  CLINIC,
  OTHER_CLINIC,
  appointmentRow,
  buildHarness,
  paidVideoRow,
  rejection,
} from './appointments-harness';

const AUDIT_MESSAGE = 'Appointment completed by an administrator';

function completeDto(): CompleteAppointmentDto {
  return { notes: 'seen' } as CompleteAppointmentDto;
}

describe('video visit completion: the doctor and the clinic admin only', () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    harness = buildHarness();
  });

  const complete = (role: string, userId: string, clinicId = CLINIC) =>
    harness.service.completeAppointment('appt-1', completeDto(), userId, clinicId, role);

  const auditEntries = () =>
    harness.logging.log.mock.calls.filter(call => call[2] === AUDIT_MESSAGE);

  function expectNothingChanged(): void {
    expect(harness.db.writes).toHaveLength(0);
    expect(harness.confirmationPlugin.process).not.toHaveBeenCalled();
    expect(harness.events.emit).not.toHaveBeenCalled();
    expect(harness.events.emitEnterprise).not.toHaveBeenCalled();
  }

  it('the treating doctor completes, with no administrator audit entry', async () => {
    harness.db.insert('appointment', paidVideoRow());

    const result = (await complete(Role.DOCTOR, 'user-doctor')) as { success: boolean };

    expect(result.success).toBe(true);
    expect(harness.db.rows('appointment')[0]?.['status']).toBe('COMPLETED');
    expect(auditEntries()).toHaveLength(0);
  });

  it('an assistant doctor who is the appointment doctor completes it like any treating doctor', async () => {
    harness.db.insert('appointment', paidVideoRow());

    const result = (await complete(Role.ASSISTANT_DOCTOR, 'user-doctor')) as { success: boolean };

    expect(result.success).toBe(true);
  });

  it('the clinic admin completes, and the audit entry names actor, role, appointment and previous status', async () => {
    harness.db.insert('appointment', paidVideoRow());

    const result = (await complete(Role.CLINIC_ADMIN, 'user-admin')) as { success: boolean };

    expect(result.success).toBe(true);
    expect(harness.db.rows('appointment')[0]?.['status']).toBe('COMPLETED');
    const [entry] = auditEntries();
    expect(entry?.[0]).toBe(LogType.AUDIT);
    expect(entry?.[4]).toEqual(
      expect.objectContaining({
        actorId: 'user-admin',
        actorRole: Role.CLINIC_ADMIN,
        appointmentId: 'appt-1',
        clinicId: CLINIC,
        previousStatus: 'IN_PROGRESS',
      })
    );
    expect(auditEntries()).toHaveLength(1);
  });

  it.each([
    [Role.ASSISTANT_DOCTOR, 'user-assistant'],
    [Role.DOCTOR, 'user-other-doctor'],
    [Role.RECEPTIONIST, 'user-reception'],
    [Role.NURSE, 'user-nurse'],
    [Role.SUPER_ADMIN, 'user-super'],
    [Role.PATIENT, 'user-patient'],
    ['USER', 'user-x'],
  ])(
    '%s (%s) gets 403: nothing is completed, emitted or logged as an admin completion',
    async (role, userId) => {
      harness.db.insert('appointment', paidVideoRow());

      const error = await rejection(complete(role, userId));

      expect(error.getStatus()).toBe(403);
      expectNothingChanged();
      expect(auditEntries()).toHaveLength(0);
    }
  );

  it('the clinic admin of another clinic gets 404: the appointment is not theirs to see', async () => {
    harness.db.insert('appointment', paidVideoRow());

    const error = await rejection(complete(Role.CLINIC_ADMIN, 'user-admin', OTHER_CLINIC));

    expect(error.getStatus()).toBe(404);
    expectNothingChanged();
    expect(auditEntries()).toHaveLength(0);
  });

  it('it still has to be IN_PROGRESS, even for the admin', async () => {
    harness.db.insert('appointment', paidVideoRow({ status: 'CONFIRMED' }));

    const error = await rejection(complete(Role.CLINIC_ADMIN, 'user-admin'));

    expect(error.getStatus()).toBe(400);
    expectNothingChanged();
  });

  describe('through PATCH :id/status COMPLETED (the same flow)', () => {
    const patch = (role: string, userId: string) =>
      harness.service.updateStatus(
        'appt-1',
        {
          status: AppointmentStatus.COMPLETED,
          notes: 'seen',
        } as unknown as UpdateAppointmentStatusDto,
        userId,
        CLINIC,
        role
      );

    it('the clinic admin completes', async () => {
      harness.db.insert('appointment', paidVideoRow());

      await patch(Role.CLINIC_ADMIN, 'user-admin');

      expect(harness.db.rows('appointment')[0]?.['status']).toBe('COMPLETED');
      expect(auditEntries()).toHaveLength(1);
    });

    it.each([Role.RECEPTIONIST, Role.NURSE, Role.ASSISTANT_DOCTOR])('%s gets 403', async role => {
      harness.db.insert('appointment', paidVideoRow());

      const error = await rejection(patch(role, 'user-staff'));

      expect(error.getStatus()).toBe(403);
      expect(harness.db.rows('appointment')[0]?.['status']).toBe('IN_PROGRESS');
    });
  });

  describe('through bulk completion (the same flow, per appointment)', () => {
    const bulk = (role: string, userId: string) =>
      harness.service.bulkCompleteSelectedAppointments(
        { clinicId: CLINIC },
        { appointmentIds: ['appt-1', 'appt-2'] } as never,
        userId,
        CLINIC,
        role
      );

    beforeEach(() => {
      harness.db.insert('appointment', paidVideoRow({ id: 'appt-1' }));
      harness.db.insert('appointment', paidVideoRow({ id: 'appt-2' }));
    });

    it('the clinic admin completes both', async () => {
      const result = await bulk(Role.CLINIC_ADMIN, 'user-admin');

      expect(result.data).toEqual({ completed: 2, failed: 0 });
      expect(auditEntries()).toHaveLength(2);
    });

    it('a receptionist completes none: both count as failed', async () => {
      const result = await bulk(Role.RECEPTIONIST, 'user-reception');

      expect(result.data).toEqual({ completed: 0, failed: 2 });
      expect(harness.db.rows('appointment').every(row => row['status'] === 'IN_PROGRESS')).toBe(
        true
      );
    });
  });
});

describe('completion requires the visit to be paid or comped (the shared definition)', () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    harness = buildHarness();
  });

  const complete = () =>
    harness.service.completeAppointment(
      'appt-1',
      completeDto(),
      'user-doctor',
      CLINIC,
      Role.DOCTOR
    );

  const video = (overrides: Row): void => {
    harness.db.insert('appointment', paidVideoRow(overrides));
  };

  it('a PENDING payment row whose invoice is PAID is paid: the doctor is not stuck IN_PROGRESS', async () => {
    video({ payment: { status: 'PENDING', invoice: { status: 'PAID' } } });

    const result = (await complete()) as { success: boolean };

    expect(result.success).toBe(true);
    expect(harness.db.rows('appointment')[0]?.['status']).toBe('COMPLETED');
  });

  it.each(['PAID', 'COMPLETED', 'SUCCESS', 'CAPTURED'])('a %s payment is paid', async status => {
    video({ payment: { status, invoice: null } });

    expect(((await complete()) as { success: boolean }).success).toBe(true);
  });

  it('a visit covered by a subscription plan is comped', async () => {
    video({ payment: null, subscriptionId: 'sub-1', isSubscriptionBased: true });

    expect(((await complete()) as { success: boolean }).success).toBe(true);
  });

  it.each([
    ['no payment at all', { payment: null }],
    [
      'a PENDING payment and a PENDING invoice',
      { payment: { status: 'PENDING', invoice: { status: 'PENDING' } } },
    ],
    ['a FAILED payment', { payment: { status: 'FAILED', invoice: null } }],
    [
      'a plan flag without a plan',
      { payment: null, subscriptionId: null, isSubscriptionBased: true },
    ],
  ])('%s is not paid: 400 and nothing is written', async (_label, overrides) => {
    video(overrides);

    const error = await rejection(complete());

    expect(error.getStatus()).toBe(400);
    expect(error.message).toContain('Payment must be completed');
    expect(harness.db.writes).toHaveLength(0);
  });

  it('an in-person visit is not gated on payment (unchanged)', async () => {
    harness.db.insert('appointment', appointmentRow({ payment: null }));

    expect(((await complete()) as { success: boolean }).success).toBe(true);
  });
});
