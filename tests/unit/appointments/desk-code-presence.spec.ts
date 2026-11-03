/**
 * Typed desk code = mandatory location verification (LOCATION_REQUIRED / TOO_FAR, with the capped
 * GPS accuracy allowance); the signed poster scan keeps 'if-supplied'; reception is unaffected.
 * Plus the cross-midnight check-in window (23:45 slot at 00:10, 00:10 slot at 23:55).
 */
import { describe, it, expect, jest } from '@jest/globals';
import {
  DESK_CODE_LOCATION_REQUIRED_MESSAGE,
  DESK_CODE_MAX_ACCURACY_ALLOWANCE_METERS,
  POSTER_LOCATION_REQUIRED_MESSAGE,
  assessDeskCodePresence,
  deskCodeTooFarMessage,
  formatApproxDistance,
  parseDeviceFix,
} from '@services/appointments/core/desk-code-presence.util';
import { isBoundedDeviceInfo } from '@services/appointments/in-person/in-person.dto';
import {
  InPersonCheckInError,
  InPersonCheckInService,
} from '@services/appointments/in-person/in-person-check-in.service';
import type { InPersonAppointmentRow } from '@services/appointments/in-person/in-person-visit.service';
import {
  evaluateQrScan,
  isBookingInCheckInScope,
  isCheckInWindowOpen,
} from '@utils/in-person-flow.util';
import { formatDateKeyInIST } from '@utils/date-time.util';
import { opdControlsDatabase } from './in-person-check-in-world';

// The local test location (CheckInLocation be79acc7-...): seeded { latitude, longitude }, 500 m.
const CENTRE = { latitude: 18.5696256, longitude: 73.8852864 };
const RADIUS = 500;
const GEOFENCE = { coordinates: CENTRE, radius: RADIUS };
/** ~111.2 m per 0.001 degree of latitude. */
const north = (meters: number): { lat: number; lng: number } => ({
  lat: CENTRE.latitude + meters / 111_195,
  lng: CENTRE.longitude,
});

describe('parseDeviceFix', () => {
  it('accepts { lat, lng } and { latitude, longitude } with an optional accuracy', () => {
    expect(parseDeviceFix({ lat: 18.5, lng: 73.8 })).toEqual({ lat: 18.5, lng: 73.8 });
    expect(parseDeviceFix({ latitude: 18.5, longitude: 73.8, accuracy: 25 })).toEqual({
      lat: 18.5,
      lng: 73.8,
      accuracy: 25,
    });
  });

  it('rejects missing, string, NaN and out-of-range positions; drops a bad accuracy', () => {
    expect(parseDeviceFix(undefined)).toBeNull();
    expect(parseDeviceFix({})).toBeNull();
    expect(parseDeviceFix({ lat: '18.5', lng: '73.8' })).toBeNull();
    expect(parseDeviceFix({ lat: Number.NaN, lng: 73.8 })).toBeNull();
    expect(parseDeviceFix({ lat: 91, lng: 73.8 })).toBeNull();
    expect(parseDeviceFix({ lat: 18.5, lng: 181 })).toBeNull();
    expect(parseDeviceFix({ lat: 18.5, lng: 73.8, accuracy: -5 })).toEqual({
      lat: 18.5,
      lng: 73.8,
    });
  });
});

