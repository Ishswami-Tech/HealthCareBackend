/**
 * Reschedule decided on fresh data under two locks (finding 11) and the doctor slot rule: one
 * doctor may hold a video visit and an in-clinic visit in the same slot, never two of a kind.
 * Runs the real service and the real core on an in-memory database.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ConflictException } from '@nestjs/common';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));

import { Role } from '@core/types/enums.types';
import type { CreateAppointmentDto } from '@dtos/appointment.dto';
import type { Row } from './test-helpers';
import {
  CLINIC,
  OTHER_CLINIC,
  appointmentRow,
  paidVideoRow,
  rejection,
} from './appointments-harness';
import { buildRealCoreHarness, type RealCoreHarness } from './appointments-real-core-harness';

const NEW_DATE = '2099-01-06';
const DAY = new Date(`${NEW_DATE}T00:00:00.000+05:30`);
const VIDEO_MESSAGE = 'This doctor already has a video visit in that slot';
const IN_CLINIC_MESSAGE = 'This doctor already has an in-clinic visit in that slot';
const BOOKING_LOCK = (time: string) =>
  `lock:booking:doctor-1:${CLINIC}:${new Date(`${NEW_DATE}T${time}:00+05:30`).toISOString()}`;
const APPOINTMENT_LOCK = `lock:reschedule:${CLINIC}:appt-1`;

function stored(harness: RealCoreHarness, id = 'appt-1'): Row {
  const row = harness.db.rows('appointment').find(candidate => candidate['id'] === id);
  if (!row) {
    throw new Error(`no appointment ${id}`);
  }
  return row;
}

function appointmentUpdates(harness: RealCoreHarness) {
  return harness.db.writes.filter(write => write.table === 'appointment');
}

/** Another appointment of the same doctor on the target day. */
function otherAppointment(overrides: Row): Row {
  return appointmentRow({
    id: 'appt-2',
    status: 'CONFIRMED',
    type: 'IN_PERSON',
    date: DAY,
    time: '11:00',
    duration: 30,
    userId: 'user-other',
    patientId: 'patient-2',
    ...overrides,
  });
}

