import {
  haversineDistanceMeters,
  isWithinRadiusMeters,
  parseGeoCoordinates,
  parseStoredGeofenceCenter,
  type GeoCoordinates,
} from '@services/appointments/core/check-in-presence.util';

/**
 * Presence rule for a PATIENT who TYPES the printed desk code (CheckInLocation.qrCode) instead of
 * scanning the signed poster. A typed code can be read off a photo from anywhere, so the device
 * position is mandatory and must be inside the location geofence. The signed poster scan keeps
 * the 'if-supplied' rule (scanning the physical poster is the presence proof) and reception's
 * one-click check-in never proves presence.
 *
 * GPS accuracy: the client may send `accuracy` (metres, 68% radius of the fix). A fix whose
 * accuracy circle reaches the geofence is accepted (`distance - accuracy <= radius`), so a coarse
 * indoor fix just outside the circle is not refused. The allowance is capped at
 * DESK_CODE_MAX_ACCURACY_ALLOWANCE_METERS so a very coarse fix (cell tower) cannot pass from
 * across the city.
 */

/** Upper bound of the GPS accuracy allowance added to the location radius (metres). */
export const DESK_CODE_MAX_ACCURACY_ALLOWANCE_METERS = 1000;

export const DESK_CODE_LOCATION_REQUIRED_MESSAGE =
  'Turn on location to check in with the desk code, scan the QR at the desk, or ask the reception desk to check you in.';

/** Poster scan refused because the clinic requires the device position and none was sent. */
export const POSTER_LOCATION_REQUIRED_MESSAGE =
  'Turn on location to check in at the clinic, or ask the reception desk to check you in.';

/** TOO_FAR without a distance. */
export const DESK_CODE_TOO_FAR_MESSAGE =
  'You are too far from the clinic. Check in when you reach the clinic, or ask the reception desk to check you in.';

/** A device position with its optional accuracy (metres). */
export interface DeviceFix extends GeoCoordinates {
  readonly accuracy?: number;
}

export type DeskCodePresenceDecision =
  | { readonly ok: true; readonly distanceMeters: number | null; readonly unverifiable: boolean }
  | { readonly ok: false; readonly code: 'LOCATION_REQUIRED' }
  | { readonly ok: false; readonly code: 'TOO_FAR'; readonly distanceMeters: number };

/**
 * Untrusted client coordinates -> a device fix, or null. Accepts the API shape `{ lat, lng }` and
 * the browser / expo-location shape `{ latitude, longitude }`; values must be finite numbers in
 * range (no numeric strings). A negative / non-finite accuracy is dropped, not trusted.
 */
export function parseDeviceFix(value: unknown): DeviceFix | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const position = parseGeoCoordinates({
    lat: record['lat'] ?? record['latitude'],
    lng: record['lng'] ?? record['longitude'],
  });
  if (!position) {
    return null;
  }
  const accuracy = record['accuracy'];
  return typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0
    ? { ...position, accuracy }
    : position;
}

/** "about 650 m" / "about 1.2 km". */
export function formatApproxDistance(distanceMeters: number): string {
  if (distanceMeters < 1000) {
    return `about ${Math.max(10, Math.round(distanceMeters / 10) * 10)} m`;
  }
  const km = distanceMeters / 1000;
  return `about ${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function deskCodeTooFarMessage(distanceMeters: number): string {
  return `You are ${formatApproxDistance(distanceMeters)} from the clinic. Check in when you reach the clinic, or ask the reception desk to check you in.`;
}

/**
 * The desk-code presence decision. Pure.
 * - no / invalid coordinates -> LOCATION_REQUIRED
 * - location without a usable geofence (centre or positive radius) -> ok, `unverifiable: true`
 *   (configuration gap: the caller logs it; the patient is not blocked by clinic setup)
 * - `distance - min(accuracy, cap) <= radius` -> ok, else TOO_FAR with the distance
 */
export function assessDeskCodePresence(
  coordinates: unknown,
  location: { coordinates?: unknown; radius?: unknown }
): DeskCodePresenceDecision {
  const fix = parseDeviceFix(coordinates);
  if (!fix) {
    return { ok: false, code: 'LOCATION_REQUIRED' };
  }
  const centre = parseStoredGeofenceCenter(location.coordinates);
  const radius = location.radius;
  if (!centre || typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) {
    return { ok: true, distanceMeters: null, unverifiable: true };
  }
  const distance = haversineDistanceMeters(fix, centre);
  const allowance = Math.min(fix.accuracy ?? 0, DESK_CODE_MAX_ACCURACY_ALLOWANCE_METERS);
  // Fail closed on NaN: isWithinRadiusMeters only passes a finite distance.
  if (isWithinRadiusMeters(distance - allowance, radius)) {
    return { ok: true, distanceMeters: distance, unverifiable: false };
  }
  return { ok: false, code: 'TOO_FAR', distanceMeters: Number.isFinite(distance) ? distance : -1 };
}
