import { describe, expect, it } from '@jest/globals';
import {
  MEDICINE_TYPE_INPUT_VALUES,
  MedicineType,
  normaliseMedicineTypeToken,
  resolveMedicineTypeInput,
} from '../../../src/libs/dtos/pharmacy.dto';

const AYURVEDIC_FORMS = [
  'BHASMA',
  'CHURNA',
  'GHRITA',
  'GRANULE',
  'KASHAYAM',
  'YAVKUT_KWATH',
  'LEPA',
  'VATI',
  'PARPATI',
  'PISHTEE',
  'GUTIKA',
  'ASAVA',
  'SWARASA',
];
const OTHER_FORMS = ['GEL', 'DRINK', 'SHAMPOO', 'LOTION', 'OIL', 'OINTMENT', 'TOOTHPASTE', 'SOAP'];

describe('medicine dosage forms', () => {
  it('accepts every form from the pharmacy list, plus the older ones', () => {
    for (const form of [
      ...AYURVEDIC_FORMS,
      ...OTHER_FORMS,
      'TABLET',
      'CAPSULE',
      'SYRUP',
      'DROPS',
      'INJECTION',
      'CREAM',
      'OTHER',
    ]) {
      expect(MEDICINE_TYPE_INPUT_VALUES).toContain(form);
      expect(Object.values(MedicineType)).toContain(form);
    }
  });

  it('still accepts the three classifications', () => {
    for (const classification of ['CLASSICAL', 'PROPRIETARY', 'HERBAL']) {
      expect(MEDICINE_TYPE_INPUT_VALUES).toContain(classification);
    }
  });

  it('treats spaces, hyphens and case as the same form', () => {
    for (const spelling of ['Yavkut Kwath', 'yavkut-kwath', 'YAVKUT_KWATH', '  yavkut   kwath ']) {
      expect(normaliseMedicineTypeToken(spelling)).toBe('YAVKUT_KWATH');
    }
    expect(normaliseMedicineTypeToken(undefined)).toBeUndefined();
  });

  it('stores a dosage form as the category and a packaged medicine as PROPRIETARY', () => {
    expect(resolveMedicineTypeInput({ type: 'Churna' })).toEqual({
      type: 'PROPRIETARY',
      category: 'CHURNA',
    });
    expect(resolveMedicineTypeInput({ type: 'Yavkut Kwath' })).toEqual({
      type: 'PROPRIETARY',
      category: 'YAVKUT_KWATH',
    });
  });

  it('keeps an explicit classification next to a dosage form', () => {
    expect(resolveMedicineTypeInput({ type: 'VATI', classification: 'classical' })).toEqual({
      type: 'CLASSICAL',
      category: 'VATI',
    });
  });

  it('passes a classification through unchanged and ignores unknown values', () => {
    expect(resolveMedicineTypeInput({ type: 'HERBAL' })).toEqual({ type: 'HERBAL' });
    expect(resolveMedicineTypeInput({ type: 'not-a-form' })).toEqual({});
  });
});
