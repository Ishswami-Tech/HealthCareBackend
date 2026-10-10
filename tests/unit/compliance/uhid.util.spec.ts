import { describe, it, expect } from '@jest/globals';
import {
  UHID_MAX_SEQUENCE,
  formatUhid,
  isValidUhid,
  luhnCheckDigit,
  normaliseClinicCode,
  parseUhidSequence,
} from '../../../src/services/compliance/utils/uhid.util';

describe('luhnCheckDigit', () => {
  it('matches the published Luhn test vectors', () => {
    expect(luhnCheckDigit('7992739871')).toBe('3');
    expect(luhnCheckDigit('411111111111111')).toBe('1');
  });

  it('rejects non-digit input', () => {
    expect(() => luhnCheckDigit('12a4')).toThrow();
    expect(() => luhnCheckDigit('')).toThrow();
  });
});

describe('formatUhid', () => {
  it('builds clinic prefix, 8-digit sequence and check digit', () => {
    expect(formatUhid('ISH', 1)).toBe('ISH-000000018');
    expect(formatUhid('ISH', 123)).toMatch(/^ISH-00000123\d$/);
  });

  it('carries no year or personal data and is always valid', () => {
    for (const sequence of [1, 2, 9, 10, 99, 4116, 43498, UHID_MAX_SEQUENCE]) {
      const uhid = formatUhid('DRC', sequence);
      expect(uhid).toMatch(/^DRC-\d{9}$/);
      expect(isValidUhid(uhid)).toBe(true);
      expect(parseUhidSequence(uhid)).toBe(sequence);
    }
  });

  it('refuses sequences outside the supported range', () => {
    expect(() => formatUhid('ISH', 0)).toThrow(RangeError);
    expect(() => formatUhid('ISH', -5)).toThrow(RangeError);
    expect(() => formatUhid('ISH', 1.5)).toThrow(RangeError);
    expect(() => formatUhid('ISH', UHID_MAX_SEQUENCE + 1)).toThrow(RangeError);
  });
});

describe('isValidUhid', () => {
  it('detects every single-digit typo', () => {
    const uhid = formatUhid('ISH', 4116);
    for (let position = 4; position < uhid.length; position += 1) {
      const original = uhid[position] as string;
      for (const replacement of '0123456789') {
        if (replacement === original) continue;
        const typo = `${uhid.slice(0, position)}${replacement}${uhid.slice(position + 1)}`;
        expect(isValidUhid(typo)).toBe(false);
      }
    }
  });

  it('rejects legacy register numbers and malformed values', () => {
    for (const value of ['26/4116', '100720180410233538', 'ISH-12345', 'ish-000000018', '', 'ISH-0000000181']) {
      expect(isValidUhid(value)).toBe(false);
      expect(parseUhidSequence(value)).toBeNull();
    }
  });
});

describe('normaliseClinicCode', () => {
  it('upper-cases, strips symbols and caps the length', () => {
    expect(normaliseClinicCode('dr-chandra kumar')).toBe('DRCHANDR');
    expect(normaliseClinicCode('Ish')).toBe('ISH');
  });

  it('falls back when too little is left', () => {
    expect(normaliseClinicCode('!')).toBe('CL');
    expect(normaliseClinicCode('')).toBe('CL');
  });
});
