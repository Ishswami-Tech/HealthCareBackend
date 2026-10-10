import { describe, it, expect } from '@jest/globals';
import {
  MAX_EVIDENCE_KEYS,
  MAX_EVIDENCE_VALUE_LENGTH,
  evidenceIsRequired,
  validateConsentEvidence,
} from '../../../src/services/compliance/utils/consent-evidence.util';

describe('validateConsentEvidence', () => {
  it('accepts nothing, null and a flat object of short primitives', () => {
    expect(validateConsentEvidence(undefined)).toEqual({ valid: true, value: undefined });
    expect(validateConsentEvidence(null)).toEqual({ valid: true, value: undefined });
    expect(validateConsentEvidence({})).toEqual({ valid: true, value: undefined });
    expect(validateConsentEvidence({ formRef: 'F-2026-014', witnessed: true, page: 2, note: null })).toEqual({
      valid: true,
      value: { formRef: 'F-2026-014', witnessed: true, page: 2, note: null },
    });
  });

  it('refuses nesting, arrays and non-objects', () => {
    expect(validateConsentEvidence({ a: { b: 1 } }).valid).toBe(false);
    expect(validateConsentEvidence({ a: [1, 2] }).valid).toBe(false);
    expect(validateConsentEvidence([1, 2]).valid).toBe(false);
    expect(validateConsentEvidence('form').valid).toBe(false);
    expect(validateConsentEvidence(7).valid).toBe(false);
  });

  it('refuses too many fields, long values, odd field names and non-finite numbers', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_EVIDENCE_KEYS + 1 }, (_, i) => [`k${i}`, 1]));
    expect(validateConsentEvidence(many).valid).toBe(false);
    expect(validateConsentEvidence({ a: 'x'.repeat(MAX_EVIDENCE_VALUE_LENGTH + 1) }).valid).toBe(false);
    expect(validateConsentEvidence({ a: 'x'.repeat(MAX_EVIDENCE_VALUE_LENGTH) }).valid).toBe(true);
    expect(validateConsentEvidence({ 'bad key!': 1 }).valid).toBe(false);
    expect(validateConsentEvidence({ __proto__x: 1, n: Number.POSITIVE_INFINITY }).valid).toBe(false);
  });
});

describe('evidenceIsRequired', () => {
  it('requires proof only for staff-recorded grants of sensitive purposes', () => {
    expect(evidenceIsRequired('RESEARCH', 'GRANTED', 'STAFF')).toBe(true);
    expect(evidenceIsRequired('ABDM_LINKING', 'GRANTED', 'STAFF')).toBe(true);
    expect(evidenceIsRequired('DATA_SHARING_WITH_PROVIDERS', 'GRANTED', 'STAFF')).toBe(true);
  });

  it('does not require it for self-service, withdrawals, imports or routine purposes', () => {
    expect(evidenceIsRequired('RESEARCH', 'GRANTED', 'SELF')).toBe(false);
    expect(evidenceIsRequired('RESEARCH', 'WITHDRAWN', 'STAFF')).toBe(false);
    expect(evidenceIsRequired('RESEARCH', 'GRANTED', 'IMPORT')).toBe(false);
    expect(evidenceIsRequired('TREATMENT_AND_RECORDS', 'GRANTED', 'STAFF')).toBe(false);
  });
});
