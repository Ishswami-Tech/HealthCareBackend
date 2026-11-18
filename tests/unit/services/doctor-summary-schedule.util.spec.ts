/// <reference types="jest" />
/**
 * When doctors get their WhatsApp summaries: the morning full-day summary and one before each
 * consultation window, all from stored settings. Fixtures mirror the live clinic: video calls
 * 14:00-17:00, clinic open 09:00-18:00 Mon-Fri, doctor 09:00-17:00 Mon-Fri.
 */

import {
  isWithinDoctorSummaryDay,
  planDoctorSummaries,
  resolveDoctorSummaryWindows,
  type DoctorSummaryPair,
} from '@services/appointments/doctor-summary-schedule.util';

const weekdays = (start: string, end: string) => ({
  monday: [{ start, end }],
  tuesday: [{ start, end }],
  wednesday: [{ start, end }],
  thursday: [{ start, end }],
  friday: [{ start, end }],
  saturday: [],
  sunday: [],
});

const appointmentSettings = {
  videoCallWindow: { start: '14:00', end: '17:00' },
  operatingWindowsByDay: weekdays('09:00', '18:00'),
};

const WEDNESDAY = '2026-11-18';
const SATURDAY = '2026-11-21';
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const pair = (overrides: Partial<DoctorSummaryPair> = {}): DoctorSummaryPair => ({
  doctorId: 'doc-1',
  doctorUserId: 'user-1',
  clinicId: 'clinic-1',
  locationId: 'loc-1',
  doctorWorkingHours: weekdays('09:00', '17:00'),
  locationWorkingHours: JSON.stringify(weekdays('09:00', '18:00')),
  clinicSettings: { appointmentSettings },
  ...overrides,
});

const withSummary = (doctorSummary: Record<string, unknown>, extra = {}) => ({
  appointmentSettings: { ...appointmentSettings, ...extra, doctorSummary },
});

