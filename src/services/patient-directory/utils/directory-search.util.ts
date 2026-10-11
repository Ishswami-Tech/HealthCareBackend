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

/** `null` for an empty or one-character term, which would match most of the clinic. */
export function classifySearchTerm(raw: string | undefined | null): PatientSearchTerm | null {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH);
  if (text.length < 2) return null;

  if (UHID_PATTERN.test(text)) return { kind: 'uhid', value: text.toUpperCase() };
  if (COUNTRY_CODE_MOBILE_PATTERN.test(text)) return { kind: 'phone', value: text };
  if (LEGACY_PATTERN.test(text)) return { kind: 'legacy', value: text };
  if (OPD_PREFIX_PATTERN.test(text)) return { kind: 'opd', value: text.toUpperCase() };
  if (OPD_SLASH_PATTERN.test(text)) return { kind: 'opd', value: text };
  if (text.includes('@')) return { kind: 'email', value: text.toLowerCase() };

  // A trunk "0" before a ten-digit number (09876543210) is not part of the stored +91 number.
  const typedDigits = text.replace(PHONE_NOISE, '');
  const phoneDigits =
    typedDigits.length === 11 && typedDigits.startsWith('0') ? typedDigits.slice(1) : typedDigits;
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

/** Escapes `%`, `_` and `\` so a typed value is matched literally by LIKE / ILIKE. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}
