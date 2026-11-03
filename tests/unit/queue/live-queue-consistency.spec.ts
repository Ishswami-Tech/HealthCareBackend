import { describe, expect, it } from '@jest/globals';
import type { QueueEntryData } from '@core/types/appointment.types';
import {
  PRIORITY_WEIGHTS,
  compareLiveQueueEntries,
  queuePriorityWeight,
  reconcileLiveEntries,
  type LiveQueueRebuildRow,
} from '@infrastructure/queue/src/services/live-queue-rebuild.util';
import {
  acquireWithRetry,
  jitteredDelay,
} from '@infrastructure/queue/src/services/queue-lock-retry.util';
import { queueWeightOf } from '@services/clinic-ops/services/queue-ops.service';

const label = (type: string): string => `label:${type}`;

function dbRow(id: string, overrides: Partial<LiveQueueRebuildRow> = {}): LiveQueueRebuildRow {
  return {
    id,
    doctorId: 'd-1',
    patientId: `p-${id}`,
    clinicId: 'c-1',
    locationId: 'loc-1',
    type: 'IN_PERSON',
    status: 'CONFIRMED',
    priority: 'NORMAL',
    metadata: {},
    checkedInAt: new Date('2026-10-22T04:00:00Z'),
    startedAt: null,
    tokenNumber: Number(id.replace(/\D/g, '')) || 1,
    tokenLabel: null,
    ...overrides,
  };
}

function entry(id: string, overrides: Partial<QueueEntryData> = {}): QueueEntryData {
  return {
    appointmentId: id,
    patientId: `p-${id}`,
    doctorId: 'd-1',
    clinicId: 'c-1',
    status: 'WAITING',
    checkedInAt: '2026-10-22T04:00:00.000Z',
    tokenNumber: Number(id.replace(/\D/g, '')) || 1,
    priority: 0,
    locationId: 'loc-1',
    ...overrides,
  } as QueueEntryData;
}

describe('one queue priority scale (M3 / B6)', () => {
  it('every ordinary value weighs 0; only raised priorities move ahead', () => {
    for (const value of ['NORMAL', 'MEDIUM', 'LOW', 'ROUTINE', '', null, undefined, 'nonsense']) {
      expect(queuePriorityWeight(value)).toBe(0);
    }
    expect(queuePriorityWeight('high')).toBe(50);
    expect(queuePriorityWeight('URGENT')).toBe(80);
    expect(queuePriorityWeight('EMERGENCY')).toBe(100);
    expect(queuePriorityWeight(30)).toBe(30);
    expect(PRIORITY_WEIGHTS['MEDIUM']).toBe(PRIORITY_WEIGHTS['NORMAL']);
  });

  it('the desk priority action uses the same scale; NORMAL is the never-raised weight', () => {
    expect(queueWeightOf('NORMAL')).toBe(0);
    expect(queueWeightOf('SENIOR')).toBe(50);
    expect(queueWeightOf('PREGNANT')).toBe(50);
    expect(queueWeightOf('EMERGENCY')).toBe(100);
  });

  it('a walk-in, a desk booking (MEDIUM) and a self booking (NORMAL) are served by token', () => {
    const walkIn = entry('a3', { tokenNumber: 3, priority: queuePriorityWeight(undefined) });
    const desk = entry('a2', { tokenNumber: 2, priority: queuePriorityWeight('MEDIUM') });
    const self = entry('a1', { tokenNumber: 1, priority: queuePriorityWeight('NORMAL') });
    const ordered = [walkIn, desk, self].sort(compareLiveQueueEntries).map(e => e.appointmentId);
    expect(ordered).toEqual(['a1', 'a2', 'a3']);
  });

  it('a priority reset to NORMAL puts the patient back at their arrival place', () => {
    const raised = entry('a3', { tokenNumber: 3, priority: queueWeightOf('SENIOR') });
    const others = [entry('a1', { tokenNumber: 1 }), entry('a2', { tokenNumber: 2 })];
    expect([raised, ...others].sort(compareLiveQueueEntries)[0]?.appointmentId).toBe('a3');
    const reset = { ...raised, priority: queueWeightOf('NORMAL') };
    expect([reset, ...others].sort(compareLiveQueueEntries).map(e => e.appointmentId)).toEqual([
      'a1',
      'a2',
      'a3',
    ]);
  });
});

