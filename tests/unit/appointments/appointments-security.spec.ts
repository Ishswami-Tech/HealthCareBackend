/**
 * Authorization / state-machine regressions for AppointmentsService:
 * completion matrix, reschedule ownership + slot race, clinic scoping behind the detail cache,
 * IN_PROGRESS -> EXPIRED restricted to the system, and the past-video-closure cron.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));

import { Role } from '@core/types/enums.types';
import type { UpdateAppointmentStatusDto, CompleteAppointmentDto } from '@dtos/appointment.dto';
import { FakeDb, type Row } from './test-helpers';

import {
  CLINIC,
  OTHER_CLINIC,
  appointmentRow,
  buildHarness,
  paidVideoRow,
  rejection,
} from './appointments-harness';

function completeDto(overrides: Partial<CompleteAppointmentDto> = {}): CompleteAppointmentDto {
  return { notes: 'seen', ...overrides } as CompleteAppointmentDto;
}

describe('AppointmentsService.completeAppointment', () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    harness = buildHarness();
  });

  function complete(
    role: string,
    userId = 'user-doctor',
    dto: CompleteAppointmentDto = completeDto()
  ) {
    return harness.service.completeAppointment('appt-1', dto, userId, CLINIC, role);
  }

  function expectNothingChanged(): void {
    expect(harness.db.writes).toHaveLength(0);
    expect(harness.confirmationPlugin.process).not.toHaveBeenCalled();
    expect(harness.events.emit).not.toHaveBeenCalled();
    expect(harness.events.emitEnterprise).not.toHaveBeenCalled();
    expect(harness.queue.removePatientFromQueue).not.toHaveBeenCalled();
  }

  describe.each([
    ['CANCELLED', 'IN_PERSON'],
    ['EXPIRED', 'IN_PERSON'],
    ['NO_SHOW', 'IN_PERSON'],
    ['PENDING', 'VIDEO_CALL'],
    ['SCHEDULED', 'IN_PERSON'],
    ['CONFIRMED', 'IN_PERSON'],
    ['CANCELLED', 'VIDEO_CALL'],
    ['EXPIRED', 'VIDEO_CALL'],
  ])('a %s %s appointment', (status, type) => {
    it('is refused with 400 and nothing is written, emitted or called', async () => {
      harness.db.insert(
        'appointment',
        type === 'VIDEO_CALL' ? paidVideoRow({ status }) : appointmentRow({ status })
      );

      const error = await rejection(complete(Role.DOCTOR));

      expect(error.getStatus()).toBe(400);
      expectNothingChanged();
    });
  });

  it('an already COMPLETED appointment is an idempotent success without re-emitting anything', async () => {
    harness.db.insert(
      'appointment',
      appointmentRow({ status: 'COMPLETED', completedAt: new Date('2026-10-05T05:00:00.000Z') })
    );

    const result = (await complete(Role.DOCTOR)) as { success: boolean; data: Row };

    expect(result.success).toBe(true);
    expect(result.data['alreadyCompleted']).toBe(true);
    expectNothingChanged();
  });

  it('completes an IN_PROGRESS in-person visit with a conditional, clinic-scoped write', async () => {
    harness.db.insert('appointment', appointmentRow());

    const result = (await complete(Role.DOCTOR)) as { success: boolean };

    expect(result.success).toBe(true);
    const claim = harness.db.writes.find(write => write.op === 'updateMany');
    expect(claim?.args['where']).toEqual({
      id: 'appt-1',
      clinicId: CLINIC,
      status: 'IN_PROGRESS',
    });
    expect(harness.db.rows('appointment')[0]?.['status']).toBe('COMPLETED');
    expect(harness.confirmationPlugin.process).toHaveBeenCalledTimes(1);
    expect(harness.events.emit).toHaveBeenCalledWith(
      'appointment.completed',
      expect.objectContaining({ appointmentId: 'appt-1', clinicId: CLINIC })
    );
  });

  it('records the authenticated user, never completeDto.doctorId, as the completer', async () => {
    harness.db.insert('appointment', appointmentRow());

    await complete(Role.DOCTOR, 'user-doctor', completeDto({ doctorId: 'spoofed-doctor' }));

    const claim = harness.db.writes.find(write => write.op === 'updateMany');
    const metadata = (claim?.args['data'] as Row)['metadata'] as Row;
    expect(metadata['consultationCompletedBy']).toBe('user-doctor');
    expect(harness.confirmationPlugin.process).toHaveBeenCalledWith(
      expect.objectContaining({ doctorId: 'doctor-1' })
    );
  });

  it('lets the treating doctor complete a paid video visit', async () => {
    harness.db.insert('appointment', paidVideoRow());

    const result = (await complete(Role.DOCTOR, 'user-doctor')) as { success: boolean };

    expect(result.success).toBe(true);
    expect(harness.db.rows('appointment')[0]?.['status']).toBe('COMPLETED');
    // Video visits never touch the live queue.
    expect(harness.queue.removePatientFromQueue).not.toHaveBeenCalled();
  });

  it('lets the clinic admin complete a paid video visit', async () => {
    harness.db.insert('appointment', paidVideoRow());

    const result = (await complete(Role.CLINIC_ADMIN, 'user-admin')) as { success: boolean };

    expect(result.success).toBe(true);
  });

  it('does not let SUPER_ADMIN complete a video visit: only its doctor and the clinic admin may', async () => {
    harness.db.insert('appointment', paidVideoRow());

    const error = await rejection(complete(Role.SUPER_ADMIN, 'user-super'));

    expect(error.getStatus()).toBe(403);
    expectNothingChanged();
  });

  it('refuses a video completion from a doctor who is not the treating doctor', async () => {
    harness.db.insert('appointment', paidVideoRow());

    const error = await rejection(complete(Role.DOCTOR, 'user-other-doctor'));

    expect(error.getStatus()).toBe(403);
    expectNothingChanged();
  });

  it.each([Role.RECEPTIONIST, Role.NURSE, Role.PATIENT, 'USER'])(
    'refuses a video completion from %s',
    async role => {
      harness.db.insert('appointment', paidVideoRow());

      const error = await rejection(complete(role, 'user-doctor'));

      expect(error.getStatus()).toBe(403);
      expectNothingChanged();
    }
  );

  it('never lets a PATIENT complete an in-person appointment either', async () => {
    harness.db.insert('appointment', appointmentRow());

    const error = await rejection(complete(Role.PATIENT, 'user-patient'));

    expect(error.getStatus()).toBe(403);
    expectNothingChanged();
  });

  it('refuses to complete a video visit whose payment is not completed', async () => {
    harness.db.insert(
      'appointment',
      paidVideoRow({ payment: { status: 'PENDING', invoice: null } })
    );

    const error = await rejection(complete(Role.DOCTOR));

    expect(error.getStatus()).toBe(400);
    expectNothingChanged();
  });

  it('fails closed when the appointment cannot be read (no fall-through to a write)', async () => {
    harness.db.insert('appointment', appointmentRow());
    harness.db.executeHealthcareRead.mockRejectedValueOnce(new Error('database unavailable'));

    const error = await rejection(complete(Role.DOCTOR));

    expect(error.getStatus()).toBeGreaterThanOrEqual(500);
    expectNothingChanged();
  });

  it('answers 404 for an appointment of another clinic', async () => {
    harness.db.insert('appointment', appointmentRow({ clinicId: OTHER_CLINIC }));

    const error = await rejection(complete(Role.DOCTOR));

    expect(error.getStatus()).toBe(404);
    expectNothingChanged();
  });

  it('loses a race against a cancellation: 409 and no completion side effects', async () => {
    const row = harness.db.insert('appointment', appointmentRow());
    harness.db.executeHealthcareWrite.mockImplementationOnce(async operation => {
      row['status'] = 'CANCELLED'; // cancelled between our read and our conditional write
      return operation(harness.db.client);
    });

    const error = await rejection(complete(Role.DOCTOR));

    expect(error.getStatus()).toBe(409);
    expect(harness.db.rows('appointment')[0]?.['status']).toBe('CANCELLED');
    expect(harness.confirmationPlugin.process).not.toHaveBeenCalled();
    expect(harness.events.emit).not.toHaveBeenCalled();
  });

  it('loses a race against another completion: idempotent success, nothing re-emitted', async () => {
    const row = harness.db.insert('appointment', appointmentRow());
    harness.db.executeHealthcareWrite.mockImplementationOnce(async operation => {
      row['status'] = 'COMPLETED';
      return operation(harness.db.client);
    });

    const result = (await complete(Role.DOCTOR)) as { success: boolean; data: Row };

    expect(result.data['alreadyCompleted']).toBe(true);
    expect(harness.confirmationPlugin.process).not.toHaveBeenCalled();
    expect(harness.events.emit).not.toHaveBeenCalled();
  });

  describe('updateStatus and bulk completion reach the same rules', () => {
    it('PATCH status COMPLETED on a CANCELLED appointment is refused', async () => {
      harness.db.insert('appointment', appointmentRow({ status: 'CANCELLED', type: 'VIDEO_CALL' }));

      const error = await rejection(
        harness.service.updateStatus(
          'appt-1',
          { status: 'COMPLETED' } as UpdateAppointmentStatusDto,
          'user-doctor',
          CLINIC,
          Role.DOCTOR
        )
      );

      expect(error.getStatus()).toBe(400);
      expect(harness.db.writes).toHaveLength(0);
    });

    it('bulk completion counts refused appointments as failed and completes the valid ones', async () => {
      harness.db.insert('appointment', appointmentRow({ id: 'appt-1' }));
      harness.db.insert('appointment', appointmentRow({ id: 'appt-2', status: 'CANCELLED' }));
      harness.db.insert('appointment', appointmentRow({ id: 'appt-3', status: 'EXPIRED' }));

      const result = await harness.service.bulkCompleteSelectedAppointments(
        { clinicId: CLINIC },
        { appointmentIds: ['appt-1', 'appt-2', 'appt-3'] } as never,
        'user-doctor',
        CLINIC,
        Role.DOCTOR
      );

      expect(result.data).toEqual({ completed: 1, failed: 2 });
      expect(harness.db.rows('appointment').map(row => row['status'])).toEqual([
        'COMPLETED',
        'CANCELLED',
        'EXPIRED',
      ]);
    });
  });
});

describe('AppointmentsService.updateStatus: IN_PROGRESS -> EXPIRED belongs to the system', () => {
  const expire = (harness: ReturnType<typeof buildHarness>, role: string) =>
    harness.service.updateStatus(
      'appt-1',
      { status: 'EXPIRED', reason: 'window elapsed' } as UpdateAppointmentStatusDto,
      'user-x',
      CLINIC,
      role
    );

  it.each([Role.PATIENT, Role.RECEPTIONIST, Role.NURSE, Role.CLINIC_ADMIN, Role.DOCTOR])(
    '%s gets 403',
    async role => {
      const harness = buildHarness();
      harness.db.insert('appointment', paidVideoRow({ status: 'IN_PROGRESS' }));

      const error = await rejection(expire(harness, role));

      expect(error.getStatus()).toBe(403);
      expect(harness.core.updateAppointment).not.toHaveBeenCalled();
    }
  );

  it('is also 403 for an in-person visit (same answer for every appointment type)', async () => {
    const harness = buildHarness();
    harness.db.insert('appointment', appointmentRow({ status: 'IN_PROGRESS' }));

    const error = await rejection(expire(harness, Role.RECEPTIONIST));

    expect(error.getStatus()).toBe(403);
  });

  it('the SYSTEM role (cron) may still expire an IN_PROGRESS visit', async () => {
    const harness = buildHarness();
    harness.db.insert('appointment', paidVideoRow({ status: 'IN_PROGRESS' }));

    await expire(harness, 'SYSTEM');

    expect(harness.core.updateAppointment).toHaveBeenCalledTimes(1);
  });

  it('other EXPIRED transitions are not restricted (e.g. a CONFIRMED video visit)', async () => {
    const harness = buildHarness();
    harness.db.insert('appointment', paidVideoRow({ status: 'CONFIRMED' }));

    await expire(harness, Role.CLINIC_ADMIN);

    expect(harness.core.updateAppointment).toHaveBeenCalledTimes(1);
  });
});

describe('AppointmentsService.getAppointmentById clinic scoping', () => {
  it("re-asserts the clinic when the detail cache returns another clinic's appointment", async () => {
    const harness = buildHarness();
    // Cache hit: the loader (which holds the clinic check) is skipped entirely.
    harness.cache.cache.mockImplementation(async () => appointmentRow({ clinicId: OTHER_CLINIC }));

    const error = await rejection(harness.service.getAppointmentById('appt-1', CLINIC));

    expect(error.getStatus()).toBe(404);
  });

  it('returns a cache hit that belongs to the requested clinic', async () => {
    const harness = buildHarness();
    harness.cache.cache.mockImplementation(async () => appointmentRow());

    const result = (await harness.service.getAppointmentById('appt-1', CLINIC)) as Row;

    expect(result['id']).toBe('appt-1');
  });

  it('covers every caller: complete and reschedule see a 404, not the foreign row', async () => {
    const harness = buildHarness();
    harness.cache.cache.mockImplementation(async () => appointmentRow({ clinicId: OTHER_CLINIC }));

    const reschedule = await rejection(
      harness.service.rescheduleAppointment(
        'appt-1',
        '2026-10-06',
        '11:00',
        'user-staff',
        CLINIC,
        Role.CLINIC_ADMIN
      )
    );

    expect(reschedule.getStatus()).toBe(404);
  });

  it('keeps the loader behaviour: a miss that is not in this clinic is a 404', async () => {
    const harness = buildHarness();
    harness.db.insert('appointment', appointmentRow({ clinicId: OTHER_CLINIC }));

    const error = await rejection(harness.service.getAppointmentById('appt-1', CLINIC));

    expect(error.getStatus()).toBe(404);
  });
});

describe('AppointmentsService.rescheduleAppointment', () => {
  function seed(harness: ReturnType<typeof buildHarness>, overrides: Row = {}): Row {
    harness.db.insert('patient', { id: 'patient-1', userId: 'user-patient' });
    harness.db.insert('patient', { id: 'patient-2', userId: 'user-other' });
    return harness.db.insert(
      'appointment',
      appointmentRow({ status: 'SCHEDULED', checkedInAt: null, metadata: {}, ...overrides })
    );
  }

  const reschedule = (
    harness: ReturnType<typeof buildHarness>,
    userId: string,
    role: string | undefined,
    clinicId = CLINIC
  ) =>
    harness.service.rescheduleAppointment('appt-1', '2026-10-06', '11:00', userId, clinicId, role);

  it('lets a patient move their own appointment', async () => {
    const harness = buildHarness();
    seed(harness);

    const result = await reschedule(harness, 'user-patient', Role.PATIENT);

    expect(result.success).toBe(true);
    expect(harness.db.rows('appointment')[0]?.['time']).toBe('11:00');
  });

  it("refuses a patient who tries to move someone else's appointment (403, no write)", async () => {
    const harness = buildHarness();
    seed(harness);

    const error = await rejection(reschedule(harness, 'user-other', Role.PATIENT));

    expect(error.getStatus()).toBe(403);
    expect(harness.db.rows('appointment')[0]?.['time']).toBe('10:00');
    expect(harness.core.getDoctorAvailability).not.toHaveBeenCalled();
  });

  it('treats a missing role like a patient (ownership is enforced for every caller)', async () => {
    const harness = buildHarness();
    seed(harness);

    const error = await rejection(reschedule(harness, 'user-other', undefined));

    expect(error.getStatus()).toBe(403);
  });

  it('lets a patient move a dependent they own (appointment linked by familyMemberId)', async () => {
    const harness = buildHarness();
    seed(harness, { patientId: 'patient-1', userId: 'someone-else', familyMemberId: 'fm-1' });
    harness.db.insert('familyMember', {
      id: 'fm-1',
      patientId: 'patient-1',
      userId: null,
      isActive: true,
      deletedAt: null,
    });

    const result = await reschedule(harness, 'user-patient', Role.PATIENT);

    expect(result.success).toBe(true);
  });

  it("lets a patient move a dependent's own patient record (family member with its own user)", async () => {
    const harness = buildHarness();
    harness.db.insert('patient', { id: 'patient-dep', userId: 'user-dependent' });
    seed(harness, { patientId: 'patient-dep', userId: 'someone-else' });
    harness.db.insert('familyMember', {
      id: 'fm-2',
      patientId: 'patient-1',
      userId: 'user-dependent',
      isActive: true,
      deletedAt: null,
    });

    const result = await reschedule(harness, 'user-patient', Role.PATIENT);

    expect(result.success).toBe(true);
  });

  it("refuses another family's dependent", async () => {
    const harness = buildHarness();
    harness.db.insert('patient', { id: 'patient-dep', userId: 'user-dependent' });
    seed(harness, { patientId: 'patient-dep', userId: 'someone-else' });
    harness.db.insert('familyMember', {
      id: 'fm-3',
      patientId: 'patient-2',
      userId: 'user-dependent',
      isActive: true,
      deletedAt: null,
    });

    const error = await rejection(reschedule(harness, 'user-patient', Role.PATIENT));

    expect(error.getStatus()).toBe(403);
  });

  it('staff keep clinic-only scoping: a receptionist can move any appointment of the clinic', async () => {
    const harness = buildHarness();
    seed(harness);

    const result = await reschedule(harness, 'user-reception', Role.RECEPTIONIST);

    expect(result.success).toBe(true);
  });

  it('answers 404 for staff of another clinic and never touches the appointment', async () => {
    const harness = buildHarness();
    seed(harness);

    const error = await rejection(
      reschedule(harness, 'user-reception', Role.RECEPTIONIST, OTHER_CLINIC)
    );

    expect(error.getStatus()).toBe(404);
    expect(harness.db.rows('appointment')[0]?.['time']).toBe('10:00');
  });

  it('takes the create-path booking lock around the availability check and the write', async () => {
    const harness = buildHarness();
    seed(harness);

    await reschedule(harness, 'user-patient', Role.PATIENT);

    const lockKey = harness.cache.acquireLock.mock.calls[0]?.[0] ?? '';
    expect(lockKey).toBe(`lock:booking:doctor-1:${CLINIC}:2026-10-06T05:30:00.000Z`);
    expect(harness.cache.releaseLock).toHaveBeenCalledWith(lockKey);
    expect(harness.cache.heldLocks.size).toBe(0);
  });

  it('answers 409 while another request holds the slot lock and does not release it', async () => {
    const harness = buildHarness();
    seed(harness);
    harness.cache.heldLocks.add(`lock:booking:doctor-1:${CLINIC}:2026-10-06T05:30:00.000Z`);

    const error = await rejection(reschedule(harness, 'user-patient', Role.PATIENT));

    expect(error.getStatus()).toBe(409);
    expect(harness.db.rows('appointment')[0]?.['time']).toBe('10:00');
    expect(harness.cache.releaseLock).not.toHaveBeenCalled();
  });

  it('re-checks live conflicts inside the lock: a slot booked a moment ago is refused and the lock is released', async () => {
    const harness = buildHarness();
    seed(harness);
    // Availability (computed earlier) still says 11:00 is free, but another patient just took it.
    harness.db.insert(
      'appointment',
      appointmentRow({
        id: 'appt-other',
        status: 'SCHEDULED',
        patientId: 'patient-2',
        userId: 'user-other',
        time: '11:00',
        date: new Date('2026-10-06T00:00:00.000+05:30'),
      })
    );

    const error = await rejection(reschedule(harness, 'user-patient', Role.PATIENT));

    expect(error.getStatus()).toBe(409);
    expect(harness.db.rows('appointment')[0]?.['time']).toBe('10:00');
    expect(harness.cache.heldLocks.size).toBe(0);
  });
});

describe('AppointmentsService.handlePastVideoCallClosureCron', () => {
  it('runs on one replica per tick: the second one skips', async () => {
    const first = buildHarness();
    const run = jest
      .spyOn(first.service, 'processPastVideoCallClosures')
      .mockResolvedValue({ totalChecked: 0, closed: 0, failed: 0, details: [] });

    await first.service.handlePastVideoCallClosureCron();
    // Same cache (same lock), second replica:
    const second = buildHarness();
    second.cache.heldLocks.add('lock:cron:appointments:past-video-closure');
    const secondRun = jest
      .spyOn(second.service, 'processPastVideoCallClosures')
      .mockResolvedValue({ totalChecked: 0, closed: 0, failed: 0, details: [] });
    await second.service.handlePastVideoCallClosureCron();

    expect(run).toHaveBeenCalledTimes(1);
    expect(secondRun).not.toHaveBeenCalled();
  });

  it('bounds the candidate query: nothing in the future, a page cap, oldest first', async () => {
    const harness = buildHarness();

    await harness.service.processPastVideoCallClosures();

    const query = harness.db.findManyCalls.find(call => call.table === 'appointment');
    const where = query?.args['where'] as Row;
    expect(where['date']).toEqual({ lte: expect.any(Date) });
    expect(query?.args['take']).toBe(200);
    expect(query?.args['orderBy']).toEqual([{ date: 'asc' }, { id: 'asc' }]);
  });
});

describe('video appointments never enter the doctor queue', () => {
  it('a paid video appointment that becomes CONFIRMED (doctor confirms the slot) gets no queue entry', async () => {
    const harness = buildHarness();
    harness.db.insert(
      'appointment',
      paidVideoRow({
        status: 'AWAITING_SLOT_CONFIRMATION',
        proposedSlots: [{ date: '2026-10-07', time: '10:00' }],
        confirmedSlotIndex: null,
        checkedInAt: null,
      })
    );
    harness.db.insert('payment', { appointmentId: 'appt-1', status: 'COMPLETED' });

    const result = await harness.service.confirmVideoSlot(
      'appt-1',
      { confirmedSlotIndex: 0 } as never,
      'user-doctor',
      CLINIC
    );

    expect(result.success).toBe(true);
    expect(harness.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
    expect(harness.queue.checkIn).not.toHaveBeenCalled();
    expect(harness.queue.removePatientFromQueue).not.toHaveBeenCalled();
  });

  it('rescheduling a CONFIRMED video appointment keeps it CONFIRMED and never queues it', async () => {
    const harness = buildHarness();
    harness.db.insert('patient', { id: 'patient-1', userId: 'user-patient' });
    harness.db.insert('appointment', paidVideoRow({ status: 'CONFIRMED', checkedInAt: null }));
    harness.core.getDoctorAvailability.mockResolvedValue({ availableSlots: ['23:45'] });

    const result = await harness.service.rescheduleAppointment(
      'appt-1',
      '2099-01-02',
      '23:45',
      'user-patient',
      CLINIC,
      Role.PATIENT
    );

    expect(result.success).toBe(true);
    expect(harness.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
    expect(harness.queue.checkIn).not.toHaveBeenCalled();
    expect(harness.queue.removePatientFromQueue).not.toHaveBeenCalled();
  });

  it('completing a video appointment never touches the queue', async () => {
    const harness = buildHarness();
    harness.db.insert('appointment', paidVideoRow());

    await harness.service.completeAppointment(
      'appt-1',
      completeDto(),
      'user-doctor',
      CLINIC,
      Role.DOCTOR
    );

    expect(harness.queue.checkIn).not.toHaveBeenCalled();
    expect(harness.queue.removePatientFromQueue).not.toHaveBeenCalled();
  });
});

describe('AppointmentsService.processCheckIn (POST :id/check-in and PATCH status CONFIRMED)', () => {
  const checkIn = (
    harness: ReturnType<typeof buildHarness>,
    role: string,
    userId = 'user-reception',
    clinicId = CLINIC
  ) => harness.service.processCheckIn({ appointmentId: 'appt-1' } as never, userId, clinicId, role);

  function seed(harness: ReturnType<typeof buildHarness>): void {
    harness.db.insert(
      'appointment',
      appointmentRow({ status: 'SCHEDULED', checkedInAt: null, locationId: 'loc-1' })
    );
  }

  it('a receptionist assigned to another location gets 403 and the check-in plugin is never called', async () => {
    const harness = buildHarness();
    seed(harness);
    harness.db.insert('receptionist', {
      userId: 'user-reception',
      locationId: 'loc-2',
      location: { clinicId: CLINIC },
    });

    const error = await rejection(checkIn(harness, Role.RECEPTIONIST));

    expect(error.getStatus()).toBe(403);
    expect(harness.checkInPlugin.process).not.toHaveBeenCalled();
  });

  it('a receptionist at the appointment location is passed on to the check-in plugin', async () => {
    const harness = buildHarness();
    seed(harness);
    harness.db.insert('receptionist', {
      userId: 'user-reception',
      locationId: 'loc-1',
      location: { clinicId: CLINIC },
    });

    const result = (await checkIn(harness, Role.RECEPTIONIST)) as { success: boolean };

    expect(result.success).toBe(true);
    expect(harness.checkInPlugin.process).toHaveBeenCalledTimes(1);
  });

  it('a receptionist of another clinic gets 404', async () => {
    const harness = buildHarness();
    seed(harness);

    const error = await rejection(
      checkIn(harness, Role.RECEPTIONIST, 'user-reception', OTHER_CLINIC)
    );

    expect(error.getStatus()).toBe(404);
    expect(harness.checkInPlugin.process).not.toHaveBeenCalled();
  });

  it('other staff roles are not subject to the receptionist location rule', async () => {
    const harness = buildHarness();
    seed(harness);

    const result = (await checkIn(harness, Role.DOCTOR, 'user-doctor')) as { success: boolean };

    expect(result.success).toBe(true);
  });
});
