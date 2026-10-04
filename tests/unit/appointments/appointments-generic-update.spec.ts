/**
 * The generic update (PUT /appointments/:id) and the status endpoint (PATCH :id/status), run against
 * the REAL core service and the REAL state contract (only the database, cache and queue are
 * in-memory). Nothing here mocks away the rule it claims to prove.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));

import { Role } from '@core/types/enums.types';
import { AppointmentStatus } from '@dtos/appointment.dto';
import type { UpdateAppointmentDto, UpdateAppointmentStatusDto } from '@dtos/appointment.dto';
import type { Row } from './test-helpers';
import {
  CLINIC,
  OTHER_CLINIC,
  appointmentRow,
  paidVideoRow,
  rejection,
} from './appointments-harness';
import { buildRealCoreHarness, type RealCoreHarness } from './appointments-real-core-harness';

const STAFF = [
  Role.RECEPTIONIST,
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.CLINIC_ADMIN,
  Role.NURSE,
] as const;

const CHECKED_IN_AT = new Date('2026-10-05T04:00:00.000Z');

function updateDto(fields: Row): UpdateAppointmentDto {
  return fields as unknown as UpdateAppointmentDto;
}

function statusDto(fields: Row): UpdateAppointmentStatusDto {
  return fields as unknown as UpdateAppointmentStatusDto;
}

function storedAppointment(harness: RealCoreHarness): Row {
  const row = harness.db.rows('appointment')[0];
  if (!row) {
    throw new Error('no appointment seeded');
  }
  return row;
}

/** Writes to the appointment table (the in-memory database records every create / update). */
function appointmentWrites(harness: RealCoreHarness) {
  return harness.db.writes.filter(write => write.table === 'appointment');
}

