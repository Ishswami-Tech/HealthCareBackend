/**
 * Visit length per clinic (product rule): every clinic decides how long an in-person and a video
 * visit last. The values live in the clinic's existing settings JSON
 * (`Clinic.settings.appointmentSettings`), edited with `PUT /clinics/:id` like every other clinic
 * setting; no new table.
 *
 *   appointmentSettings.inPersonDurationMinutes   default 3   (walk-ins use the same value)
 *   appointmentSettings.videoDurationMinutes      default 15
 *
 * The legacy `appointmentSettings.appointmentDuration` (the old single slot length, read by the
 * slot grid before) still counts for in-person visits when the new key is absent.
 *
 * The server resolves the duration at booking from the appointment type; a duration sent by the
 * client is never used. The same value drives the availability grid and the slot-conflict check,
 * so a slot is never offered that the booking would refuse. Pure, framework-free.
 */

export const IN_PERSON_DURATION_SETTING_KEY = 'inPersonDurationMinutes';
export const VIDEO_DURATION_SETTING_KEY = 'videoDurationMinutes';
/** Legacy single slot length, honoured for in-person visits when the new key is absent. */
export const LEGACY_DURATION_SETTING_KEY = 'appointmentDuration';

export const DEFAULT_IN_PERSON_VISIT_MINUTES = 3;
export const DEFAULT_VIDEO_VISIT_MINUTES = 15;

export const MIN_VISIT_MINUTES = 1;
export const MAX_VISIT_MINUTES = 240;

export interface ClinicVisitDurations {
  inPersonMinutes: number;
  videoMinutes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A whole number of minutes in [1, 240], or null for anything else (strings like "5" count). */
export function normalizeVisitMinutes(value: unknown): number | null {
  const parsed =
    typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : (value as number);
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return null;
  const minutes = Math.round(parsed);
  return minutes >= MIN_VISIT_MINUTES && minutes <= MAX_VISIT_MINUTES ? minutes : null;
}

/** `Clinic.settings` (whole JSON) or its `appointmentSettings` object -> the appointment settings. */
function appointmentSettingsOf(settings: unknown): Record<string, unknown> {
  if (!isRecord(settings)) return {};
  return isRecord(settings['appointmentSettings']) ? settings['appointmentSettings'] : settings;
}

/** Both visit lengths of a clinic, defaults filled in. Accepts `Clinic.settings` as stored. */
export function resolveClinicVisitDurations(settings: unknown): ClinicVisitDurations {
  const appointmentSettings = appointmentSettingsOf(settings);
  return {
    inPersonMinutes:
      normalizeVisitMinutes(appointmentSettings[IN_PERSON_DURATION_SETTING_KEY]) ??
      normalizeVisitMinutes(appointmentSettings[LEGACY_DURATION_SETTING_KEY]) ??
      DEFAULT_IN_PERSON_VISIT_MINUTES,
    videoMinutes:
      normalizeVisitMinutes(appointmentSettings[VIDEO_DURATION_SETTING_KEY]) ??
      DEFAULT_VIDEO_VISIT_MINUTES,
  };
}

export function isVideoAppointmentType(type: string | null | undefined): boolean {
  return (
    String(type ?? '')
      .trim()
      .toUpperCase() === 'VIDEO_CALL'
  );
}

/** The visit length for one appointment type (every non-video type is an in-person visit). */
export function visitMinutesForType(
  durations: ClinicVisitDurations,
  type: string | null | undefined
): number {
  return isVideoAppointmentType(type) ? durations.videoMinutes : durations.inPersonMinutes;
}

/** Shortcut: `Clinic.settings` + appointment type -> minutes. */
export function resolveVisitDurationMinutes(
  settings: unknown,
  type: string | null | undefined
): number {
  return visitMinutesForType(resolveClinicVisitDurations(settings), type);
}

/**
 * Cleans the two duration keys of an incoming `appointmentSettings` patch (PUT /clinics/:id):
 * valid values are stored as whole minutes, invalid ones are dropped (the stored value stays),
 * `null` is kept so the merge deletes the key (back to the default).
 */
export function sanitizeVisitDurationSettings(
  appointmentSettings: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...appointmentSettings };
  for (const key of [IN_PERSON_DURATION_SETTING_KEY, VIDEO_DURATION_SETTING_KEY]) {
    if (!(key in next) || next[key] === null) continue;
    const minutes = normalizeVisitMinutes(next[key]);
    if (minutes === null) delete next[key];
    else next[key] = minutes;
  }
  return next;
}

/** Shared-cache lifetime of a clinic's resolved in-person visit length (seconds). */
export const CLINIC_IN_PERSON_MINUTES_CACHE_TTL_SECONDS = 300;

/**
 * Shared-cache key of a clinic's resolved in-person visit length (read by the patient poll path,
 * busted by ClinicService.updateClinic). Only the derived number is cached, never the settings
 * blob (it carries provider configuration).
 */
export function clinicInPersonMinutesCacheKey(clinicId: string): string {
  return `clinic:${clinicId}:in-person-minutes`;
}
