import { describe, it, expect } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import {
  FORCE_CHECK_IN_MAX_DISTANCE_METERS,
  OUTSIDE_CLINIC_RADIUS_CODE,
  OUTSIDE_CLINIC_RADIUS_MESSAGE,
  createOutsideClinicRadiusException,
  haversineDistanceMeters,
  parseGeoCoordinates,
  resolveForceCheckInRadiusMeters,
} from '@services/appointments/core/check-in-presence.util';

describe('parseGeoCoordinates', () => {
  it('accepts finite in-range numbers', () => {
    expect(parseGeoCoordinates({ lat: 19.076, lng: 72.8777 })).toEqual({
      lat: 19.076,
      lng: 72.8777,
    });
    expect(parseGeoCoordinates({ lat: -90, lng: 180 })).toEqual({ lat: -90, lng: 180 });
    expect(parseGeoCoordinates({ lat: 0, lng: 0 })).toEqual({ lat: 0, lng: 0 });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'abc'],
    ['an array', [19, 72]],
    ['NaN', { lat: Number.NaN, lng: 72 }],
    ['Infinity', { lat: 19, lng: Number.NEGATIVE_INFINITY }],
    ['strings', { lat: '19.07', lng: '72.87' }],
    ['missing lng', { lat: 19 }],
    ['lat out of range', { lat: 90.0001, lng: 0 }],
    ['lng out of range', { lat: 0, lng: -180.5 }],
  ])('rejects %s', (_label, value) => {
    expect(parseGeoCoordinates(value)).toBeNull();
  });
});

describe('haversineDistanceMeters', () => {
  it('is zero for the same point and symmetric', () => {
    const a = { lat: 19.076, lng: 72.8777 };
    const b = { lat: 19.0778, lng: 72.8777 };
    expect(haversineDistanceMeters(a, a)).toBe(0);
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });

  it('measures about 111 km per degree of latitude', () => {
    const distance = haversineDistanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(distance).toBeGreaterThan(111_000);
    expect(distance).toBeLessThan(111_400);
  });
});

describe('resolveForceCheckInRadiusMeters', () => {
  it('never exceeds the cap and honours a smaller geofence', () => {
    expect(resolveForceCheckInRadiusMeters(5000)).toBe(FORCE_CHECK_IN_MAX_DISTANCE_METERS);
    expect(resolveForceCheckInRadiusMeters(100)).toBe(100);
    expect(resolveForceCheckInRadiusMeters(200)).toBe(200);
  });

  it('falls back to the cap for a missing or unusable radius', () => {
    for (const radius of [undefined, null, 0, -5, Number.NaN, 'wide']) {
      expect(resolveForceCheckInRadiusMeters(radius)).toBe(FORCE_CHECK_IN_MAX_DISTANCE_METERS);
    }
  });
});

describe('createOutsideClinicRadiusException', () => {
  it('is a 403 with the fixed message and stable code, and nothing else', () => {
    const error = createOutsideClinicRadiusException();

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      code: OUTSIDE_CLINIC_RADIUS_CODE,
      message:
        'Please scan the QR code at the clinic location. You need to be within 200 meters of the clinic to check in.',
    });
    expect(OUTSIDE_CLINIC_RADIUS_MESSAGE).toBe(
      (error.getResponse() as { message: string }).message
    );
  });
});
