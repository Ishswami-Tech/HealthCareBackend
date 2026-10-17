import { describe, expect, it } from '@jest/globals';
import {
  CLASSICAL_DOSAGE_FORMS,
  MEDICINE_TYPE_INPUT_VALUES,
  MedicineType,
  defaultClassificationForForm,
  normaliseMedicineTypeToken,
  resolveMedicineTypeInput,
} from '../../../src/libs/dtos/pharmacy.dto';

/** Forms that default to CLASSICAL on create (the documented contract). */
const CLASSICAL_FORMS = [
  'CHURNA',
  'KASHAYAM',
  'ARISHTA',
  'ASAVA',
  'AVALEHA',
  'GHRITA',
  'LEPA',
  'VATI',
  'BHASMA',
  'GUTIKA',
  'PARPATI',
  'PISHTEE',
  'SWARASA',
  'YAVKUT_KWATH',
];

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
  'ARISHTA',
  'AVALEHA',
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

  it('on create, stores a dosage form as the category and defaults the classification by form', () => {
    expect(resolveMedicineTypeInput({ type: 'Churna' })).toEqual({
      type: 'CLASSICAL',
      category: 'CHURNA',
    });
    expect(resolveMedicineTypeInput({ type: 'Yavkut Kwath' }, 'create')).toEqual({
      type: 'CLASSICAL',
      category: 'YAVKUT_KWATH',
    });
    expect(resolveMedicineTypeInput({ type: 'TABLET' }, 'create')).toEqual({
      type: 'PROPRIETARY',
      category: 'TABLET',
    });
  });

  it('defaults exactly the classical Ayurvedic forms to CLASSICAL and every other form to PROPRIETARY', () => {
    expect([...CLASSICAL_DOSAGE_FORMS].sort()).toEqual([...CLASSICAL_FORMS].sort());
    for (const form of Object.values(MedicineType)) {
      const expected = CLASSICAL_FORMS.includes(form) ? 'CLASSICAL' : 'PROPRIETARY';
      expect(defaultClassificationForForm(form)).toBe(expected);
      expect(resolveMedicineTypeInput({ type: form }, 'create')).toEqual({
        type: expected,
        category: form,
      });
    }
    // GRANULE, GEL, OIL, ... are packaged forms, not classical preparations.
    expect(defaultClassificationForForm('GRANULE')).toBe('PROPRIETARY');
  });

  it('keeps an explicit classification next to a dosage form', () => {
    expect(resolveMedicineTypeInput({ type: 'VATI', classification: 'classical' })).toEqual({
      type: 'CLASSICAL',
      category: 'VATI',
    });
    expect(resolveMedicineTypeInput({ type: 'CHURNA', classification: 'HERBAL' })).toEqual({
      type: 'HERBAL',
      category: 'CHURNA',
    });
  });

  it('on update, a dosage form changes only the category and never the classification', () => {
    expect(resolveMedicineTypeInput({ type: 'CHURNA' }, 'update')).toEqual({ category: 'CHURNA' });
    expect(resolveMedicineTypeInput({ type: 'Syrup' }, 'update')).toEqual({ category: 'SYRUP' });
    expect(resolveMedicineTypeInput({ category: 'VATI' }, 'update')).toEqual({ category: 'VATI' });
  });

  it('on update, the classification changes only through classification or a classification type', () => {
    expect(resolveMedicineTypeInput({ type: 'SYRUP', classification: 'HERBAL' }, 'update')).toEqual(
      { type: 'HERBAL', category: 'SYRUP' }
    );
    expect(resolveMedicineTypeInput({ classification: 'classical' }, 'update')).toEqual({
      type: 'CLASSICAL',
    });
    expect(resolveMedicineTypeInput({ type: 'PROPRIETARY' }, 'update')).toEqual({
      type: 'PROPRIETARY',
    });
  });

  it('passes a classification through unchanged and ignores unknown values', () => {
    expect(resolveMedicineTypeInput({ type: 'HERBAL' })).toEqual({ type: 'HERBAL' });
    expect(resolveMedicineTypeInput({ type: 'not-a-form' })).toEqual({});
    expect(resolveMedicineTypeInput({ type: 'not-a-form' }, 'update')).toEqual({});
  });
});