describe('PUT /appointments/:id: the real core update', () => {
  let harness: RealCoreHarness;

  beforeEach(() => {
    harness = buildRealCoreHarness();
  });

  const put = (dto: Row, role: string, userId = 'user-x', clinicId = CLINIC) =>
    harness.service.updateAppointment('appt-1', updateDto(dto), userId, clinicId, role);

  const seed = (overrides: Row = {}): Row =>
    harness.db.insert('appointment', appointmentRow({ status: 'CONFIRMED', ...overrides }));

  function expectUntouched(before: Row): void {
    expect(appointmentWrites(harness)).toHaveLength(0);
    expect(storedAppointment(harness)).toEqual(before);
    expect(harness.events.emitEnterprise).not.toHaveBeenCalled();
  }

  describe('staff cannot get around the state rules (finding 3)', () => {
    it.each(STAFF)('%s cannot expire a consultation in progress: 403', async role => {
      seed({ status: 'IN_PROGRESS' });
      const before = { ...storedAppointment(harness) };

      const error = await rejection(put({ status: AppointmentStatus.EXPIRED }, role));

      expect(error.getStatus()).toBe(403);
      expectUntouched(before);
    });

    it('the SYSTEM role (the scheduler) still can, and the reason is recorded', async () => {
      seed({ status: 'IN_PROGRESS' });

      const result = await put(
        { status: AppointmentStatus.EXPIRED, reason: 'window over' },
        'SYSTEM'
      );

      expect(result.success).toBe(true);
      expect(storedAppointment(harness)['status']).toBe('EXPIRED');
      expect(storedAppointment(harness)['cancellationReason']).toBe('window over');
    });

    it.each(STAFF)('%s cannot complete through the generic update: 400', async role => {
      seed({ status: 'IN_PROGRESS' });
      const before = { ...storedAppointment(harness) };

      const error = await rejection(put({ status: AppointmentStatus.COMPLETED }, role));

      expect(error.getStatus()).toBe(400);
      expectUntouched(before);
      expect(harness.confirmationPlugin.process).not.toHaveBeenCalled();
    });

    it.each(STAFF)('%s cannot start a consultation through the generic update: 400', async role => {
      seed({ status: 'CONFIRMED' });
      const before = { ...storedAppointment(harness) };

      const error = await rejection(put({ status: AppointmentStatus.IN_PROGRESS }, role));

      expect(error.getStatus()).toBe(400);
      expectUntouched(before);
    });

    it.each([
      'SCHEDULED',
      'FOLLOW_UP_SCHEDULED',
      'AWAITING_SLOT_CONFIRMATION',
      'RESCHEDULED',
      'TRANSFERRED',
    ])('staff cannot confirm an in-clinic %s visit: 400, check-in does', async status => {
      seed({ status, checkedInAt: null });
      const before = { ...storedAppointment(harness) };

      const error = await rejection(
        put({ status: AppointmentStatus.CONFIRMED }, Role.RECEPTIONIST)
      );

      expect(error.getStatus()).toBe(400);
      expect(error.message).toContain('check-in');
      expectUntouched(before);
      expect(harness.queue.checkIn).not.toHaveBeenCalled();
    });

    it.each(['SCHEDULED', 'PENDING', 'AWAITING_SLOT_CONFIRMATION'])(
      'staff cannot confirm a %s video visit: 400, payment does (no skipped payment)',
      async status => {
        harness.db.insert('appointment', paidVideoRow({ status, checkedInAt: null }));
        const before = { ...storedAppointment(harness) };

        const error = await rejection(
          put({ status: AppointmentStatus.CONFIRMED }, Role.CLINIC_ADMIN)
        );

        expect(error.getStatus()).toBe(400);
        expect(error.message).toContain('payment');
        expectUntouched(before);
      }
    );

    it('PENDING -> CONFIRMED of a video visit is refused by the REAL contract even for SYSTEM', async () => {
      harness.db.insert('appointment', paidVideoRow({ status: 'PENDING', checkedInAt: null }));
      const before = { ...storedAppointment(harness) };

      const result = await put({ status: AppointmentStatus.CONFIRMED }, 'SYSTEM');

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_STATUS_TRANSITION');
      expectUntouched(before);
    });

    it.each(STAFF)('%s keeps NO_SHOW on a confirmed visit (the contract allows it)', async role => {
      seed({ status: 'CONFIRMED' });

      const result = await put(
        { status: AppointmentStatus.NO_SHOW, notes: 'did not arrive' },
        role
      );

      expect(result.success).toBe(true);
      expect(storedAppointment(harness)['status']).toBe('NO_SHOW');
      expect(storedAppointment(harness)['notes']).toBe('did not arrive');
    });

    it('keeps CANCELLED, RESCHEDULED and ON_HOLD as the contract decides', async () => {
      seed({ status: 'SCHEDULED', checkedInAt: null });

      expect(
        (await put({ status: AppointmentStatus.RESCHEDULED }, Role.RECEPTIONIST)).success
      ).toBe(true);
      expect(storedAppointment(harness)['status']).toBe('RESCHEDULED');
      expect((await put({ status: AppointmentStatus.CANCELLED }, Role.RECEPTIONIST)).success).toBe(
        true
      );
      expect(storedAppointment(harness)['status']).toBe('CANCELLED');
    });

    it('a transition the table does not allow is an unsuccessful result, nothing written', async () => {
      seed({ status: 'COMPLETED' });
      const before = { ...storedAppointment(harness) };

      const result = await put({ status: AppointmentStatus.NO_SHOW }, Role.DOCTOR);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_STATUS_TRANSITION');
      expectUntouched(before);
    });
  });

  describe('every route is covered: the core refuses on its own, without the service guard', () => {
    it.each([
      [AppointmentStatus.EXPIRED, 'IN_PROGRESS', 403],
      [AppointmentStatus.COMPLETED, 'IN_PROGRESS', 400],
      [AppointmentStatus.IN_PROGRESS, 'CONFIRMED', 400],
      [AppointmentStatus.CONFIRMED, 'SCHEDULED', 400],
      [AppointmentStatus.CONFIRMED, 'FOLLOW_UP_SCHEDULED', 400],
    ])(
      'a staff update to %s of a %s visit is refused (%s)',
      async (target, current, httpStatus) => {
        seed({ status: current, checkedInAt: null });
        const before = { ...storedAppointment(harness) };

        const error = await rejection(
          harness.realCore.updateAppointment('appt-1', updateDto({ status: target }), {
            userId: 'user-x',
            role: Role.RECEPTIONIST,
            clinicId: CLINIC,
          })
        );

        expect(error.getStatus()).toBe(httpStatus);
        expectUntouched(before);
      }
    );

    it('a patient role is refused any status change in the core too (403)', async () => {
      seed({ status: 'CONFIRMED' });

      const error = await rejection(
        harness.realCore.updateAppointment(
          'appt-1',
          updateDto({ status: AppointmentStatus.IN_PROGRESS }),
          { userId: 'user-patient', role: Role.PATIENT, clinicId: CLINIC }
        )
      );

      expect(error.getStatus()).toBe(403);
    });

    it('refuses a forbidden field in the core too, before reading anything', async () => {
      seed();

      const error = await rejection(
        harness.realCore.updateAppointment('appt-1', updateDto({ doctorId: 'doctor-2' }), {
          userId: 'user-x',
          role: Role.CLINIC_ADMIN,
          clinicId: CLINIC,
        })
      );

      expect(error.getStatus()).toBe(400);
      expect(harness.db.executeHealthcareRead).not.toHaveBeenCalled();
    });
  });

  describe('a patient may edit notes only (finding 5)', () => {
    it('PUT { notes } succeeds and writes a clinic-scoped update', async () => {
      seed({ notes: null });

      const result = await put({ notes: 'please call me' }, Role.PATIENT, 'user-patient');

      expect(result.success).toBe(true);
      expect(storedAppointment(harness)['notes']).toBe('please call me');
      const writes = appointmentWrites(harness);
      expect(writes).toHaveLength(1);
      expect(writes[0]?.op).toBe('updateMany');
      expect(writes[0]?.args['where'] as Row).toEqual({ id: 'appt-1', clinicId: CLINIC });
      expect(Object.keys(writes[0]?.args['data'] as Row).sort()).toEqual(['notes', 'updatedAt']);
    });

    it('may echo the unchanged status along with the notes: ignored, not an error', async () => {
      seed({ status: 'SCHEDULED', checkedInAt: null });

      const result = await put(
        { status: AppointmentStatus.SCHEDULED, notes: 'running late' },
        Role.PATIENT,
        'user-patient'
      );

      expect(result.success).toBe(true);
      expect(storedAppointment(harness)['status']).toBe('SCHEDULED');
      expect(storedAppointment(harness)['notes']).toBe('running late');
      expect(Object.keys(appointmentWrites(harness)[0]?.args['data'] as Row)).not.toContain(
        'status'
      );
    });

    it.each([
      ['appointmentDate', '2099-01-06T10:00:00.000Z'],
      ['doctorId', 'doctor-2'],
      ['clinicId', OTHER_CLINIC],
      ['metadata', { rescheduleCount: 0 }],
      ['duration', 120],
      ['priority', 'URGENT'],
      ['treatmentType', 'GENERAL_CONSULTATION'],
    ])('PUT { %s } is refused with 400 and nothing is written', async (field, value) => {
      seed({ metadata: { rescheduleCount: 2 } });
      const before = { ...storedAppointment(harness) };

      const error = await rejection(
        put({ notes: 'hi', [field]: value }, Role.PATIENT, 'user-patient')
      );

      expect(error.getStatus()).toBe(400);
      expect(error.message).toContain(`Field "${field}" cannot be changed here.`);
      expectUntouched(before);
      expect((storedAppointment(harness)['metadata'] as Row)['rescheduleCount']).toBe(2);
    });

    it('cannot change the status of the appointment (403)', async () => {
      seed({ status: 'CONFIRMED' });
      const before = { ...storedAppointment(harness) };

      const error = await rejection(
        put({ status: AppointmentStatus.IN_PROGRESS }, Role.PATIENT, 'user-patient')
      );

      expect(error.getStatus()).toBe(403);
      expectUntouched(before);
    });

    it("another clinic's appointment is simply not found: unsuccessful result, no write", async () => {
      seed({ clinicId: OTHER_CLINIC });
      const before = { ...storedAppointment(harness) };

      const result = await put({ notes: 'x' }, Role.PATIENT, 'user-patient');

      expect(result.success).toBe(false);
      expect(result.error).toBe('APPOINTMENT_NOT_FOUND');
      expectUntouched(before);
    });
  });

  describe('staff may change only non-structural fields (finding 5)', () => {
    it.each(STAFF)('%s may change notes, priority and treatment type', async role => {
      seed();

      const result = await put(
        { notes: 'wheelchair', priority: 'HIGH', treatmentType: 'FOLLOW_UP' },
        role
      );

      expect(result.success).toBe(true);
      const stored = storedAppointment(harness);
      expect(stored['notes']).toBe('wheelchair');
      expect(stored['priority']).toBe('HIGH');
      expect(stored['treatmentType']).toBe('FOLLOW_UP');
      expect(stored['status']).toBe('CONFIRMED');
    });

    it.each([
      ['appointmentDate', '2099-01-06T10:00:00.000Z'],
      ['duration', 90],
      ['doctorId', 'doctor-2'],
      ['clinicId', OTHER_CLINIC],
      ['locationId', 'loc-2'],
      ['patientId', 'patient-2'],
      ['type', 'VIDEO_CALL'],
      ['paymentStatus', 'PAID'],
      ['checkedInAt', new Date()],
      ['completedAt', new Date()],
      ['startedAt', new Date()],
      ['metadata', { rescheduleCount: 0 }],
    ])(
      'cannot change %s (400): reschedule / reassign / system fields have their own flows',
      async (field, value) => {
        seed();
        const before = { ...storedAppointment(harness) };

        const error = await rejection(put({ [field]: value }, Role.CLINIC_ADMIN));

        expect(error.getStatus()).toBe(400);
        expect(error.message).toContain(`Field "${field}" cannot be changed here.`);
        expectUntouched(before);
      }
    );

    it('a doctor saves a consultation draft: merged into the metadata, the rest of it is kept', async () => {
      seed({ metadata: { rescheduleCount: 1, lastRescheduledAt: '2026-10-01' } });

      const result = await put(
        { metadata: { consultationDraft: { diagnosis: 'allergy', savedBy: 'user-doctor' } } },
        Role.DOCTOR
      );

      expect(result.success).toBe(true);
      expect(storedAppointment(harness)['metadata']).toEqual({
        rescheduleCount: 1,
        lastRescheduledAt: '2026-10-01',
        consultationDraft: { diagnosis: 'allergy', savedBy: 'user-doctor' },
      });
    });

    it('a draft cannot be used to smuggle other metadata keys (rescheduleCount reset)', async () => {
      seed({ metadata: { rescheduleCount: 2 } });
      const before = { ...storedAppointment(harness) };

      const error = await rejection(
        put({ metadata: { consultationDraft: {}, rescheduleCount: 0 } }, Role.DOCTOR)
      );

      expect(error.getStatus()).toBe(400);
      expectUntouched(before);
    });

    it('the update is clinic-scoped and, when the status changes, conditional on the validated status', async () => {
      seed({ status: 'CONFIRMED' });

      await put({ status: AppointmentStatus.NO_SHOW }, Role.RECEPTIONIST);

      const where = appointmentWrites(harness)[0]?.args['where'] as Row;
      expect(where).toEqual({ id: 'appt-1', clinicId: CLINIC, status: 'CONFIRMED' });
    });

    it('a row that changed after it was read is not overwritten: unsuccessful result', async () => {
      seed({ status: 'CONFIRMED' });
      // A doctor starts the visit between the core's read and its write.
      const write = harness.db.executeHealthcareWrite.getMockImplementation();
      harness.db.executeHealthcareWrite.mockImplementationOnce(async (operation, audit) => {
        storedAppointment(harness)['status'] = 'IN_PROGRESS';
        return write ? write(operation, audit) : operation(harness.db.client);
      });

      const result = await put({ status: AppointmentStatus.NO_SHOW }, Role.RECEPTIONIST);

      expect(result.success).toBe(false);
      expect(result.error).toBe('APPOINTMENT_CONFLICT');
      expect(storedAppointment(harness)['status']).toBe('IN_PROGRESS');
    });
  });

  describe('the doctor queue (finding 7)', () => {
    it('a notes-only PUT on a CONFIRMED queued appointment keeps the queue entry', async () => {
      seed({ status: 'CONFIRMED', checkedInAt: CHECKED_IN_AT });

      const result = await put({ notes: 'asked for a wheelchair' }, Role.PATIENT, 'user-patient');

      expect(result.success).toBe(true);
      expect(harness.queue.removePatientFromQueue).not.toHaveBeenCalled();
      expect(storedAppointment(harness)['status']).toBe('CONFIRMED');
      expect(storedAppointment(harness)['checkedInAt']).toBe(CHECKED_IN_AT);
    });

    it('a staff edit of the priority keeps it too', async () => {
      seed({ status: 'CONFIRMED', checkedInAt: CHECKED_IN_AT });

      await put({ priority: 'HIGH' }, Role.RECEPTIONIST);

      expect(harness.queue.removePatientFromQueue).not.toHaveBeenCalled();
    });

    it.each([
      [AppointmentStatus.NO_SHOW, Role.RECEPTIONIST, 'CONFIRMED'],
      [AppointmentStatus.CANCELLED, Role.RECEPTIONIST, 'SCHEDULED'],
      [AppointmentStatus.EXPIRED, 'SYSTEM', 'CONFIRMED'],
    ])('leaves the queue when the new status is %s (terminal)', async (target, role, current) => {
      seed({ status: current, checkedInAt: CHECKED_IN_AT });

      const result = await put({ status: target }, role);

      expect(result.success).toBe(true);
      expect(harness.queue.removePatientFromQueue).toHaveBeenCalledTimes(1);
      expect(harness.queue.removePatientFromQueue).toHaveBeenCalledWith(
        'appt-1',
        'doctor-1',
        CLINIC,
        'clinic'
      );
    });

    it('a non-terminal status change (RESCHEDULED) does not drop the entry', async () => {
      seed({ status: 'SCHEDULED', checkedInAt: null });

      await put({ status: AppointmentStatus.RESCHEDULED }, Role.RECEPTIONIST);

      expect(harness.queue.removePatientFromQueue).not.toHaveBeenCalled();
    });
  });
});

