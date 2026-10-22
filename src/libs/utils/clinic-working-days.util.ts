/**
 * Which days a clinic takes appointments (owner decision 2026-10-22: weekend booking depends on
 * the clinic settings, not on a hardcoded rule). One rule for the booking check, the availability
 * grid and the walk-in "next available" search, so a day that shows slots always books and a
 * closed day never shows any. Pure, framework-free.
 *
 *   Clinic.settings.appointmentSettings.workingDays   ['monday', ..., 'friday'] by default
 *
 * The default is the behaviour before the setting existed: Monday to Friday, weekends closed.
 * Edited with `PUT /clinics/:id` like every other clinic setting (no new table); `null` resets it.
 *
 * A location whose working hours are per day (`{ monday: {...}, saturday: null }`) can close a
 * day further: a day is open only when the clinic works that day AND the location has hours on
 * it. Location hours given as one `{ start, end }` window (every day) do not restrict anything.
 * Holidays / closures stay a separate check; pass their day keys to `resolveDayBookability`.
 */

export const WORKING_DAYS_SETTING_KEY = 'workingDays';

/** Indexed like `Date#getUTCDay()` (0 = Sunday). */
export const WEEK_DAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type WeekDay = (typeof WEEK_DAYS)[number];

/** Display / storage order (Monday first). */
export const WEEK_DAYS_MONDAY_FIRST: readonly WeekDay[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/** Before the setting existed the booking refused Saturday and Sunday. */
export const DEFAULT_WORKING_DAYS: readonly WeekDay[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
];

export type DayClosedReason = 'CLINIC_CLOSED_WEEKDAY' | 'LOCATION_CLOSED_WEEKDAY' | 'HOLIDAY';

export type DayBookability =
  | { open: true; weekDay: WeekDay | null }
  | { open: false; weekDay: WeekDay | null; reason: DayClosedReason; message: string };

export interface DayBookabilityInput {
  /** IST calendar day, YYYY-MM-DD. */
  dateKey: string;
  /** `Clinic.settings` as stored (or its `appointmentSettings` object). */
  clinicSettings: unknown;
  /** `ClinicLocation.workingHours` of the visit's location (JSON or JSON string); optional. */
  locationWorkingHours?: unknown;
  /** Day keys the clinic is closed on (holidays / closures), when the caller has them. */
  closedDateKeys?: ReadonlySet<string>;
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_LABELS: Readonly<Record<WeekDay, string>> = {
  sunday: 'Sundays',
  monday: 'Mondays',
  tuesday: 'Tuesdays',
  wednesday: 'Wednesdays',
  thursday: 'Thursdays',
  friday: 'Fridays',
  saturday: 'Saturdays',
};

export const HOLIDAY_CLOSED_MESSAGE = 'The clinic is closed on this day. Please pick another day.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function appointmentSettingsOf(settings: unknown): Record<string, unknown> {
  if (!isRecord(settings)) return {};
  return isRecord(settings['appointmentSettings']) ? settings['appointmentSettings'] : settings;
}

function toWeekDay(value: unknown): WeekDay | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6) {
    return WEEK_DAYS[value] ?? null;
  }
  if (typeof value !== 'string') return null;
  const name = value.trim().toLowerCase();
  const match = WEEK_DAYS.find(day => day === name || day.slice(0, 3) === name);
  return match ?? null;
}

/**
 * A list of day names ('monday', 'Sat') or `getUTCDay` numbers -> the distinct days, Monday
 * first. Null when the value is not a list, holds an unknown day, or is empty (a clinic closed
 * on every day is "deactivate", not a working-days setting).
 */
export function normalizeWorkingDays(value: unknown): WeekDay[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const days = new Set<WeekDay>();
  for (const item of value) {
    const day = toWeekDay(item);
    if (!day) return null;
    days.add(day);
  }
  return WEEK_DAYS_MONDAY_FIRST.filter(day => days.has(day));
}

