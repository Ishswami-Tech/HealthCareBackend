/**
 * In-person visit flow (product rules V2) - pure, framework-free rules shared by the check-in
 * service, the queue and the read models. No I/O here, so every rule is unit-testable.
 *
 * Stages (what patients and staff see):
 *   BOOKED      appointment exists, patient has not arrived (not in any queue)
 *   CHECKED_IN  arrival confirmed by the patient's QR scan or the receptionist's one-click check-in;
 *               the appointment is CONFIRMED, in its location's queue and has a token (K-014)
 *   WITH_DOCTOR the doctor called / started the consultation (IN_PROGRESS)
 *   COMPLETED | NO_SHOW | EXPIRED | CANCELLED  terminal
 * There is deliberately NO vitals / "ready for doctor" stage: a checked-in patient goes straight
 * to the doctor.
 */

import { parseIstDateTime } from './date-time.util';
import { isSameIstDay } from './clock.util';
import { DEFAULT_IN_PERSON_VISIT_MINUTES } from './visit-duration.util';

export type InPersonStage =
  'BOOKED' | 'CHECKED_IN' | 'WITH_DOCTOR' | 'COMPLETED' | 'NO_SHOW' | 'EXPIRED' | 'CANCELLED';

export const IN_PERSON_STAGES: readonly InPersonStage[] = [
  'BOOKED',
  'CHECKED_IN',
  'WITH_DOCTOR',
  'COMPLETED',
  'NO_SHOW',
  'EXPIRED',
  'CANCELLED',
];

/** Allowed stage moves. Anything else is refused by `assertInPersonTransition`. */
export const IN_PERSON_TRANSITIONS: Readonly<Record<InPersonStage, readonly InPersonStage[]>> = {
  BOOKED: ['CHECKED_IN', 'NO_SHOW', 'EXPIRED', 'CANCELLED'],
  CHECKED_IN: ['WITH_DOCTOR', 'NO_SHOW', 'EXPIRED'],
  WITH_DOCTOR: ['COMPLETED', 'EXPIRED'],
  COMPLETED: [],
  NO_SHOW: [],
  EXPIRED: [],
  CANCELLED: [],
};

export const IN_PERSON_TERMINAL_STAGES: ReadonlySet<InPersonStage> = new Set<InPersonStage>([
  'COMPLETED',
  'NO_SHOW',
  'EXPIRED',
  'CANCELLED',
]);

/** The minimal appointment facts the rules need. */
export interface InPersonAppointmentFacts {
  status?: string | null;
  checkedInAt?: Date | string | null;
  type?: string | null;
  date?: Date | string | null;
  time?: string | null;
  /** Slot length in minutes (Appointment.duration). */
  duration?: number | null;
  locationId?: string | null;
}

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isVideoVisit(type: string | null | undefined): boolean {
  return upper(type) === 'VIDEO_CALL';
}

/**
 * The V2 stage of an in-person appointment. CONFIRMED only counts as checked in when an arrival
 * was actually recorded (`checkedInAt`), so a stray CONFIRMED row never shows up in a queue.
 */
export function deriveInPersonStage(appointment: InPersonAppointmentFacts): InPersonStage {
  const status = upper(appointment.status);
  switch (status) {
    case 'COMPLETED':
    case 'DISCHARGED':
      return 'COMPLETED';
    case 'NO_SHOW':
      return 'NO_SHOW';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'IN_PROGRESS':
      return 'WITH_DOCTOR';
    case 'CONFIRMED':
      return appointment.checkedInAt ? 'CHECKED_IN' : 'BOOKED';
    default:
      // PENDING, SCHEDULED, RESCHEDULED, AWAITING_SLOT_CONFIRMATION, FOLLOW_UP_SCHEDULED ...
      return 'BOOKED';
  }
}

export function canMoveInPersonStage(from: InPersonStage, to: InPersonStage): boolean {
  return IN_PERSON_TRANSITIONS[from].includes(to);
}

export class InPersonTransitionError extends Error {
  constructor(
    readonly from: InPersonStage,
    readonly to: InPersonStage
  ) {
    super(`An in-person visit cannot move from ${from} to ${to}.`);
    this.name = 'InPersonTransitionError';
  }
}

export function assertInPersonTransition(from: InPersonStage, to: InPersonStage): void {
  if (!canMoveInPersonStage(from, to)) throw new InPersonTransitionError(from, to);
}