describe('AppointmentsService.rescheduleAppointment under locks (finding 11)', () => {
  let harness: RealCoreHarness;

  beforeEach(() => {
    harness = buildRealCoreHarness();
    harness.db.insert('patient', { id: 'patient-1', userId: 'user-patient' });
    jest
      .spyOn(harness.realCore, 'getDoctorAvailability')
      .mockResolvedValue({ availableSlots: ['11:00', '11:30', '12:00'] });
  });

  const seed = (overrides: Row = {}): Row =>
    harness.db.insert(
      'appointment',
      appointmentRow({
        status: 'SCHEDULED',
        checkedInAt: null,
        metadata: {},
        date: new Date('2099-01-05T00:00:00.000+05:30'),
        ...overrides,
      })
    );

  const reschedule = (time = '11:00', role = Role.PATIENT, userId = 'user-patient') =>
    harness.service.rescheduleAppointment('appt-1', NEW_DATE, time, userId, CLINIC, role);

  describe('decides on the fresh row, not on the 30-minute cached detail', () => {
    it('moves an in-person visit that checked in after the cached copy: back to SCHEDULED, out of the queue', async () => {
      seed({ status: 'CONFIRMED', checkedInAt: new Date('2099-01-05T04:30:00.000Z') });
      harness.cache.cache.mockImplementation(async () =>
        appointmentRow({ status: 'SCHEDULED', checkedInAt: null, metadata: {} })
      );

      const result = await reschedule();

      expect(result.success).toBe(true);
      expect(stored(harness)['time']).toBe('11:00');
      expect(stored(harness)['status']).toBe('SCHEDULED');
      expect(stored(harness)['checkedInAt']).toBeNull();
      expect(harness.queue.removePatientFromQueue).toHaveBeenCalledTimes(1);
      expect(harness.cache.heldLocks.size).toBe(0);
    });

    it('refuses a visit whose consultation started after the cached copy was taken (400, nothing written)', async () => {
      seed({ status: 'IN_PROGRESS' });
      harness.cache.cache.mockImplementation(async () =>
        appointmentRow({ status: 'SCHEDULED', checkedInAt: null, metadata: {} })
      );

      const error = await rejection(reschedule());

      expect(error.getStatus()).toBe(400);
      expect(error.message).toContain('in progress');
      expect(appointmentUpdates(harness)).toHaveLength(0);
      expect(stored(harness)['time']).toBe('10:00');
    });

    it('refuses a visit that already used its reschedules, whatever the cached count says', async () => {
      seed({ metadata: { rescheduleCount: 2 } });
      harness.cache.cache.mockImplementation(async () =>
        appointmentRow({ status: 'SCHEDULED', checkedInAt: null, metadata: { rescheduleCount: 0 } })
      );

      const error = await rejection(reschedule());

      expect(error.getStatus()).toBe(400);
      expect(error.message).toContain('Maximum reschedule limit');
      expect(appointmentUpdates(harness)).toHaveLength(0);
    });

    it('refuses a visit that was cancelled after the cached copy was taken', async () => {
      seed({ status: 'CANCELLED' });
      harness.cache.cache.mockImplementation(async () =>
        appointmentRow({ status: 'CONFIRMED', checkedInAt: null, metadata: {} })
      );

      const error = await rejection(reschedule());

      expect(error.getStatus()).toBe(400);
      expect(error.message).toContain('already cancelled');
    });

    it('refuses when the visit was handed to another doctor since: the slot lock was for the wrong one', async () => {
      seed({ doctorId: 'doctor-2' });
      harness.cache.cache.mockImplementation(async () =>
        appointmentRow({
          status: 'SCHEDULED',
          checkedInAt: null,
          metadata: {},
          doctorId: 'doctor-1',
        })
      );

      const error = await rejection(reschedule());

      expect(error.getStatus()).toBe(409);
      expect(appointmentUpdates(harness)).toHaveLength(0);
      expect(harness.cache.heldLocks.size).toBe(0);
    });
  });

  describe('the write is conditional', () => {
    function changeRowBeforeTheWrite(changes: Row): void {
      const original = harness.db.executeHealthcareWrite.getMockImplementation();
      harness.db.executeHealthcareWrite.mockImplementationOnce(async (operation, audit) => {
        Object.assign(stored(harness), changes);
        return original ? original(operation, audit) : operation(harness.db.client);
      });
    }

    it('writes only while the row is reschedulable and in this clinic', async () => {
      seed();

      const result = await reschedule();

      expect(result.success).toBe(true);
      const [write] = appointmentUpdates(harness);
      expect(write?.op).toBe('updateMany');
      expect(write?.args['where']).toEqual({
        id: 'appt-1',
        clinicId: CLINIC,
        // pinned to what was read, so a check-in or confirmation in between is a 409
        status: 'SCHEDULED',
        checkedInAt: null,
      });
      expect(stored(harness)['time']).toBe('11:00');
      expect(stored(harness)['status']).toBe('SCHEDULED');
      expect((stored(harness)['metadata'] as Row)['rescheduleCount']).toBe(1);
    });

    it('never leaves a SCHEDULED visit with an arrival time: checkedInAt is cleared in the same write', async () => {
      seed();

      await reschedule();

      const data = appointmentUpdates(harness)[0]?.args['data'] as Row;
      expect(data['checkedInAt']).toBeNull();
      expect(stored(harness)['status']).toBe('SCHEDULED');
      expect(stored(harness)['checkedInAt']).toBeNull();
    });

    it('a video visit is only moved while CONFIRMED and stays CONFIRMED', async () => {
      harness.db.insert(
        'appointment',
        paidVideoRow({
          status: 'CONFIRMED',
          checkedInAt: null,
          metadata: {},
          date: new Date('2099-01-05T00:00:00.000+05:30'),
        })
      );

      const result = await reschedule();

      expect(result.success).toBe(true);
      expect(appointmentUpdates(harness)[0]?.args['where']).toEqual({
        id: 'appt-1',
        clinicId: CLINIC,
        status: { in: ['CONFIRMED'] },
      });
      expect(stored(harness)['status']).toBe('CONFIRMED');
    });

    it('a consultation that starts between the fresh read and the write is not overwritten: 409', async () => {
      seed();
      changeRowBeforeTheWrite({ status: 'IN_PROGRESS' });

      const error = await rejection(reschedule());

      expect(error.getStatus()).toBe(409);
      expect(stored(harness)['time']).toBe('10:00');
      expect(stored(harness)['status']).toBe('IN_PROGRESS');
      expect(harness.cache.heldLocks.size).toBe(0);
    });

    it('a check-in that commits between the read and the write is not overwritten: 409', async () => {
      seed();
      changeRowBeforeTheWrite({
        status: 'CONFIRMED',
        checkedInAt: new Date('2099-01-05T04:30:00.000Z'),
      });

      const error = await rejection(reschedule());

      expect(error.getStatus()).toBe(409);
      expect(stored(harness)['time']).toBe('10:00');
      expect(stored(harness)['status']).toBe('CONFIRMED');
    });

    it('a payment confirmation between the read and the write is not written back as PENDING: 409', async () => {
      harness.db.insert(
        'appointment',
        appointmentRow({ status: 'PENDING', checkedInAt: null, metadata: {} })
      );
      changeRowBeforeTheWrite({ status: 'CONFIRMED' });

      const error = await rejection(reschedule());

      expect(error.getStatus()).toBe(409);
      expect(stored(harness)['status']).toBe('CONFIRMED');
    });

    it('a cancellation that commits between the read and the write is not overwritten: 409', async () => {
      seed();
      changeRowBeforeTheWrite({ status: 'CANCELLED' });

      const error = await rejection(reschedule());

      expect(error.getStatus()).toBe(409);
      expect(stored(harness)['status']).toBe('CANCELLED');
      expect(stored(harness)['time']).toBe('10:00');
    });
  });

  describe('the locks', () => {
    it('takes the slot lock first, then a lock keyed on the appointment id, and releases both', async () => {
      seed();

      await reschedule();

      const acquired = harness.cache.acquireLock.mock.calls.map(call => call[0]);
      expect(acquired).toEqual([BOOKING_LOCK('11:00'), APPOINTMENT_LOCK]);
      expect(harness.cache.releaseLock).toHaveBeenCalledWith(APPOINTMENT_LOCK);
      expect(harness.cache.releaseLock).toHaveBeenCalledWith(BOOKING_LOCK('11:00'));
      expect(harness.cache.heldLocks.size).toBe(0);
    });

    it('answers 409 while another reschedule of this appointment holds its lock, and frees the slot lock', async () => {
      seed();
      harness.cache.heldLocks.add(APPOINTMENT_LOCK);

      const error = await rejection(reschedule());

      expect(error.getStatus()).toBe(409);
      expect(harness.cache.heldLocks.has(BOOKING_LOCK('11:00'))).toBe(false);
      expect(harness.cache.heldLocks.has(APPOINTMENT_LOCK)).toBe(true);
      expect(appointmentUpdates(harness)).toHaveLength(0);
    });

    it('two concurrent reschedules to different slots cannot both pass the reschedule limit', async () => {
      seed({ metadata: { rescheduleCount: 1 } });

      const results = await Promise.allSettled([reschedule('11:00'), reschedule('11:30')]);

      const fulfilled = results.filter(result => result.status === 'fulfilled');
      const rejected = results.filter(result => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(appointmentUpdates(harness)).toHaveLength(1);
      expect((stored(harness)['metadata'] as Row)['rescheduleCount']).toBe(2);
      expect(['11:00', '11:30']).toContain(stored(harness)['time']);
      expect(harness.cache.heldLocks.size).toBe(0);
    });

    it('a second reschedule after the first sees the new count on the fresh row: limit reached', async () => {
      seed({ metadata: { rescheduleCount: 1 } });

      await reschedule('11:00');
      const error = await rejection(reschedule('11:30'));

      expect(error.getStatus()).toBe(400);
      expect(error.message).toContain('Maximum reschedule limit');
      expect(stored(harness)['time']).toBe('11:00');
    });
  });

  describe('the doctor slot rule on reschedule', () => {
    it('moves an in-clinic visit onto a slot held by a video visit', async () => {
      seed();
      harness.db.insert('appointment', otherAppointment({ type: 'VIDEO_CALL', duration: 15 }));

      const result = await reschedule();

      expect(result.success).toBe(true);
      expect(stored(harness)['time']).toBe('11:00');
    });

    it('moves a video visit onto a slot held by an in-clinic visit', async () => {
      harness.db.insert(
        'appointment',
        paidVideoRow({
          status: 'CONFIRMED',
          checkedInAt: null,
          metadata: {},
          date: new Date('2099-01-05T00:00:00.000+05:30'),
        })
      );
      harness.db.insert('appointment', otherAppointment({ type: 'IN_PERSON' }));

      const result = await reschedule();

      expect(result.success).toBe(true);
      expect(stored(harness)['time']).toBe('11:00');
    });

    it('refuses two video visits in one slot: 409, clear message', async () => {
      harness.db.insert(
        'appointment',
        paidVideoRow({
          status: 'CONFIRMED',
          checkedInAt: null,
          metadata: {},
          date: new Date('2099-01-05T00:00:00.000+05:30'),
        })
      );
      harness.db.insert('appointment', otherAppointment({ type: 'VIDEO_CALL', duration: 15 }));

      const error = await rejection(reschedule());

      expect(error.getStatus()).toBe(409);
      expect(error.message).toBe(VIDEO_MESSAGE);
      expect(stored(harness)['time']).toBe('10:00');
      expect(harness.cache.heldLocks.size).toBe(0);
    });

    it('refuses two in-clinic visits in one slot: 409, clear message', async () => {
      seed();
      harness.db.insert('appointment', otherAppointment({ type: 'IN_PERSON' }));

      const error = await rejection(reschedule());

      expect(error.getStatus()).toBe(409);
      expect(error.message).toBe(IN_CLINIC_MESSAGE);
      expect(stored(harness)['time']).toBe('10:00');
    });

    it.each(['CANCELLED', 'EXPIRED', 'NO_SHOW', 'COMPLETED'])(
      'ignores a %s appointment: it no longer holds the slot',
      async status => {
        seed();
        harness.db.insert('appointment', otherAppointment({ type: 'IN_PERSON', status }));

        const result = await reschedule();

        expect(result.success).toBe(true);
      }
    );

    it('only counts the same doctor in the same clinic', async () => {
      seed();
      harness.db.insert('appointment', otherAppointment({ doctorId: 'doctor-9' }));
      harness.db.insert('appointment', otherAppointment({ id: 'appt-3', clinicId: OTHER_CLINIC }));

      const result = await reschedule();

      expect(result.success).toBe(true);
    });

    it('excludes the appointment being moved: it never conflicts with itself', async () => {
      // Moving within its own old window: the row at 11:00 (30 minutes) is the appointment itself.
      seed({ time: '11:00', date: DAY, duration: 30 });

      const result = await reschedule('11:30');

      expect(result.success).toBe(true);
      expect(stored(harness)['time']).toBe('11:30');
    });
  });
});

describe('CoreAppointmentService.createAppointment: the doctor slot rule at booking', () => {
  let harness: RealCoreHarness;

  beforeEach(() => {
    harness = buildRealCoreHarness();
    harness.db.insert('patient', { id: 'patient-1', userId: 'user-patient' });
    harness.db.insert('clinicLocation', { id: 'loc-1', locationId: 'loc-1' });
  });

  function bookingDto(type: 'VIDEO_CALL' | 'IN_PERSON', time = '10:00'): CreateAppointmentDto {
    return {
      patientId: 'patient-1',
      doctorId: 'doctor-1',
      appointmentDate: `${NEW_DATE}T${time}:00+05:30`,
      duration: type === 'VIDEO_CALL' ? 15 : 3,
      type,
      ...(type === 'IN_PERSON' ? { locationId: 'loc-1' } : {}),
    } as unknown as CreateAppointmentDto;
  }

  const book = (dto: CreateAppointmentDto, clinicId = CLINIC) =>
    harness.realCore.createAppointment(dto, {
      userId: 'user-patient',
      role: Role.PATIENT,
      clinicId,
    });

  const existing = (overrides: Row): Row =>
    harness.db.insert('appointment', otherAppointment({ time: '10:00', ...overrides }));

  it('books a video visit in a slot held by an in-clinic visit', async () => {
    existing({ type: 'IN_PERSON' });

    const result = await book(bookingDto('VIDEO_CALL'));

    expect(result.success).toBe(true);
    expect(harness.db.createAppointmentSafe).toHaveBeenCalledTimes(1);
  });

  it('books an in-clinic visit in a slot held by a video visit', async () => {
    existing({ type: 'VIDEO_CALL', duration: 15 });

    const result = await book(bookingDto('IN_PERSON'));

    expect(result.success).toBe(true);
  });

  it('refuses a second video visit in the slot: 409 with a clear message, no row, lock released', async () => {
    existing({ type: 'VIDEO_CALL', duration: 15 });

    const error = await rejection(book(bookingDto('VIDEO_CALL')));

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getStatus()).toBe(409);
    expect(error.message).toBe(VIDEO_MESSAGE);
    expect(harness.db.createAppointmentSafe).not.toHaveBeenCalled();
    expect(harness.cache.heldLocks.size).toBe(0);
  });

  it('refuses a second in-clinic visit in the slot: 409 with a clear message', async () => {
    existing({ type: 'IN_PERSON' });

    const error = await rejection(book(bookingDto('IN_PERSON')));

    expect(error.getStatus()).toBe(409);
    expect(error.message).toBe(IN_CLINIC_MESSAGE);
    expect(harness.db.createAppointmentSafe).not.toHaveBeenCalled();
  });

  it('is the check that decides: the old scheduling-conflict service is never consulted', async () => {
    const conflictService = { resolveSchedulingConflict: jest.fn() };
    Object.assign(harness.realCore, { conflictResolutionService: conflictService });
    existing({ type: 'IN_PERSON' });

    await rejection(book(bookingDto('IN_PERSON')));

    expect(conflictService.resolveSchedulingConflict).not.toHaveBeenCalled();
  });

  it('an overlapping (not identical) in-clinic slot conflicts too', async () => {
    existing({ type: 'IN_PERSON', time: '10:00', duration: 30 });

    const error = await rejection(book(bookingDto('IN_PERSON', '10:27')));

    expect(error.getStatus()).toBe(409);
  });

  it.each(['CANCELLED', 'EXPIRED', 'NO_SHOW', 'COMPLETED'])(
    'a %s appointment no longer holds the slot',
    async status => {
      existing({ type: 'IN_PERSON', status });

      const result = await book(bookingDto('IN_PERSON'));

      expect(result.success).toBe(true);
    }
  );

  it("is per doctor and per clinic: another doctor's or another clinic's visit does not hold it", async () => {
    existing({ type: 'IN_PERSON', doctorId: 'doctor-9' });
    existing({ id: 'appt-3', type: 'IN_PERSON', clinicId: OTHER_CLINIC });

    const result = await book(bookingDto('IN_PERSON'));

    expect(result.success).toBe(true);
  });

  it('runs inside the per-slot booking lock', async () => {
    existing({ type: 'IN_PERSON' });

    await rejection(book(bookingDto('IN_PERSON')));

    expect(harness.cache.acquireLock).toHaveBeenCalledWith(
      `lock:booking:doctor-1:${CLINIC}:${new Date(`${NEW_DATE}T10:00:00+05:30`).toISOString()}`,
      15
    );
  });

  it("a patient's own retry still returns their existing appointment (idempotent), not a 409", async () => {
    existing({
      id: 'appt-own',
      type: 'VIDEO_CALL',
      duration: 15,
      patientId: 'patient-1',
      locationId: null,
      status: 'PENDING',
      createdAt: new Date(),
    });

    const result = await book(bookingDto('VIDEO_CALL'));

    expect(result.success).toBe(true);
    expect((result.data as Row)['id']).toBe('appt-own');
    expect(harness.db.createAppointmentSafe).not.toHaveBeenCalled();
  });

  it('a held booking lock is still the old unsuccessful result', async () => {
    harness.cache.heldLocks.add(
      `lock:booking:doctor-1:${CLINIC}:${new Date(`${NEW_DATE}T10:00:00+05:30`).toISOString()}`
    );

    const result = await book(bookingDto('IN_PERSON'));

    expect(result.success).toBe(false);
    expect(result.error).toBe('SCHEDULING_CONFLICT');
  });
});