describe('assessDeskCodePresence', () => {
  it('LOCATION_REQUIRED without (usable) coordinates', () => {
    expect(assessDeskCodePresence(undefined, GEOFENCE)).toEqual({
      ok: false,
      code: 'LOCATION_REQUIRED',
    });
    expect(assessDeskCodePresence({ accuracy: 10 }, GEOFENCE)).toEqual({
      ok: false,
      code: 'LOCATION_REQUIRED',
    });
  });

  it('accepts a position within the radius', () => {
    const decision = assessDeskCodePresence(north(300), GEOFENCE);
    expect(decision.ok).toBe(true);
    expect(decision).toMatchObject({ unverifiable: false });
  });

  it('TOO_FAR outside the radius, with the distance', () => {
    const decision = assessDeskCodePresence(north(1200), GEOFENCE);
    expect(decision).toMatchObject({ ok: false, code: 'TOO_FAR' });
    if (decision.ok || decision.code !== 'TOO_FAR') throw new Error('expected TOO_FAR');
    expect(Math.round(decision.distanceMeters)).toBeGreaterThan(1190);
    expect(deskCodeTooFarMessage(decision.distanceMeters)).toBe(
      'You are about 1.2 km from the clinic. Check in when you reach the clinic, or ask the reception desk to check you in.'
    );
  });

  it('accuracy allowance: distance - accuracy <= radius passes, a smaller accuracy does not', () => {
    expect(assessDeskCodePresence({ ...north(600), accuracy: 150 }, GEOFENCE).ok).toBe(true);
    expect(assessDeskCodePresence({ ...north(600), accuracy: 50 }, GEOFENCE)).toMatchObject({
      ok: false,
      code: 'TOO_FAR',
    });
  });

  it(`caps the allowance at ${DESK_CODE_MAX_ACCURACY_ALLOWANCE_METERS} m`, () => {
    // 2 km away with a 5 km "accuracy": only 1000 m is allowed -> 1000 m > 500 m radius.
    expect(assessDeskCodePresence({ ...north(2000), accuracy: 5000 }, GEOFENCE)).toMatchObject({
      ok: false,
      code: 'TOO_FAR',
    });
    expect(assessDeskCodePresence({ ...north(1400), accuracy: 5000 }, GEOFENCE).ok).toBe(true);
  });

  it('a location without a usable geofence is accepted but flagged unverifiable', () => {
    expect(assessDeskCodePresence(north(5000), { coordinates: null, radius: 500 })).toEqual({
      ok: true,
      distanceMeters: null,
      unverifiable: true,
    });
    expect(assessDeskCodePresence(north(5000), { coordinates: CENTRE, radius: 0 })).toMatchObject({
      ok: true,
      unverifiable: true,
    });
  });

  it('formats distances for the patient', () => {
    expect(formatApproxDistance(648)).toBe('about 650 m');
    expect(formatApproxDistance(1234)).toBe('about 1.2 km');
    expect(formatApproxDistance(15_400)).toBe('about 15 km');
  });
});