/** True when the appointment belongs in its location's live queue (checked in or with doctor). */
export function isInLiveQueue(appointment: InPersonAppointmentFacts): boolean {
  if (isVideoVisit(appointment.type)) return false;
  const stage = deriveInPersonStage(appointment);
  return stage === 'CHECKED_IN' || stage === 'WITH_DOCTOR';
}

/** Only a checked-in (confirmed, queued) in-person visit may be called / started by the doctor. */
export const NOT_CHECKED_IN_MESSAGE =
  'This patient has not checked in yet. Only checked-in patients can be called or seen.';

export function canDoctorCall(appointment: InPersonAppointmentFacts): boolean {
  return !isVideoVisit(appointment.type) && deriveInPersonStage(appointment) === 'CHECKED_IN';
}

/**
 * The "must be checked in" rule belongs to clinic (IN_PERSON) visits only: there is no arrival to
 * record for a video call or a home visit. A row without a type is a legacy clinic visit (the
 * column defaults to IN_PERSON).
 */
export function requiresInPersonCheckIn(type: string | null | undefined): boolean {
  const value = upper(type);
  return value === '' || value === 'IN_PERSON';
}

/**
 * Whether the doctor may start this visit (`PATCH /queue/:id/status` IN_PROGRESS).
 * - non in-person types are never gated by check-in;
 * - checked in, or already with the doctor (a repeated click stays idempotent);
 * - legacy: a CONFIRMED in-person row without `checkedInAt` that already sits in the live queue was
 *   queued under the old flow (check-in == CONFIRMED + queued), so its queue presence counts as
 *   the arrival.
 */
export function canStartInPersonVisit(
  appointment: InPersonAppointmentFacts,
  presentInLiveQueue: boolean
): boolean {
  if (!requiresInPersonCheckIn(appointment.type)) return true;
  if (isInLiveQueue(appointment)) return true;
  return presentInLiveQueue && upper(appointment.status) === 'CONFIRMED';
}

/**
 * Whether a row that IS in the live queue may be listed. Only an in-person visit that is still
 * pre-arrival (booked / scheduled, never checked in, not CONFIRMED by the old flow) is hidden;
 * video / other types, rows with a recorded arrival, rows with the doctor or finished, and legacy
 * CONFIRMED queue rows are always kept.
 */
export function isListableQueueRow(appointment: InPersonAppointmentFacts): boolean {
  if (!requiresInPersonCheckIn(appointment.type)) return true;
  if (appointment.checkedInAt) return true;
  const stage = deriveInPersonStage(appointment);
  if (stage !== 'BOOKED') return true;
  return upper(appointment.status) === 'CONFIRMED';
}

// ---------------------------------------------------------------------------------------------
// Check-in window and scan validation (V2 rule 3)
// ---------------------------------------------------------------------------------------------

/**
 * A patient's own (QR) check-in window, the same for every visit length: it opens
 * QR_WINDOW_OPENS_BEFORE_MINUTES before the slot start and closes QR_WINDOW_CLOSES_AFTER_MINUTES
 * after it (2:00 pm slot -> open 1:40 pm .. 2:45 pm, both edges inclusive). Every patient entry
 * point (POST /in-person/check-in, the deprecated scan-qr, processCheckIn, the plugin config)
 * reads these two constants. Reception's one-click check-in is not bound to it (any time that day).
 */
export const QR_WINDOW_OPENS_BEFORE_MINUTES = 20;
export const QR_WINDOW_CLOSES_AFTER_MINUTES = 45;
/** Slot length used when an appointment has no usable duration. */
export const DEFAULT_SLOT_MINUTES = 15;

const MS_PER_MINUTE = 60_000;

export interface CheckInWindow {
  opensAt: Date;
  /** Slot start + QR_WINDOW_CLOSES_AFTER_MINUTES: after this self check-in is closed. */
  closesAt: Date;
  startsAt: Date;
}

export type CheckInWindowState = 'TOO_EARLY' | 'OPEN' | 'CLOSED';

export function slotMinutesOf(duration: number | null | undefined): number {
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
    ? Math.round(duration)
    : DEFAULT_SLOT_MINUTES;
}

