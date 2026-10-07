import {
  type DateInput,
  formatDateInIST,
  formatTimeInIST,
  parseIstDateTime,
} from './date-time.util';

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;
const IST_MIDNIGHT_LABEL = '12:00 AM';

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Tue, 6 Oct 2026" in IST; '' when the input is missing or unparseable. */
export function formatVisitDateLabel(value: DateInput): string {
  const label = formatDateInIST(value, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  // en-IN writes "Tue, 6 Oct, 2026"; drop the comma before the year.
  return label.replace(/,\s*(\d{4})$/, ' $1');
}

/** "2:00 PM" in IST for an instant; '' when the input is missing or unparseable. */
export function formatVisitTimeLabel(value: DateInput): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  return formatTimeInIST(date, {
    hour: 'numeric',
    minute: '2-digit',
    second: undefined,
    hour12: true,
  })
    .replace(/\u202f/g, ' ')
    .replace(/\s?(am|pm)$/i, match => match.toUpperCase())
    .trim();
}

/** "2:00 PM" from a row's date plus "HH:mm" clock time; '' when either is missing. */
export function formatVisitTimeFromClock(
  date: DateInput,
  clock: string | null | undefined
): string {
  const dateValue = toDate(date);
  if (!dateValue || !clock) {
    return '';
  }
  return formatVisitTimeLabel(parseIstDateTime(dateValue, clock));
}

/**
 * Whatever a producer passed as the visit date, as "Tue, 6 Oct 2026": an ISO timestamp (with Z
 * or an offset), a "YYYY-MM-DD" key, or a Date. Text that is already for people is kept.
 */
export function humanizeVisitDate(value: string | Date | null | undefined): string {
  if (value instanceof Date) {
    return formatVisitDateLabel(value);
  }
  const text = (value || '').trim();
  if (!text) {
    return '';
  }
  if (ISO_TIMESTAMP.test(text)) {
    return formatVisitDateLabel(text) || text;
  }
  if (DATE_KEY.test(text)) {
    return formatVisitDateLabel(`${text}T00:00:00+05:30`) || text;
  }
  return text;
}

/**
 * Whatever a producer passed as the visit time, as "2:00 PM": an ISO timestamp, a "HH:mm" or
 * "HH:mm:ss" clock, or nothing when the time was folded into an ISO `dateHint`. Text that is
 * already for people is kept.
 */
export function humanizeVisitTime(
  value: string | null | undefined,
  dateHint?: string | Date | null
): string {
  const text = (value || '').trim();
  if (ISO_TIMESTAMP.test(text)) {
    return formatVisitTimeLabel(text) || text;
  }
  if (CLOCK_TIME.test(text)) {
    // IST has no daylight saving, so any date resolves the clock to the same label.
    const base = toDate(dateHint instanceof Date ? dateHint : dateHint || null) ?? new Date();
    return formatVisitTimeFromClock(base, text) || text;
  }
  if (!text && typeof dateHint === 'string' && ISO_TIMESTAMP.test(dateHint)) {
    const label = formatVisitTimeLabel(dateHint);
    return label === IST_MIDNIGHT_LABEL ? '' : label;
  }
  return text;
}

/** Both labels at once, for senders that receive the pair from an arbitrary producer. */
export function humanizeVisitWhen(
  date: string | Date | null | undefined,
  time: string | null | undefined
): { date: string; time: string } {
  return { date: humanizeVisitDate(date), time: humanizeVisitTime(time, date) };
}
