/**
 * In-clinic slot windows are the INTERSECTION of every schedule layer that is configured for the
 * day: the location's opening hours, the clinic's operating windows and the doctor's own hours
 * (a dated day-availability override replaces the doctor's weekly hours). A layer that is not
 * configured (`null`) does not restrict; a configured layer with no windows closes the day.
 *
 * Before this, the first non-empty layer won (location > doctor > clinic), so a location open
 * 00:00-23:59 offered slots all day even though the doctor works 09:00-17:00 or only 00:00-06:00
 * on an override day.
 */

import {
  timeToMinutes,
  type SessionWindow,
} from '@services/doctors/day-availability-sessions.util';

interface MinuteWindow {
  start: number;
  end: number;
}

function toMinuteWindows(windows: readonly SessionWindow[]): MinuteWindow[] {
  return windows
    .map(window => ({ start: timeToMinutes(window.start), end: timeToMinutes(window.end) }))
    .filter((w): w is MinuteWindow => w.start !== null && w.end !== null && w.end > w.start)
    .sort((a, b) => a.start - b.start);
}

function intersectPair(a: readonly MinuteWindow[], b: readonly MinuteWindow[]): MinuteWindow[] {
  const result: MinuteWindow[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) result.push({ start, end });
    }
  }
  return result.sort((p, q) => p.start - q.start);
}

function toHhMm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Intersects the configured layers. Returns `null` when no layer is configured (the caller keeps
 * its legacy fallback), `[]` when the configured layers leave no common time (closed day).
 */
export function intersectSessionLayers(
  layers: ReadonlyArray<readonly SessionWindow[] | null>
): SessionWindow[] | null {
  const configured = layers.filter((layer): layer is readonly SessionWindow[] => layer !== null);
  if (configured.length === 0) return null;
  const [first, ...rest] = configured.map(toMinuteWindows);
  const merged = rest.reduce<MinuteWindow[]>(
    (acc, layer) => intersectPair(acc, layer),
    first ?? []
  );
  return merged.map(window => ({ start: toHhMm(window.start), end: toHhMm(window.end) }));
}
