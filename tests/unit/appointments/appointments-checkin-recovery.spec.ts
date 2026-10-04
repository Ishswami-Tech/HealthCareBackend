/**
 * The check-in HTTP handlers (scan-qr, force-check-in, POST :id/check-in) wired to the real
 * AppointmentsService and the real CheckInLocationService on an in-memory database, for what the
 * service-level specs cannot show: a queue failure answers 503 and the RETRY through the same
 * handler repairs it (the handlers used to short-circuit "already confirmed" and never reached
 * the repair), the reception endpoint is the same atomic check-in, and access is decided before
 * the appointment type.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));
jest.mock('@services/video/video.service', () => ({ VideoService: class VideoService {} }));

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppointmentsController } from '@services/appointments/appointments.controller';
import {
  CheckInLocationService,
  VIDEO_CHECK_IN_REJECTION_MESSAGE,
} from '@services/appointments/plugins/therapy/check-in-location.service';
import {
  CHECK_IN_NOT_TODAY_CODE,
  CHECK_IN_WINDOW_CLOSED_CODE,
  OUTSIDE_CLINIC_RADIUS_CODE,
} from '@services/appointments/core/check-in-presence.util';
import { CACHE_INVALIDATE_KEY } from '@core/decorators';
import type { ForceCheckInDto, ProcessCheckInDto, ScanLocationQRDto } from '@dtos/appointment.dto';
import { CLINIC, OTHER_CLINIC, buildHarness, rejection, type Row } from './appointments-harness';
import { FakeQueueCache } from './fake-queue-cache';
import { createStubQueue, northOfClinic, CLINIC_LAT, CLINIC_LNG } from './check-in-service-world';
import { istSlot, istSlotOnOtherDay, pinClock, unpinClock } from './check-in-time-helpers';

function inPersonAppointment(overrides: Row = {}): Row {
  return {
    id: 'appt-1',
    clinicId: CLINIC,
    patientId: 'patient-1',
    userId: 'user-patient',
    doctorId: 'doctor-1',
    type: 'IN_PERSON',
    status: 'SCHEDULED',
    locationId: 'loc-1',
    checkedInAt: null,
    subscriptionId: 'sub-1',
    isSubscriptionBased: true,
    doctor: { id: 'doctor-1', user: { name: 'Dr Rao' } },
    ...istSlot(0),
    ...overrides,
  };
}

function videoAppointment(overrides: Row = {}): Row {
  return inPersonAppointment({
    id: 'appt-video',
    type: 'VIDEO_CALL',
    status: 'CONFIRMED',
    locationId: null,
    subscriptionId: null,
    isSubscriptionBased: false,
    ...overrides,
  });
}

function world() {
  const h = buildHarness();
  const cache = new FakeQueueCache();
  const { queue, queued } = createStubQueue();
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

  return { ...h, controller, queue, queued, events, cache };
}

type World = ReturnType<typeof world>;

function req(role: string, userId: string, clinicId = CLINIC) {
  return {
    user: { sub: userId, id: userId, role },
    clinicContext: { clinicId },
    query: {},
  } as never;
}

const forceDto = (overrides: Partial<ForceCheckInDto> = {}): ForceCheckInDto =>
  ({ reason: 'Kiosk scan unavailable', ...overrides }) as ForceCheckInDto;
const scanDto = (overrides: Partial<ScanLocationQRDto> = {}): ScanLocationQRDto =>
  ({ qrCode: 'CHK-MAIN-1234', ...overrides }) as ScanLocationQRDto;
/** What the web action posts to POST :id/check-in. */
const webCheckInDto = (overrides: Partial<ProcessCheckInDto> = {}): ProcessCheckInDto =>
  ({
    checkInMethod: 'manual',
    notes: 'Manual receptionist check-in',
    ...overrides,
  }) as ProcessCheckInDto;

const statusOf = (w: World, id = 'appt-1'): unknown =>
  w.db.rows('appointment').find(row => row['id'] === id)?.['status'];

function eventCount(w: World, name: string): number {
  return w.events.emit.mock.calls.filter(call => call[0] === name).length;
}