/** The self check-in window around a slot start (independent of the visit length). */
export function checkInWindowFromStart(startsAt: Date): CheckInWindow {
  return {
    startsAt,
    opensAt: new Date(startsAt.getTime() - QR_WINDOW_OPENS_BEFORE_MINUTES * MS_PER_MINUTE),
    closesAt: new Date(startsAt.getTime() + QR_WINDOW_CLOSES_AFTER_MINUTES * MS_PER_MINUTE),
  };
}

/** Null when the slot cannot be determined (callers fail closed). */
export function computeCheckInWindow(appointment: InPersonAppointmentFacts): CheckInWindow | null {
  if (!appointment.date || typeof appointment.time !== 'string' || !appointment.time.trim()) {
    return null;
  }
  const startsAt = parseIstDateTime(appointment.date, appointment.time);
  if (!startsAt || Number.isNaN(startsAt.getTime())) return null;
  return checkInWindowFromStart(startsAt);
}

export function checkInWindowState(window: CheckInWindow, now: Date): CheckInWindowState {
  const t = now.getTime();
  if (t < window.opensAt.getTime()) return 'TOO_EARLY';
  if (t > window.closesAt.getTime()) return 'CLOSED';
  return 'OPEN';
}

/** The slot's self check-in window contains `now` (fails closed when the slot is unknown). */
export function isCheckInWindowOpen(
  appointment: InPersonAppointmentFacts,
  now: Date = new Date()
): boolean {
  const window = computeCheckInWindow(appointment);
  return window !== null && checkInWindowState(window, now) === 'OPEN';
}

/**
 * Whether a patient booking belongs to "today" for check-in and the patient's today list: the
 * slot is on today's IST day, OR its check-in window is open right now. The window crosses
 * midnight for late and early slots (a 23:45 slot stays open until 00:30 the next day; a 00:10
 * slot opens at 23:50 the day before), so a calendar-day match alone refused patients standing
 * at the desk inside their window. Callers fetch the previous / today / next IST day and filter.
 */
export function isBookingInCheckInScope(
  appointment: InPersonAppointmentFacts,
  now: Date = new Date()
): boolean {
  const window = computeCheckInWindow(appointment);
  if (!window)
    return Boolean(appointment.date) && isSameIstDay(appointment.date as Date | string, now);
  return isSameIstDay(window.startsAt, now) || checkInWindowState(window, now) === 'OPEN';
}

/** One formatter for every call (building an Intl.DateTimeFormat is the expensive part). */
const IST_CLOCK_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "1:40 pm" (IST wall clock) for patient-facing copy. */
export function formatIstClock(instant: Date): string {
  return IST_CLOCK_FORMATTER.format(instant).replace(/\s+/gu, ' ').toLowerCase();
}

/** Failure reasons written to the check-in log (same vocabulary as CheckInFailureReason). */
export type ScanFailureReason =
  'WRONG_LOCATION' | 'TOO_EARLY' | 'EXPIRED' | 'NOT_BOOKED' | 'VIDEO_VISIT' | 'NOT_TODAY';

export type ScanDecision =
  | { ok: true; alreadyCheckedIn: boolean }
  | { ok: false; reason: ScanFailureReason; message: string };

/** Friendly fallback every timing / presence refusal ends with: the desk can always help. */
export const RECEPTION_CHECK_IN_FALLBACK = 'or ask the reception desk to check you in.';

/** Generic copy (no slot known). `scanFailureMessage` adds the opening / closing time. */
export const SCAN_FAILURE_MESSAGES: Readonly<Record<ScanFailureReason, string>> = {
  WRONG_LOCATION:
    'This QR code belongs to a different clinic location. Please scan the QR at the location you booked.',
  TOO_EARLY: `Check-in opens ${QR_WINDOW_OPENS_BEFORE_MINUTES} minutes before your appointment. Scan again then, ${RECEPTION_CHECK_IN_FALLBACK}`,
  EXPIRED: `Self check-in closes ${QR_WINDOW_CLOSES_AFTER_MINUTES} minutes after your appointment time. If you are at the clinic, show your booking ${RECEPTION_CHECK_IN_FALLBACK}`,
  NOT_BOOKED:
    'We could not find an in-clinic booking for you at this location today. Please book an appointment or ask the reception desk.',
  VIDEO_VISIT: 'Video visits do not use clinic check-in. Join the call from your appointments.',
  NOT_TODAY: 'This appointment is not today. Check-in is only possible on the day of the visit.',
};

