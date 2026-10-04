/**
 * CheckInLocationService.processCheckIn: the one place every check-in path (patient QR scan,
 * manual code, force check-in, receptionist desk) records an arrival.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CheckInLocationService,
  FORCE_CHECK_IN_MAX_DISTANCE_METERS,
  OUTSIDE_CLINIC_RADIUS_CODE,
  OUTSIDE_CLINIC_RADIUS_MESSAGE,
  VIDEO_CHECK_IN_REJECTION_MESSAGE,
} from '@services/appointments/plugins/therapy/check-in-location.service';
import type { ProcessCheckInOptions } from '@core/types/appointment.types';
import { FakeDb, createCacheStub, createLoggingStub, type Row } from './test-helpers';
import { istSlot, pinClock, unpinClock } from './check-in-time-helpers';

const CLINIC = 'clinic-1';
const OTHER_CLINIC = 'clinic-2';
const CLINIC_LAT = 19.076;
const CLINIC_LNG = 72.8777;
const METERS_PER_DEGREE_LAT = 111_194.9;

/** A position `meters` due north of the clinic. */
function northOfClinic(meters: number): { lat: number; lng: number } {
  return { lat: CLINIC_LAT + meters / METERS_PER_DEGREE_LAT, lng: CLINIC_LNG };
}

const PATIENT = { userId: 'user-patient', role: 'PATIENT' };

function build(options: { locationRadius?: number } = {}) {
  const db = new FakeDb();
  const cache = createCacheStub();
  const logging = createLoggingStub();

  // The shared queue service throws a plain Error for an arrival that is already queued.
  const queuedAppointments = new Set<string>();
  const queue = {
    checkIn: jest.fn(async (entry: { appointmentId: string }, _domain: string) => {
      if (queuedAppointments.has(entry.appointmentId)) {
        throw new Error('Appointment arrival is already confirmed');
      }
      queuedAppointments.add(entry.appointmentId);
      return { success: true };
    }),
  };

  const clinicLocation = { id: 'loc-1', clinicId: CLINIC };
  const locationCache = {
    getLocation: jest.fn(async (..._args: unknown[]) => clinicLocation),
    invalidateLocation: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const clinicLocationService = {
    getClinicLocationById: jest.fn(async (..._args: unknown[]) => clinicLocation),
  };

  const service = new CheckInLocationService(
    db as never,
    cache as never,
    logging as never,
    queue as never,
    locationCache as never,
    clinicLocationService as never
  );

  db.insert('patient', { id: 'patient-1', userId: 'user-patient' });
  db.insert('patient', { id: 'patient-2', userId: 'user-other' });
  // The baseline clinic has exactly one active location (a receptionist without an assignment
  // is only accepted in that case; the multi-location tests add a second one).
  db.insert('clinicLocation', { id: 'loc-1', clinicId: CLINIC, isActive: true, deletedAt: null });
  db.insert('checkInLocation', {
    id: 'cil-1',
    clinicId: CLINIC,
    locationId: 'loc-1',
    locationName: 'Main Reception',
    isActive: true,
    qrCode: 'CHK-MAIN',
    coordinates: { lat: CLINIC_LAT, lng: CLINIC_LNG },
    radius: options.locationRadius ?? 300,
  });
  db.findSubscriptionByIdSafe.mockImplementation(async () => ({
    id: 'sub-1',
    clinicId: CLINIC,
    status: 'ACTIVE',
    currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  }));

  return { service, db, cache, queue, queuedAppointments, locationCache };
}

function appointmentRow(overrides: Row = {}): Row {
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
    // An appointment starting right now (inside every check-in window).
    ...istSlot(0),
    ...overrides,
  };
}

function checkInInput(overrides: Row = {}) {
  return {
    appointmentId: 'appt-1',
    locationId: 'loc-1',
    patientId: 'patient-1',
    ...overrides,
  } as Parameters<CheckInLocationService['processCheckIn']>[0];
}

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(HttpException);
  return error as HttpException;
}