describe('CoreAppointmentService.getDoctorAvailability: the grid follows the same rule', () => {
  let harness: RealCoreHarness;

  beforeEach(() => {
    harness = buildRealCoreHarness();
  });

  const availability = async (appointmentType: string): Promise<string[]> => {
    const result = (await harness.realCore.getDoctorAvailability('doctor-1', NEW_DATE, {
      userId: 'user-x',
      role: 'USER',
      clinicId: CLINIC,
      appointmentType,
    })) as { availableSlots: string[] };
    return result.availableSlots;
  };

  it('an in-clinic visit does not block the video grid, and blocks the in-clinic grid', async () => {
    harness.db.insert('appointment', otherAppointment({ type: 'IN_PERSON', time: '11:00' }));

    const video = await availability('VIDEO_CALL');
    const inClinic = await availability('IN_PERSON');

    expect(video).toContain('11:00');
    expect(video).toContain('11:15');
    expect(inClinic).not.toContain('11:00');
    expect(inClinic).not.toContain('11:27');
    expect(inClinic).toContain('11:30');
  });

  it('a video visit does not block the in-clinic grid, and blocks the video grid', async () => {
    harness.db.insert(
      'appointment',
      otherAppointment({ type: 'VIDEO_CALL', time: '11:00', duration: 15 })
    );

    const video = await availability('VIDEO_CALL');
    const inClinic = await availability('IN_PERSON');

    expect(video).not.toContain('11:00');
    expect(video).toContain('11:15');
    expect(inClinic).toContain('11:00');
  });

  it('a cancelled visit frees its slot in both grids', async () => {
    harness.db.insert('appointment', otherAppointment({ type: 'IN_PERSON', status: 'CANCELLED' }));

    expect(await availability('IN_PERSON')).toContain('11:00');
  });
});
