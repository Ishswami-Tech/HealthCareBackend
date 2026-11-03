import { describe, expect, it } from '@jest/globals';
import {
  doctorVisitLockKey,
  startVisitAtomically,
  type VisitStartOutcome,
} from '@infrastructure/queue/src/services/doctor-visit-start.util';
import type { RawSqlClient } from '@infrastructure/queue/src/services/location-token.allocator';

interface Row {
  id: string;
  clinicId: string;
  doctorId: string;
  status: string;
  checkedInAt: Date | null;
  startedAt: Date | null;
  date: Date;
}

const NOW = new Date('2026-10-22T06:00:00Z'); // 11:30 IST
const TODAY = new Date('2026-10-21T18:30:00Z'); // IST midnight of 2026-10-22

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    clinicId: 'c-1',
    doctorId: 'd-1',
    status: 'CONFIRMED',
    checkedInAt: new Date('2026-10-22T04:00:00Z'),
    startedAt: null,
    date: TODAY,
    ...overrides,
  };
}

/**
 * A tiny in-memory Postgres for the four statements, with a transaction-scoped advisory lock:
 * a second transaction asking for the same lock waits until the first one ends.
 */
function fakeDatabase(rows: Row[]) {
  const table = new Map(rows.map(r => [r.id, { ...r }]));
  const held = new Map<string, Promise<void>>();

  async function transaction<T>(fn: (tx: RawSqlClient) => Promise<T>): Promise<T> {
    const releases: Array<() => void> = [];
    const tx: RawSqlClient = {
      $queryRawUnsafe: async <R>(sql: string, ...args: Array<string | number | null>) => {
        await Promise.resolve();
        if (sql.includes('pg_advisory_xact_lock')) {
          const key = String(args[0]);
          while (held.has(key)) await held.get(key);
          let release!: () => void;
          held.set(key, new Promise<void>(resolve => (release = resolve)));
          releases.push(() => {
            held.delete(key);
            release();
          });
          return [{ locked: 1 }] as unknown as R;
        }
        if (sql.includes('UPDATE "Appointment"')) {
          const [id, clinicId, at] = args as [string, string, string];
          const target = table.get(id);
          if (
            target &&
            target.clinicId === clinicId &&
            target.status === 'CONFIRMED' &&
            target.checkedInAt
          ) {
            target.status = 'IN_PROGRESS';
            target.startedAt = new Date(at);
            return [{ id }] as unknown as R;
          }
          return [] as unknown as R;
        }
        if (sql.includes('"status" = \'IN_PROGRESS\'') && sql.includes('LIMIT 1')) {
          const [doctorId, exceptId, from, to] = args as [string, string, string, string];
          const lo = Date.parse(from);
          const hi = Date.parse(to);
          const other = [...table.values()].find(
            r =>
              r.doctorId === doctorId &&
              r.id !== exceptId &&
              r.status === 'IN_PROGRESS' &&
              ((r.startedAt && r.startedAt.getTime() >= lo && r.startedAt.getTime() <= hi) ||
                (!r.startedAt && r.date.getTime() >= lo && r.date.getTime() <= hi))
          );
          return (other ? [{ id: other.id }] : []) as unknown as R;
        }
        const [id, clinicId] = args as [string, string];
        const found = table.get(id);
        return (found && found.clinicId === clinicId ? [{ ...found }] : []) as unknown as R;
      },
    };
    try {
      return await fn(tx);
    } finally {
      releases.forEach(release => release());
    }
  }

  const start = (appointmentId: string, clinicId = 'c-1'): Promise<VisitStartOutcome> =>
    transaction(tx => startVisitAtomically(tx, { appointmentId, clinicId, now: NOW }));
  return { table, start };
}

describe('startVisitAtomically (H2: one IN_PROGRESS per doctor, M5: idempotent start)', () => {
  it('starts a checked-in CONFIRMED visit', async () => {
    const db = fakeDatabase([row('a')]);
    const outcome = await db.start('a');
    expect(outcome.kind).toBe('started');
    expect(db.table.get('a')?.status).toBe('IN_PROGRESS');
  });

  it('a second start of the same visit is already-started (double click), not an error', async () => {
    const db = fakeDatabase([row('a')]);
    await db.start('a');
    const again = await db.start('a');
    expect(again.kind).toBe('already-started');
  });

  it('refuses a second patient while the doctor has one IN_PROGRESS today', async () => {
    const db = fakeDatabase([row('a'), row('b')]);
    expect((await db.start('a')).kind).toBe('started');
    const second = await db.start('b');
    expect(second).toEqual({ kind: 'doctor-busy', doctorId: 'd-1', inProgressAppointmentId: 'a' });
    expect(db.table.get('b')?.status).toBe('CONFIRMED');
  });

  it('two concurrent starts for the same doctor: exactly one wins', async () => {
    const db = fakeDatabase([row('a'), row('b'), row('c')]);
    const outcomes = await Promise.all([db.start('a'), db.start('b'), db.start('c')]);
    const kinds = outcomes.map(o => o.kind).sort();
    expect(kinds).toEqual(['doctor-busy', 'doctor-busy', 'started']);
    expect([...db.table.values()].filter(r => r.status === 'IN_PROGRESS')).toHaveLength(1);
  });

  it('another doctor, or a stale IN_PROGRESS from an earlier day, does not block', async () => {
    const db = fakeDatabase([
      row('a', { doctorId: 'd-2', status: 'IN_PROGRESS', startedAt: NOW }),
      row('old', {
        status: 'IN_PROGRESS',
        startedAt: new Date('2026-10-20T06:00:00Z'),
        date: new Date('2026-10-19T18:30:00Z'),
      }),
      row('b'),
    ]);
    expect((await db.start('b')).kind).toBe('started');
  });

  it('a visit that is not checked in is not startable; another clinic is not found', async () => {
    const db = fakeDatabase([row('a', { status: 'SCHEDULED', checkedInAt: null })]);
    const outcome = await db.start('a');
    expect(outcome).toMatchObject({ kind: 'not-startable', status: 'SCHEDULED', checkedIn: false });
    expect((await db.start('a', 'c-2')).kind).toBe('not-found');
  });

  it('locks per doctor and IST day', () => {
    expect(doctorVisitLockKey('d-1', '2026-10-22')).toBe('doctor-visit-start:d-1:2026-10-22');
  });
});
