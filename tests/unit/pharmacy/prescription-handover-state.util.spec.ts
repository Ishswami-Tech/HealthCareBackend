import { describe, expect, it } from '@jest/globals';
import {
  EMPTY_HANDOVER_STATE,
  canCollectMedicines,
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

describe('canCollectMedicines', () => {
  const item = { quantity: 2, dispensedQuantity: 0, unitPrice: 50 };

  it('is false when the prescription is paid but not dispensed yet (D4)', () => {
    expect(
      canCollectMedicines(
        { status: 'PENDING', items: [item], paidAmount: 100 },
        EMPTY_HANDOVER_STATE
      )
    ).toBe(false);
  });

  it('is false when dispensed but not paid', () => {
    expect(
      canCollectMedicines(
        { status: 'FILLED', items: [{ ...item, dispensedQuantity: 2 }], paidAmount: 0 },
        EMPTY_HANDOVER_STATE
      )
    ).toBe(false);
  });

  it('is true when dispensed and paid (or the invoice is paid)', () => {
    const dispensed = [{ ...item, dispensedQuantity: 2 }];
    expect(
      canCollectMedicines(
        { status: 'FILLED', items: dispensed, paidAmount: 100 },
        EMPTY_HANDOVER_STATE
      )
    ).toBe(true);
    expect(
      canCollectMedicines(
        { status: 'FILLED', items: dispensed, paidAmount: 0, invoiceStatus: 'PAID' },
        EMPTY_HANDOVER_STATE
      )
    ).toBe(true);
  });

  it('accepts a partial dispense with units given', () => {
    expect(
      canCollectMedicines(
        { status: 'PARTIAL', items: [{ ...item, dispensedQuantity: 1 }], paidAmount: 100 },
        EMPTY_HANDOVER_STATE
      )
    ).toBe(true);
  });

  it('is false once collected, and for an advice-only prescription', () => {
    expect(
      canCollectMedicines(
        { status: 'FILLED', items: [{ ...item, dispensedQuantity: 2 }], paidAmount: 100 },
        { status: 'HANDED_OVER', handedOverAt: '2026-10-31T06:00:00.000Z' }
      )
    ).toBe(false);
    expect(
      canCollectMedicines({ status: 'FILLED', items: [], paidAmount: 0 }, EMPTY_HANDOVER_STATE)
    ).toBe(false);
  });
});
