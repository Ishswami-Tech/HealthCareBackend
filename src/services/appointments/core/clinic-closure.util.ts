/**
 * Calendar closures from the `clinic_holidays` table (written by clinic-ops leave / holiday
 * services) as read by slot availability and booking validation.
 *
 *   HOLIDAY / CLOSURE  clinic-wide when `locationId` is null, else that location only
 *   DOCTOR_LEAVE       the row carries no doctor; it is matched to the approved leave request it
 *                      was created from (same clinic, same start / end day, full-day leave) and
 *                      then blocks only that doctor. An unmatched DOCTOR_LEAVE row blocks nobody.
 *
 * `startDate` / `endDate` are Postgres DATE columns (Prisma returns them as UTC midnight), so day
 * keys are compared on their UTC calendar date; the requested day is the IST `YYYY-MM-DD` key.
 */

import type { DatabaseService } from '@infrastructure/database';

export interface ClinicClosureRow {
  id?: string;
  title?: string | null;
  kind: string | null;
  locationId: string | null;
  startDate: Date | string;
  endDate: Date | string;
}

export interface DoctorLeaveRow {
  locationId?: string | null;
  kind?: string | null;
  startDate: Date | string;
  endDate: Date | string;
  startTime?: string | null;
  endTime?: string | null;
}

export interface ClosureQuery {
  /** IST calendar day `YYYY-MM-DD`. */
  dayKey: string;
  /** The visit's clinic location (absent for video visits: only clinic-wide closures apply). */
  locationId?: string | null;
}

export const DOCTOR_LEAVE_KIND = 'DOCTOR_LEAVE';
export const CLINIC_CLOSED_MESSAGE = 'Clinic is closed on this holiday';
export const DOCTOR_ON_LEAVE_MESSAGE = 'The doctor is on leave on this day';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}/;

/** `YYYY-MM-DD` of a DATE column value (UTC calendar date), or null when unreadable. */
export function closureDayKey(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const match = DAY_KEY.exec(value.trim());
    if (match) return match[0];
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
  return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
}

function coversDay(
  row: { startDate: Date | string; endDate: Date | string },
  dayKey: string
): boolean {
  const start = closureDayKey(row.startDate);
  const end = closureDayKey(row.endDate) ?? start;
  if (!start || !end) return false;
  return start <= dayKey && dayKey <= end;
}

function isDoctorLeaveKind(kind: string | null | undefined): boolean {
  return (
    String(kind ?? '')
      .trim()
      .toUpperCase() === DOCTOR_LEAVE_KIND
  );
}

/** A full-day leave (kind LEAVE, or no time window). HALF_DAY / BREAK with times do not close the day. */
export function isFullDayLeave(leave: DoctorLeaveRow): boolean {
  const kind = String(leave.kind ?? 'LEAVE')
    .trim()
    .toUpperCase();
  if (kind === 'LEAVE') return true;
  return !leave.startTime && !leave.endTime;
}

/** The HOLIDAY / CLOSURE row that closes the clinic (or the visit's location) on the day. */
export function findClinicClosure(
  rows: readonly ClinicClosureRow[],
  query: ClosureQuery
): ClinicClosureRow | null {
  return (
    rows.find(
      row =>
        !isDoctorLeaveKind(row.kind) &&
        coversDay(row, query.dayKey) &&
        (row.locationId === null || (!!query.locationId && row.locationId === query.locationId))
    ) ?? null
  );
}

/**
 * The DOCTOR_LEAVE row on the day that belongs to this doctor: its start / end day equal one of
 * the doctor's approved full-day leave requests (leave.service copies them verbatim on approval).
 */
export function findDoctorLeaveClosure(
  rows: readonly ClinicClosureRow[],
  doctorLeaves: readonly DoctorLeaveRow[],
  dayKey: string
): ClinicClosureRow | null {
  const fullDay = doctorLeaves.filter(isFullDayLeave);
  if (fullDay.length === 0) return null;
  return (
    rows.find(row => {
      if (!isDoctorLeaveKind(row.kind) || !coversDay(row, dayKey)) return false;
      const start = closureDayKey(row.startDate);
      const end = closureDayKey(row.endDate);
      return fullDay.some(
        leave =>
          closureDayKey(leave.startDate) === start &&
          closureDayKey(leave.endDate) === end &&
          (leave.locationId ?? null) === (row.locationId ?? null)
      );
    }) ?? null
  );
}

export interface ClosureDecision {
  closed: boolean;
  reason: string | null;
}

export function decideClosure(
  rows: readonly ClinicClosureRow[],
  doctorLeaves: readonly DoctorLeaveRow[],
  query: ClosureQuery
): ClosureDecision {
  if (findClinicClosure(rows, query)) return { closed: true, reason: CLINIC_CLOSED_MESSAGE };
  if (findDoctorLeaveClosure(rows, doctorLeaves, query.dayKey)) {
    return { closed: true, reason: DOCTOR_ON_LEAVE_MESSAGE };
  }
  return { closed: false, reason: null };
}

interface ClosureClient {
  clinicHoliday?: { findMany: (args: unknown) => Promise<ClinicClosureRow[]> };
  leaveRequest?: { findMany: (args: unknown) => Promise<DoctorLeaveRow[]> };
  doctor?: { findFirst: (args: unknown) => Promise<{ userId: string } | null> };
}

/**
 * Whether `dayKey` is closed for `doctorId` (Doctor.id) at `locationId`. One indexed, day-bounded
 * query on clinic_holidays; the doctor / leave lookup runs only when a DOCTOR_LEAVE row covers the
 * day. A client without the delegate (older generated client) answers "open".
 */
export async function readClosureForDay(
  database: Pick<DatabaseService, 'executeHealthcareRead'>,
  clinicId: string,
  doctorId: string,
  query: ClosureQuery
): Promise<ClosureDecision> {
  const day = new Date(`${query.dayKey}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) return { closed: false, reason: null };
  return database.executeHealthcareRead(async client => {
    const typed = client as unknown as ClosureClient;
    if (!typed.clinicHoliday) return { closed: false, reason: null };
    const rows = await typed.clinicHoliday.findMany({
      where: {
        clinicId,
        deletedAt: null,
        startDate: { lte: day },
        endDate: { gte: day },
      },
      select: {
        id: true,
        title: true,
        kind: true,
        locationId: true,
        startDate: true,
        endDate: true,
      },
      take: 50,
    });
    if (!Array.isArray(rows) || rows.length === 0) return { closed: false, reason: null };
    if (findClinicClosure(rows, query)) return { closed: true, reason: CLINIC_CLOSED_MESSAGE };
    if (!rows.some(row => isDoctorLeaveKind(row.kind))) return { closed: false, reason: null };
    if (!typed.doctor || !typed.leaveRequest) return { closed: false, reason: null };
    const doctor = await typed.doctor.findFirst({
      where: { OR: [{ id: doctorId }, { userId: doctorId }] },
      select: { userId: true },
    });
    if (!doctor?.userId) return { closed: false, reason: null };
    const leaves = await typed.leaveRequest.findMany({
      where: {
        clinicId,
        userId: doctor.userId,
        status: 'APPROVED',
        startDate: { lte: day },
        endDate: { gte: day },
      },
      select: {
        locationId: true,
        kind: true,
        startDate: true,
        endDate: true,
        startTime: true,
        endTime: true,
      },
      take: 20,
    });
    return decideClosure(rows, Array.isArray(leaves) ? leaves : [], query);
  });
}
