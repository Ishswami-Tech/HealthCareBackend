import { describe, expect, it } from '@jest/globals';
import {
  foldRangeFinancials,
  resolveAnalyticsRange,
} from '../../../src/services/analytics/analytics-range.util';
import { foldPriorityCounts } from '../../../src/services/appointments/plugins/analytics/appointment-analytics.util';
import {
  buildScopeWhere,
  type PrescriptionListScope,
} from '../../../src/services/pharmacy/services/prescription-list.util';
import {
  DOCTOR_BUSY_CODE,
  DOCTOR_BUSY_MESSAGE,
} from '../../../src/libs/infrastructure/queue/src/services/doctor-visit-start.util';

const day = {
  from: new Date('2026-10-21T18:30:00.000Z'),
  to: new Date('2026-10-22T10:00:00.000Z'),
};

describe('resolveAnalyticsRange', () => {
  it('keeps the period window without explicit dates', () => {
    expect(resolveAnalyticsRange(day)).toBe(day);
    expect(resolveAnalyticsRange(day, { startDate: 'nope', endDate: '2026-10-01' })).toBe(day);
  });

  it('uses startDate / endDate when both parse and are in order', () => {
    const range = resolveAnalyticsRange(day, {
      startDate: '2026-10-01T00:00:00.000Z',
      endDate: '2026-10-05T00:00:00.000Z',
    });
    expect(range.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('ignores a reversed window', () => {
    expect(resolveAnalyticsRange(day, { startDate: '2026-10-05', endDate: '2026-10-01' })).toBe(
      day
    );
  });
});

describe('foldRangeFinancials', () => {
  it('folds an empty window to zeros (no demo numbers)', () => {
    expect(foldRangeFinancials(day, { revenue: null, refunds: undefined, expenses: null })).toEqual(
      {
        totalRevenue: 0,
        totalRefunds: 0,
        netRevenue: 0,
        totalExpenses: 0,
        netProfit: 0,
        from: day.from.toISOString(),
        to: day.to.toISOString(),
      }
    );
  });

  it('nets refunds and expenses, rounded to paise', () => {
    const result = foldRangeFinancials(day, { revenue: 1500.555, refunds: 200, expenses: 100.1 });
    expect(result.totalRevenue).toBe(1500.56);
    expect(result.netRevenue).toBe(1300.56);
    expect(result.netProfit).toBe(1200.46);
  });
});

describe('foldPriorityCounts', () => {
  it('lists every priority with 0 when the window is empty', () => {
    expect(foldPriorityCounts([])).toEqual({ EMERGENCY: 0, URGENT: 0, HIGH: 0, NORMAL: 0, LOW: 0 });
  });

  it('counts real rows; null and legacy MEDIUM are NORMAL', () => {
    expect(
      foldPriorityCounts([
        { priority: 'NORMAL', count: 3 },
        { priority: null, count: 2 },
        { priority: 'medium', count: 1 },
        { priority: 'URGENT', count: 4 },
      ])
    ).toEqual({ EMERGENCY: 0, URGENT: 4, HIGH: 0, NORMAL: 6, LOW: 0 });
  });
});

describe('pharmacist prescription scope', () => {
  const base: PrescriptionListScope = { clinicId: 'CL0002', allowDrafts: false };

  it('keeps every prescription for doctors / admins', () => {
    expect(buildScopeWhere(base, {})).not.toHaveProperty('items');
  });

  it('leaves out note-only (advice) prescriptions for the pharmacist desk', () => {
    expect(buildScopeWhere({ ...base, medicinesOnly: true }, {})).toMatchObject({
      clinicId: 'CL0002',
      items: { some: {} },
    });
  });
});

describe('doctor busy refusal', () => {
  it('has its own error code', () => {
    expect(DOCTOR_BUSY_CODE).toBe('CONSULTATION_IN_PROGRESS');
    expect(DOCTOR_BUSY_MESSAGE).toBe('Finish the current consultation first');
  });
});
