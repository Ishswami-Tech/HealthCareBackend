/**
 * When each doctor gets a WhatsApp appointment summary today. Pure: the caller loads the
 * doctor-clinic pairs and the day's overrides, this decides what is due at a given IST minute.
 *
 * Everything comes from stored settings, nothing is fixed in code:
 *   - timing: Clinic.settings.appointmentSettings.doctorSummary (doctor-summary-settings.util.ts)
 *       morning summary  at `morningTime`, listing the whole day;
 *       window summaries `beforeWindowMinutes` before each consultation window opens;
 *   - windows:
 *       in-person: the doctor's first OPD session of the day, resolved like the slot grid does
 *         (intersection of location hours, the clinic's operatingWindowsByDay and the doctor's
 *         weekly hours or dated override; see session-layers.util.ts), listing in-person visits;
 *       video: the clinic's appointmentSettings.videoCallWindow, listing video visits.
 *     Without a videoCallWindow the in-person summary lists every visit of the day.
 *   A window summary names its window in the message ("18 Nov 2026 (OPD 9:00 AM - 5:00 PM)"),
 *   so it reads as the reminder it is, not as a repeat of the morning summary.
 *
 * The scheduler checks every minute; a summary is due during a span (not at one instant), so a
 * missed or failed check is retried by the next one inside the span, and deterministic job ids
 * make it send once.
 * Days without confirmed bookings send nothing (DoctorSummaryService skips them), which is also
 * what keeps closed days / holidays quiet without a separate rule.
 */

import type { DoctorSummaryTypeFilter, DoctorSummaryWindowKind } from '@core/types/queue.types';
import { resolveDoctorSummarySettings } from '@utils/doctor-summary-settings.util';
import {
  intersectSessionLayers,
  LEGACY_DEFAULT_WORKING_HOURS,
} from '@services/appointments/core/session-layers.util';
import { parseDaySessions } from '@services/appointments/core/day-availability.util';
import { sessionsForDay } from '@services/doctors/doctor-schedule.util';
import {
  istWeekdayOf,
  timeToMinutes,
  type SessionWindow,
} from '@services/doctors/day-availability-sessions.util';

/** How long after `morningTime` a missed check (worker restart) may still send the morning summary. */
export const MORNING_SUMMARY_CATCH_UP_MINUTES = 15;

const VIDEO_CALL = 'VIDEO_CALL';
const MINUTES_PER_DAY = 24 * 60;

export type DoctorSummaryKind = 'morning' | DoctorSummaryWindowKind;

export interface DoctorSummaryWindow {
  kind: DoctorSummaryWindowKind;
  /** Window start, HH:MM IST. */
  start: string;
  /** Window end, HH:MM IST (in-person: end of the day's last OPD session). */
  end: string;
  /** Which of the day's appointments this summary lists; absent = all of them. */
  typeFilter?: DoctorSummaryTypeFilter;
}

/** One doctor-clinic association with the schedule layers stored for it. */
export interface DoctorSummaryPair {
  doctorId: string;
  doctorUserId: string;
  clinicId: string;
  locationId: string | null;
  doctorWorkingHours: unknown;
  locationWorkingHours: unknown;
  clinicSettings: unknown;
  /** DoctorClinic.startTime / endTime as HH:MM IST: the legacy hours when no layer is set. */
  legacyStart?: string | null;
  legacyEnd?: string | null;
  /**
   * The clinic's active locations. A doctor not tied to one location (locationId null) can be
   * booked at any of them, and each visit uses its own location's dated override first.
   */
  clinicLocationIds?: readonly string[];
}

/** An active doctor_day_availability row for the day. */
export interface DoctorSummaryOverride {
  doctorId: string;
  clinicId: string;
  locationId: string | null;
  sessions: unknown;
}

