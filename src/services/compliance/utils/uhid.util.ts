/**
 * UHID (unique health identifier) format. Pure functions, no framework imports.
 *
 * A UHID is opaque and system-issued: `<CLINIC>-<8-digit sequence><check digit>`, for example
 * `ISH-000000018`. It carries no year, name, age or other personal data, it is never reused, and
 * the Luhn check digit catches a mistyped or mis-copied number at the desk before it reaches a
 * lookup. It is unique within a clinic (the clinic prefix is only a readability aid).
 *
 * Numbers from a previous register are NOT UHIDs: they are kept as LEGACY_REGISTRATION identifiers.
 */

export const UHID_SEQUENCE_DIGITS = 8;
export const UHID_MAX_SEQUENCE = 10 ** UHID_SEQUENCE_DIGITS - 1;
const CLINIC_CODE_MAX_LENGTH = 8;
const UHID_PATTERN = /^([A-Z0-9]{2,8})-(\d{8})(\d)$/;

/** Luhn (ISO/IEC 7812-1) check digit of a string of digits. */
export function luhnCheckDigit(digits: string): string {
  if (!/^\d+$/.test(digits)) {
    throw new Error('Check digit input must be digits only');
  }
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}

/** Readable clinic prefix: upper-case letters and digits only, 2 to 8 characters. */
export function normaliseClinicCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CLINIC_CODE_MAX_LENGTH);
  return cleaned.length >= 2 ? cleaned : 'CL';
}

export function formatUhid(clinicCode: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > UHID_MAX_SEQUENCE) {
    throw new RangeError(`UHID sequence must be an integer from 1 to ${UHID_MAX_SEQUENCE}`);
  }
  const digits = String(sequence).padStart(UHID_SEQUENCE_DIGITS, '0');
  return `${normaliseClinicCode(clinicCode)}-${digits}${luhnCheckDigit(digits)}`;
}

/** True when the value has the UHID shape and a correct check digit. */
export function isValidUhid(value: string): boolean {
  const match = UHID_PATTERN.exec(value);
  if (!match) return false;
  const [, , digits, check] = match;
  return digits !== undefined && check === luhnCheckDigit(digits);
}

/** Sequence number inside a valid UHID, or null. */
export function parseUhidSequence(value: string): number | null {
  const match = UHID_PATTERN.exec(value);
  const digits = match?.[2];
  return digits !== undefined && isValidUhid(value) ? Number(digits) : null;
}
