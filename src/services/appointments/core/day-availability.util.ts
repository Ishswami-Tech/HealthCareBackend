/**
 * Dated OPD-window override read for the availability / booking engine.
 *
 * A doctor (or clinic admin) can set a single-day override of their OPD windows in the
 * `doctor_day_availability` table: e.g. "30 Oct: open only 12:00–15:00" or "closed for the
 * day" (empty sessions). While an active (deletedAt IS NULL) override exists for the
 * doctor+date(+location), the availability engine must use the override's sessions instead of
 * the doctor's static weekly workingHours. This is the one query the engine calls.
 *
 * `date` is a Postgres DATE column (Prisma returns it as UTC midnight), so the requested IST
 * `YYYY-MM-DD` day key is compared on its UTC calendar date — the same convention as
 * clinic_closures (see clinic-closure.util.ts). Fails open (returns null = "no override") on
 * any error: an override-lookup failure must never take availability / booking down.
 */

import type { DatabaseService } from '@infrastructure/database';

/** One OPD session block, the exact per-day shape getDoctorAvailability's grid consumes. */
export interface DaySessionWindow {
  start: string;
  end: string;
}

export interface DayOverrideRow {
  /** Normalized session blocks; `[]` = the doctor is closed for the day. */
  sessions: DaySessionWindow[];
  /** Free-text emergency reason (going somewhere, family matter, illness), when set. */
  reason: string | null;
}

interface DayOverrideClient {
  doctorDayAvailability?: {
    findFirst: (args: unknown) => Promise<{ sessions: unknown; reason: string | null } | null>;
  };
}

/** `HH:MM` -> minutes since midnight, or null when not a valid 24h time. */
function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Coerce the stored Json (array of {start,end}) into the engine's SessionWindow shape. */
export function parseDaySessions(raw: unknown): DaySessionWindow[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const windows: DaySessionWindow[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const start = typeof record['start'] === 'string' ? record['start'].trim() : '';
    const end = typeof record['end'] === 'string' ? record['end'].trim() : '';
    if (timeToMinutes(start) === null || timeToMinutes(end) === null) continue;
    windows.push({ start, end });
  }
  return windows;
}

/**
 * The active override for `doctorId` on IST day `dayKey` (at `locationId`, null = clinic
 * wide), or null when there is none (the engine then falls back to weekly workingHours).
 * A location-scoped lookup sees the most specific match: a location-specific override
 * first, then a clinic-wide one — so a clinic-wide "closed for the day" still closes a
 * location's grid. A client without the `doctorDayAvailability` delegate (an older
 * generated client) answers "no override", exactly like readClosureForDay answers "open".
 */
export async function readDayOverrideForDay(
  database: Pick<DatabaseService, 'executeHealthcareRead'>,
  clinicId: string,
  doctorId: string,
  dayKey: string,
  locationId?: string | null
): Promise<DayOverrideRow | null> {
  const day = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) return null;
  try {
    const findOverride = async (scopedLocationId: string | null) =>
      database.executeHealthcareRead(async client => {
        const typed = client as unknown as DayOverrideClient;
        if (!typed.doctorDayAvailability) return null;
        return await typed.doctorDayAvailability.findFirst({
          where: {
            doctorId,
            clinicId,
            deletedAt: null,
            date: day,
            locationId: scopedLocationId,
          },
          select: { sessions: true, reason: true },
        });
      });
    const rows = locationId
      ? [await findOverride(locationId), await findOverride(null)]
      : [await findOverride(null)];
    const row = rows.find(candidate => candidate !== null);
    if (!row) return null;
    return {
      sessions: parseDaySessions(row.sessions),
      reason: typeof row.reason === 'string' && row.reason.trim() ? row.reason : null,
    };
  } catch {
    // Fail open: treat as no override rather than breaking the slot grid.
    return null;
  }
}
