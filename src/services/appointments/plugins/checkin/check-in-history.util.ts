/**
 * Pure helpers of the clinic check-in history (GET /appointments/check-in/history).
 *
 * - How a visit was checked in: the in-person flow logs every successful check-in in
 *   `check_in_attempts` (method QR | MANUAL | WALK_IN, plus the actor's role). The CheckIn row
 *   itself has no method column and its `notes` are empty in that flow, so the old regex on notes
 *   labelled every row "Manual".
 * - Cached values: CacheService may hand back the stored JSON string or an already parsed
 *   object, so a cache hit must accept both (JSON.parse on an object threw and every call
 *   after the first answered 500 until the entry expired).
 */

/** Methods the history reports (labels on the web: QR, Manual, Walk-in, Staff, Desk code). */
export type CheckInHistoryMethod = 'QR' | 'MANUAL' | 'WALK_IN' | 'STAFF' | 'DESK_CODE';

const KNOWN_METHODS: ReadonlySet<string> = new Set<CheckInHistoryMethod>([
  'QR',
  'MANUAL',
  'WALK_IN',
  'STAFF',
  'DESK_CODE',
]);

/** Roles that check a patient in at the desk on the patient's behalf. */
const STAFF_ROLES: ReadonlySet<string> = new Set([
  'RECEPTIONIST',
  'CLINIC_ADMIN',
  'CLINIC_LOCATION_HEAD',
  'NURSE',
  'ASSISTANT_DOCTOR',
  'DOCTOR',
  'SUPER_ADMIN',
]);

export interface CheckInMethodSource {
  /** `check_in_attempts.method` of the successful attempt, when one was logged. */
  attemptMethod?: string | null;
  /** `check_in_attempts.actorRole` of that attempt. */
  actorRole?: string | null;
  /** CheckIn.notes (older flows wrote "QR check-in ..." / "Walk-in ..." there). */
  notes?: string | null;
  /** CheckIn.coordinates / deviceInfo: only the patient app (QR / desk code) sends them. */
  hasDeviceContext?: boolean;
}

function normalizeMethod(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
}

/** The check-in method of one history row, from the most to the least reliable source. */
export function resolveCheckInMethod(source: CheckInMethodSource): CheckInHistoryMethod {
  const method = normalizeMethod(source.attemptMethod);
  if (method === 'QR_CODE' || method === 'QR_SCAN') return 'QR';
  if (KNOWN_METHODS.has(method)) return method as CheckInHistoryMethod;

  const notes = String(source.notes ?? '');
  if (/qr check-in/i.test(notes)) return 'QR';
  if (/walk-?in/i.test(notes)) return 'WALK_IN';
  if (/desk code/i.test(notes)) return 'DESK_CODE';

  const role = normalizeMethod(source.actorRole);
  if (role === 'PATIENT') return 'QR';
  if (STAFF_ROLES.has(role)) return 'MANUAL';

  return source.hasDeviceContext ? 'QR' : 'MANUAL';
}

export interface CheckInAttemptMethodRow {
  appointmentId: string | null;
  method: string | null;
  actorRole: string | null;
  createdAt: Date | string;
}

/** Latest successful attempt per appointment (rows in any order). */
export function latestAttemptByAppointment(
  rows: readonly CheckInAttemptMethodRow[]
): Map<string, CheckInAttemptMethodRow> {
  const latest = new Map<string, CheckInAttemptMethodRow>();
  for (const row of rows) {
    if (!row.appointmentId) continue;
    const current = latest.get(row.appointmentId);
    if (!current || new Date(row.createdAt).getTime() > new Date(current.createdAt).getTime()) {
      latest.set(row.appointmentId, row);
    }
  }
  return latest;
}

/**
 * A cache hit as an object: a JSON string is parsed, an object is returned as it is. An empty or
 * unparseable value is a miss (null), so the caller reads the database instead of failing.
 */
export function readCachedJson<T extends object>(
  cached: string | object | null | undefined
): T | null {
  if (cached === null || cached === undefined) return null;
  if (typeof cached === 'string') {
    if (!cached.trim()) return null;
    try {
      const parsed = JSON.parse(cached) as object | null;
      return parsed !== null && typeof parsed === 'object' ? (parsed as T) : null;
    } catch {
      return null;
    }
  }
  return typeof cached === 'object' ? (cached as T) : null;
}
