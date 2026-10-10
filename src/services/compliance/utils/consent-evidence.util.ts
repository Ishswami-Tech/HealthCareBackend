import type { ConsentCaptureChannel, ConsentPurpose } from '@core/types/compliance.types';

export type ConsentEvidence = Readonly<Record<string, string | number | boolean | null>>;

export type EvidenceCheck =
  | { readonly valid: true; readonly value: ConsentEvidence | undefined }
  | { readonly valid: false; readonly reason: string };

export const MAX_EVIDENCE_KEYS = 10;
export const MAX_EVIDENCE_VALUE_LENGTH = 200;
export const MAX_EVIDENCE_JSON_LENGTH = 4096;
const KEY_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;

/** Purposes where a staff member recording a grant on the patient's behalf must show proof. */
export const PROOF_REQUIRED_PURPOSES: readonly ConsentPurpose[] = [
  'DATA_SHARING_WITH_PROVIDERS',
  'ABDM_LINKING',
  'RESEARCH',
];

/**
 * Evidence is a flat object of short primitives (a form reference, a witness name, ...). Nested
 * objects, arrays and long values are refused so the ledger cannot be used as a data dump.
 */
export function validateConsentEvidence(evidence: unknown): EvidenceCheck {
  if (evidence === undefined || evidence === null) {
    return { valid: true, value: undefined };
  }
  if (typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { valid: false, reason: 'Evidence must be an object' };
  }
  const entries = Object.entries(evidence as Record<string, unknown>);
  if (entries.length > MAX_EVIDENCE_KEYS) {
    return { valid: false, reason: `Evidence may have at most ${MAX_EVIDENCE_KEYS} fields` };
  }
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of entries) {
    if (!KEY_PATTERN.test(key)) {
      return { valid: false, reason: `Evidence field name "${key.slice(0, 40)}" is not allowed` };
    }
    if (typeof value === 'string') {
      if (value.length > MAX_EVIDENCE_VALUE_LENGTH) {
        return {
          valid: false,
          reason: `Evidence values are limited to ${MAX_EVIDENCE_VALUE_LENGTH} characters`,
        };
      }
      clean[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      clean[key] = value;
    } else if (typeof value === 'boolean' || value === null) {
      clean[key] = value;
    } else {
      return { valid: false, reason: `Evidence field "${key}" must be text, a number or a flag` };
    }
  }
  if (JSON.stringify(clean).length > MAX_EVIDENCE_JSON_LENGTH) {
    return { valid: false, reason: 'Evidence is too large' };
  }
  return { valid: true, value: Object.keys(clean).length > 0 ? clean : undefined };
}

/** A staff-recorded grant for a sensitive purpose must carry evidence. */
export function evidenceIsRequired(
  purpose: ConsentPurpose,
  status: 'GRANTED' | 'WITHDRAWN',
  capturedVia: ConsentCaptureChannel
): boolean {
  return (
    capturedVia === 'STAFF' && status === 'GRANTED' && PROOF_REQUIRED_PURPOSES.includes(purpose)
  );
}
