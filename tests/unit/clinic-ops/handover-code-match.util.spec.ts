import { describe, expect, it } from '@jest/globals';
import {
  classifyHandoverCandidates,
  identityMatches,
  matchHandoverCode,
  primaryVerifiedRow,
  type HandoverCandidateRow,
} from '@services/clinic-ops/services/handover-code-match.util';

const NOW = Date.parse('2026-11-01T10:00:00Z');
const row = (
  id: string,
  prescriptionId: string,
  overrides: Partial<HandoverCandidateRow> = {}
): HandoverCandidateRow => ({
  id,
  prescriptionId,
  otpHash: `hash:${id}:123456`,
  otpExpiresAt: new Date(NOW + 60_000),
  otpAttempts: 0,
  ...overrides,
});
const hashOf = (id: string, code: string): string => `hash:${id}:${code}`;
const equals = (a: string, b: string): boolean => a === b;

describe('classifyHandoverCandidates', () => {
  it('splits live, locked and expired codes and skips rows without a code', () => {
    const result = classifyHandoverCandidates(
      [
        row('a', 'rx-a'),
        row('b', 'rx-b', { otpAttempts: 5 }),
        row('c', 'rx-c', { otpExpiresAt: new Date(NOW - 1) }),
        row('d', 'rx-d', { otpHash: null }),
      ],
      NOW,
      5
    );
    expect(result.live.map(r => r.id)).toEqual(['a']);
    expect(result.locked.map(r => r.id)).toEqual(['b']);
    expect(result.expired.map(r => r.id)).toEqual(['c']);
  });
});

describe('matchHandoverCode', () => {
  it('matches every row carrying the same shared code', () => {
    const rows = [
      row('a', 'rx-a'),
      row('b', 'rx-b'),
      row('c', 'rx-c', { otpHash: 'hash:c:999999' }),
    ];
    expect(matchHandoverCode(rows, '123456', hashOf, equals).map(r => r.id)).toEqual(['a', 'b']);
    expect(matchHandoverCode(rows, '000000', hashOf, equals)).toEqual([]);
  });
});

describe('primaryVerifiedRow', () => {
  it('prefers the prescription the desk opened, else the first verified', () => {
    const rows = [row('a', 'rx-a'), row('b', 'rx-b')];
    expect(primaryVerifiedRow(rows, 'rx-b')?.id).toBe('b');
    expect(primaryVerifiedRow(rows, 'rx-z')?.id).toBe('a');
    expect(primaryVerifiedRow([], 'rx-a')).toBeNull();
  });
});

describe('identityMatches', () => {
  const record = { phone: '+91 90000 04321', uhids: ['UH-0007'] };

  it('checks the last 4 digits of the phone on file', () => {
    expect(identityMatches('PHONE_LAST4', '4321', record)).toBe(true);
    expect(identityMatches('PHONE_LAST4', '1234', record)).toBe(false);
    expect(identityMatches('PHONE_LAST4', '04321', record)).toBe(false);
    expect(identityMatches('PHONE_LAST4', '4321', { phone: null, uhids: [] })).toBe(false);
  });

  it('compares the UHID ignoring case and spaces', () => {
    expect(identityMatches('UHID', ' uh-0007 ', record)).toBe(true);
    expect(identityMatches('UHID', 'UH-0008', record)).toBe(false);
    expect(identityMatches('UHID', '', record)).toBe(false);
  });
});
