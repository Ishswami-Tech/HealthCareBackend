/**
 * Clock + slot helpers for the check-in specs. Check-in is gated on the appointment's IST slot
 * (30 min before .. 3 h after, same IST day), so the specs pin "now" and place appointments
 * relative to it instead of depending on the wall clock of the machine running them.
 */
import { jest } from '@jest/globals';
import { formatDateKeyInIST } from '@utils/date-time.util';

/** 2026-10-05 12:00 IST (06:30 UTC): far from midnight in both IST and UTC. */
export const PINNED_NOW = new Date('2026-10-05T06:30:00.000Z');

const MS_PER_MINUTE = 60_000;

/** Fake only Date. Timers and promises keep working (the queue lock waits with setTimeout). */
export function pinClock(now: Date = PINNED_NOW): void {
  jest.useFakeTimers({
    now,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

export function unpinClock(): void {
  jest.useRealTimers();
}

/**
 * The appointment grid fields (IST calendar day + IST wall-clock "HH:mm") of the moment that is
 * `offsetMinutes` after `from`. offset 0 is "an appointment starting right now".
 */
export function istSlot(offsetMinutes = 0, from: Date = new Date()): { date: Date; time: string } {
  const slotStart = new Date(from.getTime() + offsetMinutes * MS_PER_MINUTE);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(slotStart);
  return { date: new Date(`${formatDateKeyInIST(slotStart)}T00:00:00.000Z`), time };
}

/** An appointment on a different IST calendar day than `from`. */
export function istSlotOnOtherDay(
  dayOffset: number,
  from: Date = new Date()
): { date: Date; time: string } {
  return istSlot(dayOffset * 24 * 60, from);
}
