import { describe, it, expect } from '@jest/globals';
import {
  isConsentGranted,
  resolveCurrentConsents,
} from '../../../src/services/compliance/utils/consent.util';

type Row = Parameters<typeof isConsentGranted>[0][number];

const at = (iso: string): Date => new Date(iso);
const row = (purpose: Row['purpose'], status: Row['status'], iso: string): Row => ({
  purpose,
  status,
  recordedAt: at(iso),
});

describe('resolveCurrentConsents', () => {
  it('returns an empty map for an empty ledger', () => {
    expect(resolveCurrentConsents([]).size).toBe(0);
  });

  it('keeps the latest row per purpose regardless of input order', () => {
    const rows = [
      row('TELECONSULTATION', 'WITHDRAWN', '2026-03-01T00:00:00Z'),
      row('TELECONSULTATION', 'GRANTED', '2026-01-01T00:00:00Z'),
      row('RESEARCH', 'GRANTED', '2026-02-01T00:00:00Z'),
    ];
    const current = resolveCurrentConsents(rows);
    expect(current.size).toBe(2);
    expect(current.get('TELECONSULTATION')?.status).toBe('WITHDRAWN');
    expect(current.get('RESEARCH')?.status).toBe('GRANTED');
  });

  it('prefers the later input row when timestamps tie', () => {
    const current = resolveCurrentConsents([
      row('RESEARCH', 'GRANTED', '2026-01-01T00:00:00Z'),
      row('RESEARCH', 'WITHDRAWN', '2026-01-01T00:00:00Z'),
    ]);
    expect(current.get('RESEARCH')?.status).toBe('WITHDRAWN');
  });
});

describe('isConsentGranted', () => {
  it('is false when there is no row for the purpose', () => {
    expect(isConsentGranted([], 'ABDM_LINKING')).toBe(false);
  });

  it('is true when the newest row is a grant', () => {
    const rows = [
      row('ABDM_LINKING', 'WITHDRAWN', '2026-01-01T00:00:00Z'),
      row('ABDM_LINKING', 'GRANTED', '2026-02-01T00:00:00Z'),
    ];
    expect(isConsentGranted(rows, 'ABDM_LINKING')).toBe(true);
  });

  it('is false after a later withdrawal', () => {
    const rows = [
      row('ABDM_LINKING', 'GRANTED', '2026-01-01T00:00:00Z'),
      row('ABDM_LINKING', 'WITHDRAWN', '2026-02-01T00:00:00Z'),
    ];
    expect(isConsentGranted(rows, 'ABDM_LINKING')).toBe(false);
  });

  it('does not leak a grant from another purpose', () => {
    expect(
      isConsentGranted([row('RESEARCH', 'GRANTED', '2026-01-01T00:00:00Z')], 'COMMUNICATIONS')
    ).toBe(false);
  });
});
