/**
 * Duplicate medicine check (N13): same name (strength included) + dosage form within a clinic.
 * src/services/pharmacy/services/medicine-identity.util.ts
 */
import { describe, expect, it } from '@jest/globals';
import {
  duplicateMedicineMessage,
  normalizeMedicineForm,
  normalizeMedicineName,
} from '@services/pharmacy/services/medicine-identity.util';

describe('medicine identity', () => {
  it('normalizes the name by trimming and collapsing spaces', () => {
    expect(normalizeMedicineName('  Paracetamol   500mg ')).toBe('Paracetamol 500mg');
  });

  it('normalizes the form to upper case and null when blank', () => {
    expect(normalizeMedicineForm(' tablet ')).toBe('TABLET');
    expect(normalizeMedicineForm('')).toBeNull();
    expect(normalizeMedicineForm(undefined)).toBeNull();
    expect(normalizeMedicineForm(null)).toBeNull();
  });

  it('names the clashing medicine in the message', () => {
    expect(duplicateMedicineMessage(' Paracetamol  500mg', 'TABLET')).toContain(
      '"Paracetamol 500mg (tablet)"'
    );
    expect(duplicateMedicineMessage('Triphala', null)).toContain('"Triphala"');
  });
});
