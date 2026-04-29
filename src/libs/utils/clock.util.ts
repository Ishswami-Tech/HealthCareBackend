import { formatDateKeyInIST, type DateInput } from './date-time.util';

export function getIstDateParts(dateInput: DateInput): {
  year: number;
  month: number;
  day: number;
} | null {
  const dateKey = formatDateKeyInIST(dateInput);
  if (!dateKey) {
    return null;
  }

  const [yearPart, monthPart, dayPart] = dateKey.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return { year, month, day };
}

export function startOfIstDay(dateInput: DateInput): Date | null {
  const parts = getIstDateParts(dateInput);
  if (!parts) {
    return null;
  }

  return new Date(
    `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T00:00:00+05:30`
  );
}

export function endOfIstDay(dateInput: DateInput): Date | null {
  const start = startOfIstDay(dateInput);
  if (!start) {
    return null;
  }

  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

export function isSameIstDay(left: DateInput, right: DateInput): boolean {
  const leftKey = formatDateKeyInIST(left);
  const rightKey = formatDateKeyInIST(right);
  return leftKey !== '' && leftKey === rightKey;
}

export function nowIst(): Date {
  return new Date();
}
