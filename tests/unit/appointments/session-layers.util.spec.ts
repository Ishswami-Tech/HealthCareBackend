import { describe, expect, it } from '@jest/globals';
import { intersectSessionLayers } from '@services/appointments/core/session-layers.util';

describe('intersectSessionLayers', () => {
  const allDay = [{ start: '00:00', end: '23:59' }];
  const opd = [{ start: '09:00', end: '17:00' }];

  it('returns null when no layer is configured', () => {
    expect(intersectSessionLayers([null, null, null])).toBeNull();
  });

  it('caps an all-day location by the doctor hours', () => {
    expect(intersectSessionLayers([allDay, null, opd])).toEqual(opd);
  });

  it('applies a dated override window inside the location hours', () => {
    expect(intersectSessionLayers([allDay, null, [{ start: '00:00', end: '06:00' }]])).toEqual([
      { start: '00:00', end: '06:00' },
    ]);
  });

  it('closes the day when the doctor has no block that weekday', () => {
    expect(intersectSessionLayers([allDay, null, []])).toEqual([]);
  });

  it('keeps split sessions and trims them to the clinic windows', () => {
    expect(
      intersectSessionLayers([
        [{ start: '08:00', end: '20:00' }],
        [{ start: '10:00', end: '18:00' }],
        [
          { start: '09:00', end: '13:00' },
          { start: '14:00', end: '19:00' },
        ],
      ])
    ).toEqual([
      { start: '10:00', end: '13:00' },
      { start: '14:00', end: '18:00' },
    ]);
  });

  it('closes the day when layers do not overlap and ignores malformed windows', () => {
    expect(
      intersectSessionLayers([
        [{ start: '09:00', end: '12:00' }],
        null,
        [{ start: '13:00', end: '17:00' }],
      ])
    ).toEqual([]);
    expect(intersectSessionLayers([[{ start: 'bad', end: '12:00' }, ...opd], null, null])).toEqual(
      opd
    );
  });
});
