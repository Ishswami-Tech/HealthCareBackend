import { describe, expect, it } from '@jest/globals';
import type { QueueEntryData } from '@core/types/appointment.types';
import {
  ORPHAN_ENTRY_GRACE_MS,
  isOrphanCheckInEntry,
  reconcileLiveEntries,
  type LiveQueueRebuildRow,
} from '@infrastructure/queue/src/services/live-queue-rebuild.util';

const label = (type: string): string => `label:${type}`;

function dbRow(id: string): LiveQueueRebuildRow {
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
    tokenNumber: 1,
    tokenLabel: null,
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
    tokenNumber: 1,
    priority: 0,
    locationId: 'loc-1',
    ...overrides,
  } as QueueEntryData;
}

describe('live queue consistency: orphan entries (appointment deleted)', () => {
  it('drops a check-in entry whose appointment no longer exists, after the grace period', () => {
    const orphanId = 'a1df42bc-d12d-41ff-b10c-5551d57fe79f';
    const now = Date.parse('2026-10-22T09:00:00Z');
    const orphan = entry(orphanId, { tokenNumber: 559, tokenLabel: 'A-559' });
    const result = reconcileLiveEntries(
      [orphan, entry('a1')],
      [dbRow('a1')],
      new Map(),
      label,
      now
    );
    expect(result.removed).toBe(1);
    expect(result.entries.map(e => e.appointmentId)).toEqual(['a1']);
  });

  it('keeps a just-written entry (its appointment may not be readable yet) and lane items', () => {
    const freshId = 'b1df42bc-d12d-41ff-b10c-5551d57fe79f';
    const now = Date.parse('2026-10-22T04:01:00Z');
    const fresh = entry(freshId);
    const lane = entry('lane-item');
    const result = reconcileLiveEntries([fresh, lane], [], new Map(), label, now);
    expect(result.removed).toBe(0);
    expect(result.entries).toHaveLength(2);
    expect(isOrphanCheckInEntry(fresh, now + ORPHAN_ENTRY_GRACE_MS)).toBe(true);
    expect(isOrphanCheckInEntry(lane, now + ORPHAN_ENTRY_GRACE_MS)).toBe(false);
  });

  it('an appointment id entry without token or location is not judged an orphan', () => {
    const bare = {
      appointmentId: 'c1df42bc-d12d-41ff-b10c-5551d57fe79f',
      patientId: 'p-1',
      doctorId: 'd-1',
      clinicId: 'c-1',
      status: 'WAITING',
      checkedInAt: '2026-10-22T04:00:00.000Z',
      priority: 0,
    } as QueueEntryData;
    expect(isOrphanCheckInEntry(bare, Date.parse('2026-10-23'))).toBe(false);
  });

  it('a known closed appointment is still dropped (existing rule)', () => {
    const closedId = 'd1df42bc-d12d-41ff-b10c-5551d57fe79f';
    const result = reconcileLiveEntries(
      [entry(closedId)],
      [],
      new Map([[closedId, 'COMPLETED']]),
      label,
      Date.parse('2026-10-22T04:00:30Z')
    );
    expect(result.removed).toBe(1);
  });
});
