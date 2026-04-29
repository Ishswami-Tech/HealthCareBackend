export const IST_TIMEZONE = 'Asia/Kolkata' as const;

export type DateInput = Date | string | number | null | undefined;

function normalizeDateInput(dateInput: DateInput): Date | null {
  if (dateInput === null || dateInput === undefined || dateInput === '') {
    return null;
  }

  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    ...options,
  });
}

export function formatDateTimeInIST(
  dateInput: DateInput,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const date = normalizeDateInput(dateInput);
  if (!date) {
    return '';
  }

  return buildFormatter({
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    ...options,
  }).format(date);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatDateInIST(
  dateInput: DateInput,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const date = normalizeDateInput(dateInput);
  if (!date) {
    return '';
  }

  return buildFormatter({
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    ...options,
  }).format(date);
}

export function formatTimeInIST(
  dateInput: DateInput,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const date = normalizeDateInput(dateInput);
  if (!date) {
    return '';
  }

  return buildFormatter({
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    ...options,
  }).format(date);
}

export function formatISODateInIST(dateInput: DateInput): string {
  return formatDateKeyInIST(dateInput);
}

export function formatDateKeyInIST(dateInput: DateInput): string {
  const date = normalizeDateInput(dateInput);
  if (!date) {
    return '';
  }

  const parts = buildFormatter({
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;

  return year && month && day ? `${year}-${month}-${day}` : '';
}

export function parseIstDateTime(
  dateInput: Date | string | undefined,
  timeInput?: string | null
): Date | null {
  if (!dateInput) {
    return null;
  }

  const dateValue = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(dateValue.getTime())) {
    return null;
  }

  const hasExplicitTimeInput = typeof timeInput === 'string' && timeInput.trim().length > 0;
  if (!hasExplicitTimeInput) {
    if (typeof dateInput === 'string') {
      const direct = new Date(dateInput);
      return Number.isNaN(direct.getTime()) ? null : direct;
    }
    return dateValue;
  }

  const normalizedTime = normalizeTimeForDateParsing(timeInput);
  if (!normalizedTime) {
    return null;
  }

  const datePart = formatDateKeyInIST(dateValue);
  const parsed = new Date(`${datePart}T${normalizedTime}+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeTimeForDateParsing(timeValue: string | null | undefined): string | null {
  const value = String(timeValue || '')
    .trim()
    .toLowerCase();
  if (!value) {
    return null;
  }

  const directMatch = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?$/);
  const dottedMatch = value.match(/^(\d{1,2})\.(\d{2})(?:\s*(am|pm))?$/);
  const hourOnlyMatch = value.match(/^(\d{1,2})(?:\s*(am|pm))$/);
  const matched = directMatch || dottedMatch || hourOnlyMatch;
  if (!matched) {
    return null;
  }

  const hour = Number(matched[1] || '0');
  const minute = Number(matched[2] || '0');
  const second = Number(directMatch?.[3] || '0');
  const meridiem = (directMatch?.[4] || dottedMatch?.[3] || hourOnlyMatch?.[2] || '').toLowerCase();

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }

  let normalizedHour = hour;
  if (meridiem === 'am') {
    normalizedHour = hour === 12 ? 0 : hour;
  } else if (meridiem === 'pm') {
    normalizedHour = hour === 12 ? 12 : hour + 12;
  }

  if (!Number.isFinite(normalizedHour) || normalizedHour < 0 || normalizedHour > 23) {
    return null;
  }

  return `${String(normalizedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(
    Number.isFinite(second) ? second : 0
  ).padStart(2, '0')}`;
}
