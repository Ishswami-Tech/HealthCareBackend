import { describe, expect, it } from '@jest/globals';
import {
  UNNAMED_PATIENT_LABEL,
  classifySearchTerm,
  directoryDisplayName,
  escapeLike,
  normalizePhoneDigits,
  isPharmacySearchAllowed,
  isRealCalendarDate,
} from '../../../src/services/patient-directory/utils/directory-search.util';

describe('classifySearchTerm', () => {
  it('ignores empty and one-character terms', () => {
    expect(classifySearchTerm(undefined)).toBeNull();
    expect(classifySearchTerm('   ')).toBeNull();
    expect(classifySearchTerm('a')).toBeNull();
  });

  it('recognises a UHID and upper-cases it', () => {
    expect(classifySearchTerm('cl0002-000000208')).toEqual({
      kind: 'uhid',
      value: 'CL0002-000000208',
    });
  });

  it('recognises an old register number', () => {
    expect(classifySearchTerm('103820170105141622')).toEqual({
      kind: 'legacy',
      value: '103820170105141622',
    });
  });

  it('treats a country-code mobile without a plus as a phone, not a register number', () => {
    expect(classifySearchTerm('919876543210')).toEqual({ kind: 'phone', value: '9876543210' });
  });

  it('recognises OPD numbers with or without the VM prefix', () => {
    expect(classifySearchTerm('vm-2017/21')).toEqual({ kind: 'opd', value: 'VM-2017/21' });
    expect(classifySearchTerm('2017/21')).toEqual({ kind: 'opd', value: '2017/21' });
    expect(classifySearchTerm('OPD-CL0002-2026-000123')?.kind).toBe('opd');
  });

  it('treats a phone number in any format as digits', () => {
    expect(classifySearchTerm('+91 98765-43210')).toEqual({ kind: 'phone', value: '9876543210' });
    expect(classifySearchTerm('09876543210')).toEqual({ kind: 'phone', value: '9876543210' });
    expect(classifySearchTerm('4321')).toEqual({ kind: 'phone', value: '4321' });
  });

  it('does not treat three digits as a phone (too broad)', () => {
    expect(classifySearchTerm('432')?.kind).toBe('name');
  });

  it('recognises an e-mail', () => {
    expect(classifySearchTerm('Rahul@Example.com')).toEqual({
      kind: 'email',
      value: 'rahul@example.com',
    });
  });

  it('splits a name into lower-cased words in any order', () => {
    expect(classifySearchTerm('  Gaikwad   TANAJI ')).toEqual({
      kind: 'name',
      value: 'gaikwad tanaji',
      tokens: ['gaikwad', 'tanaji'],
    });
  });

  it('caps the number of name words and the length', () => {
    const many = classifySearchTerm('a1 b2 c3 d4 e5 f6 g7 h8');
    expect(many?.tokens).toHaveLength(6);
    expect(classifySearchTerm('x'.repeat(500))?.value.length).toBeLessThanOrEqual(100);
  });
});

describe('phone search matches every stored form of an Indian mobile', () => {
  it('searches the national number for +91, 91 and 0 prefixes', () => {
    for (const typed of ['+919000000980', '919000000980', '+91 90000 00980', '09000000980']) {
      expect(classifySearchTerm(typed)).toEqual({ kind: 'phone', value: '9000000980' });
    }
    expect(classifySearchTerm('9000000980')).toEqual({ kind: 'phone', value: '9000000980' });
  });

  it('keeps partial numbers and non-Indian numbers as typed', () => {
    expect(normalizePhoneDigits('0980')).toBe('0980');
    expect(normalizePhoneDigits('447854545454')).toBe('447854545454');
    // 91 followed by a number that is not a mobile is left alone.
    expect(normalizePhoneDigits('911234567890')).toBe('911234567890');
  });
});

describe('directoryDisplayName', () => {
  it('uses the full name, else first and last name', () => {
    expect(directoryDisplayName('PERF Gate Test', 'PERF Gate', 'Test')).toBe('PERF Gate Test');
    expect(directoryDisplayName(null, 'Asha', 'Patil')).toBe('Asha Patil');
  });

  it('labels an app sign-up that has no name yet instead of showing a blank row', () => {
    expect(directoryDisplayName('', '', '')).toBe(UNNAMED_PATIENT_LABEL);
    expect(directoryDisplayName('   ', null, undefined)).toBe(UNNAMED_PATIENT_LABEL);
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards so they match literally', () => {
    const typed = String.raw`50%_off\x`;
    expect(escapeLike(typed)).toBe(String.raw`50\%\_off\\x`);
  });
});

describe('isRealCalendarDate', () => {
  it('accepts real dates, including a leap day', () => {
    expect(isRealCalendarDate('2026-10-11')).toBe(true);
    expect(isRealCalendarDate('2028-02-29')).toBe(true);
  });

  it('rejects dates that match the pattern but do not exist', () => {
    expect(isRealCalendarDate('2026-02-31')).toBe(false);
    expect(isRealCalendarDate('2027-02-29')).toBe(false);
    expect(isRealCalendarDate('2026-13-01')).toBe(false);
  });
});

describe('isPharmacySearchAllowed (N4)', () => {
  it('lets pharmacy staff search by UHID, phone or a name of 3+ letters', () => {
    expect(isPharmacySearchAllowed(classifySearchTerm('CL0002-000000208'))).toBe(true);
    expect(isPharmacySearchAllowed(classifySearchTerm('98765 43210'))).toBe(true);
    expect(isPharmacySearchAllowed(classifySearchTerm('Asha'))).toBe(true);
    expect(isPharmacySearchAllowed(classifySearchTerm('asha patil'))).toBe(true);
  });

  it('refuses short names, e-mails, register numbers and an empty search', () => {
    expect(isPharmacySearchAllowed(classifySearchTerm('as'))).toBe(false);
    expect(isPharmacySearchAllowed(classifySearchTerm('a@b.in'))).toBe(false);
    expect(isPharmacySearchAllowed(classifySearchTerm('123456789012345678'))).toBe(false);
    expect(isPharmacySearchAllowed(null)).toBe(false);
  });
});
