/// <reference types="jest" />
/**
 * The query cache's L2 (Dragonfly) stores JSON, so cached Prisma results used to come back from
 * an L2 hit with every DateTime as an ISO string. Once the query cache started serving L2 hits,
 * PermissionService rejected cached permissions ("Invalid permission entity structure":
 * `createdAt instanceof Date` failed) - seen in production 2026-11-13. QueryCacheService now
 * stores a type-preserving envelope; these tests push values through a real
 * JSON.stringify/JSON.parse round trip, as Dragonfly does.
 */

import {
  QueryCacheService,
  decodeQueryCacheValue,
  encodeQueryCacheValue,
  type CacheJson,
} from '@infrastructure/database/internal/query-cache.service';
import type { PrismaArgValue } from '@infrastructure/database/internal/query-dependency-tracker';
import type { CacheService } from '@infrastructure/cache/cache.service';
import type { LoggingService } from '@infrastructure/logging/logging.service';

/** What an L2 hit returns: the stored value after JSON serialization. */
const throughL2 = (value: PrismaArgValue): PrismaArgValue =>
  decodeQueryCacheValue(JSON.parse(JSON.stringify(encodeQueryCacheValue(value))) as CacheJson);

describe('query cache codec (type-preserving L2 round trip)', () => {
  it('returns real Date objects for a permission entity (the production failure)', () => {
    const permission = {
      id: '3f077044-02fa-4c9e-bd59-5997472d3c1d',
      name: 'Manage Lab Reports',
      resource: 'lab-reports',
      action: '*',
      description: 'Full lab access',
      isSystemPermission: true,
      isActive: true,
      createdAt: new Date('2026-05-15T15:48:29.376Z'),
      updatedAt: new Date('2026-05-15T15:48:29.376Z'),
    };
    const decoded = throughL2(permission) as typeof permission;
    expect(decoded.createdAt).toBeInstanceOf(Date);
    expect(decoded.updatedAt).toBeInstanceOf(Date);
    expect(decoded).toEqual(permission);
    // Plain JSON (the old behaviour) is exactly what broke it:
    const plain = JSON.parse(JSON.stringify(permission)) as { createdAt: string };
    expect(typeof plain.createdAt).toBe('string');
  });

  it('keeps dates inside nested relations and arrays', () => {
    const appointment = {
      id: 'a1',
      date: new Date('2026-11-13T05:30:00.000Z'),
      patient: { id: 'p1', user: { id: 'u1', dateOfBirth: new Date('1990-01-01T00:00:00.000Z') } },
      notes: [{ at: new Date('2026-11-13T06:00:00.000Z'), text: 'x' }],
      deletedAt: null,
    };
    const decoded = throughL2(appointment) as typeof appointment;
    expect(decoded).toEqual(appointment);
    expect(decoded.patient.user.dateOfBirth).toBeInstanceOf(Date);
    expect(decoded.notes[0]?.at).toBeInstanceOf(Date);
    expect(decoded.deletedAt).toBeNull();
  });

  it('round-trips BigInt (plain JSON.stringify throws on it)', () => {
    expect(() => JSON.stringify({ n: BigInt(1) })).toThrow();
    expect(throughL2({ n: BigInt('9007199254740993') })).toEqual({ n: BigInt('9007199254740993') });
  });

  it('round-trips bytes, non-finite numbers, invalid dates and undefined', () => {
    const bytes = Buffer.from([0, 1, 2, 255]);
    const decoded = throughL2({
      bytes,
      inf: Infinity,
      nan: Number.NaN,
      bad: new Date('not a date'),
      list: [1, undefined, 3],
    }) as { bytes: Buffer; inf: number; nan: number; bad: Date; list: Array<number | null> };
    expect(Buffer.compare(decoded.bytes, bytes)).toBe(0);
    expect(decoded.inf).toBe(Infinity);
    expect(Number.isNaN(decoded.nan)).toBe(true);
    expect(Number.isNaN(decoded.bad.getTime())).toBe(true);
    expect(decoded.list).toEqual([1, null, 3]); // as JSON does
    expect(throughL2(undefined)).toBeUndefined();
    expect(throughL2(null)).toBeNull();
    expect(throughL2([])).toEqual([]);
    expect(throughL2(0)).toBe(0);
  });

  it('never misreads user JSON data that uses the tag key', () => {
    // e.g. a Json column whose content happens to look like an encoded value
    const row = {
      metadata: { __hcbType: 'Date', v: 'not-a-date-just-data' },
      nested: [{ __hcbType: 'Object', v: { a: 1 } }],
    };
    expect(throughL2(row)).toEqual(row);
  });

  it('treats an unknown tag as an ordinary object', () => {
    expect(decodeQueryCacheValue({ __hcbType: 'Something', v: 'x' })).toEqual({
      __hcbType: 'Something',
      v: 'x',
    });
  });
});

describe('QueryCacheService envelope', () => {
  function build(): { service: QueryCacheService; store: Map<string, CacheJson> } {
    const store = new Map<string, CacheJson>();
    // Simulates L2: whatever is cached comes back as JSON.
    async function cache<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
      const value = await fetchFn();
      store.set(key, JSON.parse(JSON.stringify(value)) as CacheJson);
      return value;
    }
    async function get<T>(key: string): Promise<T | null> {
      const raw = store.get(key);
      return Promise.resolve(raw === undefined ? null : (JSON.parse(JSON.stringify(raw)) as T));
    }
    const cacheStub: Partial<CacheService> = { cache, get };
    const loggingStub: Partial<LoggingService> = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new QueryCacheService(cacheStub as CacheService, loggingStub as LoggingService);
    return { service, store };
  }

  it('stores an envelope and returns the decoded value with real dates', async () => {
    const { service, store } = build();
    const row = { id: 'x', createdAt: new Date('2026-01-01T00:00:00.000Z') };
    await service.setCached('k', row, { tags: [] });
    expect((store.get('k') as Record<string, CacheJson>)['__hcbQueryCache']).toBe(1);
    const hit = await service.getCached<typeof row>('k');
    expect(hit?.createdAt).toBeInstanceOf(Date);
    expect(hit).toEqual(row);
  });

  it('serves a falsy result (count 0) as a hit', async () => {
    const { service } = build();
    await service.setCached('count', 0, { tags: [] });
    expect(await service.getCached<number>('count')).toBe(0);
  });

  it('treats an entry written before the envelope (dates already strings) as a miss', async () => {
    const { service, store } = build();
    store.set('legacy', { id: 'x', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(await service.getCached('legacy')).toBeNull();
  });

  it('returns a fresh object per hit, so callers cannot corrupt the cached copy', async () => {
    const { service } = build();
    await service.setCached('k', { list: [1, 2] }, { tags: [] });
    const first = await service.getCached<{ list: number[] }>('k');
    first?.list.push(3);
    expect(await service.getCached<{ list: number[] }>('k')).toEqual({ list: [1, 2] });
  });
});
