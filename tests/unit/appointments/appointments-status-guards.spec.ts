/**
 * Status-change guards of AppointmentsService:
 * - PUT /appointments/:id (updateAppointment) cannot confirm an appointment around check-in,
 * - PATCH /appointments/:id/status (updateStatus) NO_SHOW / EXPIRED belong to staff and the system,
 * - reassigning a doctor never puts a video appointment into a doctor queue.
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
  buildHarness,
  paidVideoRow,
  rejection,
} from './appointments-harness';

type Harness = ReturnType<typeof buildHarness>;

const PATIENT_MESSAGE =
  'Patients cannot change an appointment status here. Cancel the appointment, or check in at the clinic.';
const CHECK_IN_MESSAGE = 'In-clinic appointments are confirmed by check-in. Use the check-in flow.';
const VIDEO_CONFIRMATION_MESSAGE =
  'Video appointments are confirmed by payment, not by a status change.';

const STAFF_ROLES = [
  Role.RECEPTIONIST,
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.CLINIC_ADMIN,
  Role.NURSE,
];

function updateDto(overrides: Partial<UpdateAppointmentDto>): UpdateAppointmentDto {
  return overrides as UpdateAppointmentDto;
}

function statusDto(overrides: Partial<UpdateAppointmentStatusDto>): UpdateAppointmentStatusDto {
  return overrides as UpdateAppointmentStatusDto;
}

function seedScheduledInPerson(harness: Harness, overrides: Row = {}): Row {
  return harness.db.insert(
    'appointment',
    appointmentRow({ status: 'SCHEDULED', checkedInAt: null, ...overrides })
  );
}

describe('AppointmentsService.updateAppointment status guard (PUT /appointments/:id)', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = buildHarness();
  });

  const update = (dto: UpdateAppointmentDto, role: string | undefined, clinicId = CLINIC) =>
    role === undefined
      ? harness.service.updateAppointment('appt-1', dto, 'user-x', clinicId)
      : harness.service.updateAppointment('appt-1', dto, 'user-x', clinicId, role);

  function expectNothingWritten(): void {
    expect(harness.core.updateAppointment).not.toHaveBeenCalled();
    expect(harness.db.writes).toHaveLength(0);
    expect(harness.events.emitEnterprise).not.toHaveBeenCalled();
  }

  describe('a patient', () => {
    it('cannot confirm their own in-person appointment: 403 and the core update never runs', async () => {
      seedScheduledInPerson(harness);

      const error = await rejection(
        update(updateDto({ status: AppointmentStatus.CONFIRMED }), Role.PATIENT)
      );

      expect(error.getStatus()).toBe(403);
      expect(error.message).toBe(PATIENT_MESSAGE);
      expectNothingWritten();
      expect(harness.queue.checkIn).not.toHaveBeenCalled();
      expect(harness.db.rows('appointment')[0]?.['status']).toBe('SCHEDULED');
    });

    it('cannot confirm a video appointment either (video is confirmed by payment)', async () => {
      harness.db.insert('appointment', paidVideoRow({ status: 'PENDING', checkedInAt: null }));

      const error = await rejection(
        update(updateDto({ status: AppointmentStatus.CONFIRMED }), Role.PATIENT)
      );

      expect(error.getStatus()).toBe(403);
      expectNothingWritten();
    });

    it.each([
      AppointmentStatus.IN_PROGRESS,
      AppointmentStatus.COMPLETED,
      AppointmentStatus.NO_SHOW,
      AppointmentStatus.EXPIRED,
      AppointmentStatus.CANCELLED,
    ])('cannot move the appointment to %s through this method', async status => {
      seedScheduledInPerson(harness);

      const error = await rejection(update(updateDto({ status }), Role.PATIENT));

      expect(error.getStatus()).toBe(403);
      expectNothingWritten();
    });

    it.each(['USER', 'PHARMACIST', 'LAB_TECHNICIAN', ''])(
      'is not the only refused role: %p is treated as non-staff and gets 403',
      async role => {
        seedScheduledInPerson(harness);

        const error = await rejection(
          update(updateDto({ status: AppointmentStatus.CONFIRMED }), role)
        );

        expect(error.getStatus()).toBe(403);
        expectNothingWritten();
      }
    );

    it('a missing role (service default) is treated as non-staff', async () => {
      seedScheduledInPerson(harness);

      const error = await rejection(
        update(updateDto({ status: AppointmentStatus.CONFIRMED }), undefined)
      );

      expect(error.getStatus()).toBe(403);
      expectNothingWritten();
    });

    it('may send the unchanged status along with other fields: passes through to the core', async () => {
      seedScheduledInPerson(harness);
      const dto = updateDto({ status: AppointmentStatus.SCHEDULED, notes: 'running late' });

      const result = await update(dto, Role.PATIENT);

      expect(result.success).toBe(true);
      expect(harness.core.updateAppointment).toHaveBeenCalledTimes(1);
      expect(harness.core.updateAppointment).toHaveBeenCalledWith('appt-1', dto, {
        userId: 'user-x',
        role: Role.PATIENT,
        clinicId: CLINIC,
      });
    });

    it('may update other fields without a status: passes through with no extra database read', async () => {
      seedScheduledInPerson(harness);
      const dto = updateDto({ notes: 'please call me' });

      const result = await update(dto, Role.PATIENT);

      expect(result.success).toBe(true);
      expect(harness.core.updateAppointment).toHaveBeenCalledWith('appt-1', dto, {
        userId: 'user-x',
        role: Role.PATIENT,
        clinicId: CLINIC,
      });
      expect(harness.db.executeHealthcareRead).not.toHaveBeenCalled();
    });

    it('gets 404, not a leak, for an appointment of another clinic', async () => {
      seedScheduledInPerson(harness, { clinicId: OTHER_CLINIC });

      const error = await rejection(
        update(updateDto({ status: AppointmentStatus.CONFIRMED }), Role.PATIENT)
      );

      expect(error.getStatus()).toBe(404);
      expectNothingWritten();
    });

    it('is decided on a fresh clinic-scoped read, not on the cached detail', async () => {
      seedScheduledInPerson(harness);
      // A stale cached copy that still says CONFIRMED must not turn this into an "unchanged" status.
      harness.cache.cache.mockImplementation(async () => appointmentRow({ status: 'CONFIRMED' }));

      const error = await rejection(
        update(updateDto({ status: AppointmentStatus.CONFIRMED }), Role.PATIENT)
      );

      expect(error.getStatus()).toBe(403);
      expect(harness.db.executeHealthcareRead).toHaveBeenCalledTimes(1);
      expectNothingWritten();
    });
  });

  describe('clinic staff', () => {
    it.each(STAFF_ROLES)(
      '%s cannot confirm a SCHEDULED in-person appointment: 400, the check-in flow creates the queue entry',
      async role => {
        seedScheduledInPerson(harness);

        const error = await rejection(
          update(updateDto({ status: AppointmentStatus.CONFIRMED }), role)
        );

        expect(error.getStatus()).toBe(400);
        expect(error.message).toBe(CHECK_IN_MESSAGE);
        expectNothingWritten();
        expect(harness.db.rows('appointment')[0]?.['status']).toBe('SCHEDULED');
      }
    );

    it('treats a home visit like an in-person visit (only VIDEO_CALL is exempt)', async () => {
      seedScheduledInPerson(harness, { type: 'HOME_VISIT' });

      const error = await rejection(
        update(updateDto({ status: AppointmentStatus.CONFIRMED }), Role.RECEPTIONIST)
      );

      expect(error.getStatus()).toBe(400);
      expectNothingWritten();
    });

    it.each(['SCHEDULED', 'PENDING', 'AWAITING_SLOT_CONFIRMATION'])(
      'staff cannot confirm a %s VIDEO_CALL appointment either: video is confirmed by payment',
      async status => {
        harness.db.insert('appointment', paidVideoRow({ status, checkedInAt: null }));

        const error = await rejection(
          update(updateDto({ status: AppointmentStatus.CONFIRMED }), Role.RECEPTIONIST)
        );

        expect(error.getStatus()).toBe(400);
        expect(error.message).toBe(VIDEO_CONFIRMATION_MESSAGE);
        expectNothingWritten();
      }
    );

    it.each([
      AppointmentStatus.CANCELLED,
      AppointmentStatus.NO_SHOW,
      AppointmentStatus.EXPIRED,
      AppointmentStatus.RESCHEDULED,
    ])(
      'a receptionist moving a SCHEDULED in-person appointment to %s still follows the state contract: passes to the core',
      async status => {
        seedScheduledInPerson(harness);
        const dto = updateDto({ status });

        const result = await update(dto, Role.RECEPTIONIST);

        expect(result.success).toBe(true);
        expect(harness.core.updateAppointment).toHaveBeenCalledWith('appt-1', dto, {
          userId: 'user-x',
          role: Role.RECEPTIONIST,
          clinicId: CLINIC,
        });
        // Not CONFIRMED, so no need to even read the row for the guard.
        expect(harness.db.executeHealthcareRead).not.toHaveBeenCalled();
      }
    );

    it('a receptionist updating other fields without a status is untouched', async () => {
      seedScheduledInPerson(harness);

      const result = await update(updateDto({ notes: 'wheelchair access' }), Role.RECEPTIONIST);

      expect(result.success).toBe(true);
      expect(harness.core.updateAppointment).toHaveBeenCalledTimes(1);
      expect(harness.db.executeHealthcareRead).not.toHaveBeenCalled();
    });

    it('answers 404 for staff of another clinic and never reaches the core', async () => {
      seedScheduledInPerson(harness);

      const error = await rejection(
        update(updateDto({ status: AppointmentStatus.CONFIRMED }), Role.RECEPTIONIST, OTHER_CLINIC)
      );

      expect(error.getStatus()).toBe(404);
      expectNothingWritten();
    });
  });

  describe('permissions and failure modes', () => {
    it('the RBAC refusal still comes first (403) and no appointment is read', async () => {
      seedScheduledInPerson(harness);
      harness.rbac.checkPermission.mockResolvedValueOnce({ hasPermission: false });

      const error = await rejection(
        update(updateDto({ status: AppointmentStatus.CONFIRMED }), Role.PATIENT)
      );

      expect(error.getStatus()).toBe(403);
      expect(harness.db.executeHealthcareRead).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    it('fails closed when the appointment cannot be read: nothing is passed on to the core', async () => {
      seedScheduledInPerson(harness);
      harness.db.executeHealthcareRead.mockRejectedValueOnce(new Error('database unavailable'));

      await expect(
        update(updateDto({ status: AppointmentStatus.CONFIRMED }), Role.RECEPTIONIST)
      ).rejects.toThrow('database unavailable');

      expectNothingWritten();
    });
  });

  describe('the SYSTEM role (cron / internal callers)', () => {
    it.each([AppointmentStatus.CONFIRMED, AppointmentStatus.EXPIRED, AppointmentStatus.NO_SHOW])(
      'bypasses RBAC and the guard: %s reaches the core untouched',
      async status => {
        seedScheduledInPerson(harness);
        const dto = updateDto({ status });

        const result = await update(dto, 'SYSTEM');

        expect(result.success).toBe(true);
        expect(harness.rbac.checkPermission).not.toHaveBeenCalled();
        expect(harness.db.executeHealthcareRead).not.toHaveBeenCalled();
        expect(harness.core.updateAppointment).toHaveBeenCalledWith('appt-1', dto, {
          userId: 'user-x',
          role: 'SYSTEM',
          clinicId: CLINIC,
        });
      }
    );
  });
});

describe('AppointmentsService.updateStatus NO_SHOW / EXPIRED role gate (PATCH :id/status)', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = buildHarness();
  });

  const patchStatus = (dto: UpdateAppointmentStatusDto, role: string, userId = 'user-x') =>
    harness.service.updateStatus('appt-1', dto, userId, CLINIC, role);

  function seedConfirmed(kind: 'IN_PERSON' | 'VIDEO_CALL'): void {
    harness.db.insert(
      'appointment',
      kind === 'VIDEO_CALL'
        ? paidVideoRow({ status: 'CONFIRMED', checkedInAt: null })
        : appointmentRow({ status: 'CONFIRMED' })
    );
  }

  function expectRefused(error: { getStatus: () => number }): void {
    expect(error.getStatus()).toBe(403);
    expect(harness.core.updateAppointment).not.toHaveBeenCalled();
    expect(harness.db.writes).toHaveLength(0);
    expect(harness.queue.removePatientFromQueue).not.toHaveBeenCalled();
    expect(harness.events.emitEnterprise).not.toHaveBeenCalled();
  }

  describe.each(['IN_PERSON', 'VIDEO_CALL'] as const)('on a CONFIRMED %s appointment', kind => {
    it.each([Role.PATIENT, Role.PHARMACIST, 'USER'])('%s gets 403 for NO_SHOW', async role => {
      seedConfirmed(kind);

      const error = await rejection(
        patchStatus(statusDto({ status: AppointmentStatus.NO_SHOW }), role)
      );

      expectRefused(error);
    });

    it.each([Role.PATIENT, Role.PHARMACIST, 'USER'])('%s gets 403 for EXPIRED', async role => {
      seedConfirmed(kind);

      const error = await rejection(
        patchStatus(statusDto({ status: AppointmentStatus.EXPIRED }), role)
      );

      expectRefused(error);
    });
  });

  it('a patient cannot use the doctor-no-show reason to trigger a refund: 403 before any payment lookup', async () => {
    seedConfirmed('VIDEO_CALL');

    const error = await rejection(
      patchStatus(
        statusDto({
          status: AppointmentStatus.NO_SHOW,
          reason: 'Doctor failed to join within grace period.',
        }),
        Role.PATIENT
      )
    );

    expectRefused(error);
    expect(harness.db.findPaymentsSafe).not.toHaveBeenCalled();
  });

  it('a patient gets the same 403 on a not-yet-confirmed in-person appointment (not the check-in rule)', async () => {
    seedScheduledInPerson(harness);

    const error = await rejection(
      patchStatus(statusDto({ status: AppointmentStatus.EXPIRED }), Role.PATIENT)
    );

    expectRefused(error);
  });

  it('the existing IN_PROGRESS -> EXPIRED rule is untouched: still 403 for every human role', async () => {
    harness.db.insert('appointment', paidVideoRow({ status: 'IN_PROGRESS' }));

    const error = await rejection(
      patchStatus(statusDto({ status: AppointmentStatus.EXPIRED }), Role.CLINIC_ADMIN)
    );

    expectRefused(error);
  });

  it('CANCELLED is not affected by the gate: a patient still reaches the cancellation rules (reason required: 400, not 403)', async () => {
    seedConfirmed('IN_PERSON');

    const error = await rejection(
      patchStatus(statusDto({ status: AppointmentStatus.CANCELLED }), Role.PATIENT)
    );

    expect(error.getStatus()).toBe(400);
    expect(harness.core.updateAppointment).not.toHaveBeenCalled();
  });

  it.each(STAFF_ROLES)(
    '%s may mark a CONFIRMED in-person appointment NO_SHOW (state contract allows it)',
    async role => {
      seedConfirmed('IN_PERSON');

      const result = (await patchStatus(
        statusDto({ status: AppointmentStatus.NO_SHOW, notes: 'did not arrive' }),
        role
      )) as { success: boolean };

      expect(result.success).toBe(true);
      expect(harness.core.updateAppointment).toHaveBeenCalledTimes(1);
      expect(harness.core.updateAppointment).toHaveBeenCalledWith(
        'appt-1',
        { status: AppointmentStatus.NO_SHOW, notes: 'did not arrive' },
        { userId: 'user-x', role, clinicId: CLINIC }
      );
    }
  );

  it('staff may expire a CONFIRMED video appointment', async () => {
    seedConfirmed('VIDEO_CALL');

    await patchStatus(statusDto({ status: AppointmentStatus.EXPIRED }), Role.CLINIC_ADMIN);

    expect(harness.core.updateAppointment).toHaveBeenCalledTimes(1);
  });

  it.each([AppointmentStatus.EXPIRED, AppointmentStatus.NO_SHOW])(
    'the SYSTEM role keeps %s (scheduler flows)',
    async status => {
      seedConfirmed('VIDEO_CALL');

      await patchStatus(statusDto({ status }), 'SYSTEM', 'system');

      expect(harness.core.updateAppointment).toHaveBeenCalledTimes(1);
      expect(harness.core.updateAppointment).toHaveBeenCalledWith(
        'appt-1',
        expect.objectContaining({ status }),
        { userId: 'system', role: 'SYSTEM', clinicId: CLINIC }
      );
    }
  );

  it('the SYSTEM role may still expire an IN_PROGRESS visit (unchanged)', async () => {
    harness.db.insert('appointment', paidVideoRow({ status: 'IN_PROGRESS' }));

    await patchStatus(statusDto({ status: AppointmentStatus.EXPIRED }), 'SYSTEM', 'system');

    expect(harness.core.updateAppointment).toHaveBeenCalledTimes(1);
  });
});

describe('AppointmentsService.reassignDoctor never queues a video appointment', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = buildHarness();
  });

  function seed(overrides: Row): void {
    harness.db.insert(
      'appointment',
      appointmentRow({ status: 'CONFIRMED', checkedInAt: null, ...overrides })
    );
    // Hand the service a copy: the in-memory update mutates the stored row in place, and the
    // service still needs the previous doctor id afterwards (a real database returns a fresh row).
    harness.db.findAppointmentByIdSafe.mockImplementation(async (id: string) => {
      const row = harness.db.rows('appointment').find(candidate => candidate['id'] === id);
      return row ? { ...row } : null;
    });
    // The target doctor lookup (the in-memory client has no doctor table).
    harness.db.executeHealthcareRead.mockImplementationOnce(async () => ({
      id: 'doctor-2',
      user: { id: 'user-doctor-2', role: Role.DOCTOR, name: 'Dr Two' },
      clinics: [{ clinicId: CLINIC, locationId: 'loc-1' }],
    }));
  }

  const reassign = () =>
    harness.service.reassignDoctor('appt-1', 'doctor-2', 'user-admin', CLINIC, Role.CLINIC_ADMIN);

  function expectReassignedInDatabase(): void {
    const stored = harness.db.rows('appointment')[0] as Row;
    expect(stored['doctorId']).toBe('doctor-2');
    expect((stored['metadata'] as Row)['assignedDoctorId']).toBe('doctor-2');
    expect(harness.events.emitEnterprise).toHaveBeenCalledWith(
      'appointment.reassigned',
      expect.objectContaining({ clinicId: CLINIC })
    );
  }

  it('re-assigns a CONFIRMED VIDEO_CALL appointment in the database only: the queue is never called', async () => {
    seed({ type: 'VIDEO_CALL', locationId: 'loc-1', payment: { status: 'COMPLETED' } });

    const result = (await reassign()) as { success: boolean };

    expect(result.success).toBe(true);
    expectReassignedInDatabase();
    expect(harness.queue.removePatientFromQueue).not.toHaveBeenCalled();
    expect(harness.queue.checkIn).not.toHaveBeenCalled();
  });

  it('moves a CONFIRMED in-person appointment between doctor queues: remove from the old, check in to the new', async () => {
    seed({ type: 'IN_PERSON' });

    const result = (await reassign()) as { success: boolean };

    expect(result.success).toBe(true);
    expectReassignedInDatabase();
    expect(harness.queue.removePatientFromQueue).toHaveBeenCalledTimes(1);
    expect(harness.queue.removePatientFromQueue).toHaveBeenCalledWith(
      'appt-1',
      'doctor-1',
      CLINIC,
      'clinic'
    );
    expect(harness.queue.checkIn).toHaveBeenCalledTimes(1);
    expect(harness.queue.checkIn).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: 'appt-1',
        doctorId: 'doctor-2',
        patientId: 'patient-1',
        clinicId: CLINIC,
        appointmentType: 'IN_PERSON',
        locationId: 'loc-1',
      }),
      'clinic'
    );
    const removeOrder = harness.queue.removePatientFromQueue.mock.invocationCallOrder[0] ?? 0;
    const checkInOrder = harness.queue.checkIn.mock.invocationCallOrder[0] ?? 0;
    expect(removeOrder).toBeLessThan(checkInOrder);
  });

  it('an in-person appointment that is only SCHEDULED is not in a queue yet: no queue calls (unchanged)', async () => {
    seed({ type: 'IN_PERSON', status: 'SCHEDULED' });

    const result = (await reassign()) as { success: boolean };

    expect(result.success).toBe(true);
    expectReassignedInDatabase();
    expect(harness.queue.removePatientFromQueue).not.toHaveBeenCalled();
    expect(harness.queue.checkIn).not.toHaveBeenCalled();
  });
});