describe('PATCH /appointments/:id/status: the real updateStatus (finding 1)', () => {
  let harness: RealCoreHarness;

  beforeEach(() => {
    harness = buildRealCoreHarness();
  });

  const patch = (dto: Row, role: string, userId = 'user-x') =>
    harness.service.updateStatus('appt-1', statusDto(dto), userId, CLINIC, role);

  /** A checked-in in-person visit: the check-in rule is satisfied, so only the role gate can stop it. */
  const seedCheckedIn = (overrides: Row = {}): void => {
    harness.db.insert(
      'appointment',
      appointmentRow({ status: 'CONFIRMED', checkedInAt: CHECKED_IN_AT, ...overrides })
    );
  };

  function expectNothingDispatched(): void {
    expect(harness.checkInPlugin.process).not.toHaveBeenCalled();
    expect(harness.confirmationPlugin.process).not.toHaveBeenCalled();
    expect(appointmentWrites(harness)).toHaveLength(0);
    expect(harness.queue.removePatientFromQueue).not.toHaveBeenCalled();
    expect(harness.queue.checkIn).not.toHaveBeenCalled();
    expect(harness.events.emitEnterprise).not.toHaveBeenCalled();
    expect(harness.db.findPaymentsSafe).not.toHaveBeenCalled();
  }

  describe.each([Role.PATIENT, 'USER', Role.PHARMACIST, ''])('a non-staff role (%p)', role => {
    it.each([
      AppointmentStatus.IN_PROGRESS,
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.COMPLETED,
      AppointmentStatus.NO_SHOW,
      AppointmentStatus.EXPIRED,
      AppointmentStatus.RESCHEDULED,
      AppointmentStatus.ON_HOLD,
    ])('gets 403 for %s: nothing is started, completed, checked in or refunded', async status => {
      seedCheckedIn();

      const error = await rejection(patch({ status, reason: 'r' }, role, 'user-patient'));

      expect(error.getStatus()).toBe(403);
      expectNothingDispatched();
      expect(storedAppointmentStatus(harness)).toBe('CONFIRMED');
    });
  });

  it('a patient cannot start their own consultation after checking in', async () => {
    seedCheckedIn();

    const error = await rejection(
      patch({ status: AppointmentStatus.IN_PROGRESS }, Role.PATIENT, 'user-patient')
    );

    expect(error.getStatus()).toBe(403);
    expect(harness.checkInPlugin.process).not.toHaveBeenCalled();
  });

  it('a patient cannot run the legacy check-in with CONFIRMED on an unchecked appointment', async () => {
    seedCheckedIn({ status: 'SCHEDULED', checkedInAt: null });

    const error = await rejection(
      patch({ status: AppointmentStatus.CONFIRMED }, Role.PATIENT, 'user-patient')
    );

    expect(error.getStatus()).toBe(403);
    expectNothingDispatched();
  });

  it.each([Role.RECEPTIONIST, 'SYSTEM'])(
    'NO_SHOW never refunds, even with the doctor-no-show reason (%s): the payment is left as it is',
    async role => {
      harness.db.insert('appointment', paidVideoRow({ status: 'CONFIRMED', checkedInAt: null }));
      harness.db.insert('payment', { id: 'pay-1', appointmentId: 'appt-1', status: 'COMPLETED' });

      const result = (await patch(
        {
          status: AppointmentStatus.NO_SHOW,
          reason: 'Doctor failed to join within grace period.',
        },
        role,
        'system'
      )) as { success: boolean };

      expect(result.success).toBe(true);
      expect(storedAppointmentStatus(harness)).toBe('NO_SHOW');
      expect(harness.db.findPaymentsSafe).not.toHaveBeenCalled();
      expect(harness.db.rows('payment')).toEqual([
        { id: 'pay-1', appointmentId: 'appt-1', status: 'COMPLETED' },
      ]);
    }
  );

  it('a patient may still cancel: CANCELLED follows the existing rules (reason required, 400)', async () => {
    seedCheckedIn({ status: 'SCHEDULED', checkedInAt: null, type: 'VIDEO_CALL' });

    const error = await rejection(
      patch({ status: AppointmentStatus.CANCELLED }, Role.PATIENT, 'user-patient')
    );

    expect(error.getStatus()).toBe(400);
  });

  it('a patient CANCELLED with a reason reaches the cancellation flow', async () => {
    seedCheckedIn({ status: 'PENDING', checkedInAt: null, type: 'VIDEO_CALL' });
    const cancel = jest.spyOn(harness.realCore, 'cancelAppointment').mockResolvedValue({
      success: true,
      message: 'cancelled',
      data: { patientId: 'patient-1', doctorId: 'doctor-1' },
    });

    const result = (await patch(
      { status: AppointmentStatus.CANCELLED, reason: 'changed my mind' },
      Role.PATIENT,
      'user-patient'
    )) as { success: boolean };

    expect(result.success).toBe(true);
    expect(cancel).toHaveBeenCalledWith('appt-1', 'changed my mind', {
      userId: 'user-patient',
      role: Role.PATIENT,
      clinicId: CLINIC,
    });
    expect(harness.db.findPaymentsSafe).not.toHaveBeenCalled();
  });

  it('a doctor can still start the consultation of a checked-in visit', async () => {
    seedCheckedIn();

    const result = (await patch(
      { status: AppointmentStatus.IN_PROGRESS },
      Role.DOCTOR,
      'user-doctor'
    )) as { success: boolean };

    expect(result.success).toBe(true);
    expect(harness.checkInPlugin.process).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'startConsultation', appointmentId: 'appt-1' })
    );
  });

  describe('startConsultation itself refuses a non-staff caller', () => {
    it.each([Role.PATIENT, 'USER', Role.PHARMACIST, 'SYSTEM', ''])('%p gets 403', async role => {
      seedCheckedIn();

      const error = await rejection(
        harness.service.startConsultation(
          'appt-1',
          { doctorId: 'doctor-1' },
          'user-x',
          CLINIC,
          role
        )
      );

      expect(error.getStatus()).toBe(403);
      expect(harness.checkInPlugin.process).not.toHaveBeenCalled();
    });

    it.each(STAFF)('%s may start it', async role => {
      seedCheckedIn();

      const result = (await harness.service.startConsultation(
        'appt-1',
        { doctorId: 'doctor-1' },
        'user-x',
        CLINIC,
        role
      )) as { success: boolean };

      expect(result.success).toBe(true);
      expect(harness.checkInPlugin.process).toHaveBeenCalledTimes(1);
    });
  });

  it('completing through PATCH COMPLETED is still the complete flow (a patient is refused first)', async () => {
    seedCheckedIn({ status: 'IN_PROGRESS' });

    const error = await rejection(
      patch({ status: AppointmentStatus.COMPLETED }, Role.PATIENT, 'user-patient')
    );

    expect(error.getStatus()).toBe(403);
    expect(harness.confirmationPlugin.process).not.toHaveBeenCalled();
  });
});

