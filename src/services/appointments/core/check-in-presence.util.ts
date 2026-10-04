import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { isSameIstDay } from '@utils/clock.util';
import { parseIstDateTime } from '@utils/date-time.util';

/**
 * Presence ("is the patient physically at the clinic") helpers shared by every check-in path.
 *
 * A PATIENT force check-in has no QR scan to prove presence, so the server verifies the
 * coordinates the device reports against the appointment's own clinic location instead.
 */

/** A PATIENT may force check in only within this distance of the clinic location. */
export const FORCE_CHECK_IN_MAX_DISTANCE_METERS = 200;

/** Stable machine-readable code returned in the body of the presence rejection. */
export const OUTSIDE_CLINIC_RADIUS_CODE = 'OUTSIDE_CLINIC_RADIUS';

/**
 * The single user-facing message for every presence failure (coordinates missing, invalid or
 * too far). One message on purpose, so the rule cannot be probed one failure mode at a time.
 */
export const OUTSIDE_CLINIC_RADIUS_MESSAGE = `Please scan the QR code at the clinic location. You need to be within ${FORCE_CHECK_IN_MAX_DISTANCE_METERS} meters of the clinic to check in.`;

export interface GeoCoordinates {
  readonly lat: number;
  readonly lng: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Narrow untrusted input to valid WGS84 coordinates.
 * Anything that is not an object with finite numeric lat in [-90, 90] and lng in [-180, 180]
 * (strings, NaN, Infinity, missing or out-of-range values) returns null.
 */
export function parseGeoCoordinates(value: unknown): GeoCoordinates | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as { lat?: unknown; lng?: unknown };
  const { lat, lng } = candidate;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}

const NUMERIC_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

/** A finite number, or a plain decimal string ("18.5204"), else null (no hex / exponent forms). */
function toFiniteCoordinate(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && NUMERIC_STRING_PATTERN.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * The centre of a stored check-in location geofence (CheckInLocation.coordinates, a JSON column).
 *
 * The API writes `{ lat, lng }`, but seeded and legacy rows hold `{ latitude, longitude }`, and
 * values may be numeric strings. Both shapes normalise to the same point. Anything else (missing
 * keys, non-numeric values, out-of-range values, a non-object) returns null, so the caller
 * fails closed. Only stored data goes through this lenient reader: a position a patient sends
 * must still be real numbers (`parseGeoCoordinates`).
 */
export function parseStoredGeofenceCenter(value: unknown): GeoCoordinates | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const lat = toFiniteCoordinate(record['lat'] ?? record['latitude']);
  const lng = toFiniteCoordinate(record['lng'] ?? record['longitude']);
  if (lat === null || lng === null) {
    return null;
  }
  return parseGeoCoordinates({ lat, lng });
}

/**
 * Great-circle distance between two coordinates in meters (haversine).
 *
 * The haversine term can exceed 1 by a few ULPs for (near-)antipodal points, which made
 * `sqrt(1 - a)` NaN and let such a point slip through a plain `distance > radius` comparison.
 * The term is therefore clamped to [0, 1]. A non-finite input still yields NaN, so callers must
 * judge the result with `isWithinRadiusMeters`, never with `distance > radius`.
 */
export function haversineDistanceMeters(from: GeoCoordinates, to: GeoCoordinates): number {
  const phi1 = (from.lat * Math.PI) / 180;
  const phi2 = (to.lat * Math.PI) / 180;
  const deltaPhi = ((to.lat - from.lat) * Math.PI) / 180;
  const deltaLambda = ((to.lng - from.lng) * Math.PI) / 180;

  const rawTerm =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const term = Math.min(1, Math.max(0, rawTerm));
  const c = 2 * Math.atan2(Math.sqrt(term), Math.sqrt(1 - term));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Fail-closed radius test: only a finite distance that is at most the finite radius passes.
 * NaN / Infinity (from bad input or float error) are outside, unlike `!(distance > radius)`.
 */
export function isWithinRadiusMeters(distanceMeters: number, radiusMeters: number): boolean {
  return (
    Number.isFinite(distanceMeters) &&
    Number.isFinite(radiusMeters) &&
    distanceMeters <= radiusMeters
  );
}

/**
 * Radius a PATIENT force check-in is allowed: the location's own geofence radius when it is
 * smaller than the global cap, never more than the cap.
 */
export function resolveForceCheckInRadiusMeters(configuredRadius: unknown): number {
  if (isFiniteNumber(configuredRadius) && configuredRadius > 0) {
    return Math.min(configuredRadius, FORCE_CHECK_IN_MAX_DISTANCE_METERS);
  }
  return FORCE_CHECK_IN_MAX_DISTANCE_METERS;
}

/** 403 with the fixed message and code. Never carries the distance or the clinic coordinates. */
export function createOutsideClinicRadiusException(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    code: OUTSIDE_CLINIC_RADIUS_CODE,
    message: OUTSIDE_CLINIC_RADIUS_MESSAGE,
  });
}

