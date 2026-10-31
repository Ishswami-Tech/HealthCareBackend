import { describe, expect, it } from '@jest/globals';
import {
  normalisePreferredLots,
  planFefoConsumption,
  type FefoPlanBatch,
} from '../../../src/services/pharmacy-inventory/services/fefo-plan.util';

const NOW = Date.parse('2026-10-31T06:00:00.000Z');
const day = (offset: number): Date => new Date(NOW + offset * 24 * 60 * 60 * 1000);

const batches: FefoPlanBatch[] = [
  { id: 'b-late', lotNumber: 'LATE-1', expiryDate: day(300), quantityOnHand: 50 },
  { id: 'b-early', lotNumber: 'EARLY-1', expiryDate: day(30), quantityOnHand: 5 },
  { id: 'b-old', lotNumber: 'OLD-1', expiryDate: day(-2), quantityOnHand: 40 },
];

describe('planFefoConsumption', () => {
  it('takes earliest expiry first and skips expired batches when no batch is chosen', () => {
    const plan = planFefoConsumption(batches, 8, [], NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.takes.map(t => [t.batch.lotNumber, t.quantity])).toEqual([
      ['EARLY-1', 5],
      ['LATE-1', 3],
    ]);
    expect(plan.remaining).toBe(0);
  });

  it('honours the chosen batch instead of the FEFO pick', () => {
    const plan = planFefoConsumption(batches, 4, [{ lotNumber: 'late-1', quantity: 4 }], NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.takes.map(t => [t.batch.id, t.quantity])).toEqual([['b-late', 4]]);
  });

  it('tops up from FEFO when the chosen batch covers only part, one take per batch', () => {
    const plan = planFefoConsumption(batches, 10, [{ lotNumber: 'LATE-1', quantity: 3 }], NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.takes.map(t => [t.batch.id, t.quantity])).toEqual([
      ['b-late', 5],
      ['b-early', 5],
    ]);
  });

  it('refuses a batch that does not belong to the medicine', () => {
    const plan = planFefoConsumption(batches, 2, [{ lotNumber: 'OTHER-9', quantity: 2 }], NOW);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.refusal.code).toBe('BATCH_NOT_FOUND');
  });

  it('refuses an expired chosen batch', () => {
    const plan = planFefoConsumption(batches, 2, [{ lotNumber: 'OLD-1', quantity: 2 }], NOW);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.refusal.code).toBe('BATCH_EXPIRED');
  });

  it('refuses a chosen batch without enough stock', () => {
    const plan = planFefoConsumption(batches, 6, [{ lotNumber: 'EARLY-1', quantity: 6 }], NOW);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.refusal.code).toBe('BATCH_SHORT');
  });

  it('reports what no batch covers as remaining', () => {
    const plan = planFefoConsumption(batches, 60, [], NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.remaining).toBe(5);
  });
});

describe('normalisePreferredLots', () => {
  it('merges repeated lots and drops blanks and non-positive quantities', () => {
    expect(
      normalisePreferredLots([
        { lotNumber: ' A1 ', quantity: 2 },
        { lotNumber: 'a1', quantity: 3 },
        { lotNumber: '', quantity: 4 },
        { lotNumber: 'B2', quantity: 0 },
      ])
    ).toEqual([{ lotNumber: 'A1', quantity: 5 }]);
  });
});
