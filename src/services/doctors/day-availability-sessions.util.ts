/**
 * Shared helpers for the doctor day-availability flows (L1 overrides, L3 reassignment cascade):
 * the per-day session shape the slot grid consumes, IST day-key math, and the doctor's weekly
 * fallback windows (reusing doctor-schedule.util so the override paths and the schedule routes
 * never disagree about the stored workingHours JSON).
 */

import { IST_TIMEZONE } from '@utils/date-time.util';
import { WEEK_DAYS, sessionsForDay, type WeekDay } from '@services/doctors/doctor-schedule.util';

/** One OPD session block, the exact { start: 'HH:MM', end: 'HH:MM' } shape the grid consumes. */
export interface SessionWindow {
  start: string;
  end: string;
}

/** `HH:MM` -> minutes since midnight, or null when not a valid 24h time. */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** True when the slot start falls inside at least one session window (start <= t < end). */
export function timeInsideWindows(time: string, windows: readonly SessionWindow[]): boolean {
  const target = timeToMinutes(time);
  if (target === null) return false;
  return windows.some(window => {
    const start = timeToMinutes(window.start);
    const end = timeToMinutes(window.end);
    return start !== null && end !== null && target >= start && target < end;
  });
}

/** The doctor's weekly session windows for the IST weekday of an IST day key. */
export function weeklySessionsForDay(workingHours: unknown, dateKey: string): SessionWindow[] {
  return sessionsForDay(workingHours, istWeekdayOf(dateKey));
}

/** The IST weekday (lowercase long name) of a YYYY-MM-DD day key. */
export function istWeekdayOf(dateKey: string): WeekDay {
  const base = new Date(`${dateKey}T00:00:00.000+05:30`);
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: IST_TIMEZONE,
    weekday: 'long',
  })
    .format(base)
    .toLowerCase();
  return WEEK_DAYS.includes(day as WeekDay) ? (day as WeekDay) : 'monday';
}

/** `dateKey` + n days, as an IST YYYY-MM-DD day key (midnight-UTC DATE convention). */
export function addDaysIstKey(dateKey: string, days: number): string {
  const base = new Date(`${dateKey}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** A stored DATE column value (Prisma returns it as UTC midnight) -> YYYY-MM-DD day key. */
export function dateToIstDayKey(value: Date | string): string {
  if (typeof value === 'string') {
    const match = /^\d{4}-\d{2}-\d{2}/.exec(value.trim());
    if (match) return match[0];
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}
