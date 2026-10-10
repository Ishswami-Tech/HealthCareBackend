import { describe, expect, it } from '@jest/globals';
import {
  classifySearchTerm,
  escapeLike,
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

  it('recognises OPD numbers with or without the VM prefix', () => {
    expect(classifySearchTerm('vm-2017/21')).toEqual({ kind: 'opd', value: 'VM-2017/21' });
    expect(classifySearchTerm('2017/21')).toEqual({ kind: 'opd', value: '2017/21' });
    expect(classifySearchTerm('OPD-CL0002-2026-000123')?.kind).toBe('opd');
  });

  it('treats a phone number in any format as digits', () => {
    expect(classifySearchTerm('+91 98765-43210')).toEqual({ kind: 'phone', value: '919876543210' });
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

describe('escapeLike', () => {
  it('escapes LIKE wildcards so they match literally', () => {
    const typed = String.raw`50%_off\x`;
    expect(escapeLike(typed)).toBe(String.raw`50\%\_off\\x`);
  });
});