/** The clinic's working days, default Monday to Friday. Accepts `Clinic.settings` as stored. */
export function resolveClinicWorkingDays(settings: unknown): WeekDay[] {
  return (
    normalizeWorkingDays(appointmentSettingsOf(settings)[WORKING_DAYS_SETTING_KEY]) ?? [
      ...DEFAULT_WORKING_DAYS,
    ]
  );
}

function hasSessions(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isRecord);
  return isRecord(value);
}

/**
 * Days a location is open from its per-day working hours (a day with a session), or null when the
 * hours do not name days (one window for every day, nothing stored, unreadable JSON).
 */
export function locationOpenDays(workingHours: unknown): WeekDay[] | null {
  let value = workingHours;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).map(key => key.toLowerCase());
  if (!keys.some(key => (WEEK_DAYS as readonly string[]).includes(key))) return null;
  return WEEK_DAYS_MONDAY_FIRST.filter(day => {
    const key = Object.keys(value as Record<string, unknown>).find(k => k.toLowerCase() === day);
    return key !== undefined && hasSessions((value as Record<string, unknown>)[key]);
  });
}

/** Weekday of an IST day key (the key is already the IST calendar day). */
export function weekDayOfDateKey(dateKey: string): WeekDay | null {
  const match = DATE_KEY.exec(dateKey);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  // Rejects keys that roll over (2026-02-30 is not a day).
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) return null;
  return WEEK_DAYS[date.getUTCDay()] ?? null;
}

/** "The clinic is closed on Sundays. Please pick another day." */
export function closedWeekDayMessage(weekDay: WeekDay): string {
  return `The clinic is closed on ${DAY_LABELS[weekDay]}. Please pick another day.`;
}

/** Whether `dateKey` takes appointments, with the patient-facing refusal when it does not. */
export function resolveDayBookability(input: DayBookabilityInput): DayBookability {
  const weekDay = weekDayOfDateKey(input.dateKey);
  if (input.closedDateKeys?.has(input.dateKey)) {
    return { open: false, weekDay, reason: 'HOLIDAY', message: HOLIDAY_CLOSED_MESSAGE };
  }
  // An unreadable day key is left to the date validation of the caller.
  if (!weekDay) return { open: true, weekDay: null };
  if (!resolveClinicWorkingDays(input.clinicSettings).includes(weekDay)) {
    return {
      open: false,
      weekDay,
      reason: 'CLINIC_CLOSED_WEEKDAY',
      message: closedWeekDayMessage(weekDay),
    };
  }
  const locationDays = locationOpenDays(input.locationWorkingHours);
  if (locationDays && !locationDays.includes(weekDay)) {
    return {
      open: false,
      weekDay,
      reason: 'LOCATION_CLOSED_WEEKDAY',
      message: closedWeekDayMessage(weekDay),
    };
  }
  return { open: true, weekDay };
}

/** Shortcut for searches that only need yes / no. */
export function isBookableDay(input: DayBookabilityInput): boolean {
  return resolveDayBookability(input).open;
}

/**
 * Cleans `workingDays` of an incoming `appointmentSettings` patch (PUT /clinics/:id): a valid
 * list is stored as day names Monday first, an invalid one is dropped (the stored value stays),
 * `null` is kept so the merge deletes the key (back to the default).
 */
export function sanitizeWorkingDaysSetting(
  appointmentSettings: Record<string, unknown>
): Record<string, unknown> {
  if (!(WORKING_DAYS_SETTING_KEY in appointmentSettings)) return appointmentSettings;
  const raw = appointmentSettings[WORKING_DAYS_SETTING_KEY];
  if (raw === null) return appointmentSettings;
  const next = { ...appointmentSettings };
  const days = normalizeWorkingDays(raw);
  if (days) next[WORKING_DAYS_SETTING_KEY] = days;
  else delete next[WORKING_DAYS_SETTING_KEY];
  return next;
}
