/// <reference types="jest" />
/**
 * The query cache used to tag every entry only `database` + `read`, so every write anywhere had
 * to empty the whole cache (measured live 2026-11-13: ~4% hit rate). The tracker records which
 * tables each read depends on and each write changes, from Prisma's own operation arguments and
 * the generated client's DMMF, so invalidation can be per table. These tests run against the real
 * generated schema.
 */

import {
  ALL_QUERY_CACHE_TAG,
  UNTRACKED_READ_TAG,
  collectModelTables,
  configureQueryTrackingSchema,
  describeOperation,
  emptyTableSet,
  isQueryTrackingConfigured,
  isTableTag,
  newQueryTrackingScope,
  readDependencyTags,
  runWithQueryTracking,
  setUntrackedWriteListener,
  markEnclosingReadsUntracked,
  runInTransactionScope,
  tableCacheTagForEntity,
  tableTag,
  trackPrismaOperation,
  writeInvalidationTags,
  type PrismaArgValue,
  type QueryTrackingDmmf,
  type TableSet,
} from '@infrastructure/database/internal/query-dependency-tracker';
import { Prisma } from '@infrastructure/database/prisma/generated';

const generated = { Prisma: { dmmf: Prisma.dmmf as QueryTrackingDmmf } };

/** Table names of a set, without the `tbl:` cache-tag prefix (asserted separately). */
const tablesOf = (set: TableSet): string[] =>
  [...set.tables].map(tag => tag.replace(/^tbl:/, '')).sort();

/** A PrismaPromise-like lazy thenable: the "query" runs only when then() is called. */
function lazyQuery<T>(
  model: string,
  operation: string,
  args: PrismaArgValue,
  value: T
): PromiseLike<T> {
  return {
    then<R1 = T, R2 = never>(
      onFulfilled?: ((v: T) => R1 | PromiseLike<R1>) | null,
      onRejected?: ((e: Error) => R2 | PromiseLike<R2>) | null
    ): PromiseLike<R1 | R2> {
      return trackPrismaOperation(model, operation, args, () => Promise.resolve(value)).then(
        onFulfilled,
        onRejected
      );
    },
  };
}

