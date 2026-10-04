/// <reference types="jest" />
/**
 * Pure rules behind GET /ehr/analytics/medication-adherence: doses per day from the
 * prescription frequency text and the per-dose log / percentage for a day range.
 */

import {
  buildDoseLog,
  doseKey,
  dosesPerDay,
  enumerateDays,
  MAX_DOSES_PER_DAY,
  type ScheduledMedication,
} from '@services/ehr/medication-schedule.util';

describe('dosesPerDay', () => {
  it.each([
    ['1-0-1', 2],
    ['1-1-1', 3],
    ['1-1-1-1', 4],
    ['0-0-1', 1],
    ['twice daily', 2],
    ['Twice a day', 2],
    ['once daily', 1],
    ['three times a day', 3],
    ['3 times daily', 3],
    ['2x/day', 2],
    ['every 8 hours', 3],
    ['every 12 hrs', 2],
    ['BD', 2],
    ['TDS', 3],
    ['QID', 4],
    ['OD', 1],
  ])('%s -> %i dose(s) a day', (text, expected) => {
    expect(dosesPerDay(text)).toBe(expected);
  });

  it('counts an empty or unparseable frequency as one dose a day (never zero)', () => {
    expect(dosesPerDay('')).toBe(1);
    expect(dosesPerDay(null)).toBe(1);
    expect(dosesPerDay(undefined)).toBe(1);
    expect(dosesPerDay('as directed by the doctor')).toBe(1);
    expect(dosesPerDay('0-0-0')).toBe(1);
  });

  it('caps absurd values so a typo cannot create dozens of log rows a day', () => {
    expect(dosesPerDay('every 1 hour')).toBe(MAX_DOSES_PER_DAY);
    expect(dosesPerDay('20 times a day')).toBe(MAX_DOSES_PER_DAY);
  });
});

describe('enumerateDays', () => {
  it('lists every day of the range inclusive, across a month end', () => {
    expect(enumerateDays('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });

  it('is a single day when from equals to', () => {
    expect(enumerateDays('2026-05-05', '2026-05-05')).toEqual(['2026-05-05']);
  });
});

describe('buildDoseLog', () => {
  const med = (over: Partial<ScheduledMedication> = {}): ScheduledMedication => ({
    id: 'med-1',
    name: 'Ashwagandha',
    frequency: '1-0-1',
    startDay: '2026-05-01',
    endDay: null,
    ...over,
  });
  const days = ['2026-05-03', '2026-05-04', '2026-05-05'];

  it('marks logged doses TAKEN, past unlogged doses MISSED and today / later PENDING', () => {
    const taken = new Map<string, Date>([
      [doseKey('med-1', '2026-05-03', 0), new Date('2026-05-03T03:00:00Z')],
      [doseKey('med-1', '2026-05-03', 1), new Date('2026-05-03T15:00:00Z')],
      [doseKey('med-1', '2026-05-04', 0), new Date('2026-05-04T03:00:00Z')],
    ]);

    const { doseLog, summary } = buildDoseLog({
      medications: [med()],
      days,
      today: '2026-05-05',
      taken,
    });

    expect(doseLog).toHaveLength(6);
    expect(doseLog.filter(d => d.status === 'TAKEN')).toHaveLength(3);
    expect(doseLog.filter(d => d.status === 'MISSED')).toEqual([
      expect.objectContaining({ date: '2026-05-04', doseIndex: 1, label: 'Dose 2 of 2' }),
    ]);
    expect(doseLog.filter(d => d.status === 'PENDING').map(d => d.date)).toEqual([
      '2026-05-05',
      '2026-05-05',
    ]);
    expect(summary).toEqual({
      scheduledDoses: 6,
      takenDoses: 3,
      missedDoses: 1,
      adherencePercentage: 75,
    });
  });

  it('does not count pending doses of today against the patient', () => {
    const { summary } = buildDoseLog({
      medications: [med()],
      days: ['2026-05-05'],
      today: '2026-05-05',
      taken: new Map(),
    });

    expect(summary.adherencePercentage).toBeNull();
    expect(summary.missedDoses).toBe(0);
    expect(summary.scheduledDoses).toBe(2);
  });

  it('schedules nothing before the start day or after the end day', () => {
    const { doseLog } = buildDoseLog({
      medications: [med({ startDay: '2026-05-04', endDay: '2026-05-04' })],
      days,
      today: '2026-05-10',
      taken: new Map(),
    });

    expect(new Set(doseLog.map(d => d.date))).toEqual(new Set(['2026-05-04']));
  });

  it('is 100% when every due dose was taken and ignores a logged slot beyond the frequency', () => {
    const taken = new Map<string, Date>([
      [doseKey('med-1', '2026-05-03', 0), new Date()],
      [doseKey('med-1', '2026-05-03', 1), new Date()],
      // slot 2 does not exist for a twice-daily medicine
      [doseKey('med-1', '2026-05-03', 2), new Date()],
    ]);

    const { summary } = buildDoseLog({
      medications: [med()],
      days: ['2026-05-03'],
      today: '2026-05-04',
      taken,
    });

    expect(summary).toMatchObject({ takenDoses: 2, missedDoses: 0, adherencePercentage: 100 });
  });

  it('combines several medications into one percentage', () => {
    const { summary, doseLog } = buildDoseLog({
      medications: [med(), med({ id: 'med-2', name: 'Triphala', frequency: 'once daily' })],
      days: ['2026-05-03'],
      today: '2026-05-04',
      taken: new Map([[doseKey('med-2', '2026-05-03', 0), new Date()]]),
    });

    expect(doseLog).toHaveLength(3);
    expect(summary).toMatchObject({ takenDoses: 1, missedDoses: 2, adherencePercentage: 33 });
  });
});
