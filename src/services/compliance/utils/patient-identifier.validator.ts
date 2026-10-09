import type { PatientIdentifierSystem } from '@core/types/compliance.types';
import { isValidUhid } from '@services/compliance/utils/uhid.util';

export type IdentifierValidation =
  | { readonly valid: true; readonly value: string }
  | { readonly valid: false; readonly reason: string };

const ABHA_NUMBER_LENGTH = 14;
const ABHA_ADDRESS_PATTERN = /^[a-z0-9._-]{4,}@(abdm|sbx)$/i;
const FREE_TEXT_MAX_LENGTH = 64;

function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** ABHA number: 14 digits, written by people as 91-1234-5678-9012 or with spaces. */
export function normaliseAbhaNumber(raw: string): IdentifierValidation {
  const stripped = raw.replace(/[-\s]/g, '');
  if (!/^\d+$/.test(stripped) || stripped.length !== ABHA_NUMBER_LENGTH) {
    return { valid: false, reason: 'ABHA number must be exactly 14 digits' };
  }
  return { valid: true, value: stripped };
}

/** ABHA address (PHR address): handle@abdm or handle@sbx, stored lowercase. */
export function normaliseAbhaAddress(raw: string): IdentifierValidation {
  const trimmed = raw.trim();
  if (!ABHA_ADDRESS_PATTERN.test(trimmed)) {
    return {
      valid: false,
      reason: 'ABHA address must look like name@abdm or name@sbx (at least 4 characters before @)',
    };
  }
  return { valid: true, value: trimmed.toLowerCase() };
}

/** UHID: system-issued `<CLINIC>-<8 digits><check digit>`; a wrong check digit is rejected. */
export function normaliseUhid(raw: string): IdentifierValidation {
  const upper = raw.trim().toUpperCase();
  return isValidUhid(upper)
    ? { valid: true, value: upper }
    : { valid: false, reason: 'Not a valid UHID (check the number and its check digit)' };
}

/** Legacy registration numbers: opaque, trimmed, 1-64 chars, no control characters. */
export function normaliseFreeTextIdentifier(raw: string): IdentifierValidation {
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > FREE_TEXT_MAX_LENGTH) {
    return { valid: false, reason: `Identifier must be 1-${FREE_TEXT_MAX_LENGTH} characters` };
  }
  if (hasControlCharacters(trimmed)) {
    return { valid: false, reason: 'Identifier must not contain control characters' };
  }
  return { valid: true, value: trimmed };
}

export function validateAndNormaliseIdentifier(
  system: PatientIdentifierSystem,
  raw: string
): IdentifierValidation {
  switch (system) {
    case 'ABHA_NUMBER':
      return normaliseAbhaNumber(raw);
    case 'ABHA_ADDRESS':
      return normaliseAbhaAddress(raw);
    case 'UHID':
      return normaliseUhid(raw);
    case 'LEGACY_REGISTRATION':
      return normaliseFreeTextIdentifier(raw);
  }
}