// ---------------------------------------------------------------------------------------------
// Check-in timing (same rule for every entry point)
// ---------------------------------------------------------------------------------------------

/** Check-in opens this long before the appointment time. */
export const CHECK_IN_WINDOW_BEFORE_MINUTES = 30;

/** Check-in closes this long after the appointment time. */
export const CHECK_IN_WINDOW_AFTER_MINUTES = 180;

const MS_PER_MINUTE = 60_000;

/** Same code the scan-qr controller already answers when the window is closed. */
export const CHECK_IN_WINDOW_CLOSED_CODE = 'CHECKIN_TIME_WINDOW_EXPIRED';

export const CHECK_IN_WINDOW_CLOSED_MESSAGE = `Check-in is only available from ${CHECK_IN_WINDOW_BEFORE_MINUTES} minutes before until ${CHECK_IN_WINDOW_AFTER_MINUTES / 60} hours after the appointment time.`;

export const CHECK_IN_NOT_TODAY_CODE = 'CHECKIN_NOT_TODAY';

export const CHECK_IN_NOT_TODAY_MESSAGE =
  'This appointment is not scheduled for today, so it cannot be checked in. Check-in is only possible on the day of the appointment.';

export const CHECK_IN_TIME_UNKNOWN_MESSAGE = 'Unable to determine appointment time';

export interface CheckInTimingAssessment {
  /** The appointment start as an instant (its IST calendar day + IST wall-clock time). */
  readonly appointmentAt: Date;
  /** The appointment is on the same IST calendar day as `now` (the live queue is keyed by it). */
  readonly isSameIstDay: boolean;
  /** `now` is inside [appointment - 30 min, appointment + 3 h]. */
  readonly isWithinWindow: boolean;
}

/**
 * Where `now` stands relative to an appointment slot. `time` is an IST wall-clock string
 * ("15:40"); it is combined with the appointment's IST calendar day, never with the server's
 * local timezone. Returns null when the slot cannot be determined (callers must fail closed).
 */
export function assessCheckInTiming(
  date: Date | string | null | undefined,
  time: string | null | undefined,
  now: Date = new Date()
): CheckInTimingAssessment | null {
  if (!date || typeof time !== 'string' || time.trim().length === 0) {
    return null;
  }
  const appointmentAt = parseIstDateTime(date, time);
  if (!appointmentAt || Number.isNaN(appointmentAt.getTime())) {
    return null;
  }

  const opensAt = appointmentAt.getTime() - CHECK_IN_WINDOW_BEFORE_MINUTES * MS_PER_MINUTE;
  const closesAt = appointmentAt.getTime() + CHECK_IN_WINDOW_AFTER_MINUTES * MS_PER_MINUTE;
  const nowMs = now.getTime();

  return {
    appointmentAt,
    isSameIstDay: isSameIstDay(appointmentAt, now),
    isWithinWindow: nowMs >= opensAt && nowMs <= closesAt,
  };
}

/** 400 for a patient outside the check-in window. */
export function createCheckInWindowClosedException(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: CHECK_IN_WINDOW_CLOSED_CODE,
    message: CHECK_IN_WINDOW_CLOSED_MESSAGE,
  });
}

/** 400 for any caller checking in an appointment that is not on today's IST date. */
export function createCheckInNotTodayException(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: CHECK_IN_NOT_TODAY_CODE,
    message: CHECK_IN_NOT_TODAY_MESSAGE,
  });
}
