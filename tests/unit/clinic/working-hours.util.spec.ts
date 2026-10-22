/**
 * Location working hours: only valid HH:MM windows (start < end) are stored.
 */
import { describe, it, expect } from '@jest/globals';
import { parseWorkingHours } from '@services/clinic/cliniclocation/working-hours.util';

describe('parseWorkingHours', () => {
  it('accepts one window for every day and stores it as JSON', () => {
    const result = parseWorkingHours({ start: '09:00', end: '17:00' });
    expect(result).toEqual({
      ok: true,
      value: { start: '09:00', end: '17:00' },
      stored: '{"start":"09:00","end":"17:00"}',
    });
  });

  it('accepts the same value sent as a JSON string', () => {
    const result = parseWorkingHours('{"start":"00:00","end":"23:59"}');
    expect(result.ok).toBe(true);
  });

  it('accepts per-day hours with closed days and split sessions', () => {
    const result = parseWorkingHours({
      Monday: { start: '09:00', end: '13:00' },
      tuesday: [
        { start: '14:00', end: '18:00' },
        { start: '09:00', end: '12:00' },
      ],
      sunday: null,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        monday: { start: '09:00', end: '13:00' },
        tuesday: [
          { start: '09:00', end: '12:00' },
          { start: '14:00', end: '18:00' },
        ],
        sunday: null,
      },
      stored: expect.any(String),
    });
  });

  it.each([
    ['start after end', { start: '17:00', end: '09:00' }],
    ['start equal to end', { start: '09:00', end: '09:00' }],
    ['12-hour text', { start: '9am', end: '5pm' }],
    ['single-digit hour', { start: '9:00', end: '17:00' }],
    ['hour 24', { start: '09:00', end: '24:00' }],
    ['missing end', { start: '09:00' }],
    ['plain string', '9:00 AM - 5:00 PM'],
    ['empty object', {}],
    ['array', [{ start: '09:00', end: '17:00' }]],
    ['null', null],
    ['unknown day', { funday: { start: '09:00', end: '17:00' } }],
    ['extra field', { start: '09:00', end: '17:00', note: 'x' }],
    ['bad day window', { monday: { start: '18:00', end: '10:00' } }],
    [
      'every day closed',
      {
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
        sunday: null,
      },
    ],
    ['only closed days', { sunday: null, monday: [] }],
    [
      'overlapping sessions',
      {
        monday: [
          { start: '09:00', end: '13:00' },
          { start: '12:00', end: '15:00' },
        ],
      },
    ],
  ])('rejects %s', (_label, input) => {
    const result = parseWorkingHours(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});
