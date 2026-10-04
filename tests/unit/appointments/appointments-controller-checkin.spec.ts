/**
 * Check-in entry points of AppointmentsController, wired to the real AppointmentsService and the
 * real CheckInLocationService on an in-memory database:
 *   - POST :id/force-check-in  (patient presence rule, ownership, receptionist location)
 *   - POST check-in/scan-qr    (patient QR / manual code, staff path, video guard, error mapping)
 * Everything the product flow needs must come out identical: appointment SCHEDULED -> CONFIRMED,
 * a CheckIn row, and an entry in the appointment's doctor queue.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));
jest.mock('@services/video/video.service', () => ({ VideoService: class VideoService {} }));

import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { AppointmentsController } from '@services/appointments/appointments.controller';
import {
  CheckInLocationService,
  OUTSIDE_CLINIC_RADIUS_CODE,
  OUTSIDE_CLINIC_RADIUS_MESSAGE,
  VIDEO_CHECK_IN_REJECTION_MESSAGE,
} from '@services/appointments/plugins/therapy/check-in-location.service';
import { formatDateKeyInIST } from '@utils/date-time.util';
import type { ForceCheckInDto, ScanLocationQRDto } from '@dtos/appointment.dto';
import { CLINIC, OTHER_CLINIC, buildHarness, rejection, type Row } from './appointments-harness';
import { createCacheStub } from './test-helpers';

const CLINIC_LAT = 19.076;
const CLINIC_LNG = 72.8777;
const METERS_PER_DEGREE_LAT = 111_194.9;

function northOfClinic(meters: number): { lat: number; lng: number } {
  return { lat: CLINIC_LAT + meters / METERS_PER_DEGREE_LAT, lng: CLINIC_LNG };
}

/** "Now" in the appointment grid: today's IST date and the current IST wall-clock minute. */
function nowSlot(): { date: Date; time: string } {
  const now = new Date();
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  return { date: new Date(`${formatDateKeyInIST(now)}T00:00:00.000Z`), time };
}

function inPersonAppointment(overrides: Row = {}): Row {
  const slot = nowSlot();
  return {
    id: 'appt-1',
    clinicId: CLINIC,
    patientId: 'patient-1',
    userId: 'user-patient',
    doctorId: 'doctor-1',
    type: 'IN_PERSON',
    status: 'SCHEDULED',
    locationId: 'loc-1',
    date: slot.date,
    time: slot.time,
    checkedInAt: null,
    subscriptionId: 'sub-1',
    isSubscriptionBased: true,
    doctor: { id: 'doctor-1', user: { name: 'Dr Rao' } },
    ...overrides,
  };
}

function videoAppointment(overrides: Row = {}): Row {
  return inPersonAppointment({
    id: 'appt-video',
    type: 'VIDEO_CALL',
    status: 'CONFIRMED',
    subscriptionId: null,
    isSubscriptionBased: false,
    ...overrides,
  });
}