/**
 * The patient-facing message of a refusal. With the slot's window, TOO_EARLY names the opening
 * time ("Check-in opens at 1:40 pm ...") and EXPIRED the closing time ("... closed at 2:45 pm.
 * Please go to the reception desk.").
 */
export function scanFailureMessage(
  reason: ScanFailureReason,
  window?: CheckInWindow | null
): string {
  if (window && reason === 'TOO_EARLY') {
    return `Check-in opens at ${formatIstClock(window.opensAt)}, ${QR_WINDOW_OPENS_BEFORE_MINUTES} minutes before your ${formatIstClock(window.startsAt)} appointment. Please scan again then, ${RECEPTION_CHECK_IN_FALLBACK}`;
  }
  if (window && reason === 'EXPIRED') {
    return `The check-in window closed at ${formatIstClock(window.closesAt)}. If you are at the clinic, show your booking ${RECEPTION_CHECK_IN_FALLBACK}`;
  }
  return SCAN_FAILURE_MESSAGES[reason];
}

function fail(reason: ScanFailureReason, window?: CheckInWindow | null): ScanDecision {
  return { ok: false, reason, message: scanFailureMessage(reason, window) };
}

/**
 * Whether a patient's QR scan at `scannedLocationIds` (the poster's CheckInLocation id and its
 * linked ClinicLocation id) may check in `appointment` at `now`. Idempotent: an appointment that
 * is already checked in (or with the doctor) at that location answers ok + alreadyCheckedIn.
 */
export function evaluateQrScan(
  appointment: InPersonAppointmentFacts | null | undefined,
  scannedLocationIds: readonly (string | null | undefined)[],
  now: Date = new Date()
): ScanDecision {
  if (!appointment) return fail('NOT_BOOKED');
  if (isVideoVisit(appointment.type)) return fail('VIDEO_VISIT');

  const ids = scannedLocationIds.filter((id): id is string => Boolean(id));
  if (!appointment.locationId || !ids.includes(appointment.locationId)) {
    return fail('WRONG_LOCATION');
  }

  const stage = deriveInPersonStage(appointment);
  if (stage === 'CHECKED_IN' || stage === 'WITH_DOCTOR')
    return { ok: true, alreadyCheckedIn: true };
  if (stage === 'EXPIRED' || stage === 'NO_SHOW') return fail('EXPIRED');
  if (stage !== 'BOOKED') return fail('NOT_BOOKED');

  const window = computeCheckInWindow(appointment);
  if (!window) return fail('NOT_BOOKED');
  const state = checkInWindowState(window, now);
  // An open window is enough, also across midnight (23:45 slot at 00:10, 00:10 slot at 23:55).
  if (state === 'OPEN') return { ok: true, alreadyCheckedIn: false };
  if (!isSameIstDay(window.startsAt, now)) {
    return window.startsAt.getTime() > now.getTime() ? fail('TOO_EARLY') : fail('EXPIRED');
  }
  return state === 'TOO_EARLY' ? fail('TOO_EARLY', window) : fail('EXPIRED', window);
}

/**
 * Picks the booking a patient's scan refers to among their own in-person bookings for today:
 * the one at the scanned location (earliest open first), otherwise the first booking elsewhere
 * (so the scan is reported as WRONG_LOCATION, not NOT_BOOKED).
 */
export function pickScanCandidate<T extends InPersonAppointmentFacts & { id: string }>(
  bookings: readonly T[],
  scannedLocationIds: readonly (string | null | undefined)[],
  requestedAppointmentId?: string | null
): { match: T | null; ambiguous: T[] } {
  const live = bookings.filter(b => !IN_PERSON_TERMINAL_STAGES.has(deriveInPersonStage(b)));
  if (requestedAppointmentId) {
    return { match: bookings.find(b => b.id === requestedAppointmentId) ?? null, ambiguous: [] };
  }
  const ids = scannedLocationIds.filter((id): id is string => Boolean(id));
  const here = live.filter(b => b.locationId && ids.includes(b.locationId));
  // Slot start, not the time string: bookings of the previous / next IST day can be in scope.
  const startOf = (x: T): number => computeCheckInWindow(x)?.startsAt.getTime() ?? 0;
  const byTime = (a: T, b: T): number =>
    startOf(a) - startOf(b) || String(a.time ?? '').localeCompare(String(b.time ?? ''));
  if (here.length > 1) {
    const notYet = here.filter(b => deriveInPersonStage(b) === 'BOOKED');
    if (notYet.length > 1) return { match: null, ambiguous: [...notYet].sort(byTime) };
    return { match: notYet[0] ?? [...here].sort(byTime)[0] ?? null, ambiguous: [] };
  }
  if (here.length === 1) return { match: here[0] ?? null, ambiguous: [] };
  return { match: [...live].sort(byTime)[0] ?? null, ambiguous: [] };
}

