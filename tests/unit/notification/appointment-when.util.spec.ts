import { describe, expect, it } from '@jest/globals';
import {
  humanizeVisitDate,
  humanizeVisitTime,
  humanizeVisitWhen,
} from '@utils/appointment-when.util';

describe('appointment when normalizer', () => {
  it('turns every date shape producers pass into one IST label', () => {
    expect(humanizeVisitDate('2026-10-06T09:00:00.000Z')).toBe('Tue, 6 Oct 2026');
    expect(humanizeVisitDate('2026-10-06T14:00:00+05:30')).toBe('Tue, 6 Oct 2026');
    expect(humanizeVisitDate('2026-10-06')).toBe('Tue, 6 Oct 2026');
    expect(humanizeVisitDate(new Date('2026-10-05T18:30:00.000Z'))).toBe('Tue, 6 Oct 2026');
    expect(humanizeVisitDate('Tue, 6 Oct 2026')).toBe('Tue, 6 Oct 2026');
    expect(humanizeVisitDate('')).toBe('');
  });

  it('turns every time shape producers pass into one IST label', () => {
    expect(humanizeVisitTime('14:00')).toBe('2:00 PM');
    expect(humanizeVisitTime('14:00:00')).toBe('2:00 PM');
    expect(humanizeVisitTime('2026-10-06T09:00:00.000Z')).toBe('2:30 PM');
    expect(humanizeVisitTime('', '2026-10-06T14:00:00+05:30')).toBe('2:00 PM');
    expect(humanizeVisitTime('', '2026-10-05T18:30:00.000Z')).toBe('');
    expect(humanizeVisitTime('2:00 PM')).toBe('2:00 PM');
  });

  it('normalizes the pair the WhatsApp senders receive', () => {
    expect(humanizeVisitWhen('2026-10-06T14:00:00+05:30', '10:00')).toEqual({
      date: 'Tue, 6 Oct 2026',
      time: '10:00 AM',
    });
    expect(humanizeVisitWhen('2026-10-06T09:00:00.000Z', '')).toEqual({
      date: 'Tue, 6 Oct 2026',
      time: '2:30 PM',
    });
  });
});
