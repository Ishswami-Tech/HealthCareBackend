import type { PatientSearchTerm } from '@core/types/patient-directory.types';

/**
 * Turns what staff type into the one thing they most likely mean. One search box serves the desk:
 * a UHID read off a card, an old register number, an OPD number, a phone number (any format, even
 * the last few digits), an e-mail, or a name in any word order.
 */

const UHID_PATTERN = /^[A-Za-z0-9]{2,8}-\d{9}$/;
/** The old register's patient numbers are long digit strings (for example 18 digits). */
const LEGACY_PATTERN = /^\d{12,}$/;
/** An Indian mobile typed with its country code but no plus (919876543210) is a phone, not a register number. */
const COUNTRY_CODE_MOBILE_PATTERN = /^91[6-9]\d{9}$/;
/** Visit numbers: `VM-2018/609` (imported) or `OPD-CL0002-2026-000123`; a bare `2018/609` too. */
const OPD_PREFIX_PATTERN = /^(VM|OPD)-/i;
const OPD_SLASH_PATTERN = /^\d{2,4}\/\d+/;
const PHONE_MIN_DIGITS = 4;
const PHONE_MAX_DIGITS = 13;
const SEARCH_MAX_LENGTH = 100;
const NAME_TOKEN_MAX = 6;

export const SEARCH_TOO_SHORT_MESSAGE = 'Type at least 2 characters to search';

/** Characters that mean nothing in a phone number a person typed. */
const PHONE_NOISE = /[\s\-().+]/g;
/** `91` + a ten-digit Indian mobile, however it was typed (+91 98765 43210, 919876543210). */
const INDIAN_COUNTRY_CODE_DIGITS = /^91([6-9]\d{9})$/;

/**
 * The national part of an Indian mobile, so one search matches every stored form of the number:
 * `+919876543210` (app sign-up, E.164), `9876543210` (imported registers) and `919876543210`.
 * A trunk `0` (09876543210) and the `91` country code are dropped; other digits are kept as typed.
 */
export function normalizePhoneDigits(digits: string): string {
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  const national = INDIAN_COUNTRY_CODE_DIGITS.exec(digits);
  return national?.[1] ?? digits;
}

/** Shown for a patient who signed up in the app and has not added a name yet (phone search finds them). */
export const UNNAMED_PATIENT_LABEL = 'Name not added yet';

/** The name staff see for a row: a blank name (app sign-up before profile completion) falls back. */
export function directoryDisplayName(
  name: string | null | undefined,
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string {
  const full = (name ?? '').trim();
  if (full) return full;
  const parts = [firstName, lastName].map(part => (part ?? '').trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : UNNAMED_PATIENT_LABEL;
}

/** `null` for an empty or one-character term, which would match most of the clinic. */
export function classifySearchTerm(raw: string | undefined | null): PatientSearchTerm | null {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH);
  if (text.length < 2) return null;

  if (UHID_PATTERN.test(text)) return { kind: 'uhid', value: text.toUpperCase() };
  if (COUNTRY_CODE_MOBILE_PATTERN.test(text)) {
    return { kind: 'phone', value: normalizePhoneDigits(text) };
  }
  if (LEGACY_PATTERN.test(text)) return { kind: 'legacy', value: text };
  if (OPD_PREFIX_PATTERN.test(text)) return { kind: 'opd', value: text.toUpperCase() };
  if (OPD_SLASH_PATTERN.test(text)) return { kind: 'opd', value: text };
  if (text.includes('@')) return { kind: 'email', value: text.toLowerCase() };

  // A trunk "0" or the "91" country code is not needed to match the stored number.
  const typedDigits = text.replace(PHONE_NOISE, '');
  const phoneDigits = /^\d+$/.test(typedDigits) ? normalizePhoneDigits(typedDigits) : typedDigits;
  if (
    /^\d+$/.test(phoneDigits) &&
    phoneDigits.length >= PHONE_MIN_DIGITS &&
    phoneDigits.length <= PHONE_MAX_DIGITS
  ) {
    return { kind: 'phone', value: phoneDigits };
  }

  const tokens = text
    .toLowerCase()
    .split(' ')
    .filter(token => token.length > 0)
    .slice(0, NAME_TOKEN_MAX);
  return { kind: 'name', value: tokens.join(' '), tokens };
}

/** Pharmacy staff need at least this many letters of a name (a looser name would list half the clinic). */
export const PHARMACY_NAME_MIN_LETTERS = 3;

export const PHARMACY_SEARCH_MESSAGE = `Search by name (at least ${PHARMACY_NAME_MIN_LETTERS} letters), UHID or phone number`;

/**
 * Pharmacy staff look one patient up (clinic scoped, one small page): a UHID, a phone number, or a
 * name of at least three letters, like the assistant's picker. Other kinds (register / OPD numbers,
 * e-mail) and short names are refused.
 */
export function isPharmacySearchAllowed(search: PatientSearchTerm | null | undefined): boolean {
  if (!search) return false;
  if (search.kind === 'uhid' || search.kind === 'phone') return true;
  if (search.kind !== 'name') return false;
  return search.value.replace(/\s+/g, '').length >= PHARMACY_NAME_MIN_LETTERS;
}

/** Escapes `%`, `_` and `\` so a typed value is matched literally by LIKE / ILIKE. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

/** `YYYY-MM-DD` that exists on the calendar (the format check alone lets 2026-02-31 through). */
export const isRealCalendarDate = (value: string): boolean => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
