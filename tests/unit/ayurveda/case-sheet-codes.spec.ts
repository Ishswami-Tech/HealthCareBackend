import { describe, it, expect } from '@jest/globals';
import { CASE_SHEET_OPTION_CODES } from '../../../src/services/ayurveda/data/case-sheet-codes.generated';
import {
  CASE_SHEET_CODE_SYSTEM,
  categoryCode,
  optionCode,
} from '../../../src/services/ayurveda/data/case-sheet-codes';

const EXAM_TYPES = [
  'ASHTAVIDHA_PARIKSHA',
  'DASHAVIDHA_PARIKSHA',
  'SROTAS_PARIKSHA',
  'SAMPRAPTI_GHATAKA',
  'PAIN_ASSESSMENT',
  'PERSONAL_HISTORY',
];

describe('case-sheet option codes', () => {
  it('covers every exam type', () => {
    expect(Object.keys(CASE_SHEET_OPTION_CODES).sort()).toEqual([...EXAM_TYPES].sort());
  });

  it('gives every option a lower-case slug that is unique within its category', () => {
    for (const [examType, categories] of Object.entries(CASE_SHEET_OPTION_CODES)) {
      for (const [categoryKey, options] of Object.entries(categories)) {
        const codes = Object.values(options);
        expect(codes.length).toBeGreaterThan(0);
        for (const code of codes) expect(code).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect({ where: `${examType}.${categoryKey}`, unique: new Set(codes).size }).toEqual({
          where: `${examType}.${categoryKey}`,
          unique: codes.length,
        });
      }
    }
  });

  it('looks up a stored label by exam type, category and option', () => {
    expect(optionCode('ASHTAVIDHA_PARIKSHA', 'nadi', 'वातपित्त')).toBe('vata-pitta');
    expect(optionCode('PAIN_ASSESSMENT', 'knee', 'Left')).toBe('left');
    expect(categoryCode('ASHTAVIDHA_PARIKSHA', 'jihva')).toBe('jihva');
  });

  it('keeps the same category key apart per exam type', () => {
    expect(categoryCode('ASHTAVIDHA_PARIKSHA', 'mala')).toBe('mala');
    expect(categoryCode('SAMPRAPTI_GHATAKA', 'mala')).toBe('mala');
    expect(optionCode('SAMPRAPTI_GHATAKA', 'mala', 'पुरीष')).toBe('purisha');
    expect(optionCode('ASHTAVIDHA_PARIKSHA', 'mala', 'पुरीष')).toBeNull();
  });

  it('returns null for unknown values and never reads prototype properties', () => {
    expect(optionCode('ASHTAVIDHA_PARIKSHA', 'nadi', 'free text')).toBeNull();
    expect(optionCode('ASHTAVIDHA_PARIKSHA', 'unknown', 'साम')).toBeNull();
    expect(optionCode('UNKNOWN_TYPE', 'nadi', 'साम')).toBeNull();
    expect(optionCode('constructor', 'toString', '__proto__')).toBeNull();
    expect(categoryCode('ASHTAVIDHA_PARIKSHA', 'constructor')).toBeNull();
  });

  it('uses the clinic URN code system, not a borrowed standard one', () => {
    expect(CASE_SHEET_CODE_SYSTEM.startsWith('urn:')).toBe(true);
    expect(CASE_SHEET_CODE_SYSTEM).not.toMatch(/snomed|loinc|icd|namaste/i);
  });
});
