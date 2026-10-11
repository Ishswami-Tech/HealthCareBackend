import { describe, it, expect } from '@jest/globals';
import {
  normaliseAbhaAddress,
  normaliseAbhaNumber,
  normaliseFreeTextIdentifier,
  validateAndNormaliseIdentifier,
} from '../../../src/services/compliance/utils/patient-identifier.validator';

describe('normaliseAbhaNumber', () => {
  it.each([
    ['91123456789012', '91123456789012'],
    ['91-1234-5678-9012', '91123456789012'],
    [' 91 1234 5678 9012 ', '91123456789012'],
  ])('accepts %s', (raw, expected) => {
    expect(normaliseAbhaNumber(raw)).toEqual({ valid: true, value: expected });
  });

  it.each(['9112345678901', '911234567890123', '9112345678901a', '', '----'])('rejects %s', raw => {
    expect(normaliseAbhaNumber(raw).valid).toBe(false);
  });
});

describe('normaliseAbhaAddress', () => {
  it('lowercases and accepts @abdm and @sbx', () => {
    expect(normaliseAbhaAddress('Dr.Asha_1@ABDM')).toEqual({
      valid: true,
      value: 'dr.asha_1@abdm',
    });
    expect(normaliseAbhaAddress('asha-k@sbx')).toEqual({ valid: true, value: 'asha-k@sbx' });
  });

  it.each(['asha@gmail.com', 'abc@abdm', 'asha@abdm.in', '@abdm', 'asha k@abdm', 'asha'])(
    'rejects %s',
    raw => {
      expect(normaliseAbhaAddress(raw).valid).toBe(false);
    }
  );
});

describe('normaliseFreeTextIdentifier', () => {
  it('accepts a legacy register number like 26/4116 and trims', () => {
    expect(normaliseFreeTextIdentifier('  26/4116 ')).toEqual({ valid: true, value: '26/4116' });
  });

  it('accepts an 18-digit legacy number', () => {
    const value = '123456789012345678';
    expect(normaliseFreeTextIdentifier(value)).toEqual({ valid: true, value });
  });

  it('rejects empty, whitespace-only and over-long values', () => {
    expect(normaliseFreeTextIdentifier('').valid).toBe(false);
    expect(normaliseFreeTextIdentifier('   ').valid).toBe(false);
    expect(normaliseFreeTextIdentifier('x'.repeat(65)).valid).toBe(false);
    expect(normaliseFreeTextIdentifier('x'.repeat(64)).valid).toBe(true);
  });

  it('rejects control characters', () => {
    expect(normaliseFreeTextIdentifier('26/4\u0000116').valid).toBe(false);
    expect(normaliseFreeTextIdentifier('26/4\n116').valid).toBe(false);
    expect(normaliseFreeTextIdentifier('26/4\u007f116').valid).toBe(false);
  });
});

describe('validateAndNormaliseIdentifier', () => {
  it('dispatches per system', () => {
    expect(validateAndNormaliseIdentifier('ABHA_NUMBER', '91-1234-5678-9012')).toEqual({
      valid: true,
      value: '91123456789012',
    });
    expect(validateAndNormaliseIdentifier('ABHA_ADDRESS', 'A.B-c1@SBX')).toEqual({
      valid: true,
      value: 'a.b-c1@sbx',
    });
    expect(validateAndNormaliseIdentifier('UHID', ' ish-000000018 ')).toEqual({
      valid: true,
      value: 'ISH-000000018',
    });
    expect(validateAndNormaliseIdentifier('LEGACY_REGISTRATION', '26/4116')).toEqual({
      valid: true,
      value: '26/4116',
    });
    expect(validateAndNormaliseIdentifier('LEGACY_REGISTRATION', '').valid).toBe(false);
  });

  it('only accepts a UHID with the proper format and check digit', () => {
    expect(validateAndNormaliseIdentifier('UHID', 'ISH-000000019').valid).toBe(false);
    expect(validateAndNormaliseIdentifier('UHID', '26/4116').valid).toBe(false);
    expect(validateAndNormaliseIdentifier('UHID', '123456789012345678').valid).toBe(false);
    expect(validateAndNormaliseIdentifier('UHID', '').valid).toBe(false);
  });
});
