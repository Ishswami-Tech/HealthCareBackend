import { describe, expect, it } from '@jest/globals';
import { draftChangedSinceReturn } from '../../../src/services/clinic-ops/services/rx-draft-change.util';

const item = {
  medicineId: 'm1',
  dosage: '1-0-1',
  frequency: 'BD',
  duration: '5 days',
  quantity: 10,
  instructions: null,
};
const snapshot = {
  takenAt: 'x',
  diagnosis: 'Fever',
  notes: null,
  items: [item, { ...item, medicineId: 'm2' }],
};

describe('draftChangedSinceReturn', () => {
  it('is unchanged for the same draft (item order, blank vs null, whitespace)', () => {
    expect(
      draftChangedSinceReturn(snapshot, {
        diagnosis: ' Fever ',
        notes: '',
        items: [
          { ...item, medicineId: 'm2' },
          { ...item, instructions: '  ' },
        ],
      })
    ).toBe(false);
  });

  it('detects item, diagnosis and notes edits', () => {
    expect(
      draftChangedSinceReturn(snapshot, {
        ...snapshot,
        items: [item, { ...item, medicineId: 'm2', quantity: 12 }],
      })
    ).toBe(true);
    expect(draftChangedSinceReturn(snapshot, { ...snapshot, items: [item] })).toBe(true);
    expect(draftChangedSinceReturn(snapshot, { ...snapshot, diagnosis: 'Viral fever' })).toBe(true);
    expect(draftChangedSinceReturn(snapshot, { ...snapshot, notes: 'Review in 3 days' })).toBe(
      true
    );
  });

  it('never blocks when the snapshot is missing or unreadable', () => {
    expect(draftChangedSinceReturn(null, snapshot)).toBe(true);
    expect(draftChangedSinceReturn({ diagnosis: 'Fever' }, snapshot)).toBe(true);
  });
});
