/**
 * Validation of clinic-location working hours (PUT /clinics/:clinicId/locations/:id/working-hours,
 * and `workingHours` on location create / update). Pure, framework-free.
 *
 * Accepted shapes (an object, or the same object as a JSON string):
 *   { start: 'HH:MM', end: 'HH:MM' }                         every day
 *   { monday: { start, end } | [{ start, end }, ...] | null, ... }  per day; null / [] = closed
 * Times are 24-hour `HH:MM`, start strictly before end, and the sessions of one day must not
 * overlap. Anything else ("9am", a plain string, {}, start after end) is rejected with a message,
 * as is a per-day value that leaves every day closed (use deactivate to close a location).
 * The result is the canonical JSON string that is stored (the column has always held a string).
 */

export const WORKING_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type WorkingDay = (typeof WORKING_DAYS)[number];

export interface WorkingSession {
  start: string;
  end: string;
}

export type WorkingHoursValue =
  WorkingSession | Partial<Record<WorkingDay, WorkingSession | WorkingSession[] | null>>;

export type WorkingHoursResult =
  { ok: true; value: WorkingHoursValue; stored: string } | { ok: false; error: string };

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function parseSession(value: unknown, label: string): WorkingSession | string {
  if (!isPlainObject(value)) return `${label} must be { start: "HH:MM", end: "HH:MM" }`;
  const extra = Object.keys(value).filter(key => key !== 'start' && key !== 'end');
  if (extra.length > 0) return `${label} has unknown field(s): ${extra.join(', ')}`;
  const { start, end } = value;
  if (typeof start !== 'string' || !TIME_PATTERN.test(start.trim())) {
    return `${label} start must be a 24-hour time HH:MM (for example 09:00)`;
  }
  if (typeof end !== 'string' || !TIME_PATTERN.test(end.trim())) {
    return `${label} end must be a 24-hour time HH:MM (for example 17:00)`;
  }
  const session = { start: start.trim(), end: end.trim() };
  if (minutesOf(session.start) >= minutesOf(session.end)) {
    return `${label} start (${session.start}) must be before end (${session.end})`;
  }
  return session;
}

function parseDay(
  value: unknown,
  day: WorkingDay
): WorkingSession | WorkingSession[] | null | string {
  if (value === null) return null;
  if (!Array.isArray(value)) return parseSession(value, day);
  const sessions: WorkingSession[] = [];
  for (const [index, item] of value.entries()) {
    const session = parseSession(item, `${day} session ${index + 1}`);
    if (typeof session === 'string') return session;
    sessions.push(session);
  }
  const sorted = [...sessions].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous && current && minutesOf(current.start) < minutesOf(previous.end)) {
      return `${day} sessions overlap (${previous.start}-${previous.end} and ${current.start}-${current.end})`;
    }
  }
  return sorted;
}

/** Validates working hours; on success returns the normalized value and the string to store. */
export function parseWorkingHours(input: unknown): WorkingHoursResult {
  let value = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return {
        ok: false,
        error: 'workingHours must be an object like { "start": "09:00", "end": "17:00" }',
      };
    }
  }
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    return {
      ok: false,
      error:
        'workingHours must be { start, end } or per-day hours such as { monday: { start, end } }',
    };
  }

  if ('start' in value || 'end' in value) {
    const session = parseSession(value, 'workingHours');
    if (typeof session === 'string') return { ok: false, error: session };
    return { ok: true, value: session, stored: JSON.stringify(session) };
  }

  const unknownKeys = Object.keys(value).filter(
    key => !(WORKING_DAYS as readonly string[]).includes(key.toLowerCase())
  );
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      error: `Unknown day(s) in workingHours: ${unknownKeys.join(', ')} (use monday … sunday)`,
    };
  }
  const days: Partial<Record<WorkingDay, WorkingSession | WorkingSession[] | null>> = {};
  for (const day of WORKING_DAYS) {
    const key = Object.keys(value).find(candidate => candidate.toLowerCase() === day);
    if (key === undefined) continue;
    const parsed = parseDay(value[key], day);
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    days[day] = parsed;
  }
  // A per-day value with no open session would close the location every day (a form that
  // failed to read the hours used to save exactly that). Closing a location is "deactivate".
  const anyOpen = Object.values(days).some(day =>
    Array.isArray(day) ? day.length > 0 : day !== null && day !== undefined
  );
  if (!anyOpen) {
    return {
      ok: false,
      error:
        'workingHours closes the location on every day. Keep at least one day open, or deactivate the location instead.',
    };
  }
  return { ok: true, value: days, stored: JSON.stringify(days) };
}