/** Every summary that becomes due during the day, checked every minute like the scheduler. */
const dayPlan = (p: DoctorSummaryPair, dateKey = WEDNESDAY, overrides = []) => {
  const firstDue = new Map<string, string>();
  for (let m = 0; m < 24 * 60; m += 1) {
    for (const s of planDoctorSummaries([p], overrides, dateKey, m)) {
      if (!firstDue.has(s.jobId)) {
        firstDue.set(
          s.jobId,
          `${s.kind}@${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
        );
      }
    }
  }
  return [...firstDue.values()];
};

describe('resolveDoctorSummaryWindows', () => {
  const resolve = (p: DoctorSummaryPair, dateKey: string, overrideSessions = null) =>
    resolveDoctorSummaryWindows({
      dateKey,
      clinicSettings: p.clinicSettings,
      locationWorkingHours: p.locationWorkingHours,
      doctorWorkingHours: p.doctorWorkingHours,
      overrideSessions,
    });

  it('gives the in-person OPD window and the video window, in time order', () => {
    expect(resolve(pair(), WEDNESDAY)).toEqual([
      { kind: 'in_person', start: '09:00', end: '17:00', typeFilter: { notIn: ['VIDEO_CALL'] } },
      { kind: 'video', start: '14:00', end: '17:00', typeFilter: { in: ['VIDEO_CALL'] } },
    ]);
  });

  it('opens the in-person window where ALL layers overlap and ends at the last session', () => {
    const doctorWorkingHours = {
      ...weekdays('10:30', '13:00'),
      wednesday: [
        { start: '10:30', end: '13:00' },
        { start: '16:00', end: '20:00' },
      ],
    };
    expect(resolve(pair({ doctorWorkingHours }), WEDNESDAY)[0]).toMatchObject({
      kind: 'in_person',
      start: '10:30',
      end: '18:00',
    });
  });

  it('uses a dated override instead of the weekly hours', () => {
    const windows = resolveDoctorSummaryWindows({
      dateKey: WEDNESDAY,
      clinicSettings: { appointmentSettings },
      locationWorkingHours: null,
      doctorWorkingHours: weekdays('09:00', '17:00'),
      overrideSessions: [{ start: '12:00', end: '15:00' }],
    });
    expect(windows[0]).toMatchObject({ kind: 'in_person', start: '12:00', end: '15:00' });
  });

  it('has no in-person window on a closed day, but keeps the video window', () => {
    expect(resolve(pair(), SATURDAY).map(w => w.kind)).toEqual(['video']);
  });

  it('lists every visit in the in-person summary when the clinic has no video window', () => {
    const windows = resolve(
      pair({
        clinicSettings: {
          appointmentSettings: { operatingWindowsByDay: weekdays('09:00', '18:00') },
        },
      }),
      WEDNESDAY
    );
    expect(windows).toEqual([{ kind: 'in_person', start: '09:00', end: '17:00' }]);
  });

  it('ignores an invalid video window (end before start)', () => {
    const windows = resolve(
      pair({
        clinicSettings: {
          appointmentSettings: { videoCallWindow: { start: '17:00', end: '14:00' } },
        },
      }),
      WEDNESDAY
    );
    expect(windows.map(w => w.kind)).toEqual(['in_person']);
  });

  it('with no hours configured anywhere, uses the slot grid legacy hours (default 11:00)', () => {
    expect(
      resolve(
        pair({ clinicSettings: {}, doctorWorkingHours: null, locationWorkingHours: null }),
        WEDNESDAY
      )
    ).toEqual([{ kind: 'in_person', start: '11:00', end: '23:59' }]);
  });

  it('with a weekly schedule stored, a day no layer covers is closed (no legacy hours)', () => {
    // Like the slot grid: clinic windows stored, Saturday empty, no doctor / location hours.
    const p = pair({
      clinicSettings: {
        appointmentSettings: { operatingWindowsByDay: weekdays('09:00', '18:00') },
      },
      doctorWorkingHours: null,
      locationWorkingHours: null,
    });
    expect(resolve(p, SATURDAY)).toEqual([]);
    expect(resolve(p, WEDNESDAY)).toEqual([{ kind: 'in_person', start: '09:00', end: '18:00' }]);
  });

  it('with no hours configured, uses the DoctorClinic start / end when set', () => {
    expect(
      resolveDoctorSummaryWindows({
        dateKey: WEDNESDAY,
        clinicSettings: {},
        locationWorkingHours: null,
        doctorWorkingHours: null,
        overrideSessions: null,
        legacyStart: '10:00',
        legacyEnd: '13:00',
      })
    ).toEqual([{ kind: 'in_person', start: '10:00', end: '13:00' }]);
  });
});

describe('planDoctorSummaries', () => {
  it('with default settings: morning at 7:00, in-person at 8:45, video at 1:45 PM, each once', () => {
    expect(dayPlan(pair())).toEqual(['morning@07:00', 'in_person@08:45', 'video@13:45']);
  });

  it('follows the clinic setting for the morning time and the lead time', () => {
    const p = pair({
      clinicSettings: withSummary({ morningTime: '06:30', beforeWindowMinutes: 30 }),
    });
    expect(dayPlan(p)).toEqual(['morning@06:30', 'in_person@08:30', 'video@13:30']);
  });

  it('can switch either kind of summary off', () => {
    expect(dayPlan(pair({ clinicSettings: withSummary({ morningEnabled: false }) }))).toEqual([
      'in_person@08:45',
      'video@13:45',
    ]);
    expect(dayPlan(pair({ clinicSettings: withSummary({ beforeWindowEnabled: false }) }))).toEqual([
      'morning@07:00',
    ]);
  });

  it('skips a window summary when the morning summary falls inside its lead period', () => {
    const p = pair({ clinicSettings: withSummary({ morningTime: '08:50' }) });
    expect(dayPlan(p)).toEqual(['morning@08:50', 'video@13:45']);
  });

  it('still sends the morning summary when a check is missed, within the catch-up span', () => {
    const p = pair();
    expect(planDoctorSummaries([p], [], WEDNESDAY, at('07:10')).map(s => s.kind)).toEqual([
      'morning',
    ]);
    expect(planDoctorSummaries([p], [], WEDNESDAY, at('07:15'))).toEqual([]);
  });

  it('uses deterministic per-day job ids (morning keeps the old 7 AM id)', () => {
    expect(planDoctorSummaries([pair()], [], WEDNESDAY, at('07:00'))[0]?.jobId).toBe(
      'doctor-summary-user-1-clinic-1-2026-11-18-cron'
    );
    expect(planDoctorSummaries([pair()], [], WEDNESDAY, at('13:45'))).toEqual([
      {
        jobId: 'doctor-summary-user-1-clinic-1-2026-11-18-video-window',
        kind: 'video',
        doctorId: 'doc-1',
        doctorUserId: 'user-1',
        clinicId: 'clinic-1',
        at: '14:00',
        windowEnd: '17:00',
        typeFilter: { in: ['VIDEO_CALL'] },
      },
    ]);
  });

  it('applies a location-specific override before a clinic-wide one', () => {
    const overrides = [
      {
        doctorId: 'doc-1',
        clinicId: 'clinic-1',
        locationId: null,
        sessions: [{ start: '11:00', end: '13:00' }],
      },
      {
        doctorId: 'doc-1',
        clinicId: 'clinic-1',
        locationId: 'loc-1',
        sessions: [{ start: '10:00', end: '12:00' }],
      },
    ];
    expect(planDoctorSummaries([pair()], overrides, WEDNESDAY, at('09:45')).map(s => s.at)).toEqual(
      ['10:00']
    );
  });

  it('a doctor tied to a location ignores the overrides of other locations', () => {
    const overrides = [
      {
        doctorId: 'doc-1',
        clinicId: 'clinic-1',
        locationId: 'loc-2',
        sessions: [{ start: '12:00', end: '13:00' }],
      },
    ];
    expect(planDoctorSummaries([pair()], overrides, WEDNESDAY, at('08:45')).map(s => s.at)).toEqual(
      ['09:00']
    );
  });

  it('a doctor at any location: each location uses its own override, the window spans them', () => {
    const p = pair({ locationId: null, locationWorkingHours: null, clinicLocationIds: ['a', 'b'] });
    const overrides = [
      // Location a has its own hours today; location b falls back to the clinic-wide override.
      {
        doctorId: 'doc-1',
        clinicId: 'clinic-1',
        locationId: 'a',
        sessions: [{ start: '10:00', end: '11:00' }],
      },
      {
        doctorId: 'doc-1',
        clinicId: 'clinic-1',
        locationId: null,
        sessions: [{ start: '12:00', end: '15:00' }],
      },
    ];
    expect(planDoctorSummaries([p], overrides, WEDNESDAY, at('09:45'))).toEqual([
      expect.objectContaining({ kind: 'in_person', at: '10:00', windowEnd: '15:00' }),
    ]);
    // Without a clinic-wide override, location b keeps the weekly hours (09:00-17:00).
    expect(
      planDoctorSummaries([p], overrides.slice(0, 1), WEDNESDAY, at('08:45')).map(s => [
        s.at,
        s.windowEnd,
      ])
    ).toEqual([['09:00', '17:00']]);
  });

  it('sends no in-person summary when an override closes the day', () => {
    const overrides = [{ doctorId: 'doc-1', clinicId: 'clinic-1', locationId: null, sessions: [] }];
    expect(planDoctorSummaries([pair()], overrides, WEDNESDAY, at('08:45'))).toEqual([]);
  });

  it('ignores overrides of another doctor', () => {
    const overrides = [{ doctorId: 'doc-2', clinicId: 'clinic-1', locationId: null, sessions: [] }];
    expect(
      planDoctorSummaries([pair()], overrides, WEDNESDAY, at('08:45')).map(s => s.kind)
    ).toEqual(['in_person']);
  });

  it('clips the lead period at midnight (window at 00:05 is announced from 00:00)', () => {
    const p = pair({
      clinicSettings: withSummary(
        { morningEnabled: false },
        { videoCallWindow: { start: '00:05', end: '02:00' } }
      ),
    });
    expect(dayPlan(p)).toEqual(['video@00:00', 'in_person@08:45']);
  });

  it('on a closed weekday only the morning and video summaries can go out', () => {
    expect(dayPlan(pair(), SATURDAY)).toEqual(['morning@07:00', 'video@13:45']);
  });
});

describe('isWithinDoctorSummaryDay', () => {
  it('is open from the first scheduled summary until the last window closes', () => {
    expect(isWithinDoctorSummaryDay(pair(), [], WEDNESDAY, at('06:59'))).toBe(false);
    expect(isWithinDoctorSummaryDay(pair(), [], WEDNESDAY, at('07:00'))).toBe(true);
    expect(isWithinDoctorSummaryDay(pair(), [], WEDNESDAY, at('16:59'))).toBe(true);
    expect(isWithinDoctorSummaryDay(pair(), [], WEDNESDAY, at('17:00'))).toBe(false);
  });

  it('opens at the first window summary when the morning summary is off', () => {
    const p = pair({ clinicSettings: withSummary({ morningEnabled: false }) });
    expect(isWithinDoctorSummaryDay(p, [], WEDNESDAY, at('08:44'))).toBe(false);
    expect(isWithinDoctorSummaryDay(p, [], WEDNESDAY, at('08:45'))).toBe(true);
  });

  it('with only the legacy hours, closes at their end (23:59 by default)', () => {
    const p = pair({ clinicSettings: {}, doctorWorkingHours: null, locationWorkingHours: null });
    expect(isWithinDoctorSummaryDay(p, [], WEDNESDAY, at('06:00'))).toBe(false);
    expect(isWithinDoctorSummaryDay(p, [], WEDNESDAY, at('22:00'))).toBe(true);
    expect(isWithinDoctorSummaryDay(p, [], WEDNESDAY, at('23:59'))).toBe(false);
  });

  it('with summaries switched off, any time until the last window closes', () => {
    const p = pair({
      clinicSettings: withSummary({ morningEnabled: false, beforeWindowEnabled: false }),
    });
    expect(isWithinDoctorSummaryDay(p, [], WEDNESDAY, at('00:00'))).toBe(true);
    expect(isWithinDoctorSummaryDay(p, [], WEDNESDAY, at('17:00'))).toBe(false);
  });
});