function world() {
  const h = buildHarness();
  const queuedAppointments = new Set<string>();
  const queue = {
    checkIn: jest.fn(async (entry: { appointmentId: string }, _domain: string) => {
      if (queuedAppointments.has(entry.appointmentId)) {
        throw new Error('Appointment arrival is already confirmed');
      }
      queuedAppointments.add(entry.appointmentId);
      return { success: true };
    }),
    getPatientQueuePosition: jest.fn(async (..._args: unknown[]) => ({
      position: 1,
      totalInQueue: 1,
      estimatedWaitTime: 5,
    })),
  };
  const cache = createCacheStub();
  const clinicLocation = { id: 'loc-1', clinicId: CLINIC };
  const checkInLocationService = new CheckInLocationService(
    h.db as never,
    cache as never,
    h.logging as never,
    queue as never,
    {
      getLocation: jest.fn(async (..._args: unknown[]) => clinicLocation),
      invalidateLocation: jest.fn(async (..._args: unknown[]) => undefined),
    } as never,
    { getClinicLocationById: jest.fn(async (..._args: unknown[]) => clinicLocation) } as never
  );

  const events = { emit: jest.fn(async (..._args: unknown[]) => undefined) };
  const locationQr = { verifyLocationQR: jest.fn((..._args: unknown[]) => true) };
  const noop = {} as never;
  const controller = new AppointmentsController(
    h.service as never,
    h.errors as never,
    h.logging as never,
    cache as never,
    noop, // videoService
    noop, // checkInService
    queue as never,
    checkInLocationService as never,
    events as never,
    noop, // qrService
    locationQr as never,
    noop // analyticsService
  );

  h.db.insert('patient', { id: 'patient-1', userId: 'user-patient' });
  h.db.insert('patient', { id: 'patient-2', userId: 'user-other' });
  // One active location: an UNASSIGNED receptionist is only accepted in that case.
  h.db.insert('clinicLocation', { id: 'loc-1', clinicId: CLINIC, isActive: true, deletedAt: null });
  h.db.insert('checkInLocation', {
    id: 'cil-1',
    clinicId: CLINIC,
    locationId: 'loc-1',
    locationName: 'Main Reception',
    isActive: true,
    qrCode: 'CHK-MAIN-1234',
    coordinates: { lat: CLINIC_LAT, lng: CLINIC_LNG },
    radius: 300,
  });
  h.db.findSubscriptionByIdSafe.mockImplementation(async () => ({
    id: 'sub-1',
    clinicId: CLINIC,
    status: 'ACTIVE',
    currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  }));

  return { ...h, controller, queue, queuedAppointments, events, locationQr };
}

type World = ReturnType<typeof world>;

function req(role: string, userId: string, clinicId = CLINIC) {
  return {
    user: { sub: userId, id: userId, role },
    clinicContext: { clinicId },
    query: {},
  } as never;
}

function forceDto(overrides: Partial<ForceCheckInDto> = {}): ForceCheckInDto {
  return { reason: 'Kiosk scan unavailable', ...overrides } as ForceCheckInDto;
}

function scanDto(overrides: Partial<ScanLocationQRDto> = {}): ScanLocationQRDto {
  return { qrCode: 'CHK-MAIN-1234', ...overrides } as ScanLocationQRDto;
}

function statusOf(w: World, appointmentId = 'appt-1'): unknown {
  return w.db.rows('appointment').find(row => row['id'] === appointmentId)?.['status'];
}

function expectCheckedIn(w: World, appointmentId = 'appt-1'): void {
  const appointment = w.db.rows('appointment').find(row => row['id'] === appointmentId);
  expect(appointment?.['status']).toBe('CONFIRMED');
  expect(appointment?.['checkedInAt']).toBeInstanceOf(Date);
  expect(w.db.rows('checkIn').filter(row => row['appointmentId'] === appointmentId)).toHaveLength(
    1
  );
  expect(w.queue.checkIn).toHaveBeenCalledWith(
    expect.objectContaining({ appointmentId, doctorId: 'doctor-1', locationId: 'loc-1' }),
    'clinic'
  );
}

function expectNothingRecorded(
  w: World,
  expectedStatus = 'SCHEDULED',
  appointmentId = 'appt-1'
): void {
  expect(w.db.rows('checkIn')).toHaveLength(0);
  expect(statusOf(w, appointmentId)).toBe(expectedStatus);
  expect(w.queue.checkIn).not.toHaveBeenCalled();
}

