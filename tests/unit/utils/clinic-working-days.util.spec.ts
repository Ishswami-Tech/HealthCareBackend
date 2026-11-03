/**
 * Clinic working days (settings JSON, default Mon-Fri) + location per-day hours + holidays: the
 * one rule used by the booking check, the slot grid and the walk-in next-available search.
 * src/libs/utils/clinic-working-days.util.ts
 */
import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_WORKING_DAYS,
  closedWeekDayMessage,
  isBookableDay,
  locationOpenDays,
  normalizeWorkingDays,
  resolveClinicWorkingDays,
  resolveDayBookability,
  sanitizeWorkingDaysSetting,
  weekDayOfDateKey,
} from '@utils/clinic-working-days.util';

// Thu 22 Oct 2026 .. Sun 25 Oct 2026
const THU = '2026-10-22';
const SAT = '2026-10-24';
const SUN = '2026-10-25';

const withDays = (workingDays: unknown) => ({ appointmentSettings: { workingDays } });

describe('clinic working days', () => {
  it('default (no setting) is the old rule: Monday to Friday, weekends closed', () => {
    expect(DEFAULT_WORKING_DAYS).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
    expect(resolveClinicWorkingDays(undefined)).toEqual([...DEFAULT_WORKING_DAYS]);
    expect(resolveClinicWorkingDays({ appointmentSettings: {} })).toEqual([
      ...DEFAULT_WORKING_DAYS,
    ]);
    expect(isBookableDay({ dateKey: THU, clinicSettings: {} })).toBe(true);
    expect(isBookableDay({ dateKey: SAT, clinicSettings: {} })).toBe(false);
    expect(isBookableDay({ dateKey: SUN, clinicSettings: null })).toBe(false);
  });

  it('a clinic that opens Saturday books Saturday, Sunday still refused with friendly copy', () => {
    const settings = withDays(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
    expect(resolveDayBookability({ dateKey: SAT, clinicSettings: settings })).toEqual({
      open: true,
      weekDay: 'saturday',
    });
    expect(resolveDayBookability({ dateKey: SUN, clinicSettings: settings })).toEqual({
      open: false,
      weekDay: 'sunday',
      reason: 'CLINIC_CLOSED_WEEKDAY',
      message: 'The clinic is closed on Sundays. Please pick another day.',
    });
  });

  it('accepts the appointmentSettings object directly, short names and getUTCDay numbers', () => {
    expect(resolveClinicWorkingDays({ workingDays: ['Sat', 'MON'] })).toEqual([
      'monday',
      'saturday',
    ]);
    expect(normalizeWorkingDays([0, 6, 6])).toEqual(['saturday', 'sunday']);
  });

  it('a malformed or empty list falls back to the default', () => {
    expect(normalizeWorkingDays([])).toBeNull();
    expect(normalizeWorkingDays(['funday'])).toBeNull();
    expect(normalizeWorkingDays('monday')).toBeNull();
    expect(resolveClinicWorkingDays(withDays(['funday']))).toEqual([...DEFAULT_WORKING_DAYS]);
  });

  it('per-location per-day hours close a day the clinic works', () => {
    const settings = withDays(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
    const hours = JSON.stringify({
      monday: { start: '09:00', end: '17:00' },
      thursday: [{ start: '09:00', end: '13:00' }],
      saturday: null,
    });
    expect(locationOpenDays(hours)).toEqual(['monday', 'thursday']);
    expect(
      resolveDayBookability({ dateKey: SAT, clinicSettings: settings, locationWorkingHours: hours })
    ).toMatchObject({ open: false, reason: 'LOCATION_CLOSED_WEEKDAY' });
    expect(
      isBookableDay({ dateKey: THU, clinicSettings: settings, locationWorkingHours: hours })
    ).toBe(true);
  });

  it('a location open on Saturday cannot open a day the clinic setting closes (default kept)', () => {
    const hours = {
      saturday: { start: '10:00', end: '14:00' },
      monday: { start: '09:00', end: '17:00' },
    };
    expect(
      resolveDayBookability({ dateKey: SAT, clinicSettings: {}, locationWorkingHours: hours })
    ).toMatchObject({ open: false, reason: 'CLINIC_CLOSED_WEEKDAY' });
  });

  it('one window for every day (or no hours) does not restrict days', () => {
    expect(locationOpenDays('{"start":"00:00","end":"23:59"}')).toBeNull();
    expect(locationOpenDays(null)).toBeNull();
    expect(locationOpenDays('not json')).toBeNull();
    const settings = withDays(['saturday']);
    expect(
      isBookableDay({
        dateKey: SAT,
        clinicSettings: settings,
        locationWorkingHours: '{"start":"00:00","end":"23:59"}',
      })
    ).toBe(true);
  });

  it('holidays are still respected on a working day', () => {
    expect(
      resolveDayBookability({ dateKey: THU, clinicSettings: {}, closedDateKeys: new Set([THU]) })
    ).toMatchObject({ open: false, reason: 'HOLIDAY' });
    expect(
      isBookableDay({ dateKey: THU, clinicSettings: {}, closedDateKeys: new Set(['2026-10-23']) })
    ).toBe(true);
  });

  it('weekday of an IST day key and the refusal copy', () => {
    expect(weekDayOfDateKey(THU)).toBe('thursday');
    expect(weekDayOfDateKey('2026-02-30')).toBeNull();
    expect(weekDayOfDateKey('garbage')).toBeNull();
    expect(closedWeekDayMessage('saturday')).toBe(
      'The clinic is closed on Saturdays. Please pick another day.'
    );
  });

  it('PUT sanitizer: stores a valid list Monday first, drops a bad one, keeps null (reset)', () => {
    expect(sanitizeWorkingDaysSetting({ workingDays: ['sat', 'mon'] })).toEqual({
      workingDays: ['monday', 'saturday'],
    });
    expect(sanitizeWorkingDaysSetting({ workingDays: [], other: 1 })).toEqual({ other: 1 });
    expect(sanitizeWorkingDaysSetting({ workingDays: null })).toEqual({ workingDays: null });
    expect(sanitizeWorkingDaysSetting({ other: 1 })).toEqual({ other: 1 });
  });
});
