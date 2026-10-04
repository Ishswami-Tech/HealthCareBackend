/**
 * The 200 m rule must fail closed: float error (NaN) never passes it, and the stored geofence
 * centre is read from both coordinate shapes that exist in the database.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));

import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import {
  OUTSIDE_CLINIC_RADIUS_CODE,
  OUTSIDE_CLINIC_RADIUS_MESSAGE,
  haversineDistanceMeters,
  isWithinRadiusMeters,
  parseStoredGeofenceCenter,
} from '@services/appointments/core/check-in-presence.util';
import type { ProcessCheckInOptions } from '@core/types/appointment.types';
import {
  CLINIC_LAT,
  CLINIC_LNG,
  PATIENT_ACTOR,
  buildCheckInServiceWorld,
  checkInInput,
  inPersonRow,
  northOfClinic,
  type CheckInServiceWorld,
} from './check-in-service-world';
import { pinClock, unpinClock } from './check-in-time-helpers';

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(HttpException);
  return error as HttpException;
}

const PUNE = { lat: 18.5204, lng: 73.8567 };
/** Exact antipode of PUNE, nudged so the haversine term lands at 1.0000000000000002. */
const PUNE_ANTIPODE = { lat: -18.520400183, lng: -106.1433002 };

describe('haversineDistanceMeters / isWithinRadiusMeters (NaN safety)', () => {
  it('the antipodal point of the reported reproduction used to give NaN; it is now a finite ~20,000 km', () => {
    const distance = haversineDistanceMeters(PUNE, PUNE_ANTIPODE);

    expect(Number.isNaN(distance)).toBe(false);
    expect(Number.isFinite(distance)).toBe(true);
    expect(distance).toBeGreaterThan(20_000_000);
    expect(distance).toBeLessThan(20_100_000);
  });

  it('the old comparison would have let NaN through, the fail-closed one does not', () => {
    expect(Number.NaN > 200).toBe(false); // `if (distance > allowed) throw` did NOT throw for NaN
    expect(isWithinRadiusMeters(Number.NaN, 200)).toBe(false);
  });

  it.each([
    ['NaN distance', Number.NaN, 200],
    ['Infinity distance', Number.POSITIVE_INFINITY, 200],
    ['negative-Infinity distance', Number.NEGATIVE_INFINITY, 200],
    ['NaN radius', 10, Number.NaN],
    ['Infinity radius', 10, Number.POSITIVE_INFINITY],
    ['distance over the radius', 200.0001, 200],
  ])('is outside for %s', (_label, distance, radius) => {
    expect(isWithinRadiusMeters(distance, radius)).toBe(false);
  });

  it.each([
    [0, 200],
    [199.999, 200],
    [200, 200],
  ])('is inside for distance %s with radius %s', (distance, radius) => {
    expect(isWithinRadiusMeters(distance, radius)).toBe(true);
  });

  it('stays finite and non-negative for random near-antipodal pairs', () => {
    for (let index = 0; index < 500; index++) {
      const lat = (Math.random() * 180 - 90) * 0.999999;
      const lng = Math.random() * 360 - 180;
      const from = { lat, lng };
      const to = {
        lat: -lat + (Math.random() - 0.5) * 1e-6,
        lng: lng > 0 ? lng - 180 : lng + 180,
      };
      const distance = haversineDistanceMeters(from, to);
      expect(Number.isFinite(distance)).toBe(true);
      expect(distance).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('parseStoredGeofenceCenter', () => {
  it.each([
    ['lat / lng numbers', { lat: 18.5204, lng: 73.8567 }],
    ['latitude / longitude numbers (seeded rows)', { latitude: 18.5204, longitude: 73.8567 }],
    ['lat / lng numeric strings', { lat: '18.5204', lng: ' 73.8567 ' }],
    ['latitude / longitude numeric strings', { latitude: '18.5204', longitude: '73.8567' }],
  ])('reads %s', (_label, value) => {
    expect(parseStoredGeofenceCenter(value)).toEqual({ lat: 18.5204, lng: 73.8567 });
  });

  it.each([
    ['null', null],
    ['a string', '18.5204,73.8567'],
    ['an array', [18.5204, 73.8567]],
    ['missing longitude', { latitude: 18.5204 }],
    ['non-numeric text', { latitude: 'north', longitude: 'east' }],
    ['hex strings', { lat: '0x10', lng: '0x20' }],
    ['exponent strings', { lat: '1e1', lng: '2e1' }],
    ['empty strings', { lat: '', lng: '' }],
    ['NaN', { lat: Number.NaN, lng: 73 }],
    ['Infinity', { lat: 18, lng: Number.POSITIVE_INFINITY }],
    ['out-of-range latitude', { latitude: 91, longitude: 73 }],
    ['out-of-range longitude', { latitude: 18, longitude: -181 }],
    ['a bad lat that hides behind a good latitude', { lat: 'x', latitude: 18.5204, lng: 73.8567 }],
  ])('rejects %s', (_label, value) => {
    expect(parseStoredGeofenceCenter(value)).toBeNull();
  });
});

describe('force check-in presence through CheckInLocationService', () => {
  let w: CheckInServiceWorld;

  beforeEach(() => {
    pinClock();
  });

  afterEach(() => {
    unpinClock();
  });

  const force = (coordinates: unknown) =>
    w.service.processCheckIn(checkInInput({ coordinates }), 'clinic-1', {
      actor: PATIENT_ACTOR,
      presence: 'required',
    } as ProcessCheckInOptions);

  function expectOutside(error: HttpException): void {
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      code: OUTSIDE_CLINIC_RADIUS_CODE,
      message: OUTSIDE_CLINIC_RADIUS_MESSAGE,
    });
    expect(w.db.rows('checkIn')).toHaveLength(0);
    expect(w.queue.checkIn).not.toHaveBeenCalled();
    expect(w.db.rows('appointment')[0]?.['status']).toBe('SCHEDULED');
  }

  describe('antipodal / NaN reproduction (clinic at 18.5204, 73.8567)', () => {
    beforeEach(() => {
      w = buildCheckInServiceWorld({ geofenceCoordinates: PUNE });
      w.db.insert('appointment', inPersonRow());
    });

    it('the antipodal point is refused with the fixed 403 (it used to pass as NaN)', async () => {
      expectOutside(await rejection(force(PUNE_ANTIPODE)));
    });

    it('the clinic position itself is still accepted', async () => {
      const checkIn = await force(PUNE);

      expect(checkIn.alreadyCheckedIn).toBeUndefined();
      expect(w.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
    });

    it('a QR scan that sends the antipodal point is refused too (400, outside the geofence)', async () => {
      const error = await rejection(
        w.service.processCheckIn(checkInInput({ coordinates: PUNE_ANTIPODE }), 'clinic-1', {
          actor: PATIENT_ACTOR,
          presence: 'if-supplied',
        })
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(w.db.rows('checkIn')).toHaveLength(0);
    });
  });

  describe.each([
    ['{ lat, lng }', { lat: CLINIC_LAT, lng: CLINIC_LNG }],
    ['{ latitude, longitude }', { latitude: CLINIC_LAT, longitude: CLINIC_LNG }],
    [
      '{ latitude, longitude } as strings',
      { latitude: String(CLINIC_LAT), longitude: String(CLINIC_LNG) },
    ],
  ])('geofence stored as %s', (_label, stored) => {
    beforeEach(() => {
      w = buildCheckInServiceWorld({ geofenceCoordinates: stored });
      w.db.insert('appointment', inPersonRow());
    });

    it('a patient standing on the clinic checks in (0 m, not a 403)', async () => {
      const checkIn = await force({ lat: CLINIC_LAT, lng: CLINIC_LNG });

      expect(checkIn.alreadyCheckedIn).toBeUndefined();
      expect(w.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
      expect(w.queue.checkIn).toHaveBeenCalledTimes(1);
    });

    it('199 m is accepted, 250 m is refused', async () => {
      expectOutside(await rejection(force(northOfClinic(250))));
      const ok = await force(northOfClinic(199));
      expect(ok.alreadyCheckedIn).toBeUndefined();
    });
  });

  describe.each([
    ['a non-object', 'somewhere'],
    ['null', null],
    ['an array', [CLINIC_LAT, CLINIC_LNG]],
    ['one coordinate only', { latitude: CLINIC_LAT }],
    ['non-numeric values', { latitude: 'north', longitude: 'east' }],
    ['out-of-range values', { latitude: 200, longitude: 400 }],
  ])('malformed stored geofence (%s)', (_label, stored) => {
    beforeEach(() => {
      w = buildCheckInServiceWorld({ geofenceCoordinates: stored });
      w.db.insert('appointment', inPersonRow());
    });

    it('fails closed for a force check-in, even at the clinic position', async () => {
      expectOutside(await rejection(force({ lat: CLINIC_LAT, lng: CLINIC_LNG })));
    });
  });
});

describe('cached check-in locations (CacheService.get returns parsed values)', () => {
  let w: CheckInServiceWorld;

  beforeEach(() => {
    w = buildCheckInServiceWorld();
  });

  const cachedLocation = {
    id: 'cil-cached',
    clinicId: 'clinic-1',
    locationId: 'loc-1',
    locationName: 'From cache',
    isActive: true,
    qrCode: 'CHK-CACHED',
  };

  function parseWarnings(): unknown[] {
    return w.logging.log.mock.calls.filter(call => String(call[2]).includes('Failed to parse'));
  }

  it('an already-parsed object is used as is, with no parse warning (QR lookup)', async () => {
    w.cache.get.mockResolvedValueOnce(cachedLocation as never);

    const location = await w.service.getLocationByQRCode('CHK-CACHED', 'clinic-1');

    expect(location).toEqual(cachedLocation);
    expect(parseWarnings()).toHaveLength(0);
  });

  it('the stored JSON string still works', async () => {
    w.cache.get.mockResolvedValueOnce(JSON.stringify(cachedLocation) as never);

    const location = await w.service.getLocationByQRCode('CHK-CACHED', 'clinic-1');

    expect(location).toEqual(cachedLocation);
    expect(parseWarnings()).toHaveLength(0);
  });

  it('a cached object of another clinic is ignored and the database answers', async () => {
    w.cache.get.mockResolvedValueOnce({ ...cachedLocation, clinicId: 'clinic-2' } as never);

    const location = await w.service.getLocationByQRCode('CHK-MAIN', 'clinic-1');

    expect(location.id).toBe('cil-1');
  });

  it('a string that is not JSON logs one warning and falls back to the database', async () => {
    w.cache.get.mockResolvedValueOnce('not json {' as never);

    const location = await w.service.getLocationByQRCode('CHK-MAIN', 'clinic-1');

    expect(location.id).toBe('cil-1');
    expect(parseWarnings()).toHaveLength(1);
  });

  it('an already-parsed object is used for the lookup by id too', async () => {
    w.cache.get.mockResolvedValueOnce(cachedLocation as never);

    const location = await w.service.getLocationById('cil-cached', 'clinic-1');

    expect(location).toEqual(cachedLocation);
    expect(parseWarnings()).toHaveLength(0);
  });

  it('an already-parsed array is used for the clinic location list', async () => {
    w.cache.get.mockResolvedValueOnce([cachedLocation] as never);

    const locations = await w.service.getClinicLocations('clinic-1');

    expect(locations).toEqual([cachedLocation]);
    expect(parseWarnings()).toHaveLength(0);
  });
});