// ---------------------------------------------------------------------------------------------
// Queue presentation: token, people ahead, ETA
// ---------------------------------------------------------------------------------------------

export const DEFAULT_TOKEN_PREFIX = 'K';

/**
 * Token prefix of a clinic location: ONE token series per location per day (Kothrud K-001...,
 * Baner B-001...), shared by booked and walk-in patients. `ClinicLocation.settings.tokenPrefix`
 * (1-3 letters / digits) overrides; otherwise the first letter of the location name; otherwise K.
 */
export function locationTokenPrefix(
  location: { name?: string | null; settings?: unknown } | null | undefined
): string {
  const settings = location?.settings;
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const configured = (settings as Record<string, unknown>)['tokenPrefix'];
    if (typeof configured === 'string' && /^[A-Za-z0-9]{1,3}$/.test(configured.trim())) {
      return configured.trim().toUpperCase();
    }
  }
  const initial = /[A-Za-z0-9]/.exec(String(location?.name ?? ''));
  return initial ? initial[0].toUpperCase() : DEFAULT_TOKEN_PREFIX;
}

/**
 * Walk-in tag of a booking's metadata (`isWalkIn` / `walkIn`, or a WALK* `bookingSource`).
 * Undefined when the metadata says nothing. Used by the lists (`isWalkIn`) and the live queue.
 */
export function readWalkInFlag(metadata: unknown): boolean | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const record = metadata as Record<string, unknown>;
  const flag = record['isWalkIn'] ?? record['walkIn'];
  if (typeof flag === 'boolean') return flag;
  const source = record['bookingSource'] ?? record['source'];
  if (typeof source === 'string') return source.toUpperCase().includes('WALK');
  return undefined;
}

/** Display token of a queue entry: the label stored at check-in ("B-004"), else K-nnn. */
export function queueTokenLabel(
  entry: { tokenNumber?: number | null; tokenLabel?: string | null } | null | undefined
): string | null {
  if (entry?.tokenLabel && entry.tokenLabel.trim()) return entry.tokenLabel;
  return formatQueueToken(entry?.tokenNumber);
}

/** 14 -> "K-014". Null for a missing / invalid number. */
export function formatQueueToken(
  tokenNumber: number | null | undefined,
  prefix: string = DEFAULT_TOKEN_PREFIX
): string | null {
  if (typeof tokenNumber !== 'number' || !Number.isFinite(tokenNumber) || tokenNumber <= 0) {
    return null;
  }
  return `${prefix}-${String(Math.floor(tokenNumber)).padStart(3, '0')}`;
}

export interface QueueLine {
  appointmentId: string;
  status?: string | null;
  tokenNumber?: number | null;
  /** Location-prefixed display token stored at check-in ("B-004"). */
  tokenLabel?: string | null;
}

export interface QueuePlace {
  position: number;
  peopleAhead: number;
  etaMinutes: number;
  isNext: boolean;
  nowServingToken: number | null;
  nowServingTokenLabel: string | null;
}

