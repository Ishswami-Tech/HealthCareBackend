/**
 * When doctors get their WhatsApp appointment summaries, per clinic. Pure, framework-free.
 *
 *   Clinic.settings.appointmentSettings.doctorSummary = {
 *     morningEnabled: true,        // full-day summary every day the doctor has bookings
 *     morningTime: '07:00',        // IST, HH:MM
 *     beforeWindowEnabled: true,   // one summary before each consultation window opens
 *     beforeWindowMinutes: 15,     // how long before the window opens
 *   }
 *
 * The defaults are the behaviour before the setting existed (7 AM summary) plus the window
 * summaries 15 minutes ahead. Edited with `PUT /clinics/:id` like every other clinic setting;
 * `doctorSummary: null` resets to the defaults. A missing or invalid field falls back to its
 * default on read, so a half-filled object never switches summaries off by accident.
 */

export const DOCTOR_SUMMARY_SETTING_KEY = 'doctorSummary';

export interface DoctorSummarySettings {
  morningEnabled: boolean;
  /** IST, HH:MM (24h). */
  morningTime: string;
  beforeWindowEnabled: boolean;
  beforeWindowMinutes: number;
}

export const DEFAULT_DOCTOR_SUMMARY_SETTINGS: Readonly<DoctorSummarySettings> = Object.freeze({
  morningEnabled: true,
  morningTime: '07:00',
  beforeWindowEnabled: true,
  beforeWindowMinutes: 15,
});

/**
 * The scheduler checks every minute; at least 5 minutes leaves room for retries of a missed
 * check, and 3 hours is the longest lead that still reads as "before the window".
 */
export const BEFORE_WINDOW_MINUTES_MIN = 5;
export const BEFORE_WINDOW_MINUTES_MAX = 180;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `H:MM` / `HH:MM` (24h) -> zero-padded `HH:MM`, or null when invalid. */
export function normalizeSummaryTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Whole minutes within [MIN, MAX], or null when invalid. */
export function normalizeBeforeWindowMinutes(value: unknown): number | null {
  const minutes = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes)) return null;
  return minutes >= BEFORE_WINDOW_MINUTES_MIN && minutes <= BEFORE_WINDOW_MINUTES_MAX
    ? minutes
    : null;
}

/** The clinic's summary settings, from `Clinic.settings` or its `appointmentSettings`. */
export function resolveDoctorSummarySettings(settings: unknown): DoctorSummarySettings {
  const appointmentSettings =
    isRecord(settings) && isRecord(settings['appointmentSettings'])
      ? settings['appointmentSettings']
      : settings;
  const raw = isRecord(appointmentSettings)
    ? appointmentSettings[DOCTOR_SUMMARY_SETTING_KEY]
    : undefined;
  const stored = isRecord(raw) ? raw : {};
  const defaults = DEFAULT_DOCTOR_SUMMARY_SETTINGS;
  return {
    morningEnabled:
      typeof stored['morningEnabled'] === 'boolean'
        ? stored['morningEnabled']
        : defaults.morningEnabled,
    morningTime: normalizeSummaryTime(stored['morningTime']) ?? defaults.morningTime,
    beforeWindowEnabled:
      typeof stored['beforeWindowEnabled'] === 'boolean'
        ? stored['beforeWindowEnabled']
        : defaults.beforeWindowEnabled,
    beforeWindowMinutes:
      normalizeBeforeWindowMinutes(stored['beforeWindowMinutes']) ?? defaults.beforeWindowMinutes,
  };
}

/**
 * Cleans `doctorSummary` in an incoming `appointmentSettings` patch (PUT /clinics/:id): valid
 * fields are stored normalized, invalid or unknown ones are dropped (the stored value stays,
 * see mergeDoctorSummaryPatch), `null` is kept so the merge deletes the key (back to defaults).
 */
export function sanitizeDoctorSummarySettings(
  appointmentSettings: Record<string, unknown>
): Record<string, unknown> {
  if (!(DOCTOR_SUMMARY_SETTING_KEY in appointmentSettings)) return appointmentSettings;
  const raw = appointmentSettings[DOCTOR_SUMMARY_SETTING_KEY];
  const next = { ...appointmentSettings };
  if (raw === null) return next;
  if (!isRecord(raw)) {
    delete next[DOCTOR_SUMMARY_SETTING_KEY];
    return next;
  }

  const clean: Partial<DoctorSummarySettings> = {};
  if (typeof raw['morningEnabled'] === 'boolean') clean.morningEnabled = raw['morningEnabled'];
  if (typeof raw['beforeWindowEnabled'] === 'boolean') {
    clean.beforeWindowEnabled = raw['beforeWindowEnabled'];
  }
  const morningTime = normalizeSummaryTime(raw['morningTime']);
  if (morningTime) clean.morningTime = morningTime;
  const beforeWindowMinutes = normalizeBeforeWindowMinutes(raw['beforeWindowMinutes']);
  if (beforeWindowMinutes !== null) clean.beforeWindowMinutes = beforeWindowMinutes;

  if (Object.keys(clean).length === 0) delete next[DOCTOR_SUMMARY_SETTING_KEY];
  else next[DOCTOR_SUMMARY_SETTING_KEY] = clean;
  return next;
}

/**
 * `mergeClinicSettings` merges one level inside `appointmentSettings`, so a partial
 * `doctorSummary` patch would replace the stored object and its omitted fields would fall back
 * to the defaults (e.g. a clinic that switched the morning summary off would get it back by
 * saving only the minutes). This keeps the stored fields the patch does not set.
 */
export function mergeDoctorSummaryPatch(
  existingSettings: unknown,
  mergedSettings: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!mergedSettings || !patch) return mergedSettings;
  const patchAppointment = patch['appointmentSettings'];
  const patchSummary = isRecord(patchAppointment)
    ? patchAppointment[DOCTOR_SUMMARY_SETTING_KEY]
    : undefined;
  if (!isRecord(patchSummary)) return mergedSettings;

  const storedAppointment =
    isRecord(existingSettings) && isRecord(existingSettings['appointmentSettings'])
      ? existingSettings['appointmentSettings']
      : {};
  const storedSummary = isRecord(storedAppointment[DOCTOR_SUMMARY_SETTING_KEY])
    ? storedAppointment[DOCTOR_SUMMARY_SETTING_KEY]
    : {};
  const mergedAppointment = isRecord(mergedSettings['appointmentSettings'])
    ? mergedSettings['appointmentSettings']
    : {};
  return {
    ...mergedSettings,
    appointmentSettings: {
      ...mergedAppointment,
      [DOCTOR_SUMMARY_SETTING_KEY]: { ...storedSummary, ...patchSummary },
    },
  };
}