describe('CheckInLocationService.processCheckIn', () => {
  let h: ReturnType<typeof build>;

  beforeEach(() => {
    pinClock();
    h = build();
  });

  afterEach(() => {
    unpinClock();
  });

  const patientCheckIn = (
    overrides: Row = {},
    options: ProcessCheckInOptions = { actor: PATIENT, presence: 'if-supplied' }
  ) => h.service.processCheckIn(checkInInput(overrides), CLINIC, options);

  function expectNothingRecorded(expectedStatus = 'SCHEDULED'): void {
    expect(h.db.rows('checkIn')).toHaveLength(0);
    expect(h.db.rows('appointment')[0]?.['status']).toBe(expectedStatus);
    expect(h.db.rows('appointment')[0]?.['checkedInAt']).toBeNull();
    expect(h.queue.checkIn).not.toHaveBeenCalled();
  }

  describe('atomic arrival', () => {
    it('confirms the appointment, records one CheckIn row and queues the doctor in one go', async () => {
      h.db.insert('appointment', appointmentRow());

      const checkIn = await patientCheckIn();

      expect(h.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
      expect(h.db.rows('appointment')[0]?.['checkedInAt']).toBeInstanceOf(Date);
      expect(h.db.rows('checkIn')).toHaveLength(1);
      expect(checkIn.alreadyCheckedIn).toBeUndefined();
      expect(checkIn.checkInTime).toBeInstanceOf(Date);
      expect(h.queue.checkIn).toHaveBeenCalledTimes(1);
      expect(h.queue.checkIn).toHaveBeenCalledWith(
        expect.objectContaining({
          appointmentId: 'appt-1',
          doctorId: 'doctor-1',
          clinicId: CLINIC,
          appointmentType: 'IN_PERSON',
          locationId: 'loc-1',
        }),
        'clinic'
      );
    });

    it('claims the arrival with a conditional update guarded by checkedInAt and status', async () => {
      h.db.insert('appointment', appointmentRow());

      await patientCheckIn();

      const claim = h.db.writes.find(write => write.op === 'updateMany');
      expect(claim?.args['where']).toEqual({
        id: 'appt-1',
        clinicId: CLINIC,
        checkedInAt: null,
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
      });
    });

    it.each([
      ['no active plan at all', { subscriptionId: null, isSubscriptionBased: false }, null],
      [
        'a cancelled plan',
        {},
        {
          id: 'sub-1',
          clinicId: CLINIC,
          status: 'CANCELLED',
          currentPeriodEnd: new Date(Date.now() + 1e9),
        },
      ],
      [
        'an expired plan period',
        {},
        {
          id: 'sub-1',
          clinicId: CLINIC,
          status: 'ACTIVE',
          currentPeriodEnd: new Date(Date.now() - 1000),
        },
      ],
    ])(
      'a lapsed plan (%s) leaves no CheckIn row, no status change and no queue entry',
      async (_label, overrides, subscription) => {
        h.db.insert('appointment', appointmentRow(overrides));
        h.db.findSubscriptionByIdSafe.mockImplementation(async () => subscription as Row | null);

        const error = await rejection(patientCheckIn());

        expect(error).toBeInstanceOf(BadRequestException);
        expectNothingRecorded();
      }
    );

    it('rolls the whole arrival back when the CheckIn insert fails', async () => {
      h.db.insert('appointment', appointmentRow());
      h.db.failNextCreateOn = 'checkIn';

      await expect(patientCheckIn()).rejects.toThrow('forced checkIn.create failure');

      expectNothingRecorded();
    });

    it('reuses a stray CheckIn row from an earlier failed attempt instead of adding a second one', async () => {
      h.db.insert('appointment', appointmentRow());
      h.db.insert('checkIn', {
        appointmentId: 'appt-1',
        clinicId: CLINIC,
        locationId: 'cil-1',
        patientId: 'patient-1',
        checkedInAt: new Date('2026-01-01T00:00:00Z'),
        isVerified: false,
        verifiedBy: null,
        coordinates: null,
        deviceInfo: null,
      });

      const checkIn = await patientCheckIn();

      expect(h.db.rows('checkIn')).toHaveLength(1);
      expect(h.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
      expect(checkIn.alreadyCheckedIn).toBeUndefined();
    });

    it('a duplicate concurrent scan resolves to the same success: one row, one queue entry, no 500', async () => {
      h.db.insert('appointment', appointmentRow());

      const [first, second] = await Promise.all([patientCheckIn(), patientCheckIn()]);

      const flags = [first.alreadyCheckedIn === true, second.alreadyCheckedIn === true];
      expect(flags.filter(Boolean)).toHaveLength(1);
      expect(h.db.rows('checkIn')).toHaveLength(1);
      expect(h.queuedAppointments.size).toBe(1);
      expect(first.id).toBe(second.id);
      expect(h.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
    });

    it('a repeated request for an already checked-in appointment is idempotent', async () => {
      h.db.insert('appointment', appointmentRow());
      await patientCheckIn();

      const again = await patientCheckIn();

      expect(again.alreadyCheckedIn).toBe(true);
      expect(h.db.rows('checkIn')).toHaveLength(1);
    });

    it.each(['CANCELLED', 'COMPLETED', 'NO_SHOW', 'EXPIRED'])(
      'refuses a %s appointment with 400 and records nothing',
      async status => {
        h.db.insert('appointment', appointmentRow({ status }));

        const error = await rejection(patientCheckIn());

        expect(error).toBeInstanceOf(BadRequestException);
        expect(h.db.rows('checkIn')).toHaveLength(0);
        expect(h.queue.checkIn).not.toHaveBeenCalled();
      }
    );

    it('loses a race against a cancellation with 409 and records nothing', async () => {
      const row = h.db.insert('appointment', appointmentRow());
      // The appointment is cancelled between the pre-checks and the claim.
      h.db.executeInTransaction.mockImplementationOnce(async operation => {
        row['status'] = 'CANCELLED';
        return operation(h.db.client);
      });

      const error = await rejection(patientCheckIn());

      expect(error).toBeInstanceOf(ConflictException);
      expect(h.db.rows('checkIn')).toHaveLength(0);
      expect(h.queue.checkIn).not.toHaveBeenCalled();
    });

    it('a queue failure after the commit surfaces as 503 and the retry repairs the queue', async () => {
      h.db.insert('appointment', appointmentRow());
      h.queue.checkIn.mockRejectedValueOnce(new Error('cache unavailable'));

      const error = await rejection(patientCheckIn());
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(h.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
      expect(h.queuedAppointments.size).toBe(0);

      const retry = await patientCheckIn();
      expect(retry.alreadyCheckedIn).toBe(true);
      expect(h.queuedAppointments.size).toBe(1);
      expect(h.db.rows('checkIn')).toHaveLength(1);
    });
  });

  describe('video appointments never use clinic check-in', () => {
    it.each([
      ['patient QR scan', { actor: PATIENT, presence: 'if-supplied' } as ProcessCheckInOptions],
      [
        'force check-in (patient)',
        { actor: PATIENT, presence: 'required' } as ProcessCheckInOptions,
      ],
      [
        'receptionist desk',
        {
          actor: { userId: 'user-reception', role: 'RECEPTIONIST' },
          presence: 'skip',
        } as ProcessCheckInOptions,
      ],
      ['no actor', {} as ProcessCheckInOptions],
    ])('%s: 400, no CheckIn row, no status change, no queue entry', async (_label, options) => {
      h.db.insert(
        'appointment',
        appointmentRow({ type: 'VIDEO_CALL', status: 'CONFIRMED', locationId: null })
      );

      const error = await rejection(
        h.service.processCheckIn(checkInInput({ coordinates: northOfClinic(10) }), CLINIC, options)
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(VIDEO_CHECK_IN_REJECTION_MESSAGE);
      expect(h.db.rows('checkIn')).toHaveLength(0);
      expect(h.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
      expect(h.db.rows('appointment')[0]?.['checkedInAt']).toBeNull();
      expect(h.queue.checkIn).not.toHaveBeenCalled();
    });
  });

  describe('force check-in presence rule (PATIENT)', () => {
    const force = (coordinates: unknown) =>
      patientCheckIn({ coordinates }, { actor: PATIENT, presence: 'required' });

    beforeEach(() => {
      h.db.insert('appointment', appointmentRow());
    });

    function expectOutsideClinicRejection(error: HttpException): void {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getStatus()).toBe(403);
      expect(error.getResponse()).toEqual({
        statusCode: 403,
        error: 'Forbidden',
        code: OUTSIDE_CLINIC_RADIUS_CODE,
        message: OUTSIDE_CLINIC_RADIUS_MESSAGE,
      });
      expectNothingRecorded();
    }

    it('uses the exact user-facing message, code and 200 m cap', () => {
      expect(OUTSIDE_CLINIC_RADIUS_MESSAGE).toBe(
        'Please scan the QR code at the clinic location. You need to be within 200 meters of the clinic to check in.'
      );
      expect(OUTSIDE_CLINIC_RADIUS_CODE).toBe('OUTSIDE_CLINIC_RADIUS');
      expect(FORCE_CHECK_IN_MAX_DISTANCE_METERS).toBe(200);
    });

    it.each([
      ['no coordinates', undefined],
      ['null coordinates', null],
      ['a string instead of an object', 'abc'],
      ['NaN latitude', { lat: Number.NaN, lng: CLINIC_LNG }],
      ['Infinity longitude', { lat: CLINIC_LAT, lng: Number.POSITIVE_INFINITY }],
      ['non-numeric values', { lat: 'abc', lng: 'def' }],
      ['numeric strings', { lat: String(CLINIC_LAT), lng: String(CLINIC_LNG) }],
      ['out-of-range latitude', { lat: 123, lng: CLINIC_LNG }],
      ['out-of-range longitude', { lat: CLINIC_LAT, lng: 400 }],
      ['missing longitude', { lat: CLINIC_LAT }],
    ])('rejects %s with the one fixed message', async (_label, coordinates) => {
      expectOutsideClinicRejection(await rejection(force(coordinates)));
    });

    it('rejects a position 250 m away', async () => {
      expectOutsideClinicRejection(await rejection(force(northOfClinic(250))));
    });

    it('accepts a position 199 m away: CONFIRMED and queued', async () => {
      const checkIn = await force(northOfClinic(199));

      expect(checkIn.alreadyCheckedIn).toBeUndefined();
      expect(h.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
      expect(h.db.rows('checkIn')).toHaveLength(1);
      expect(h.queue.checkIn).toHaveBeenCalledTimes(1);
    });

    it('never leaks the distance or the clinic coordinates in the response', async () => {
      const error = await rejection(force(northOfClinic(250)));

      const body = JSON.stringify(error.getResponse());
      expect(body).not.toMatch(/250|\d{2}\.\d{3}|72\.87|19\.07/);
    });

    it('a location geofence smaller than 200 m wins: 150 m is too far for a 100 m geofence', async () => {
      h = build({ locationRadius: 100 });
      h.db.insert('appointment', appointmentRow());

      expectOutsideClinicRejection(await rejection(force(northOfClinic(150))));
      const ok = await force(northOfClinic(80));
      expect(ok.alreadyCheckedIn).toBeUndefined();
    });

    it('a larger geofence never widens the cap: 250 m is refused even with a 5 km geofence', async () => {
      h = build({ locationRadius: 5000 });
      h.db.insert('appointment', appointmentRow());

      expectOutsideClinicRejection(await rejection(force(northOfClinic(250))));
    });

    it('fails closed when the location has no usable geofence center', async () => {
      const location = h.db.rows('checkInLocation')[0] as Row;
      location['coordinates'] = { lat: 'x', lng: null };

      expectOutsideClinicRejection(await rejection(force(northOfClinic(10))));
    });

    it("refuses another patient's appointment with 403 before any presence check", async () => {
      const error = await rejection(
        h.service.processCheckIn(checkInInput({ coordinates: northOfClinic(10) }), CLINIC, {
          actor: { userId: 'user-other', role: 'PATIENT' },
          presence: 'required',
        })
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe('Patients can only check in their own appointments');
      expectNothingRecorded();
    });

    it('lets a patient check in an owned dependent', async () => {
      h.db.rows('appointment')[0]!['patientId'] = 'patient-dep';
      h.db.rows('appointment')[0]!['userId'] = 'user-booker-elsewhere';
      h.db.insert('patient', { id: 'patient-dep', userId: 'user-dependent' });
      h.db.insert('familyMember', {
        id: 'fm-1',
        patientId: 'patient-1',
        userId: 'user-dependent',
        isActive: true,
        deletedAt: null,
      });

      const checkIn = await force(northOfClinic(50));

      expect(checkIn.alreadyCheckedIn).toBeUndefined();
      expect(h.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
    });
  });

  describe('staff check-in (no coordinates)', () => {
    const receptionist = { userId: 'user-reception', role: 'RECEPTIONIST' };
    const desk = (options?: Partial<ProcessCheckInOptions>) =>
      h.service.processCheckIn(checkInInput({ patientId: 'patient-1' }), CLINIC, {
        actor: receptionist,
        presence: 'skip',
        ...options,
      });

    beforeEach(() => {
      h.db.insert('appointment', appointmentRow());
    });

    it('a receptionist at the right location with NO coordinates succeeds: CONFIRMED + queued', async () => {
      h.db.insert('receptionist', {
        userId: 'user-reception',
        locationId: 'loc-1',
        location: { clinicId: CLINIC },
      });

      const checkIn = await desk();

      expect(checkIn.alreadyCheckedIn).toBeUndefined();
      expect(h.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
      expect(h.db.rows('checkIn')).toHaveLength(1);
      expect(h.queue.checkIn).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: 'doctor-1', locationId: 'loc-1' }),
        'clinic'
      );
    });

    it('does not validate coordinates for staff even when some are sent', async () => {
      const farAway = { lat: 0, lng: 0 };

      const checkIn = await h.service.processCheckIn(
        checkInInput({ coordinates: farAway }),
        CLINIC,
        { actor: receptionist, presence: 'skip' }
      );

      expect(checkIn.alreadyCheckedIn).toBeUndefined();
    });

    it('a receptionist assigned to ANOTHER location gets 403 and nothing is recorded', async () => {
      h.db.insert('receptionist', {
        userId: 'user-reception',
        locationId: 'loc-2',
        location: { clinicId: CLINIC },
      });

      const error = await rejection(desk());

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe('Receptionist is not assigned to this location');
      expectNothingRecorded();
    });

    it('an UNASSIGNED receptionist in a clinic with exactly ONE active location is accepted', async () => {
      const checkIn = await desk();

      expect(checkIn.alreadyCheckedIn).toBeUndefined();
      expect(h.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
    });

    it('an UNASSIGNED receptionist in a clinic with several active locations gets 403 and nothing is recorded', async () => {
      h.db.insert('clinicLocation', {
        id: 'loc-2',
        clinicId: CLINIC,
        isActive: true,
        deletedAt: null,
      });

      const error = await rejection(desk());

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe('Receptionist is not assigned to this location');
      expectNothingRecorded();
    });

    it('inactive and deleted locations do not make the clinic multi-location', async () => {
      h.db.insert('clinicLocation', {
        id: 'loc-closed',
        clinicId: CLINIC,
        isActive: false,
        deletedAt: null,
      });
      h.db.insert('clinicLocation', {
        id: 'loc-gone',
        clinicId: CLINIC,
        isActive: true,
        deletedAt: new Date('2026-01-01T00:00:00Z'),
      });

      const checkIn = await desk();

      expect(checkIn.alreadyCheckedIn).toBeUndefined();
    });

    it('an unassigned receptionist of a clinic with no active location is refused (fail closed)', async () => {
      h.db.rows('clinicLocation')[0]!['isActive'] = false;

      const error = await rejection(desk());

      expect(error).toBeInstanceOf(ForbiddenException);
      expectNothingRecorded();
    });

    it('a receptionist assigned to a location of ANOTHER clinic is not clinic-wide: 403', async () => {
      h.db.insert('receptionist', {
        userId: 'user-reception',
        locationId: 'loc-elsewhere',
        location: { clinicId: OTHER_CLINIC },
      });

      const error = await rejection(desk());

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe('Receptionist is not assigned to this location');
      expectNothingRecorded();
    });

    it('staff of another clinic get 404 (existence is not revealed) and nothing is recorded', async () => {
      const error = await rejection(
        h.service.processCheckIn(checkInInput(), OTHER_CLINIC, {
          actor: receptionist,
          presence: 'skip',
        })
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expectNothingRecorded();
    });

    it('a doctor keeps the existing rules: no coordinates, same clinic', async () => {
      const checkIn = await h.service.processCheckIn(checkInInput(), CLINIC, {
        actor: { userId: 'user-doctor', role: 'DOCTOR' },
        presence: 'skip',
      });

      expect(checkIn.alreadyCheckedIn).toBeUndefined();
    });
  });

  describe('QR / manual code (presence: if-supplied)', () => {
    beforeEach(() => {
      h.db.insert('appointment', appointmentRow());
    });

    it('works without coordinates: the scan is the presence proof', async () => {
      const checkIn = await patientCheckIn();

      expect(checkIn.alreadyCheckedIn).toBeUndefined();
    });

    it('accepts coordinates inside the geofence', async () => {
      const checkIn = await patientCheckIn({ coordinates: northOfClinic(120) });

      expect(checkIn.alreadyCheckedIn).toBeUndefined();
    });

    it('rejects coordinates outside the geofence with 400', async () => {
      const error = await rejection(patientCheckIn({ coordinates: northOfClinic(2000) }));

      expect(error).toBeInstanceOf(BadRequestException);
      expectNothingRecorded();
    });

    it.each([
      ['NaN', { lat: Number.NaN, lng: Number.NaN }],
      ['non-numeric', { lat: 'abc', lng: 'def' }],
      ['out of range', { lat: 999, lng: 999 }],
    ])(
      'rejects %s coordinates instead of treating the geofence as passed',
      async (_label, coordinates) => {
        const error = await rejection(patientCheckIn({ coordinates }));

        expect(error).toBeInstanceOf(BadRequestException);
        expectNothingRecorded();
      }
    );
  });
});

describe('CheckInLocationService check-in location management', () => {
  const baseDto = {
    clinicId: CLINIC,
    locationName: 'Side Door',
    coordinates: { lat: CLINIC_LAT, lng: CLINIC_LNG },
    radius: 50,
  };

  it("links a ClinicLocation of the caller's clinic", async () => {
    const h = build();
    h.db.insert('clinicLocation', { id: 'loc-9', clinicId: CLINIC, deletedAt: null });

    const created = await h.service.createCheckInLocation({ ...baseDto, locationId: 'loc-9' });

    expect(created['locationId']).toBe('loc-9');
  });

  it("refuses to link another clinic's ClinicLocation with 400", async () => {
    const h = build();
    h.db.insert('clinicLocation', { id: 'loc-foreign', clinicId: OTHER_CLINIC, deletedAt: null });

    const error = await rejection(
      h.service.createCheckInLocation({ ...baseDto, locationId: 'loc-foreign' })
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(h.db.rows('checkInLocation')).toHaveLength(1); // only the seeded one
  });

  it('maps a unique-constraint violation to 409', async () => {
    const h = build();
    h.db.insert('clinicLocation', { id: 'loc-9', clinicId: CLINIC, deletedAt: null });
    h.db.executeHealthcareWrite.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed on the fields: (`locationId`)'), {
        code: 'P2002',
      })
    );

    const error = await rejection(
      h.service.createCheckInLocation({ ...baseDto, locationId: 'loc-9' })
    );

    expect(error).toBeInstanceOf(ConflictException);
  });

  it('maps a foreign-key violation to 400, also when the database layer only kept the message', async () => {
    const h = build();
    h.db.insert('clinicLocation', { id: 'loc-9', clinicId: CLINIC, deletedAt: null });
    h.db.executeHealthcareWrite.mockRejectedValueOnce(
      new Error('P2003: Foreign key constraint failed on the field: `locationId`')
    );

    const error = await rejection(
      h.service.createCheckInLocation({ ...baseDto, locationId: 'loc-9' })
    );

    expect(error).toBeInstanceOf(BadRequestException);
  });

  it("does not modify another clinic's check-in location (404 before any write)", async () => {
    const h = build();

    const error = await rejection(
      h.service.updateCheckInLocation('cil-1', { radius: 5 }, OTHER_CLINIC)
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(h.db.writes).toHaveLength(0);
    expect(h.db.rows('checkInLocation')[0]?.['radius']).toBe(300);
  });
});
