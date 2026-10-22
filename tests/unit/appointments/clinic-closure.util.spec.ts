/**
 * clinic_holidays day matching used by slot availability and booking validation
 * (src/services/appointments/core/clinic-closure.util.ts). Pure helpers + the reader with a fake client.
 */
import { describe, it, expect, jest } from '@jest/globals';
import {
  CLINIC_CLOSED_MESSAGE,
  DOCTOR_ON_LEAVE_MESSAGE,
  closureDayKey,
  decideClosure,
  findClinicClosure,
  findDoctorLeaveClosure,
  isFullDayLeave,
  readClosureForDay,
  type ClinicClosureRow,
  type DoctorLeaveRow,
} from '@services/appointments/core/clinic-closure.util';

const day = (key: string): Date => new Date(`${key}T00:00:00.000Z`);

const holiday = (over: Partial<ClinicClosureRow> = {}): ClinicClosureRow => ({
  kind: 'HOLIDAY',
  locationId: null,
  startDate: day('2026-10-24'),
  endDate: day('2026-10-26'),
  ...over,
});

const fullLeave = (over: Partial<DoctorLeaveRow> = {}): DoctorLeaveRow => ({
  locationId: 'loc-a',
  kind: 'LEAVE',
  startDate: day('2026-10-24'),
  endDate: day('2026-10-26'),
  ...over,
});

describe('closureDayKey', () => {
  it('reads DATE columns on their UTC calendar day and accepts YYYY-MM-DD strings', () => {
    expect(closureDayKey(day('2026-10-24'))).toBe('2026-10-24');
    expect(closureDayKey('2026-10-24')).toBe('2026-10-24');
    expect(closureDayKey('2026-10-24T00:00:00.000Z')).toBe('2026-10-24');
    expect(closureDayKey('not a date')).toBeNull();
    expect(closureDayKey(null)).toBeNull();
  });
});

describe('findClinicClosure', () => {
  it('covers start .. end inclusive', () => {
    const rows = [holiday()];
    expect(findClinicClosure(rows, { dayKey: '2026-10-23' })).toBeNull();
    expect(findClinicClosure(rows, { dayKey: '2026-10-24' })).not.toBeNull();
    expect(findClinicClosure(rows, { dayKey: '2026-10-26' })).not.toBeNull();
    expect(findClinicClosure(rows, { dayKey: '2026-10-27' })).toBeNull();
  });

  it('clinic-wide rows close every location and video; location rows only that location', () => {
    const local = [holiday({ locationId: 'loc-a', kind: 'CLOSURE' })];
    expect(findClinicClosure(local, { dayKey: '2026-10-24', locationId: 'loc-a' })).not.toBeNull();
    expect(findClinicClosure(local, { dayKey: '2026-10-24', locationId: 'loc-b' })).toBeNull();
    expect(findClinicClosure(local, { dayKey: '2026-10-24', locationId: null })).toBeNull();
    expect(
      findClinicClosure([holiday()], { dayKey: '2026-10-24', locationId: null })
    ).not.toBeNull();
  });

  it('never treats a DOCTOR_LEAVE row as a clinic closure', () => {
    expect(
      findClinicClosure([holiday({ kind: 'DOCTOR_LEAVE' })], { dayKey: '2026-10-24' })
    ).toBeNull();
  });
});

describe('doctor leave', () => {
  const leaveRow = holiday({ kind: 'DOCTOR_LEAVE', locationId: 'loc-a' });

  it('blocks only when an approved full-day leave of this doctor has the same days', () => {
    expect(findDoctorLeaveClosure([leaveRow], [fullLeave()], '2026-10-25')).not.toBeNull();
    expect(findDoctorLeaveClosure([leaveRow], [], '2026-10-25')).toBeNull();
    expect(
      findDoctorLeaveClosure([leaveRow], [fullLeave({ endDate: day('2026-10-25') })], '2026-10-25')
    ).toBeNull();
  });

  it('partial-day leave (HALF_DAY / BREAK with times) does not close the day', () => {
    expect(isFullDayLeave(fullLeave())).toBe(true);
    expect(
      isFullDayLeave(fullLeave({ kind: 'HALF_DAY', startTime: '09:00', endTime: '13:00' }))
    ).toBe(false);
    expect(
      findDoctorLeaveClosure(
        [leaveRow],
        [fullLeave({ kind: 'BREAK', startTime: '13:00', endTime: '14:00' })],
        '2026-10-25'
      )
    ).toBeNull();
  });

  it('decideClosure names the reason', () => {
    expect(decideClosure([holiday()], [], { dayKey: '2026-10-24' })).toEqual({
      closed: true,
      reason: CLINIC_CLOSED_MESSAGE,
    });
    expect(
      decideClosure([leaveRow], [fullLeave()], { dayKey: '2026-10-24', locationId: 'loc-a' })
    ).toEqual({ closed: true, reason: DOCTOR_ON_LEAVE_MESSAGE });
    expect(decideClosure([], [], { dayKey: '2026-10-24' })).toEqual({
      closed: false,
      reason: null,
    });
  });
});

describe('readClosureForDay', () => {
  function database(client: Record<string, unknown>): never {
    return {
      executeHealthcareRead: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
    } as never;
  }

  it('one day-bounded query for a plain holiday; no doctor lookup', async () => {
    const holidays = jest.fn(async (_args: unknown) => [holiday()]);
    const doctor = jest.fn(async (_args: unknown) => ({ userId: 'u-doc' }));
    const result = await readClosureForDay(
      database({ clinicHoliday: { findMany: holidays }, doctor: { findFirst: doctor } }),
      'c1',
      'd1',
      { dayKey: '2026-10-24', locationId: 'loc-a' }
    );
    expect(result.closed).toBe(true);
    expect(holidays).toHaveBeenCalledTimes(1);
    const where = (holidays.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ clinicId: 'c1', deletedAt: null });
    expect(doctor).not.toHaveBeenCalled();
  });

  it('a DOCTOR_LEAVE row is matched to the doctor through the approved leave request', async () => {
    const leaves = jest.fn(async (_args: unknown) => [fullLeave({ locationId: null })]);
    const client = {
      clinicHoliday: { findMany: jest.fn(async () => [holiday({ kind: 'DOCTOR_LEAVE' })]) },
      doctor: { findFirst: jest.fn(async () => ({ userId: 'u-doc' })) },
      leaveRequest: { findMany: leaves },
    };
    await expect(
      readClosureForDay(database(client), 'c1', 'd1', { dayKey: '2026-10-25' })
    ).resolves.toEqual({ closed: true, reason: DOCTOR_ON_LEAVE_MESSAGE });
    expect((leaves.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where).toMatchObject({
      clinicId: 'c1',
      userId: 'u-doc',
      status: 'APPROVED',
    });
  });

  it('a client without the clinicHoliday delegate answers open', async () => {
    await expect(
      readClosureForDay(database({}), 'c1', 'd1', { dayKey: '2026-10-24' })
    ).resolves.toEqual({ closed: false, reason: null });
  });
});