describe('live queue consistency check (worker cron)', () => {
  it('adds a missing arrival, drops finished visits, keeps operational items', () => {
    const current = [entry('a1'), entry('a2'), entry('lane-item', { appointmentId: 'lane-item' })];
    const live = [dbRow('a1'), dbRow('a3')];
    const known = new Map([['a2', 'COMPLETED']]);
    const result = reconcileLiveEntries(current, live, known, label);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.entries.map(e => e.appointmentId).sort()).toEqual(['a1', 'a3', 'lane-item']);
    expect(result.entries.find(e => e.appointmentId === 'a3')?.tokenNumber).toBe(3);
  });

  it('follows the database status, stored token and the priority scale', () => {
    const current = [
      entry('a1', { status: 'WAITING', priority: 30 }),
      entry('a2', { status: 'IN_PROGRESS' }),
      entry('a4', { tokenNumber: 99 }),
    ];
    const live = [
      dbRow('a1', { status: 'IN_PROGRESS', startedAt: new Date('2026-10-22T05:00:00Z') }),
      dbRow('a2', { status: 'CONFIRMED' }),
      dbRow('a4', { tokenNumber: 4, tokenLabel: 'K-004' }),
    ];
    const result = reconcileLiveEntries(current, live, new Map(), label);
    expect(result.updated).toBe(3);
    const byId = new Map(result.entries.map(e => [e.appointmentId, e]));
    expect(byId.get('a1')).toMatchObject({ status: 'IN_PROGRESS', priority: 0 });
    expect(byId.get('a1')?.startedAt).toBe('2026-10-22T05:00:00.000Z');
    expect(byId.get('a2')?.status).toBe('WAITING');
    expect(byId.get('a4')).toMatchObject({ tokenNumber: 4, tokenLabel: 'K-004' });
  });

  it('a consistent list is left untouched (no rewrite)', () => {
    const result = reconcileLiveEntries([entry('a1')], [dbRow('a1')], new Map(), label);
    expect(result).toMatchObject({ added: 0, removed: 0, updated: 0 });
  });

  it('a duplicated entry is collapsed to one', () => {
    const result = reconcileLiveEntries(
      [entry('a1'), entry('a1')],
      [dbRow('a1')],
      new Map(),
      label
    );
    expect(result.entries).toHaveLength(1);
  });
});

describe('queue lock retry with jitter (L2)', () => {
  it('waits a little and retries before giving up (3 tries)', async () => {
    const answers = [false, false, true];
    const waits: number[] = [];
    const ok = await acquireWithRetry(
      async () => answers.shift() ?? false,
      { attempts: 3, minDelayMs: 75, maxDelayMs: 150 },
      async ms => {
        waits.push(ms);
      },
      () => 0.5
    );
    expect(ok).toBe(true);
    expect(waits).toEqual([113, 113]);
  });

  it('gives up after the last attempt; a throwing attempt counts as not acquired', async () => {
    let calls = 0;
    const ok = await acquireWithRetry(
      async () => {
        calls += 1;
        throw new Error('cache down');
      },
      { attempts: 3, minDelayMs: 1, maxDelayMs: 2 },
      async () => undefined
    );
    expect(ok).toBe(false);
    expect(calls).toBe(3);
  });

  it('the jitter stays inside the window (worst case ~300 ms over 3 tries)', () => {
    const policy = { attempts: 3, minDelayMs: 75, maxDelayMs: 150 };
    expect(jitteredDelay(policy, () => 0)).toBe(75);
    expect(jitteredDelay(policy, () => 1)).toBe(150);
    expect(2 * jitteredDelay(policy, () => 1)).toBeLessThanOrEqual(300);
  });
});