function storedAppointmentStatus(harness: RealCoreHarness): unknown {
  return storedAppointment(harness)['status'];
}

describe('processCheckIn: actor and receptionist location (handover from check-in)', () => {
  it('passes the actor role to the check-in plugin', async () => {
    const harness = buildRealCoreHarness();
    harness.db.insert('appointment', appointmentRow({ status: 'SCHEDULED', checkedInAt: null }));

    await harness.service.processCheckIn(
      { appointmentId: 'appt-1' } as never,
      'user-doctor',
      CLINIC,
      Role.DOCTOR
    );

    expect(harness.checkInPlugin.process).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'processCheckIn', userRole: Role.DOCTOR })
    );
  });

  it('an unassigned receptionist in a multi-location clinic is refused (fail closed)', async () => {
    const harness = buildRealCoreHarness();
    harness.db.insert('appointment', appointmentRow({ status: 'SCHEDULED', checkedInAt: null }));
    harness.db.insert('clinicLocation', {
      id: 'loc-1',
      clinicId: CLINIC,
      isActive: true,
      deletedAt: null,
    });
    harness.db.insert('clinicLocation', {
      id: 'loc-2',
      clinicId: CLINIC,
      isActive: true,
      deletedAt: null,
    });

    const error = await rejection(
      harness.service.processCheckIn(
        { appointmentId: 'appt-1' } as never,
        'user-reception',
        CLINIC,
        Role.RECEPTIONIST
      )
    );

    expect(error.getStatus()).toBe(403);
    expect(harness.checkInPlugin.process).not.toHaveBeenCalled();
  });
});