describe('isBoundedDeviceInfo (DTO cap)', () => {
  it('accepts small records and rejects too many keys / too many bytes / non-objects', () => {
    expect(isBoundedDeviceInfo({ platform: 'web', userAgent: 'Mozilla/5.0' })).toBe(true);
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i]));
    expect(isBoundedDeviceInfo(many)).toBe(false);
    expect(isBoundedDeviceInfo({ blob: 'x'.repeat(3000) })).toBe(false);
    expect(isBoundedDeviceInfo([1, 2])).toBe(false);
    expect(isBoundedDeviceInfo('web')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Service: typed desk code vs signed poster vs reception
// ---------------------------------------------------------------------------------------------

const CLINIC = 'clinic-1';
const LOC = 'loc-a';
const PATIENT = { userId: 'user-1', role: 'PATIENT' };
const RECEPTION = { userId: 'rec-1', role: 'RECEPTIONIST' };
const POSTER = JSON.stringify({ type: 'LOCATION_CHECK_IN', locationId: 'qr-a', v: 1, sig: 'x' });

function slotAround(now: Date, minutesFromNow: number): { date: Date; time: string } {
  const start = new Date(now.getTime() + minutesFromNow * 60_000);
  const ist = new Date(start.getTime() + 330 * 60_000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return { date: new Date(`${formatDateKeyInIST(start)}T00:00:00.000Z`), time: `${hh}:${mm}` };
}

function booking(): InPersonAppointmentRow {
  return {
    id: 'apt-1',
    clinicId: CLINIC,
    patientId: 'pat-1',
    doctorId: 'doc-1',
    userId: 'user-1',
    familyMemberId: null,
    locationId: LOC,
    type: 'IN_PERSON',
    status: 'SCHEDULED',
    ...slotAround(new Date(), 5),
    duration: 30,
    priority: 'NORMAL',
    checkedInAt: null,
    startedAt: null,
    completedAt: null,
    patient: { user: { name: 'Asha Patil', firstName: null, lastName: null } },
    doctor: { user: { name: 'Dr. Deshmukh', firstName: null, lastName: null } },
    location: { name: 'Main clinic' },
  } as InPersonAppointmentRow;
}

function build(opdControls: Record<string, unknown> = {}) {
  const rows = [booking()];
  const location = {
    id: 'qr-a',
    clinicId: CLINIC,
    locationId: LOC,
    locationName: 'Main clinic',
    qrCode: 'CHK-MAIN-CLINIC-TEST',
    qrVersion: 1,
    isActive: true,
    coordinates: CENTRE,
    radius: RADIUS,
  };
  const checkInLocations = {
    getLocationById: jest.fn(async () => location),
    getLocationByQRCode: jest.fn(async () => location),
    processCheckIn: jest.fn(async (_data: unknown, _clinicId: string, _options: unknown) => ({
      id: 'ci-1',
      alreadyCheckedIn: false,
    })),
  };
  const visits = {
    findPatientBookingsToday: jest.fn(async () => rows),
    loadForActor: jest.fn(async () => rows[0]),
    toVisits: jest.fn(async (list: InPersonAppointmentRow[]) =>
      list.map(r => ({ appointmentId: r.id, patientName: 'Asha Patil', token: 'K-014' }))
    ),
  };
  const checkInLog = { recordAttempt: jest.fn(async (_attempt: unknown) => undefined) };
  const service = new InPersonCheckInService(
    checkInLocations as never,
    visits as never,
    { inspectLocationQR: jest.fn(() => 'VALID') } as never,
    { emit: jest.fn(async () => undefined) } as never,
    { log: jest.fn(async () => undefined) } as never,
    opdControlsDatabase(opdControls) as never,
    checkInLog as never
  );
  return { service, checkInLocations, checkInLog };
}

describe('InPersonCheckInService - typed desk code needs the device position', () => {
  it('no coordinates -> 400 LOCATION_REQUIRED, logged, nothing written', async () => {
    const world = build();
    const error = await world.service
      .checkIn({ qrCode: 'CHK-MAIN-CLINIC-TEST' }, CLINIC, PATIENT)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InPersonCheckInError);
    expect((error as InPersonCheckInError).getStatus()).toBe(400);
    expect((error as InPersonCheckInError).getResponse()).toMatchObject({
      code: 'LOCATION_REQUIRED',
      message: DESK_CODE_LOCATION_REQUIRED_MESSAGE,
    });
    expect(world.checkInLocations.processCheckIn).not.toHaveBeenCalled();
    expect(world.checkInLog.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'FAILED',
        failureReason: 'LOCATION_REQUIRED',
        appointmentId: 'apt-1',
      })
    );
  });

  it('far away -> 403 TOO_FAR with the distance, logged', async () => {
    const world = build();
    const error = await world.service
      .checkIn({ qrCode: 'CHK-MAIN-CLINIC-TEST', coordinates: north(1200) }, CLINIC, PATIENT)
      .catch((e: unknown) => e);
    expect((error as InPersonCheckInError).getStatus()).toBe(403);
    expect((error as InPersonCheckInError).getResponse()).toMatchObject({
      code: 'TOO_FAR',
      message:
        'You are about 1.2 km from the clinic. Check in when you reach the clinic, or ask the reception desk to check you in.',
    });
    expect(world.checkInLocations.processCheckIn).not.toHaveBeenCalled();
    expect(world.checkInLog.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'FAILED', failureReason: 'TOO_FAR' })
    );
  });

  it('within the radius -> checked in; the position is stored, presence already verified', async () => {
    const world = build();
    const result = await world.service.checkIn(
      { qrCode: 'CHK-MAIN-CLINIC-TEST', coordinates: { ...north(200), accuracy: 12 } },
      CLINIC,
      PATIENT
    );
    expect(result).toMatchObject({ result: 'CHECKED_IN', alreadyCheckedIn: false });
    expect(world.checkInLocations.processCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: 'apt-1',
        coordinates: expect.objectContaining({ accuracy: 12 }),
      }),
      CLINIC,
      { actor: PATIENT, presence: 'skip' }
    );
  });

  it('a coarse fix just outside is accepted thanks to its accuracy', async () => {
    const world = build();
    await expect(
      world.service.checkIn(
        { qrCode: 'CHK-MAIN-CLINIC-TEST', coordinates: { ...north(600), accuracy: 150 } },
        CLINIC,
        PATIENT
      )
    ).resolves.toMatchObject({ result: 'CHECKED_IN' });
  });

  it('signed poster scan without coordinates is refused by default (LOCATION_REQUIRED, poster message)', async () => {
    // df4f03ed: opdControls.requireLocationForQrCheckIn defaults to on.
    const world = build();
    const error = await world.service
      .checkIn({ qrCode: POSTER }, CLINIC, PATIENT)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InPersonCheckInError);
    expect((error as InPersonCheckInError).getStatus()).toBe(400);
    expect((error as InPersonCheckInError).getResponse()).toMatchObject({
      code: 'LOCATION_REQUIRED',
      message: POSTER_LOCATION_REQUIRED_MESSAGE,
    });
    expect(world.checkInLocations.processCheckIn).not.toHaveBeenCalled();
  });

  it('signed poster scan inside the radius is checked in, presence verified here (skip)', async () => {
    const world = build();
    await expect(
      world.service.checkIn({ qrCode: POSTER, coordinates: north(100) }, CLINIC, PATIENT)
    ).resolves.toMatchObject({ result: 'CHECKED_IN' });
    expect(world.checkInLocations.processCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ coordinates: expect.anything() }),
      CLINIC,
      { actor: PATIENT, presence: 'skip' }
    );
  });

  it('signed poster scan with the clinic requirement off: no coordinates needed, presence stays if-supplied', async () => {
    const world = build({ requireLocationForQrCheckIn: false });
    await expect(world.service.checkIn({ qrCode: POSTER }, CLINIC, PATIENT)).resolves.toMatchObject(
      { result: 'CHECKED_IN' }
    );
    expect(world.checkInLocations.processCheckIn).toHaveBeenCalledWith(
      expect.not.objectContaining({ coordinates: expect.anything() }),
      CLINIC,
      { actor: PATIENT, presence: 'if-supplied' }
    );
  });

  it('reception one-click check-in never needs a position', async () => {
    const world = build();
    await expect(
      world.service.checkIn({ appointmentId: 'apt-1' }, CLINIC, RECEPTION)
    ).resolves.toMatchObject({ result: 'CHECKED_IN' });
    expect(world.checkInLocations.processCheckIn).toHaveBeenCalledWith(expect.any(Object), CLINIC, {
      actor: RECEPTION,
      presence: 'skip',
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Check-in window across midnight (IST = UTC+05:30)
// ---------------------------------------------------------------------------------------------

describe('check-in window across midnight', () => {
  // 23:45 IST on 21 Oct (window 23:25 .. 00:30), checked in at 00:10 IST on 22 Oct.
  const lateSlot = {
    status: 'SCHEDULED',
    type: 'IN_PERSON',
    date: '2026-10-21T00:00:00.000Z',
    time: '23:45',
    locationId: LOC,
  };
  const at0010 = new Date('2026-10-21T18:40:00.000Z');
  // 00:10 IST on 22 Oct (window 23:50 .. 00:55), checked in at 23:55 IST on 21 Oct.
  const earlySlot = { ...lateSlot, date: '2026-10-22T00:00:00.000Z', time: '00:10' };
  const at2355 = new Date('2026-10-21T18:25:00.000Z');

  it('a 23:45 slot is still in scope and may be checked in at 00:10 the next day', () => {
    expect(isCheckInWindowOpen(lateSlot, at0010)).toBe(true);
    expect(isBookingInCheckInScope(lateSlot, at0010)).toBe(true);
    expect(evaluateQrScan(lateSlot, [LOC], at0010)).toEqual({ ok: true, alreadyCheckedIn: false });
  });

  it('a 00:10 slot is in scope and may be checked in at 23:55 the day before', () => {
    expect(isCheckInWindowOpen(earlySlot, at2355)).toBe(true);
    expect(isBookingInCheckInScope(earlySlot, at2355)).toBe(true);
    expect(evaluateQrScan(earlySlot, [LOC], at2355)).toEqual({ ok: true, alreadyCheckedIn: false });
  });

  it('outside the window an adjacent-day slot is out of scope and refused', () => {
    const at0031 = new Date('2026-10-21T19:01:00.000Z');
    expect(isBookingInCheckInScope(lateSlot, at0031)).toBe(false);
    expect(evaluateQrScan(lateSlot, [LOC], at0031)).toMatchObject({ ok: false, reason: 'EXPIRED' });
    const at2349 = new Date('2026-10-21T18:19:00.000Z');
    expect(isBookingInCheckInScope(earlySlot, at2349)).toBe(false);
    expect(evaluateQrScan(earlySlot, [LOC], at2349)).toMatchObject({
      ok: false,
      reason: 'TOO_EARLY',
    });
  });

  it("today's slots stay in scope all day (the list still shows them)", () => {
    const morning = { ...lateSlot, time: '09:00' };
    expect(isBookingInCheckInScope(morning, new Date('2026-10-21T15:00:00.000Z'))).toBe(true);
  });
});
