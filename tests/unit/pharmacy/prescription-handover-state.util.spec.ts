import { describe, expect, it } from '@jest/globals';
import {
  EMPTY_HANDOVER_STATE,
  latestHandoverByPrescription,
  readyForHandoverAfter,
} from '../../../src/services/pharmacy/services/prescription-handover-state.util';

describe('latestHandoverByPrescription', () => {
  it('keeps the newest live row per prescription', () => {
    const map = latestHandoverByPrescription([
      {
        prescriptionId: 'a',
        status: 'UNDONE',
        createdAt: '2026-10-01T10:00:00Z',
        handedOverAt: null,
      },
      {
        prescriptionId: 'a',
        status: 'HANDED_OVER',
        createdAt: '2026-10-01T11:00:00Z',
        handedOverAt: new Date('2026-10-01T11:05:00Z'),
      },
      {
        prescriptionId: 'b',
        status: 'PENDING_VERIFICATION',
        createdAt: '2026-10-01T09:00:00Z',
        handedOverAt: null,
      },
    ]);
    expect(map.get('a')).toEqual({
      status: 'HANDED_OVER',
      handedOverAt: '2026-10-01T11:05:00.000Z',
    });
    expect(map.get('b')).toEqual({ status: 'PENDING_VERIFICATION', handedOverAt: null });
    expect(map.has('c')).toBe(false);
  });

  it('ignores SUPERSEDED / unknown rows and blanks handedOverAt unless HANDED_OVER', () => {
    const map = latestHandoverByPrescription([
      {
        prescriptionId: 'a',
        status: 'SUPERSEDED',
        createdAt: '2026-10-02T00:00:00Z',
        handedOverAt: null,
      },
      {
        prescriptionId: 'a',
        status: 'undone',
        createdAt: '2026-10-01T00:00:00Z',
        handedOverAt: '2026-10-01T00:01:00Z',
      },
    ]);
    expect(map.get('a')).toEqual({ status: 'UNDONE', handedOverAt: null });
  });
});

describe('readyForHandoverAfter', () => {
  it('is false once handed over, unchanged otherwise', () => {
    expect(readyForHandoverAfter(true, { status: 'HANDED_OVER', handedOverAt: 'x' })).toBe(false);
    expect(readyForHandoverAfter(true, { status: 'UNDONE', handedOverAt: null })).toBe(true);
    expect(readyForHandoverAfter(true, EMPTY_HANDOVER_STATE)).toBe(true);
    expect(readyForHandoverAfter(false, EMPTY_HANDOVER_STATE)).toBe(false);
  });
});