describe('updateStatus step 2 only guards IN_PROGRESS and COMPLETED for in-person visits', () => {
  const scheduled = () => {
    const harness = buildRealCoreHarness();
    harness.db.insert('appointment', appointmentRow({ status: 'SCHEDULED', checkedInAt: null }));
    return harness;
  };

  it('a patient cancels a SCHEDULED in-person visit via PATCH status: 200', async () => {
    const harness = scheduled();
    jest.spyOn(harness.realCore, 'cancelAppointment').mockResolvedValue({
      success: true,
      message: 'cancelled',
      data: { patientId: 'patient-1', doctorId: 'doctor-1' },
    });

    const result = (await harness.service.updateStatus(
      'appt-1',
      { status: AppointmentStatus.CANCELLED, reason: 'cannot come' } as never,
      'user-patient',
      CLINIC,
      Role.PATIENT
    )) as { success: boolean };

    expect(result.success).toBe(true);
  });

  it.each([AppointmentStatus.NO_SHOW, AppointmentStatus.EXPIRED])(
    'staff %s on a SCHEDULED in-person visit works',
    async status => {
      const harness = scheduled();

      const result = (await harness.service.updateStatus(
        'appt-1',
        { status } as never,
        'user-reception',
        CLINIC,
        Role.RECEPTIONIST
      )) as { success: boolean };

      // NO_SHOW is not allowed from SCHEDULED by the table; EXPIRED is.
      expect(result.success).toBe(status === AppointmentStatus.EXPIRED);
      expect(harness.db.rows('appointment')[0]?.['status']).toBe(
        status === AppointmentStatus.EXPIRED ? 'EXPIRED' : 'SCHEDULED'
      );
    }
  );

  it.each([AppointmentStatus.IN_PROGRESS, AppointmentStatus.COMPLETED])(
    '%s on a SCHEDULED in-person visit is still 400 "not confirmed"',
    async status => {
      const harness = scheduled();

      const error = await rejection(
        harness.service.updateStatus(
          'appt-1',
          { status } as never,
          'user-doctor',
          CLINIC,
          Role.DOCTOR
        )
      );

      expect(error.getStatus()).toBe(400);
      expect(error.message).toContain('not confirmed');
    }
  );
});
