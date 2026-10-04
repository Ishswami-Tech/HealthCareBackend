/**
 * Doctor weekly schedule <-> `Doctor.workingHours` JSON.
 *
 * The availability engine (CoreAppointmentService.getDoctorAvailability) reads `workingHours` as
 * `{ monday: [{ start: 'HH:mm', end: 'HH:mm' }], ... }` (an empty array means "not available that
 * day"), and also accepts the legacy flat `{ start, end }` / `[{ start, end }]` shapes that apply
 * to every day. Everything here writes the per-day shape and reads all of them, so the schedule
 * routes and the slot engine never disagree.
 */
import { IST_TIMEZONE, formatDateKeyInIST } from '@utils/date-time.util';

export const WEEK_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type WeekDay = (typeof WEEK_DAYS)[number];

export interface ScheduleSession {
  start: string;
  end: string;
}

export interface DoctorScheduleEntry {
  dayOfWeek: WeekDay;
  /** First session start ("HH:mm"), empty when the day is unavailable. */
  startTime: string;
  /** Last session end ("HH:mm"), empty when the day is unavailable. */
  endTime: string;
  isAvailable: boolean;
  /** Every session of the day (a day may have a morning and an evening block). */
  sessions: ScheduleSession[];
}

export type DoctorWorkingHoursByDay = Record<WeekDay, ScheduleSession[]>;

const DAY_MS = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** "9:5" -> "09:05"; anything that is not a valid HH:mm wall-clock time -> null. */
export function normalizeScheduleTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function scheduleTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function extractSessions(value: unknown): ScheduleSession[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (!isRecord(item)) return null;
        const start = normalizeScheduleTime(item['start']);
        const end = normalizeScheduleTime(item['end']);
        return start && end ? { start, end } : null;
      })
      .filter((session): session is ScheduleSession => session !== null);
  }
  if (isRecord(value)) {
    const start = normalizeScheduleTime(value['start']);
    const end = normalizeScheduleTime(value['end']);
    if (start && end) return [{ start, end }];
  }
  return [];
}

/** True when the JSON is keyed by weekday (the per-day shape); false for the legacy flat shapes. */
export function isPerDayWorkingHours(workingHours: unknown): boolean {
  return isRecord(workingHours) && WEEK_DAYS.some(day => day in workingHours);
}

/** Sessions of one weekday, whatever shape the stored JSON uses. */
export function sessionsForDay(workingHours: unknown, day: WeekDay): ScheduleSession[] {
  if (!workingHours) return [];
  if (isPerDayWorkingHours(workingHours)) {
    return extractSessions((workingHours as Record<string, unknown>)[day]);
  }
  return extractSessions(workingHours);
}

/** The 7-row schedule the clinic-admin and doctor screens edit. */
export function workingHoursToSchedule(workingHours: unknown): DoctorScheduleEntry[] {
  return WEEK_DAYS.map(dayOfWeek => {
    const sessions = sessionsForDay(workingHours, dayOfWeek);
    return {
      dayOfWeek,
      startTime: sessions[0]?.start ?? '',
      endTime: sessions[sessions.length - 1]?.end ?? '',
      isAvailable: sessions.length > 0,
      sessions,
    };
  });
}

export interface ScheduleEntryInput {
  dayOfWeek: string;
  startTime?: string | null;
  endTime?: string | null;
  isAvailable?: boolean;
  sessions?: Array<{ start?: string | null; end?: string | null }> | null;
}

/**
 * Builds the per-day `workingHours` JSON. Days missing from the input are unavailable (the client
 * sends the whole week). Throws an Error naming the offending day for an invalid time or an
 * end that is not after its start; callers map that to a 400.
 */
export function scheduleToWorkingHours(
  entries: readonly ScheduleEntryInput[]
): DoctorWorkingHoursByDay {
  const byDay = new Map<WeekDay, ScheduleSession[]>();
  for (const day of WEEK_DAYS) byDay.set(day, []);

  for (const entry of entries) {
    const day = String(entry.dayOfWeek || '')
      .trim()
      .toLowerCase() as WeekDay;
    if (!WEEK_DAYS.includes(day)) {
      throw new Error(`dayOfWeek must be one of ${WEEK_DAYS.join(', ')}`);
    }
    if (entry.isAvailable === false) {
      byDay.set(day, []);
      continue;
    }
    const rawSessions =
      entry.sessions && entry.sessions.length > 0
        ? entry.sessions
        : [{ start: entry.startTime, end: entry.endTime }];
    const sessions: ScheduleSession[] = [];
    for (const raw of rawSessions) {
      const start = normalizeScheduleTime(raw.start);
      const end = normalizeScheduleTime(raw.end);
      if (!start || !end) {
        throw new Error(`${day}: startTime and endTime must be HH:mm when the day is available`);
      }
      if (scheduleTimeToMinutes(end) <= scheduleTimeToMinutes(start)) {
        throw new Error(`${day}: endTime must be after startTime`);
      }
      sessions.push({ start, end });
    }
    sessions.sort(
      (left, right) => scheduleTimeToMinutes(left.start) - scheduleTimeToMinutes(right.start)
    );
    byDay.set(day, sessions);
  }

  return Object.fromEntries(byDay) as DoctorWorkingHoursByDay;
}

function istWeekDay(date: Date): WeekDay {
  return new Intl.DateTimeFormat('en-US', { timeZone: IST_TIMEZONE, weekday: 'long' })
    .format(date)
    .toLowerCase() as WeekDay;
}

/**
 * ISO instant of the next session start on or after `now` (IST), scanning `horizonDays` days.
 * Null when the doctor has no JSON schedule (legacy clinic-hours doctors) or nothing is ahead.
 * Booked slots are not consulted: this is the booking card hint, not an availability check.
 */
export function nextAvailableSlotFromWorkingHours(
  workingHours: unknown,
  now: Date = new Date(),
  horizonDays = 7
): string | null {
  if (!workingHours) return null;
  for (let offset = 0; offset < horizonDays; offset += 1) {
    const day = new Date(now.getTime() + offset * DAY_MS);
    const dateKey = formatDateKeyInIST(day);
    if (!dateKey) continue;
    for (const session of sessionsForDay(workingHours, istWeekDay(day))) {
      const start = new Date(`${dateKey}T${session.start}:00+05:30`);
      if (!Number.isNaN(start.getTime()) && start.getTime() > now.getTime()) {
        return start.toISOString();
      }
    }
  }
  return null;
}
