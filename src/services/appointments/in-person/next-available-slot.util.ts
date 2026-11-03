/**
 * Next available in-person slot after today, offered by the walk-in desk when today's grid is
 * full. The free slots of each day come from the same availability grid the patient books from
 * (doctor leave, clinic holidays / closures, location hours and the clinic visit length are all
 * applied there), so a day the doctor is away simply has no free slot and is skipped. Days the
 * clinic does not work (clinic working days + location per-day hours, the same rule the booking
 * applies: clinic-working-days.util) are skipped without a lookup.
 */

import { DEFAULT_WORKING_DAYS, weekDayOfDateKey } from '@utils/clinic-working-days.util';

/** How many days after today the desk looks for the next free slot. */
export const NEXT_SLOT_SEARCH_DAYS = 14;

/** The slot the desk offers: `date` is the IST day key, `time` the IST wall-clock HH:mm. */
export interface NextAvailableSlot {
  date: string;
  time: string;
  doctorId: string;
  locationId: string;
}

export interface NextAvailableSlotSearch {
  /** Today's IST day key (YYYY-MM-DD); the search starts the day after. */
  fromDateKey: string;
  doctorId: string;
  locationId: string;
  /** Free slots of one IST day ("HH:mm"); an empty list means the day is closed or full. */
  loadFreeSlots: (dateKey: string) => Promise<readonly string[]>;
  /**
   * Whether the clinic takes appointments on a day (resolveDayBookability of the clinic settings
   * and the location hours). Defaults to the clinic default working days (Mon-Fri).
   */
  isOpenDay?: (dateKey: string) => boolean;
  maxDays?: number;
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLOT_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Calendar day arithmetic on a YYYY-MM-DD key (no time zone involved). */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const match = DATE_KEY.exec(dateKey);
  if (!match) throw new Error(`Invalid date key: ${dateKey}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

/** The earliest well-formed "HH:mm" slot of a day, or null. */
export function earliestSlot(slots: readonly string[]): string | null {
  const valid = slots.filter(slot => SLOT_TIME.test(slot)).sort();
  return valid[0] ?? null;
}

/** The clinic default working days, for a search that was not given the clinic's own rule. */
export function isDefaultWorkingDateKey(dateKey: string): boolean {
  const weekDay = weekDayOfDateKey(dateKey);
  return weekDay !== null && DEFAULT_WORKING_DAYS.includes(weekDay);
}

/** First free slot on the days after `fromDateKey`, up to `maxDays` days ahead; null if none. */
export async function findNextAvailableSlot(
  search: NextAvailableSlotSearch
): Promise<NextAvailableSlot | null> {
  const maxDays = search.maxDays ?? NEXT_SLOT_SEARCH_DAYS;
  const isOpenDay = search.isOpenDay ?? isDefaultWorkingDateKey;
  for (let offset = 1; offset <= maxDays; offset += 1) {
    const date = addDaysToDateKey(search.fromDateKey, offset);
    if (!isOpenDay(date)) continue;
    const time = earliestSlot(await search.loadFreeSlots(date));
    if (time) {
      return { date, time, doctorId: search.doctorId, locationId: search.locationId };
    }
  }
  return null;
}

/** "Fri 23 Oct, 10:00 AM" for an IST day key and an "HH:mm" time. */
export function formatNextAvailableLabel(dateKey: string, time: string): string {
  const match = DATE_KEY.exec(dateKey);
  if (!match) return `${dateKey}, ${time}`;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const clock = `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
  return `${WEEKDAYS[day.getUTCDay()]} ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}, ${clock}`;
}

/** The 409 message of a full walk-in day, naming the next free slot when there is one. */
export function noSlotTodayMessage(next: NextAvailableSlot | null, fallback: string): string {
  if (!next) return fallback;
  return `No free slot left today. Next available: ${formatNextAvailableLabel(next.date, next.time)}.`;
}