function expectRecordedAndQueued(w: World): void {
  expect(statusOf(w)).toBe('CONFIRMED');
  expect(w.db.rows('checkIn').filter(row => row['appointmentId'] === 'appt-1')).toHaveLength(1);
  expect(w.queued.has('appt-1')).toBe(true);
}

function expectNothingRecorded(w: World, expectedStatus = 'SCHEDULED'): void {
  expect(w.db.rows('checkIn')).toHaveLength(0);
  expect(statusOf(w)).toBe(expectedStatus);
  expect(w.queue.checkIn).not.toHaveBeenCalled();
}

describe('check-in handlers: a queue failure is a 503 and the retry repairs it', () => {
  let w: World;

  beforeEach(() => {
    pinClock();
    w = world();
    w.db.insert('appointment', inPersonAppointment());
  });

  afterEach(() => {
    unpinClock();
  });

  describe('POST check-in/scan-qr (patient)', () => {
    const scan = (dto: ScanLocationQRDto = scanDto()) =>
      w.controller.scanLocationQRAndCheckIn(dto, req('PATIENT', 'user-patient'));

    it('503 after the commit, then the SAME scan again succeeds, queues the patient and emits the events once', async () => {
      w.queue.checkIn.mockRejectedValueOnce(new Error('queue backend unavailable'));

      const error = await rejection(scan());
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(statusOf(w)).toBe('CONFIRMED');
      expect(w.queued.size).toBe(0);
      expect(eventCount(w, 'appointment.checked_in')).toBe(0);

      const retry = await scan();

      expect(retry.success).toBe(true);
      expect(retry.message).toBe('Appointment already confirmed and in queue');
      expectRecordedAndQueued(w);
      // The failed attempt never reached the events; the repair emits them (once).
      expect(eventCount(w, 'appointment.checked_in')).toBe(1);
      expect(eventCount(w, 'appointment.confirmed')).toBe(1);
    });

    it('a third scan changes nothing: one entry, no more events', async () => {
      w.queue.checkIn.mockRejectedValueOnce(new Error('queue backend unavailable'));
      await rejection(scan());
      await scan();
      w.events.emit.mockClear();

      const again = await scan();

      expect(again.success).toBe(true);
      expect(w.queued.size).toBe(1);
      expect(w.db.rows('checkIn')).toHaveLength(1);
      expect(w.events.emit).not.toHaveBeenCalled();
    });

    it('the queue lock being unavailable answers 503 instead of "in queue"', async () => {
      await scan(); // arrival recorded and queued
      w.queued.clear(); // ... then the entry is lost (queue flushed, cache restarted)
      w.cache.lockUnavailable = true;

      const error = await rejection(scan());

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(w.queued.size).toBe(0);
    });

    it('a queue entry that was lost after a successful check-in is re-added by the next scan', async () => {
      await scan();
      w.queued.clear();

      const result = await scan();

      expect(result.success).toBe(true);
      expect(w.queued.has('appt-1')).toBe(true);
    });
  });

  describe('POST :id/force-check-in', () => {
    const force = (role: string, userId: string, dto: ForceCheckInDto) =>
      w.controller.forceCheckInAppointment('appt-1', dto, req(role, userId));

    it('a patient: 503, then the retry succeeds (no "already confirmed" dead end) and queues them', async () => {
      w.queue.checkIn.mockRejectedValueOnce(new Error('queue backend unavailable'));
      const dto = forceDto({ coordinates: northOfClinic(50) });

      const error = await rejection(force('PATIENT', 'user-patient', dto));
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(statusOf(w)).toBe('CONFIRMED');
      expect(w.queued.size).toBe(0);

      const retry = await force('PATIENT', 'user-patient', dto);

      expect(retry.success).toBe(true);
      expectRecordedAndQueued(w);
      expect(eventCount(w, 'appointment.checked_in')).toBe(1);
    });

    it('a retry still has to prove presence: outside 200 m it is the 403, not a free repair', async () => {
      w.queue.checkIn.mockRejectedValueOnce(new Error('queue backend unavailable'));
      await rejection(
        force('PATIENT', 'user-patient', forceDto({ coordinates: northOfClinic(50) }))
      );

      const error = await rejection(
        force('PATIENT', 'user-patient', forceDto({ coordinates: northOfClinic(900) }))
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toMatchObject({ code: OUTSIDE_CLINIC_RADIUS_CODE });
      expect(w.queued.size).toBe(0);
    });

    it('staff: a second force check-in on an arrived appointment is an idempotent success, no events, one row', async () => {
      await force('DOCTOR', 'user-doctor', forceDto());
      w.events.emit.mockClear();

      const again = await force('DOCTOR', 'user-doctor', forceDto());

      expect(again.success).toBe(true);
      expect(w.events.emit).not.toHaveBeenCalled();
      expect(w.db.rows('checkIn')).toHaveLength(1);
      expect(w.queued.size).toBe(1);
    });

    it('staff: 503 then retry repairs and emits the events', async () => {
      w.queue.checkIn.mockRejectedValueOnce(new Error('queue backend unavailable'));

      const error = await rejection(force('RECEPTIONIST', 'user-reception', forceDto()));
      expect(error).toBeInstanceOf(ServiceUnavailableException);

      const retry = await force('RECEPTIONIST', 'user-reception', forceDto());

      expect(retry.success).toBe(true);
      expectRecordedAndQueued(w);
      expect(eventCount(w, 'appointment.confirmed')).toBe(1);
    });
  });

  describe('POST :id/check-in (the web receptionist action) is the same atomic check-in', () => {
    const checkIn = (
      role: string,
      userId: string,
      dto: ProcessCheckInDto = webCheckInDto(),
      id = 'appt-1',
      clinic = CLINIC
    ) => w.controller.checkInAppointment(id, dto, req(role, userId, clinic));

    it('keeps the response contract the web depends on', async () => {
      const result = await checkIn('RECEPTIONIST', 'user-reception');

      expect(result).toEqual({
        success: true,
        data: { message: 'Check-in processed successfully' },
      });
      expectRecordedAndQueued(w);
      expect(eventCount(w, 'appointment.checked_in')).toBe(1);
      expect(eventCount(w, 'appointment.confirmed')).toBe(1);
    });

    it('a double click makes ONE CheckIn row and ONE queue entry, and both clicks succeed', async () => {
      const results = await Promise.allSettled([
        checkIn('RECEPTIONIST', 'user-reception'),
        checkIn('RECEPTIONIST', 'user-reception'),
      ]);

      expect(results.every(result => result.status === 'fulfilled')).toBe(true);
      expect(w.db.rows('checkIn')).toHaveLength(1);
      expect(w.queued.size).toBe(1);
      expect(eventCount(w, 'appointment.checked_in')).toBe(1);
    });

    it('a queue failure is a 503 (it used to be a 200 with no queue entry); the retry repairs it', async () => {
      w.queue.checkIn.mockRejectedValueOnce(new Error('queue backend unavailable'));

      const error = await rejection(checkIn('RECEPTIONIST', 'user-reception'));
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(statusOf(w)).toBe('CONFIRMED');
      expect(w.queued.size).toBe(0);

      const retry = await checkIn('RECEPTIONIST', 'user-reception');

      expect(retry.success).toBe(true);
      expectRecordedAndQueued(w);
    });

    it('enforces the active plan like the other entry points (the legacy path skipped it)', async () => {
      w.db.findSubscriptionByIdSafe.mockImplementation(async () => null);

      const error = await rejection(checkIn('RECEPTIONIST', 'user-reception'));

      expect(error).toBeInstanceOf(BadRequestException);
      expectNothingRecorded(w);
    });

    it("uses the appointment's own location: a locationId in the body is ignored, as before", async () => {
      const result = await checkIn(
        'RECEPTIONIST',
        'user-reception',
        webCheckInDto({ locationId: 'f1b1c3a0-0000-4000-8000-000000000002' })
      );

      expect(result.success).toBe(true);
      expectRecordedAndQueued(w);
    });

    it('a doctor can check in too, with no coordinates', async () => {
      const result = await checkIn('DOCTOR', 'user-doctor');

      expect(result.success).toBe(true);
      expectRecordedAndQueued(w);
    });

    it('a receptionist assigned to ANOTHER location: 403 and nothing recorded', async () => {
      w.db.insert('receptionist', {
        userId: 'user-reception',
        locationId: 'loc-2',
        location: { clinicId: CLINIC },
      });

      const error = await rejection(checkIn('RECEPTIONIST', 'user-reception'));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe('Receptionist is not assigned to this location');
      expectNothingRecorded(w);
    });

    it('an UNASSIGNED receptionist in a multi-location clinic: 403', async () => {
      w.db.insert('clinicLocation', {
        id: 'loc-2',
        clinicId: CLINIC,
        isActive: true,
        deletedAt: null,
      });

      const error = await rejection(checkIn('RECEPTIONIST', 'user-reception'));

      expect(error).toBeInstanceOf(ForbiddenException);
      expectNothingRecorded(w);
    });

    it('another clinic: 404, nothing recorded', async () => {
      const error = await rejection(
        checkIn('RECEPTIONIST', 'user-reception', webCheckInDto(), 'appt-1', OTHER_CLINIC)
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expectNothingRecorded(w);
    });

    it('an appointment on another day cannot be queued into today: 400', async () => {
      w.db.rows('appointment')[0]!['date'] = istSlotOnOtherDay(7).date;

      const error = await rejection(checkIn('RECEPTIONIST', 'user-reception'));

      expect(error.getResponse()).toMatchObject({ code: CHECK_IN_NOT_TODAY_CODE });
      expectNothingRecorded(w);
    });

    it('a video appointment is refused with the one shared message (400)', async () => {
      w.db.insert('appointment', videoAppointment());

      const error = await rejection(
        checkIn('RECEPTIONIST', 'user-reception', webCheckInDto(), 'appt-video')
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(VIDEO_CHECK_IN_REJECTION_MESSAGE);
      expect(w.db.rows('checkIn')).toHaveLength(0);
      expect(w.queue.checkIn).not.toHaveBeenCalled();
    });
  });
});

describe('force check-in: access is decided before the appointment type, and the time rules apply', () => {
  let w: World;

  beforeEach(() => {
    pinClock();
    w = world();
  });

  afterEach(() => {
    unpinClock();
  });

  const force = (role: string, userId: string, id: string, dto: ForceCheckInDto) =>
    w.controller.forceCheckInAppointment(id, dto, req(role, userId));

  describe('a patient who does not own the appointment', () => {
    beforeEach(() => {
      w.db.insert('appointment', inPersonAppointment());
      w.db.insert('appointment', videoAppointment());
    });

    it.each([
      ['in-person', 'appt-1'],
      ['video', 'appt-video'],
    ])(
      'gets the same 403 for a %s appointment (nothing about its type is revealed)',
      async (_label, id) => {
        const error = await rejection(
          force('PATIENT', 'user-other', id, forceDto({ coordinates: northOfClinic(10) }))
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.message).toBe('Patients can only check in their own appointments');
      }
    );

    it('the owner is the one who learns it is a video visit: 400 with the shared message', async () => {
      const error = await rejection(
        force('PATIENT', 'user-patient', 'appt-video', forceDto({ coordinates: northOfClinic(10) }))
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(VIDEO_CHECK_IN_REJECTION_MESSAGE);
    });
  });

  describe('time window for the patient (200 m presence is not enough)', () => {
    const here = (): ForceCheckInDto => forceDto({ coordinates: northOfClinic(20) });

    it('next week, standing on the clinic: 400 not today, nothing recorded', async () => {
      w.db.insert('appointment', inPersonAppointment({ ...istSlotOnOtherDay(7) }));

      const error = await rejection(force('PATIENT', 'user-patient', 'appt-1', here()));

      expect(error.getResponse()).toMatchObject({ code: CHECK_IN_NOT_TODAY_CODE });
      expectNothingRecorded(w);
    });

    it('yesterday: 400 not today', async () => {
      w.db.insert('appointment', inPersonAppointment({ ...istSlotOnOtherDay(-1) }));

      const error = await rejection(force('PATIENT', 'user-patient', 'appt-1', here()));

      expect(error.getResponse()).toMatchObject({ code: CHECK_IN_NOT_TODAY_CODE });
      expectNothingRecorded(w);
    });

    it('today but 4 hours early: 400 window closed', async () => {
      w.db.insert('appointment', inPersonAppointment({ ...istSlot(240) }));

      const error = await rejection(force('PATIENT', 'user-patient', 'appt-1', here()));

      expect(error.getResponse()).toMatchObject({ code: CHECK_IN_WINDOW_CLOSED_CODE });
      expectNothingRecorded(w);
    });

    it('inside the window it still works: CONFIRMED + queued', async () => {
      w.db.insert('appointment', inPersonAppointment({ ...istSlot(20) }));

      const result = await force('PATIENT', 'user-patient', 'appt-1', here());

      expect(result.success).toBe(true);
      expectRecordedAndQueued(w);
    });

    it('staff may force check in outside the window on the same day, but not another day', async () => {
      w.db.insert('appointment', inPersonAppointment({ ...istSlot(240) }));
      w.db.insert(
        'appointment',
        inPersonAppointment({ id: 'appt-next-week', ...istSlotOnOtherDay(7) })
      );

      const sameDay = await force('RECEPTIONIST', 'user-reception', 'appt-1', forceDto());
      const otherDay = await rejection(
        force('RECEPTIONIST', 'user-reception', 'appt-next-week', forceDto())
      );

      expect(sameDay.success).toBe(true);
      expect(otherDay.getResponse()).toMatchObject({ code: CHECK_IN_NOT_TODAY_CODE });
      expect(statusOf(w, 'appt-next-week')).toBe('SCHEDULED');
    });
  });
});

describe('scan-qr time rules', () => {
  let w: World;

  beforeEach(() => {
    pinClock();
    w = world();
  });

  afterEach(() => {
    unpinClock();
  });

  it('a patient scanning outside the window is refused (400) and nothing is recorded', async () => {
    w.db.insert('appointment', inPersonAppointment({ ...istSlot(-240) }));

    const error = await rejection(
      w.controller.scanLocationQRAndCheckIn(scanDto(), req('PATIENT', 'user-patient'))
    );

    expect(error.getStatus()).toBe(400);
    expectNothingRecorded(w);
  });

  it('staff scanning outside the window on the same day is accepted', async () => {
    w.db.insert('appointment', inPersonAppointment({ ...istSlot(-240) }));

    const result = await w.controller.scanLocationQRAndCheckIn(
      scanDto({ appointmentId: 'appt-1' }),
      req('RECEPTIONIST', 'user-reception')
    );

    expect(result.success).toBe(true);
    expectRecordedAndQueued(w);
  });

  it('staff cannot queue another day through the scan either (400 not today)', async () => {
    w.db.insert('appointment', inPersonAppointment({ ...istSlotOnOtherDay(3) }));

    const error = await rejection(
      w.controller.scanLocationQRAndCheckIn(
        scanDto({ appointmentId: 'appt-1' }),
        req('RECEPTIONIST', 'user-reception')
      )
    );

    expect(error.getResponse()).toMatchObject({ code: CHECK_IN_NOT_TODAY_CODE });
    expectNothingRecorded(w);
  });
});

describe('cache invalidation declared on the check-in handlers', () => {
  const patternsOf = (method: unknown): string[] =>
    (
      Reflect.getMetadata(CACHE_INVALIDATE_KEY, method as object) as
        { patterns?: string[] } | undefined
    )?.patterns ?? [];

  const proto = AppointmentsController.prototype;

  it('force-check-in lists the same detail / my / upcoming patterns as scan-qr', () => {
    const scan = patternsOf(proto.scanLocationQRAndCheckIn);
    const force = patternsOf(proto.forceCheckInAppointment);

    for (const pattern of [
      'appointments:detail:*',
      'appointments:upcoming:*',
      'appointments:my:*',
    ]) {
      expect(scan).toContain(pattern);
      expect(force).toContain(pattern);
    }
  });

  it('so does the reception endpoint (POST :id/check-in)', () => {
    const legacy = patternsOf(proto.checkInAppointment);

    expect(legacy).toEqual(
      expect.arrayContaining([
        'appointments:detail:*',
        'appointments:upcoming:*',
        'appointments:my:*',
      ])
    );
  });
});
