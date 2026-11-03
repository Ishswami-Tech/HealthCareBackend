/**
 * Durable in-person tokens (audit P0-1 / P0-2): one series per clinic location per IST visit day,
 * allocated from the database counter and stored on the appointment. A fake raw-SQL client runs
 * the three statements of `assignLocationToken` against in-memory rows, one statement at a time
 * (each statement is atomic, as the counter upsert is in Postgres).
 */
import { describe, it, expect } from '@jest/globals';
import {
  BUMP_LOCATION_TOKEN_SQL,
  CREATE_LOCATION_COUNTER_SQL,
  NO_LOCATION_SERIES_KEY,
  assignLocationToken,
  supportsRawSql,
  tokenDayKey,
  type RawSqlClient,
} from '@infrastructure/queue/src/services/location-token.allocator';

interface FakeAppointment {
  id: string;
  clinicId: string;
  locationId: string | null;
  date: Date;
  tokenNumber: number | null;
  tokenLabel: string | null;
  tokenDay: string | null;
}

const LOCATIONS: Record<string, { name: string; settings: unknown }> = {
  'loc-kothrud': { name: 'Kothrud', settings: null },
  'loc-baner': { name: 'Baner', settings: { tokenPrefix: 'BN' } },
};

class FakeRawSql implements RawSqlClient {
  readonly appointments = new Map<string, FakeAppointment>();
  readonly counters = new Map<string, number>();
  /** Highest number of the check-in log per series key (tokens handed out while cache-only). */
  readonly loggedHighWater = new Map<string, number>();
  counterCalls = 0;

  add(row: Partial<FakeAppointment> & { id: string }): void {
    this.appointments.set(row.id, {
      clinicId: 'clinic-1',
      locationId: 'loc-kothrud',
      date: new Date('2026-10-21T18:30:00.000Z'), // 2026-10-22 00:00 IST (day key)
      tokenNumber: null,
      tokenLabel: null,
      tokenDay: null,
      ...row,
    });
  }

  async $queryRawUnsafe<T>(sql: string, ...values: Array<string | number | null>): Promise<T> {
    // yield like a network round trip so concurrent callers interleave between statements
    await Promise.resolve();
    if (sql.includes('FOR UPDATE')) {
      const row = this.appointments.get(String(values[0]));
      if (!row) return [] as T;
      const location = row.locationId ? LOCATIONS[row.locationId] : undefined;
      return [
        {
          ...row,
          locationName: location?.name ?? null,
          locationSettings: location?.settings ?? null,
        },
      ] as T;
    }
    if (sql === BUMP_LOCATION_TOKEN_SQL) {
      this.counterCalls += 1;
      const key = values.slice(0, 3).join('|');
      const current = this.counters.get(key);
      if (current === undefined) return [] as T;
      this.counters.set(key, current + 1);
      return [{ lastValue: current + 1 }] as T;
    }
    if (sql === CREATE_LOCATION_COUNTER_SQL) {
      const key = values.slice(0, 3).join('|');
      const current = this.counters.get(key);
      if (current !== undefined) {
        this.counters.set(key, current + 1);
        return [{ lastValue: current + 1 }] as T;
      }
      const [clinicId, locationId, day] = values;
      const stored = [...this.appointments.values()]
        .filter(a => a.clinicId === clinicId && a.locationId === locationId && a.tokenDay === day)
        .reduce((max, a) => Math.max(max, a.tokenNumber ?? 0), 0);
      const seeded = 1 + Math.max(stored, this.loggedHighWater.get(key) ?? 0);
      this.counters.set(key, seeded);
      return [{ lastValue: seeded }] as T;
    }
    if (sql.includes('UPDATE "Appointment"')) {
      const row = this.appointments.get(String(values[0]));
      if (!row || row.tokenNumber !== null) return [] as T;
      row.tokenNumber = Number(values[1]);
      row.tokenLabel = String(values[2]);
      row.tokenDay = String(values[3]);
      return [{ tokenNumber: row.tokenNumber }] as T;
    }
    throw new Error(`unexpected SQL: ${sql}`);
  }
}

describe('tokenDayKey: the series day is the IST day of the appointment slot', () => {
  it('a 23:45 IST slot belongs to that day, even when checked in after midnight', () => {
    // 2026-10-21 23:45 IST = 18:15 UTC
    expect(tokenDayKey(new Date('2026-10-21T18:15:00.000Z'))).toBe('2026-10-21');
  });

  it('a 00:10 IST slot belongs to the new day', () => {
    // 2026-10-22 00:10 IST = 2026-10-21 18:40 UTC
    expect(tokenDayKey(new Date('2026-10-21T18:40:00.000Z'))).toBe('2026-10-22');
  });

  it('refuses a missing date instead of guessing a series', () => {
    expect(() => tokenDayKey('not-a-date')).toThrow('needs the appointment date');
  });
});