const LEFT_QUEUE = new Set(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED']);

/**
 * Where `appointmentId` stands in an ordered live queue (already sorted by priority / arrival).
 * People ahead = waiting patients before it (the one with the doctor is not "ahead"). The ETA
 * adds the remaining part of a consultation in progress (half an average one). The consult length
 * is the clinic's in-person visit length (`resolveClinicVisitDurations(settings).inPersonMinutes`,
 * visit-duration.util); callers pass it, the default is that setting's default.
 */
export function computeQueuePlace(
  orderedQueue: readonly QueueLine[],
  appointmentId: string,
  averageConsultMinutes: number = DEFAULT_IN_PERSON_VISIT_MINUTES
): QueuePlace | null {
  const active = orderedQueue.filter(line => !LEFT_QUEUE.has(upper(line.status)));
  const index = active.findIndex(line => line.appointmentId === appointmentId);
  if (index === -1) return null;
  const serving = active.find(line => upper(line.status) === 'IN_PROGRESS');
  const mine = active[index];
  if (mine && upper(mine.status) === 'IN_PROGRESS') {
    return {
      position: 0,
      peopleAhead: 0,
      etaMinutes: 0,
      isNext: false,
      nowServingToken: mine.tokenNumber ?? null,
      nowServingTokenLabel: queueTokenLabel(mine),
    };
  }
  const peopleAhead = active
    .slice(0, index)
    .filter(line => upper(line.status) !== 'IN_PROGRESS').length;
  const remainder = serving ? Math.ceil(averageConsultMinutes / 2) : 0;
  return {
    position: peopleAhead + 1,
    peopleAhead,
    etaMinutes: peopleAhead * averageConsultMinutes + remainder,
    isNext: peopleAhead === 0,
    nowServingToken: serving?.tokenNumber ?? null,
    nowServingTokenLabel: serving ? queueTokenLabel(serving) : null,
  };
}

/**
 * `computeQueuePlace` for every appointment of one ordered queue in ONE pass (M6: the desk board
 * computed it per row, O(n^2) for a 400-patient day). Same answers: the first occurrence of an
 * appointment wins, people ahead counts every waiting line before it.
 */
export function computeQueuePlaces(
  orderedQueue: readonly QueueLine[],
  averageConsultMinutes: number = DEFAULT_IN_PERSON_VISIT_MINUTES
): Map<string, QueuePlace> {
  const active = orderedQueue.filter(line => !LEFT_QUEUE.has(upper(line.status)));
  const serving = active.find(line => upper(line.status) === 'IN_PROGRESS');
  const remainder = serving ? Math.ceil(averageConsultMinutes / 2) : 0;
  const places = new Map<string, QueuePlace>();
  let ahead = 0;
  for (const line of active) {
    const inProgress = upper(line.status) === 'IN_PROGRESS';
    if (!places.has(line.appointmentId)) {
      places.set(
        line.appointmentId,
        inProgress
          ? {
              position: 0,
              peopleAhead: 0,
              etaMinutes: 0,
              isNext: false,
              nowServingToken: line.tokenNumber ?? null,
              nowServingTokenLabel: queueTokenLabel(line),
            }
          : {
              position: ahead + 1,
              peopleAhead: ahead,
              etaMinutes: ahead * averageConsultMinutes + remainder,
              isNext: ahead === 0,
              nowServingToken: serving?.tokenNumber ?? null,
              nowServingTokenLabel: serving ? queueTokenLabel(serving) : null,
            }
      );
    }
    if (!inProgress) ahead += 1;
  }
  return places;
}

// ---------------------------------------------------------------------------------------------
// Booking: nearest location
// ---------------------------------------------------------------------------------------------

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  const term = Math.min(1, Math.max(0, a));
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(term), Math.sqrt(1 - term));
}

export function parseGeoPoint(lat: unknown, lng: unknown): GeoPoint | null {
  const la = typeof lat === 'string' && lat.trim() !== '' ? Number(lat) : lat;
  const lo = typeof lng === 'string' && lng.trim() !== '' ? Number(lng) : lng;
  if (typeof la !== 'number' || typeof lo !== 'number') return null;
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return { lat: la, lng: lo };
}

/**
 * Sorts locations nearest first (locations without coordinates last, by name) and flags the
 * nearest one. Without an origin the order is by name and nothing is flagged.
 */
export function rankLocationsByDistance<
  T extends { name: string; latitude?: number | null; longitude?: number | null },
>(
  locations: readonly T[],
  origin: GeoPoint | null
): Array<T & { distanceMeters: number | null; isNearest: boolean }> {
  const withDistance = locations.map(location => {
    const point =
      origin && typeof location.latitude === 'number' && typeof location.longitude === 'number'
        ? parseGeoPoint(location.latitude, location.longitude)
        : null;
    return {
      ...location,
      distanceMeters: origin && point ? Math.round(distanceMeters(origin, point)) : null,
      isNearest: false,
    };
  });
  withDistance.sort((a, b) => {
    if (a.distanceMeters !== null && b.distanceMeters !== null) {
      return a.distanceMeters - b.distanceMeters;
    }
    if (a.distanceMeters !== null) return -1;
    if (b.distanceMeters !== null) return 1;
    return a.name.localeCompare(b.name);
  });
  const first = withDistance[0];
  if (first && first.distanceMeters !== null) first.isNearest = true;
  return withDistance;
}