export interface PlannedDoctorSummary {
  jobId: string;
  kind: DoctorSummaryKind;
  doctorId: string;
  doctorUserId: string;
  clinicId: string;
  /** HH:MM IST: the morning time, or the start of the window the summary is for. */
  at: string;
  /** Window summaries: HH:MM IST end of the window. */
  windowEnd?: string;
  typeFilter?: DoctorSummaryTypeFilter;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Location hours are stored as a JSON string by PUT .../working-hours; the rest as JSON. */
function parseStored(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function appointmentSettingsOf(clinicSettings: unknown): Record<string, unknown> {
  const settings = parseStored(clinicSettings);
  if (!isRecord(settings)) return {};
  const appointmentSettings = settings['appointmentSettings'];
  return isRecord(appointmentSettings) ? appointmentSettings : {};
}

/** The clinic's video-call window, or null when unset / invalid (same rules as booking). */
export function videoCallWindowOf(
  appointmentSettings: Record<string, unknown>
): SessionWindow | null {
  const raw = appointmentSettings['videoCallWindow'];
  if (!isRecord(raw)) return null;
  const [window] = parseDaySessions([raw]);
  if (!window) return null;
  const start = timeToMinutes(window.start);
  const end = timeToMinutes(window.end);
  return start !== null && end !== null && end > start ? window : null;
}

/**
 * The consultation windows of one doctor-clinic pair on IST day `dateKey`, in time order.
 * `overrideSessions` is the dated override's sessions (`[]` = closed), or null when none.
 */
export function resolveDoctorSummaryWindows(input: {
  dateKey: string;
  clinicSettings: unknown;
  locationWorkingHours: unknown;
  doctorWorkingHours: unknown;
  overrideSessions: readonly SessionWindow[] | null;
  legacyStart?: string | null;
  legacyEnd?: string | null;
}): DoctorSummaryWindow[] {
  const day = istWeekdayOf(input.dateKey);
  const appointmentSettings = appointmentSettingsOf(input.clinicSettings);
  const video = videoCallWindowOf(appointmentSettings);

  const location = sessionsForDay(parseStored(input.locationWorkingHours), day);
  const clinic = sessionsForDay(parseStored(appointmentSettings['operatingWindowsByDay']), day);
  const doctorHours = parseStored(input.doctorWorkingHours);
  const doctor =
    input.overrideSessions !== null
      ? input.overrideSessions
      : doctorHours
        ? sessionsForDay(doctorHours, day)
        : null;
  // Same rule as the slot grid (core-appointment.service): with a schedule stored anywhere, a day
  // no layer covers is closed; only with nothing stored at all do the legacy hours apply
  // (DoctorClinic start/end, else the default), so a doctor who can be booked gets a summary.
  const hasStoredSchedule =
    Boolean(input.locationWorkingHours) ||
    Boolean(input.doctorWorkingHours) ||
    isRecord(appointmentSettings['operatingWindowsByDay']);
  const inPerson =
    intersectSessionLayers([
      location.length > 0 ? location : null,
      clinic.length > 0 ? clinic : null,
      doctor,
    ]) ??
    (hasStoredSchedule
      ? []
      : [
          {
            start: input.legacyStart || LEGACY_DEFAULT_WORKING_HOURS.start,
            end: input.legacyEnd || LEGACY_DEFAULT_WORKING_HOURS.end,
          },
        ]);

  const windows: DoctorSummaryWindow[] = [];
  const firstSession = inPerson[0];
  const lastSession = inPerson[inPerson.length - 1];
  if (firstSession && lastSession) {
    windows.push({
      kind: 'in_person',
      start: firstSession.start,
      end: lastSession.end,
      ...(video ? { typeFilter: { notIn: [VIDEO_CALL] } } : {}),
    });
  }
  if (video) {
    windows.push({
      kind: 'video',
      start: video.start,
      end: video.end,
      typeFilter: { in: [VIDEO_CALL] },
    });
  }
  return windows.sort((a, b) => (timeToMinutes(a.start) ?? 0) - (timeToMinutes(b.start) ?? 0));
}

/**
 * The dated overrides that can apply to a pair's in-person visits, like the slot grid picks
 * them (readDayOverrideForDay: the visit's location first, then clinic-wide):
 *   - a doctor tied to a location: that location's override, else the clinic-wide one;
 *   - a doctor not tied to one: each clinic location's own override, else the clinic-wide one
 *     (one entry per distinct result).
 * `null` in the list = no override (the weekly hours apply).
 */
function overrideSessionSets(
  pair: DoctorSummaryPair,
  overrides: readonly DoctorSummaryOverride[]
): Array<SessionWindow[] | null> {
  const same = overrides.filter(o => o.doctorId === pair.doctorId && o.clinicId === pair.clinicId);
  const clinicWide = same.find(o => o.locationId === null);
  const forLocation = (locationId: string): DoctorSummaryOverride | undefined =>
    same.find(o => o.locationId === locationId) ?? clinicWide;
  const rows = pair.locationId
    ? [forLocation(pair.locationId)]
    : (pair.clinicLocationIds ?? []).length > 0
      ? [...new Set((pair.clinicLocationIds ?? []).map(forLocation))]
      : [clinicWide];
  return rows.map(row => (row ? parseDaySessions(row.sessions) : null));
}

function windowsForPair(
  pair: DoctorSummaryPair,
  overrides: readonly DoctorSummaryOverride[],
  dateKey: string
): DoctorSummaryWindow[] {
  const perOverride = overrideSessionSets(pair, overrides).map(overrideSessions =>
    resolveDoctorSummaryWindows({
      dateKey,
      clinicSettings: pair.clinicSettings,
      locationWorkingHours: pair.locationWorkingHours,
      doctorWorkingHours: pair.doctorWorkingHours,
      overrideSessions,
      legacyStart: pair.legacyStart ?? null,
      legacyEnd: pair.legacyEnd ?? null,
    })
  );
  if (perOverride.length === 1) return perOverride[0] ?? [];
  // Several locations with different hours: the in-person window spans all of them (opens at
  // the earliest, closes at the latest); the video window is the clinic's, the same for each.
  const minutes = (time: string) => timeToMinutes(time) ?? 0;
  const inPerson = perOverride
    .flat()
    .filter(window => window.kind === 'in_person')
    .reduce<DoctorSummaryWindow | null>(
      (acc, window) =>
        acc
          ? {
              ...acc,
              start: minutes(window.start) < minutes(acc.start) ? window.start : acc.start,
              end: minutes(window.end) > minutes(acc.end) ? window.end : acc.end,
            }
          : window,
      null
    );
  const video = perOverride.flat().find(window => window.kind === 'video');
  return [inPerson, video]
    .filter((window): window is DoctorSummaryWindow => Boolean(window))
    .sort((a, b) => minutes(a.start) - minutes(b.start));
}

/**
 * Whether a booking confirmed at `nowMinutes` should trigger an updated summary: only after the
 * day's first scheduled summary has gone out (earlier bookings are in it anyway) and before the
 * doctor's last window closes. With no window configured, only the first condition applies;
 * with no scheduled summary at all, any time until the last window closes.
 */
export function isWithinDoctorSummaryDay(
  pair: DoctorSummaryPair,
  overrides: readonly DoctorSummaryOverride[],
  dateKey: string,
  nowMinutes: number
): boolean {
  const settings = resolveDoctorSummarySettings(pair.clinicSettings);
  const windows = windowsForPair(pair, overrides, dateKey);
  const starts: number[] = [];
  if (settings.morningEnabled) {
    const morning = timeToMinutes(settings.morningTime);
    if (morning !== null) starts.push(morning);
  }
  if (settings.beforeWindowEnabled) {
    for (const window of windows) {
      const start = timeToMinutes(window.start);
      if (start !== null) starts.push(Math.max(0, start - settings.beforeWindowMinutes));
    }
  }
  const ends = windows
    .map(window => timeToMinutes(window.end))
    .filter((end): end is number => end !== null);
  const opensAt = starts.length > 0 ? Math.min(...starts) : 0;
  const closesAt = ends.length > 0 ? Math.max(...ends) : MINUTES_PER_DAY;
  return nowMinutes >= opensAt && nowMinutes < closesAt;
}

/**
 * Which summaries are due at `nowMinutes` (IST minutes since midnight) on IST day `dateKey`:
 *   - morning: during [morningTime, morningTime + catch-up);
 *   - window:  during [windowStart - beforeWindowMinutes, windowStart), skipped when the morning
 *     summary falls inside that same span (the doctor has just had the full list).
 * Job ids are per doctor, clinic, day and summary, so repeated checks enqueue each one once.
 */
export function planDoctorSummaries(
  pairs: readonly DoctorSummaryPair[],
  overrides: readonly DoctorSummaryOverride[],
  dateKey: string,
  nowMinutes: number
): PlannedDoctorSummary[] {
  const planned: PlannedDoctorSummary[] = [];
  for (const pair of pairs) {
    const settings = resolveDoctorSummarySettings(pair.clinicSettings);
    const morning = settings.morningEnabled ? (timeToMinutes(settings.morningTime) ?? null) : null;
    const base = {
      doctorId: pair.doctorId,
      doctorUserId: pair.doctorUserId,
      clinicId: pair.clinicId,
    };

    if (
      morning !== null &&
      nowMinutes >= morning &&
      nowMinutes < Math.min(morning + MORNING_SUMMARY_CATCH_UP_MINUTES, MINUTES_PER_DAY)
    ) {
      planned.push({
        // Same id the fixed 7 AM job used, so a deploy during the 7 AM span never sends twice.
        jobId: `doctor-summary-${pair.doctorUserId}-${pair.clinicId}-${dateKey}-cron`,
        kind: 'morning',
        ...base,
        at: settings.morningTime,
      });
    }

    if (!settings.beforeWindowEnabled) continue;
    for (const window of windowsForPair(pair, overrides, dateKey)) {
      const start = timeToMinutes(window.start);
      if (start === null) continue;
      const from = Math.max(0, start - settings.beforeWindowMinutes);
      if (nowMinutes < from || nowMinutes >= start) continue;
      if (morning !== null && morning >= from && morning <= start) continue;
      planned.push({
        jobId: `doctor-summary-${pair.doctorUserId}-${pair.clinicId}-${dateKey}-${window.kind}-window`,
        kind: window.kind,
        ...base,
        at: window.start,
        windowEnd: window.end,
        ...(window.typeFilter ? { typeFilter: window.typeFilter } : {}),
      });
    }
  }
  return planned;
}