describe('query-dependency-tracker', () => {
  beforeEach(() => {
    configureQueryTrackingSchema(generated.Prisma.dmmf);
    setUntrackedWriteListener(null);
  });

  afterAll(() => {
    setUntrackedWriteListener(null);
  });

  describe('tableTag', () => {
    it('matches the resourceType convention used by generateCacheTags', () => {
      expect(tableTag('Appointment')).toBe('appointment');
      expect(tableTag('HealthRecord')).toBe('health_record');
      expect(tableTag('RbacRole')).toBe('rbac_role');
      expect(tableTag('EHRNote')).toBe('ehr_note');
      expect(tableTag('userRole')).toBe('user_role');
    });

    it('knows the schema tables (as tbl: tags) and nothing else', () => {
      expect(isTableTag('tbl:appointment')).toBe(true);
      expect(isTableTag('tbl:user_role')).toBe(true);
      // Service-level entity tags are a different namespace
      expect(isTableTag('appointment')).toBe(false);
      expect(isTableTag('appointment:123')).toBe(false);
      expect(isTableTag(UNTRACKED_READ_TAG)).toBe(false);
    });

    it('prefixes table cache tags so they never collide with entity or clinic-scoped tags', () => {
      const set = emptyTableSet();
      collectModelTables('Appointment', { include: { patient: true } }, set);
      expect([...set.tables].sort()).toEqual(['tbl:appointment', 'tbl:patient']);
    });

    it('maps an entity name in any casing to its table tag', () => {
      expect(tableCacheTagForEntity('HealthRecord')).toBe('tbl:health_record');
      expect(tableCacheTagForEntity('HEALTH_RECORD')).toBe('tbl:health_record');
      expect(tableCacheTagForEntity('health_record')).toBe('tbl:health_record');
      expect(tableCacheTagForEntity('billing')).toBeNull();
    });
  });

  describe('collectModelTables', () => {
    it('follows relations in where, include and nested include', () => {
      const set = emptyTableSet();
      collectModelTables(
        'Appointment',
        {
          where: { patient: { userId: 'u1' }, status: 'SCHEDULED' },
          include: { doctor: { include: { user: true } } },
          take: 5,
        },
        set
      );
      expect(tablesOf(set)).toEqual(['appointment', 'doctor', 'patient', 'user']);
      expect(set.untracked).toBe(false);
    });

    it('follows relations in select, _count and orderBy', () => {
      const set = emptyTableSet();
      collectModelTables(
        'Patient',
        {
          select: {
            id: true,
            user: { select: { name: true } },
            _count: { select: { appointments: true } },
          },
          orderBy: { user: { name: 'asc' } },
        },
        set
      );
      expect(tablesOf(set)).toEqual(['appointment', 'patient', 'user']);
    });

    it('follows relation filters nested in AND/OR/some', () => {
      const set = emptyTableSet();
      collectModelTables(
        'Patient',
        { where: { OR: [{ appointments: { some: { doctor: { userId: 'd' } } } }] } },
        set
      );
      expect(tablesOf(set)).toEqual(['appointment', 'doctor', 'patient']);
    });

    it('records nested writes through relation fields', () => {
      const set = emptyTableSet();
      collectModelTables(
        'Appointment',
        { data: { patient: { connect: { id: 'p' } }, doctor: { connect: { id: 'd' } } } },
        set
      );
      expect(tablesOf(set)).toEqual(['appointment', 'doctor', 'patient']);
    });

    it('ignores scalar values that look like objects (dates, buffers)', () => {
      const set = emptyTableSet();
      collectModelTables('Appointment', { where: { date: new Date(), id: { in: ['a'] } } }, set);
      expect(tablesOf(set)).toEqual(['appointment']);
    });

    it('marks an unknown model untracked', () => {
      const set = emptyTableSet();
      collectModelTables('NoSuchModel', {}, set);
      expect(set.untracked).toBe(true);
    });

    it('marks everything untracked when no schema is configured', () => {
      configureQueryTrackingSchema(undefined);
      expect(isQueryTrackingConfigured()).toBe(false);
      const set = emptyTableSet();
      collectModelTables('Appointment', {}, set);
      expect(set.untracked).toBe(true);
    });
  });

  describe('describeOperation', () => {
    it('classifies model reads and writes', () => {
      expect(describeOperation('User', 'findUnique', { where: { id: 'x' } })).toEqual({
        reads: { tables: new Set(['tbl:user']), untracked: false },
        writes: null,
      });
      const update = describeOperation('Appointment', 'update', {
        where: { id: 'a' },
        data: { patient: { connect: { id: 'p' } } },
      });
      expect(update.reads).toBeNull();
      expect(tablesOf(update.writes!)).toEqual(['appointment', 'patient']);
    });

    it('treats an unknown model operation as both read and write', () => {
      const effect = describeOperation('User', 'someFutureOperation', {});
      expect(effect.reads?.tables.has('tbl:user')).toBe(true);
      expect(effect.writes?.tables.has('tbl:user')).toBe(true);
    });

    it('treats raw reads as untracked reads', () => {
      const sql = { strings: ['SELECT * FROM "Appointment" WHERE id = ', ''], values: ['a'] };
      expect(describeOperation(undefined, '$queryRaw', sql)).toEqual({
        reads: { tables: new Set(), untracked: true },
        writes: null,
      });
    });

    it('ignores advisory locks sent through $executeRaw (booking/billing locks)', () => {
      // Shapes observed from Prisma 7.10: tagged template -> Sql { strings, values }; Unsafe -> [sql].
      const tagged = { strings: ['SELECT pg_advisory_xact_lock(hashtext(', '))'], values: ['k'] };
      expect(describeOperation(undefined, '$executeRaw', tagged)).toEqual({
        reads: null,
        writes: null,
      });
      expect(
        describeOperation(undefined, '$executeRawUnsafe', ['select pg_try_advisory_lock(42)'])
      ).toEqual({ reads: null, writes: null });
    });

    it('treats any other raw write as touching everything', () => {
      const tagged = { strings: ['UPDATE "Appointment" SET status = ', ''], values: ['DONE'] };
      expect(describeOperation(undefined, '$executeRaw', tagged).writes).toEqual({
        tables: new Set(),
        untracked: true,
      });
      expect(describeOperation(undefined, '$executeRaw', { unknown: true }).writes?.untracked).toBe(
        true
      );
    });
  });

  describe('review fixes', () => {
    it('treats deletes as touching everything (database cascades are invisible to Prisma)', () => {
      expect(describeOperation('Patient', 'delete', { where: { id: 'p' } }).writes?.untracked).toBe(
        true
      );
      expect(describeOperation('Clinic', 'deleteMany', {}).writes?.untracked).toBe(true);
    });

    it('records only what a write changes, not what it filters on or returns', () => {
      const effect = describeOperation('Appointment', 'update', {
        where: { id: 'a', patient: { userId: 'u' } },
        data: { status: 'DONE' },
        include: { patient: { include: { user: true } }, doctor: true },
      });
      expect(tablesOf(effect.writes!)).toEqual(['appointment']);
      expect(effect.writes?.untracked).toBe(false);
    });

    it('walks an argument object reused under two relations under each model', () => {
      const shared = { clinic: { id: 'c' } };
      const set = emptyTableSet();
      // `clinic` is a relation of both Doctor and Patient; reuse must not skip the second walk.
      collectModelTables('Appointment', { where: { doctor: shared, patient: shared } }, set);
      expect(tablesOf(set)).toEqual(expect.arrayContaining(['doctor', 'patient']));
      expect(set.untracked).toBe(false);
    });

    it('records writes of a nested scope in the enclosing write scope too', async () => {
      const listener = jest.fn();
      setUntrackedWriteListener(listener);
      const outer = newQueryTrackingScope('write');
      const inner = newQueryTrackingScope('write');
      const innerRead = newQueryTrackingScope('read');
      await runWithQueryTracking(outer, async () => {
        await runWithQueryTracking(inner, () =>
          trackPrismaOperation('Invoice', 'update', { data: {} }, () => Promise.resolve({}))
        );
        await runWithQueryTracking(innerRead, () =>
          trackPrismaOperation('Payment', 'findMany', {}, () => Promise.resolve([]))
        );
      });
      expect(tablesOf(inner.written)).toEqual(['invoice']);
      expect(tablesOf(outer.written)).toEqual(['invoice']);
      expect(tablesOf(outer.read)).toEqual(['payment']);
      expect(listener).not.toHaveBeenCalled();
    });

    it('never makes a re-run scope its own parent', async () => {
      const scope = newQueryTrackingScope('read');
      await runWithQueryTracking(scope, () =>
        runWithQueryTracking(scope, () =>
          trackPrismaOperation('User', 'count', {}, () => Promise.resolve(1))
        )
      );
      expect(scope.parent).toBeUndefined();
      expect(tablesOf(scope.read)).toEqual(['user']);
    });
  });

  describe('independent review fixes', () => {
    const sql = (text: string): { strings: string[]; values: string[] } => ({
      strings: [text],
      values: [],
    });

    it('classifies raw SQL sent through $queryRaw by its text: UPDATE ... RETURNING is a write', () => {
      const effect = describeOperation(undefined, '$queryRawUnsafe', [
        `UPDATE "Appointment" SET status = 'IN_PROGRESS' WHERE id = $1 RETURNING id`,
      ]);
      expect(effect.writes).toEqual({ tables: new Set(), untracked: true });
      expect(effect.reads?.untracked).toBe(true);
    });

    it('does not treat row locks or quoted keywords as writes', () => {
      expect(
        describeOperation(
          undefined,
          '$queryRaw',
          sql('SELECT * FROM "Bed" WHERE id = 1 FOR UPDATE')
        ).writes
      ).toBeNull();
      expect(
        describeOperation(
          undefined,
          '$queryRaw',
          sql(`SELECT * FROM "AuditLog" WHERE action = 'UPDATE'`)
        ).writes
      ).toBeNull();
      expect(
        describeOperation(undefined, '$queryRaw', sql('SELECT "updatedAt" FROM "Ward"')).writes
      ).toBeNull();
    });

    it('does not let an advisory lock hide a write in the same statement string', () => {
      expect(
        describeOperation(undefined, '$executeRawUnsafe', [
          'SELECT pg_advisory_xact_lock(1); DELETE FROM "Bed"',
        ]).writes?.untracked
      ).toBe(true);
    });

    it('reports a raw write made through $queryRaw outside any scope', async () => {
      const listener = jest.fn();
      setUntrackedWriteListener(listener);
      await trackPrismaOperation(undefined, '$queryRaw', sql('UPDATE "Ward" SET name = 1'), () =>
        Promise.resolve([])
      );
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('treats operations after a scope finished as outside it (fire-and-forget work)', async () => {
      const listener = jest.fn();
      setUntrackedWriteListener(listener);
      const scope = newQueryTrackingScope('write');
      let late: (() => Promise<object>) | undefined;
      await runWithQueryTracking(scope, () => {
        // Started inside the write scope, runs after it has finished and invalidated.
        late = () =>
          trackPrismaOperation('Ward', 'update', { data: {} }, () => Promise.resolve({}));
        return Promise.resolve();
      });
      await late!();
      expect(tablesOf(scope.written)).toEqual([]);
      expect(tablesOf(listener.mock.calls[0][0] as TableSet)).toEqual(['ward']);
    });

    it('reports a service-opened transaction once, after it committed', async () => {
      const listener = jest.fn();
      setUntrackedWriteListener(listener);
      await runInTransactionScope(async () => {
        await trackPrismaOperation('Ward', 'update', { data: {} }, () => Promise.resolve({}));
        await trackPrismaOperation('Bed', 'create', { data: {} }, () => Promise.resolve({}));
        expect(listener).not.toHaveBeenCalled(); // not before the commit
      });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(tablesOf(listener.mock.calls[0][0] as TableSet)).toEqual(['bed', 'ward']);
    });

    it('leaves a transaction inside executeWrite/executeTransaction to that scope', async () => {
      const listener = jest.fn();
      setUntrackedWriteListener(listener);
      const outer = newQueryTrackingScope('write');
      await runWithQueryTracking(outer, () =>
        runInTransactionScope(() =>
          trackPrismaOperation('Ward', 'update', { data: {} }, () => Promise.resolve({}))
        )
      );
      expect(listener).not.toHaveBeenCalled();
      expect(tablesOf(outer.written)).toEqual(['ward']);
    });

    it('marks enclosing reads untracked on a nested cache hit', async () => {
      const outer = newQueryTrackingScope('read');
      await runWithQueryTracking(outer, () => {
        markEnclosingReadsUntracked();
        return Promise.resolve();
      });
      expect(outer.read.untracked).toBe(true);
    });

    it('counts `_count: true` as reading every relation of the model', () => {
      const set = emptyTableSet();
      collectModelTables('Ward', { include: { _count: true } }, set);
      expect(tablesOf(set)).toEqual(
        ['admission', 'bed', 'bed_assignment', 'clinic', 'clinic_location', 'ward'].sort()
      );
    });

    it('treats a nested delete inside a write as touching everything', () => {
      const effect = describeOperation('Ward', 'update', {
        where: { id: 'w' },
        data: { beds: { deleteMany: {} } },
      });
      expect(effect.writes?.untracked).toBe(true);
    });

    it('does not walk Json field values (data, not arguments)', () => {
      const deep: Record<string, object> = {};
      let node = deep;
      for (let i = 0; i < 30; i++) {
        const next: Record<string, object> = {};
        node['user'] = next; // a key equal to a relation name, nested deeper than the walk limit
        node = next;
      }
      const effect = describeOperation('AuditLog', 'create', { data: { metadata: deep } });
      expect(effect.writes?.untracked).toBe(false);
      expect(tablesOf(effect.writes!)).toEqual(['audit_log']);
    });
  });

  describe('tag rules', () => {
    it('tags an attributed read by its tables only', () => {
      expect(
        readDependencyTags({ tables: new Set(['appointment', 'patient']), untracked: false })
      ).toEqual(['appointment', 'patient']);
    });

    it('keeps the global tag on a read that is not fully attributed', () => {
      expect(readDependencyTags({ tables: new Set(['appointment']), untracked: true })).toEqual([
        'appointment',
        UNTRACKED_READ_TAG,
      ]);
      expect(readDependencyTags(emptyTableSet())).toEqual([UNTRACKED_READ_TAG]);
    });

    it('invalidates written tables plus the global tag (untracked reads refresh on every write)', () => {
      expect(
        writeInvalidationTags(
          { tables: new Set(['appointment']), untracked: false },
          { assumeAnyWhenNothingSeen: true }
        ).sort()
      ).toEqual(['appointment', UNTRACKED_READ_TAG].sort());
    });

    it('empties the whole query cache for an unattributed write', () => {
      expect(
        writeInvalidationTags(
          { tables: new Set(), untracked: true },
          { assumeAnyWhenNothingSeen: false }
        )
      ).toContain(ALL_QUERY_CACHE_TAG);
    });

    it('does not trust a write scope in which no write was observed', () => {
      expect(writeInvalidationTags(emptyTableSet(), { assumeAnyWhenNothingSeen: true })).toContain(
        ALL_QUERY_CACHE_TAG
      );
      expect(
        writeInvalidationTags(emptyTableSet(), { assumeAnyWhenNothingSeen: false })
      ).not.toContain(ALL_QUERY_CACHE_TAG);
    });
  });

  describe('scopes and the Prisma extension body', () => {
    it('records the reads of a scope, including lazy un-awaited Prisma promises', async () => {
      const scope = newQueryTrackingScope('read');
      // Like `prisma => prisma.user.findUnique(...)`: the lazy promise is returned, not awaited.
      await runWithQueryTracking(
        scope,
        () =>
          lazyQuery('User', 'findUnique', { include: { doctor: true } }, { id: 'u' }) as Promise<{
            id: string;
          }>
      );
      expect(tablesOf(scope.read)).toEqual(['doctor', 'user']);
    });

    it('records parallel reads and keeps concurrent scopes apart', async () => {
      const a = newQueryTrackingScope('read');
      const b = newQueryTrackingScope('read');
      await Promise.all([
        runWithQueryTracking(a, () =>
          Promise.all([
            trackPrismaOperation('User', 'count', {}, () => Promise.resolve(1)),
            trackPrismaOperation('Clinic', 'count', {}, () => Promise.resolve(1)),
          ])
        ),
        runWithQueryTracking(b, () =>
          trackPrismaOperation('Payment', 'findMany', {}, () => Promise.resolve([]))
        ),
      ]);
      expect(tablesOf(a.read)).toEqual(['clinic', 'user']);
      expect(tablesOf(b.read)).toEqual(['payment']);
    });

    it('keeps writes in a write scope for the caller to invalidate after commit', async () => {
      const listener = jest.fn();
      setUntrackedWriteListener(listener);
      const scope = newQueryTrackingScope('write');
      await runWithQueryTracking(scope, () =>
        trackPrismaOperation('Invoice', 'update', { data: {} }, () => Promise.resolve({}))
      );
      expect(tablesOf(scope.written)).toEqual(['invoice']);
      expect(listener).not.toHaveBeenCalled();
    });

    it('reports a successful write outside any write scope to the listener', async () => {
      const listener = jest.fn();
      setUntrackedWriteListener(listener);
      // e.g. a service calling db.prisma.ward.create(...) directly, or inside a read scope
      await trackPrismaOperation('Ward', 'create', { data: {} }, () => Promise.resolve({}));
      await runWithQueryTracking(newQueryTrackingScope('read'), () =>
        trackPrismaOperation('Bed', 'update', { data: {} }, () => Promise.resolve({}))
      );
      expect(listener).toHaveBeenCalledTimes(2);
      expect(tablesOf(listener.mock.calls[0][0] as TableSet)).toEqual(['ward']);
      expect(tablesOf(listener.mock.calls[1][0] as TableSet)).toEqual(['bed']);
    });

    it('does not report a write that failed', async () => {
      const listener = jest.fn();
      setUntrackedWriteListener(listener);
      await expect(
        trackPrismaOperation('Ward', 'create', { data: {} }, () =>
          Promise.reject(new Error('boom'))
        )
      ).rejects.toThrow('boom');
      expect(listener).not.toHaveBeenCalled();
    });

    it('never lets a listener failure fail the write', async () => {
      setUntrackedWriteListener(() => {
        throw new Error('listener down');
      });
      await expect(
        trackPrismaOperation('Ward', 'create', { data: {} }, () => Promise.resolve('ok'))
      ).resolves.toBe('ok');
    });

    it('does not report advisory locks as writes', async () => {
      const listener = jest.fn();
      setUntrackedWriteListener(listener);
      await trackPrismaOperation(
        undefined,
        '$executeRaw',
        { strings: ['SELECT pg_advisory_xact_lock(', ')'], values: [1] },
        () => Promise.resolve(0)
      );
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
