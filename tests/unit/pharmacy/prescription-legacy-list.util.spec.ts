import { describe, expect, it } from '@jest/globals';
import {
  LEGACY_PRESCRIPTION_LIST_LIMIT,
  MEDICINE_DESK_ACTIVE_STATUSES,
  legacyPrescriptionListHeaders,
  sliceLegacyPrescriptionWindow,
} from '../../../src/services/pharmacy/services/prescription-legacy-list.util';
import { isOffMedicineDesk } from '../../../src/services/pharmacy/services/medicine-desk-status.util';

describe('sliceLegacyPrescriptionWindow', () => {
  it('keeps every row and is not truncated when at most `limit` rows came back', () => {
    expect(sliceLegacyPrescriptionWindow([1, 2, 3], 3)).toEqual({
      rows: [1, 2, 3],
      truncated: false,
    });
    expect(sliceLegacyPrescriptionWindow([], 3)).toEqual({ rows: [], truncated: false });
  });

  it('cuts the probe row and reports truncation when limit + 1 rows came back', () => {
    expect(sliceLegacyPrescriptionWindow([1, 2, 3, 4], 3)).toEqual({
      rows: [1, 2, 3],
      truncated: true,
    });
  });

  it('defaults to the legacy limit and never returns a zero-sized window', () => {
    const rows = Array.from({ length: LEGACY_PRESCRIPTION_LIST_LIMIT + 1 }, (_, i) => i);
    const window = sliceLegacyPrescriptionWindow(rows);
    expect(window.rows).toHaveLength(LEGACY_PRESCRIPTION_LIST_LIMIT);
    expect(window.truncated).toBe(true);
    expect(sliceLegacyPrescriptionWindow([1, 2], 0)).toEqual({ rows: [1], truncated: true });
  });

  it('does not mutate the fetched array', () => {
    const fetched = [1, 2, 3];
    const window = sliceLegacyPrescriptionWindow(fetched, 5);
    expect(window.rows).not.toBe(fetched);
    expect(fetched).toEqual([1, 2, 3]);
  });
});

describe('legacyPrescriptionListHeaders', () => {
  it('reports the total and the truncation flag', () => {
    expect(legacyPrescriptionListHeaders({ total: 1234, truncated: true })).toEqual({
      'X-Total-Count': '1234',
      'X-Truncated': 'true',
    });
    expect(legacyPrescriptionListHeaders({ total: 5, truncated: false })).toEqual({
      'X-Total-Count': '5',
      'X-Truncated': 'false',
    });
  });
});

describe('MEDICINE_DESK_ACTIVE_STATUSES', () => {
  it('is exactly the statuses that stay on the medicine desk', () => {
    const all = ['PENDING', 'PARTIAL', 'FILLED', 'CANCELLED', 'DRAFT', 'RETURNED'];
    expect(all.filter(status => !isOffMedicineDesk(status))).toEqual([
      ...MEDICINE_DESK_ACTIVE_STATUSES,
    ]);
  });
});