describe('assignLocationToken', () => {
  it('allocates the next number of the location/day series and stores it on the appointment', async () => {
    const db = new FakeRawSql();
    db.add({ id: 'a-1' });

    const token = await assignLocationToken(db, 'a-1');

    expect(token).toEqual({
      tokenNumber: 1,
      tokenLabel: 'K-001',
      tokenDay: '2026-10-22',
      allocated: true,
    });
    expect(db.appointments.get('a-1')).toMatchObject({
      tokenNumber: 1,
      tokenLabel: 'K-001',
      tokenDay: '2026-10-22',
    });
  });

  it('is idempotent: a repeated check-in returns the stored token and never bumps the counter', async () => {
    const db = new FakeRawSql();
    db.add({ id: 'a-1' });
    await assignLocationToken(db, 'a-1');

    const again = await assignLocationToken(db, 'a-1');
    const third = await assignLocationToken(db, 'a-1', { prefix: 'Z' });

    expect(again).toMatchObject({ tokenNumber: 1, tokenLabel: 'K-001', allocated: false });
    // the stored label wins over a different prefix
    expect(third).toMatchObject({ tokenNumber: 1, tokenLabel: 'K-001', allocated: false });
    expect(db.counterCalls).toBe(1);
  });

  it('every doctor at a location shares ONE series; another location has its own (prefix setting)', async () => {
    const db = new FakeRawSql();
    db.add({ id: 'dr-a-1' });
    db.add({ id: 'dr-b-1' });
    db.add({ id: 'baner-1', locationId: 'loc-baner' });
    db.add({ id: 'dr-a-2' });

    const labels: string[] = [];
    for (const id of ['dr-a-1', 'dr-b-1', 'baner-1', 'dr-a-2']) {
      labels.push((await assignLocationToken(db, id))?.tokenLabel ?? '');
    }

    expect(labels).toEqual(['K-001', 'K-002', 'BN-001', 'K-003']);
  });

  it('a new visit day starts a new series; a late slot keeps its own day', async () => {
    const db = new FakeRawSql();
    db.add({ id: 'd1-a', date: new Date('2026-10-20T18:30:00.000Z') }); // 2026-10-21
    db.add({ id: 'd1-late', date: new Date('2026-10-21T18:15:00.000Z') }); // 2026-10-21 23:45
    db.add({ id: 'd2-a', date: new Date('2026-10-21T18:30:00.000Z') }); // 2026-10-22

    const first = await assignLocationToken(db, 'd1-a');
    const nextDay = await assignLocationToken(db, 'd2-a');
    // checked in after midnight, but the 23:45 slot continues the 21st's series
    const late = await assignLocationToken(db, 'd1-late');

    expect(first).toMatchObject({ tokenNumber: 1, tokenDay: '2026-10-21' });
    expect(nextDay).toMatchObject({ tokenNumber: 1, tokenDay: '2026-10-22' });
    expect(late).toMatchObject({ tokenNumber: 2, tokenDay: '2026-10-21', tokenLabel: 'K-002' });
  });

  it('20 parallel check-ins at one location get unique, consecutive tokens', async () => {
    const db = new FakeRawSql();
    const ids = Array.from({ length: 20 }, (_, i) => `p-${i}`);
    ids.forEach(id => db.add({ id }));

    const tokens = await Promise.all(ids.map(id => assignLocationToken(db, id)));

    const numbers = tokens.map(token => token?.tokenNumber ?? 0).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(tokens.map(token => token?.tokenLabel)).size).toBe(20);
  });

  it('a new counter row continues above the tokens the day already handed out (deploy seam)', async () => {
    const db = new FakeRawSql();
    // 472 tokens were issued today by the old cache counter (check-in log), then the deploy.
    db.loggedHighWater.set('clinic-1|loc-kothrud|2026-10-22', 472);
    db.add({ id: 'after-deploy' });
    db.add({ id: 'next' });

    expect(await assignLocationToken(db, 'after-deploy')).toMatchObject({
      tokenNumber: 473,
      tokenLabel: 'K-473',
    });
    expect(await assignLocationToken(db, 'next')).toMatchObject({ tokenNumber: 474 });
  });

  it('a lost counter row is re-seeded from the tokens stored on appointments', async () => {
    const db = new FakeRawSql();
    db.add({ id: 'a' });
    db.add({ id: 'b' });
    await assignLocationToken(db, 'a');
    await assignLocationToken(db, 'b');
    db.counters.clear();
    db.add({ id: 'c' });

    expect(await assignLocationToken(db, 'c')).toMatchObject({ tokenNumber: 3 });
  });

  it('an appointment without a location uses its own series key, never another location', async () => {
    const db = new FakeRawSql();
    db.add({ id: 'kothrud' });
    db.add({ id: 'nowhere', locationId: null });

    await assignLocationToken(db, 'kothrud');
    const orphan = await assignLocationToken(db, 'nowhere');

    expect(orphan).toMatchObject({ tokenNumber: 1, tokenLabel: 'K-001' });
    expect([...db.counters.keys()]).toContain(`clinic-1|${NO_LOCATION_SERIES_KEY}|2026-10-22`);
  });

  it('returns null for an unknown appointment (nothing allocated)', async () => {
    const db = new FakeRawSql();

    expect(await assignLocationToken(db, 'missing')).toBeNull();
    expect(db.counterCalls).toBe(0);
  });
});

describe('supportsRawSql', () => {
  it('detects a client that can run the raw upsert', () => {
    expect(supportsRawSql(new FakeRawSql())).toBe(true);
    expect(supportsRawSql({ appointment: {} })).toBe(false);
    expect(supportsRawSql(null)).toBe(false);
  });
});