describe('AppointmentsController.forceCheckInAppointment', () => {
  let w: World;

  beforeEach(() => {
    w = world();
    w.db.insert('appointment', inPersonAppointment());
  });

  const force = (role: string, userId: string, dto: ForceCheckInDto, clinicId = CLINIC) =>
    w.controller.forceCheckInAppointment('appt-1', dto, req(role, userId, clinicId));

  describe('PATIENT: ownership AND presence within 200 m of the appointment location', () => {
    it('own appointment, 199 m away: CONFIRMED + CheckIn row + doctor queue entry', async () => {
      const result = await force(
        'PATIENT',
        'user-patient',
        forceDto({ coordinates: northOfClinic(199) })
      );

      expect(result.success).toBe(true);
      expectCheckedIn(w);
      expect(w.events.emit).toHaveBeenCalledWith(
        'appointment.checked_in',
        expect.objectContaining({ appointmentId: 'appt-1', checkInMethod: 'manual' })
      );
      expect(w.events.emit).toHaveBeenCalledWith('appointment.confirmed', expect.any(Object));
    });

    it('250 m away: 403 with the fixed message and code, nothing recorded', async () => {
      const error = await rejection(
        force('PATIENT', 'user-patient', forceDto({ coordinates: northOfClinic(250) }))
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toMatchObject({
        statusCode: 403,
        code: OUTSIDE_CLINIC_RADIUS_CODE,
        message: OUTSIDE_CLINIC_RADIUS_MESSAGE,
      });
      expectNothingRecorded(w);
    });

    it.each([
      ['no coordinates', {}],
      ['NaN coordinates', { coordinates: { lat: Number.NaN, lng: Number.NaN } }],
      ['non-numeric coordinates', { coordinates: { lat: 'abc', lng: 'abc' } }],
    ])('%s: the same 403, same message, same code', async (_label, overrides) => {
      const error = await rejection(
        force('PATIENT', 'user-patient', forceDto(overrides as Partial<ForceCheckInDto>))
      );

      expect(error.getStatus()).toBe(403);
      expect(error.getResponse()).toMatchObject({
        code: OUTSIDE_CLINIC_RADIUS_CODE,
        message: OUTSIDE_CLINIC_RADIUS_MESSAGE,
      });
      expectNothingRecorded(w);
    });

    it("another patient's appointment: 403 and nothing recorded", async () => {
      const error = await rejection(
        force('PATIENT', 'user-other', forceDto({ coordinates: northOfClinic(10) }))
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).not.toMatchObject({ code: OUTSIDE_CLINIC_RADIUS_CODE });
      expectNothingRecorded(w);
    });

    it('an owned dependent: allowed', async () => {
      w.db.rows('appointment')[0]!['patientId'] = 'patient-dep';
      w.db.rows('appointment')[0]!['userId'] = 'user-elsewhere';
      w.db.insert('patient', { id: 'patient-dep', userId: 'user-dependent' });
      w.db.insert('familyMember', {
        id: 'fm-1',
        patientId: 'patient-1',
        userId: 'user-dependent',
        isActive: true,
        deletedAt: null,
      });

      const result = await force(
        'PATIENT',
        'user-patient',
        forceDto({ coordinates: northOfClinic(30) })
      );

      expect(result.success).toBe(true);
      expectCheckedIn(w);
    });

    it("never trusts a client-supplied locationId: the appointment's own location decides", async () => {
      w.db.insert('clinicLocation', { id: 'loc-2', clinicId: CLINIC });
      w.db.insert('checkInLocation', {
        id: 'cil-2',
        clinicId: CLINIC,
        locationId: 'loc-2',
        isActive: true,
        qrCode: 'CHK-OTHER',
        coordinates: { lat: 28.6139, lng: 77.209 },
        radius: 300,
      });

      // Presence is far from the appointment's clinic location, but right on top of loc-2.
      const error = await rejection(
        force(
          'PATIENT',
          'user-patient',
          forceDto({
            locationId: 'f1b1c3a0-0000-4000-8000-000000000002',
            coordinates: { lat: 28.6139, lng: 77.209 },
          })
        )
      );

      expect(error.getResponse()).toMatchObject({ code: OUTSIDE_CLINIC_RADIUS_CODE });
      expectNothingRecorded(w);
    });

    it('a patient is refused on a video appointment with 400 before anything is recorded', async () => {
      w.db.insert('appointment', videoAppointment({ id: 'appt-v' }));

      const error = await rejection(
        w.controller.forceCheckInAppointment(
          'appt-v',
          forceDto({ coordinates: northOfClinic(10) }),
          req('PATIENT', 'user-patient')
        )
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(VIDEO_CHECK_IN_REJECTION_MESSAGE);
      expect(w.db.rows('checkIn')).toHaveLength(0);
      expect(statusOf(w, 'appt-v')).toBe('CONFIRMED');
      expect(w.queue.checkIn).not.toHaveBeenCalled();
    });
  });

  describe('staff', () => {
    it('a receptionist at the right location with NO coordinates succeeds: CONFIRMED + queue entry', async () => {
      w.db.insert('receptionist', {
        userId: 'user-reception',
        locationId: 'loc-1',
        location: { clinicId: CLINIC },
      });

      const result = await force('RECEPTIONIST', 'user-reception', forceDto());

      expect(result.success).toBe(true);
      expectCheckedIn(w);
    });

    it('a receptionist assigned to ANOTHER location is rejected with 403', async () => {
      w.db.insert('receptionist', {
        userId: 'user-reception',
        locationId: 'loc-2',
        location: { clinicId: CLINIC },
      });

      const error = await rejection(force('RECEPTIONIST', 'user-reception', forceDto()));

      expect(error).toBeInstanceOf(ForbiddenException);
      expectNothingRecorded(w);
    });

    it('staff of another clinic: 404, nothing recorded', async () => {
      const error = await rejection(
        force('RECEPTIONIST', 'user-reception', forceDto(), OTHER_CLINIC)
      );

      expect(error.getStatus()).toBe(404);
      expectNothingRecorded(w);
    });

    it('a doctor needs no coordinates', async () => {
      const result = await force('DOCTOR', 'user-doctor', forceDto());

      expect(result.success).toBe(true);
      expectCheckedIn(w);
    });

    it('staff may repeat the appointment location but a different one is a 400', async () => {
      const error = await rejection(
        force(
          'RECEPTIONIST',
          'user-reception',
          forceDto({ locationId: 'f1b1c3a0-0000-4000-8000-000000000002' })
        )
      );

      expect(error.getStatus()).toBe(400);
      expectNothingRecorded(w);
    });

    it('staff force check-in on a video appointment is a 400 with no side effects', async () => {
      w.db.insert('appointment', videoAppointment({ id: 'appt-v' }));

      const error = await rejection(
        w.controller.forceCheckInAppointment(
          'appt-v',
          forceDto(),
          req('RECEPTIONIST', 'user-reception')
        )
      );

      expect(error.message).toBe(VIDEO_CHECK_IN_REJECTION_MESSAGE);
      expect(w.db.rows('checkIn')).toHaveLength(0);
      expect(w.queue.checkIn).not.toHaveBeenCalled();
    });
  });

  it('a second force check-in on an arrived appointment is an idempotent success and emits nothing again', async () => {
    await force('DOCTOR', 'user-doctor', forceDto());
    w.events.emit.mockClear();

    const again = await force('DOCTOR', 'user-doctor', forceDto());

    // It used to be a 409 that also made a failed queue push impossible to repair by retrying.
    expect(again.success).toBe(true);
    expect(w.events.emit).not.toHaveBeenCalled();
    expect(w.db.rows('checkIn')).toHaveLength(1);
    expect(w.queuedAppointments.size).toBe(1);
  });

  it('two simultaneous force check-ins record one arrival and emit the events once', async () => {
    const results = await Promise.allSettled([
      force('DOCTOR', 'user-doctor', forceDto()),
      force('DOCTOR', 'user-doctor', forceDto()),
    ]);

    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    expect(w.db.rows('checkIn')).toHaveLength(1);
    expect(w.queuedAppointments.size).toBe(1);
    const checkedInEvents = w.events.emit.mock.calls.filter(
      call => call[0] === 'appointment.checked_in'
    );
    expect(checkedInEvents).toHaveLength(1);
  });
});

describe('AppointmentsController.scanLocationQRAndCheckIn', () => {
  let w: World;

  beforeEach(() => {
    w = world();
  });

  const scan = (role: string, userId: string, dto: ScanLocationQRDto) =>
    w.controller.scanLocationQRAndCheckIn(dto, req(role, userId));

  it('a patient scanning the clinic QR is CONFIRMED and queued with the doctor of the appointment', async () => {
    w.db.insert('appointment', inPersonAppointment());

    const result = await scan('PATIENT', 'user-patient', scanDto());

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      appointmentId: 'appt-1',
      locationId: 'cil-1',
      doctorId: 'doctor-1',
    });
    expectCheckedIn(w);
  });

  it('works the same through the manual code (a typed code resolves the location server-side)', async () => {
    w.db.insert('appointment', inPersonAppointment());

    const result = await scan('PATIENT', 'user-patient', scanDto({ qrCode: 'chk-main-1234' }));

    expect(result.success).toBe(true);
    expectCheckedIn(w);
  });

  it('a patient with a video and an in-person appointment at the location: only the in-person one is confirmed', async () => {
    w.db.insert('appointment', inPersonAppointment());
    // Same patient, same location id on the row, but a video visit.
    w.db.insert('appointment', videoAppointment({ id: 'appt-video', locationId: 'loc-1' }));

    const result = await scan('PATIENT', 'user-patient', scanDto());

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ appointmentId: 'appt-1' });
    expectCheckedIn(w, 'appt-1');
    expect(statusOf(w, 'appt-video')).toBe('CONFIRMED');
    const videoRow = w.db.rows('appointment').find(row => row['id'] === 'appt-video');
    expect(videoRow?.['checkedInAt']).toBeNull();
    expect(w.db.rows('checkIn').some(row => row['appointmentId'] === 'appt-video')).toBe(false);
    expect(w.queue.checkIn).toHaveBeenCalledTimes(1);
  });

  it('a patient who only has a video visit is not matched by the clinic QR at all', async () => {
    w.db.insert('appointment', videoAppointment({ locationId: 'loc-1' }));

    const error = await rejection(scan('PATIENT', 'user-patient', scanDto()));

    expect(error.getStatus()).toBe(404);
    expect(w.db.rows('checkIn')).toHaveLength(0);
    expect(w.queue.checkIn).not.toHaveBeenCalled();
  });

  it('a patient who names their own video appointment gets the clear 400', async () => {
    w.db.insert('appointment', videoAppointment({ locationId: 'loc-1' }));

    const error = await rejection(
      scan('PATIENT', 'user-patient', scanDto({ appointmentId: 'appt-video' }))
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe(VIDEO_CHECK_IN_REJECTION_MESSAGE);
    expect(w.db.rows('checkIn')).toHaveLength(0);
    expect(w.queue.checkIn).not.toHaveBeenCalled();
  });

  it('staff path: a video appointment is a 400 with no CheckIn row, status change or queue entry', async () => {
    w.db.insert('appointment', videoAppointment({ locationId: 'loc-1' }));

    const error = await rejection(
      scan('RECEPTIONIST', 'user-reception', scanDto({ appointmentId: 'appt-video' }))
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe(VIDEO_CHECK_IN_REJECTION_MESSAGE);
    expect(w.db.rows('checkIn')).toHaveLength(0);
    expect(statusOf(w, 'appt-video')).toBe('CONFIRMED');
    expect(w.queue.checkIn).not.toHaveBeenCalled();
  });

  it('a receptionist at the right location needs no coordinates: CONFIRMED + queue entry', async () => {
    w.db.insert('appointment', inPersonAppointment());
    w.db.insert('receptionist', {
      userId: 'user-reception',
      locationId: 'loc-1',
      location: { clinicId: CLINIC },
    });

    const result = await scan(
      'RECEPTIONIST',
      'user-reception',
      scanDto({ appointmentId: 'appt-1' })
    );

    expect(result.success).toBe(true);
    expectCheckedIn(w);
  });

  it('a receptionist assigned to another location is rejected with 403 on the staff scan path', async () => {
    w.db.insert('appointment', inPersonAppointment());
    w.db.insert('receptionist', {
      userId: 'user-reception',
      locationId: 'loc-2',
      location: { clinicId: CLINIC },
    });

    const error = await rejection(
      scan('RECEPTIONIST', 'user-reception', scanDto({ appointmentId: 'appt-1' }))
    );

    expect(error).toBeInstanceOf(ForbiddenException);
    expectNothingRecorded(w);
  });

  it('keeps the 400 of a bad request instead of turning it into a 500 (error mapping)', async () => {
    w.db.insert('appointment', inPersonAppointment());

    const error = await rejection(
      scan('PATIENT', 'user-patient', scanDto({ coordinates: { lat: 0, lng: 0 } }))
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
    expectNothingRecorded(w);
  });

  it.each([
    ['NaN', { lat: Number.NaN, lng: Number.NaN }],
    ['non-numeric', { lat: 'abc', lng: 'def' }],
    ['out of range', { lat: 999, lng: 999 }],
  ])(
    'a patient scanning with %s coordinates gets 400 and nothing is recorded',
    async (_label, coordinates) => {
      w.db.insert('appointment', inPersonAppointment());

      const error = await rejection(
        scan(
          'PATIENT',
          'user-patient',
          scanDto({ coordinates } as unknown as Partial<ScanLocationQRDto>)
        )
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expectNothingRecorded(w);
    }
  );

  it('a receptionist scanning is never blocked by coordinates: they are ignored, not validated', async () => {
    w.db.insert('appointment', inPersonAppointment());

    const result = await scan(
      'RECEPTIONIST',
      'user-reception',
      scanDto({
        appointmentId: 'appt-1',
        coordinates: { lat: 'abc', lng: 'def' },
      } as unknown as Partial<ScanLocationQRDto>)
    );

    expect(result.success).toBe(true);
    expectCheckedIn(w);
    expect(w.db.rows('checkIn')[0]?.['coordinates']).toBeNull();
  });

  it('answers a repeated scan with the already-confirmed result and no second arrival', async () => {
    w.db.insert('appointment', inPersonAppointment());
    await scan('PATIENT', 'user-patient', scanDto());
    w.events.emit.mockClear();

    const again = await scan('PATIENT', 'user-patient', scanDto());

    expect(again.success).toBe(true);
    expect(again.message).toBe('Appointment already confirmed and in queue');
    expect(w.db.rows('checkIn')).toHaveLength(1);
    expect(w.events.emit).not.toHaveBeenCalled();
  });

  it('two simultaneous scans of the same appointment both succeed with a single arrival', async () => {
    w.db.insert('appointment', inPersonAppointment());

    const results = await Promise.allSettled([
      scan('PATIENT', 'user-patient', scanDto({ appointmentId: 'appt-1' })),
      scan('PATIENT', 'user-patient', scanDto({ appointmentId: 'appt-1' })),
    ]);

    for (const result of results) {
      expect(result.status).toBe('fulfilled');
    }
    expect(w.db.rows('checkIn')).toHaveLength(1);
    expect(w.queuedAppointments.size).toBe(1);
    const checkedInEvents = w.events.emit.mock.calls.filter(
      call => call[0] === 'appointment.checked_in'
    );
    expect(checkedInEvents).toHaveLength(1);
  });

  it('plain HttpExceptions pass through (the shape clients see is the service one)', async () => {
    w.db.insert(
      'appointment',
      inPersonAppointment({ subscriptionId: null, isSubscriptionBased: false })
    );

    const error = await rejection(scan('PATIENT', 'user-patient', scanDto()));

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(400);
    expectNothingRecorded(w);
  });
});
