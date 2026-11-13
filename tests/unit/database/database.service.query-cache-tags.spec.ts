/// <reference types="jest" />
/**
 * DatabaseService query cache: entries are tagged by the tables the read touched, writes
 * invalidate only the tables they changed, and every invalidation runs once through CacheService
 * (L2 by tag + L1 clear + cross-process broadcast).
 *
 * Before: every entry was tagged `database` + `read` and every write invalidated `database`, so any
 * write emptied the whole query cache (live 2026-11-13: ~4% hit rate), and each tag was deleted
 * twice (CacheService + QueryCacheService both looped invalidateCacheByTag).
 *
 * The service is built from its prototype with only the collaborators these paths use; the Prisma
 * extension is simulated by calling trackPrismaOperation the way the extension does.
 */

import { DatabaseService } from '@infrastructure/database/database.service';
import type { AuditInfo } from '@core/types/database.types';
import { QueryCacheService } from '@infrastructure/database/internal/query-cache.service';
import type { CacheService } from '@infrastructure/cache/cache.service';
import type { LoggingService } from '@infrastructure/logging/logging.service';
import {
  configureQueryTrackingSchema,
  setUntrackedWriteListener,
  trackPrismaOperation,
  type PrismaArgValue,
  type QueryTrackingDmmf,
} from '@infrastructure/database/internal/query-dependency-tracker';
import { Prisma } from '@infrastructure/database/prisma/generated';

const generated = { Prisma: { dmmf: Prisma.dmmf as QueryTrackingDmmf } };

interface Harness {
  service: DatabaseService;
  getCached: jest.Mock;
  remoteListeners: Array<(tag: string | null) => void>;
  setCached: jest.Mock;
  invalidateCacheByTag: jest.Mock;
  queryCacheInvalidate: jest.Mock;
}

/** Runs the queued setImmediate callbacks (cache writes / invalidations are deferred). */
const flushImmediates = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

function buildService(): Harness {
  const setCached = jest.fn().mockResolvedValue(undefined);
  const getCached = jest.fn().mockResolvedValue(null);
  const invalidateCacheByTag = jest.fn().mockResolvedValue(0);
  const queryCacheInvalidate = jest.fn().mockResolvedValue(undefined);
  const prismaStub = {};
  const remoteListeners: Array<(tag: string | null) => void> = [];
  const service = Object.create(DatabaseService.prototype) as DatabaseService;
  Object.assign(service, {
    serviceName: 'DatabaseService',
    tagInvalidatedAt: new Map<string, number>(),
    pendingUntrackedWriteTags: new Set<string>(),
    untrackedWriteFlushScheduled: false,
    stopRemoteInvalidationListener: null,
    config: { enableAuditLogging: false },
    queryCache: {
      getCached,
      setCached,
      invalidateCache: queryCacheInvalidate,
    },
    cacheService: {
      invalidateCacheByTag,
      onTagInvalidated: (listener: (tag: string | null) => void) => {
        remoteListeners.push(listener);
        return () => undefined;
      },
    },
    queryKeyFactory: { fromOperation: (op: string, p: object) => `k:${op}:${JSON.stringify(p)}` },
    metricsService: {
      recordCacheHit: jest.fn(),
      recordCacheMiss: jest.fn(),
      recordQueryExecution: jest.fn(),
    },
    prismaService: { isReady: () => true, isConnected: () => true },
    circuitBreaker: undefined,
    readReplicaRouter: { isEnabled: () => false },
    middlewareChain: {
      before: (ctx: object) => Promise.resolve(ctx),
      after: (_ctx: object, result: PrismaArgValue) => Promise.resolve(result),
      onError: (_ctx: object, error: Error) => Promise.resolve(error),
    },
    strategyManager: {
      execute: (op: (p: object) => Promise<PrismaArgValue>) => op(prismaStub),
    },
    retryService: {
      executeWithRetry: async (fn: () => Promise<PrismaArgValue>) => ({
        success: true,
        result: await fn(),
        attempts: 1,
      }),
    },
    loggingService: { log: jest.fn().mockResolvedValue(undefined) },
  });
  return {
    service,
    setCached,
    getCached,
    invalidateCacheByTag,
    queryCacheInvalidate,
    remoteListeners,
  };
}

/** What the Prisma extension does for one operation. */
const prismaOp = <T>(
  model: string | undefined,
  operation: string,
  args: PrismaArgValue,
  value: T
) => trackPrismaOperation(model, operation, args, () => Promise.resolve(value));

const tagsOfLastCacheWrite = (setCached: jest.Mock): string[] =>
  (setCached.mock.calls[setCached.mock.calls.length - 1]?.[2] as { tags: string[] }).tags;

const audit = (overrides: Partial<AuditInfo> & Pick<AuditInfo, 'resourceType'>): AuditInfo => ({
  userId: 'u',
  userRole: 'DOCTOR',
  operation: 'UPDATE',
  clinicId: 'c1',
  ...overrides,
});

const invalidatedTags = (invalidateCacheByTag: jest.Mock): string[] =>
  invalidateCacheByTag.mock.calls.map(call => call[0] as string);

describe('DatabaseService query cache tagging', () => {
  beforeEach(() => {
    configureQueryTrackingSchema(generated.Prisma.dmmf);
    setUntrackedWriteListener(null);
  });

  afterEach(() => {
    setUntrackedWriteListener(null);
    jest.useRealTimers();
  });

  describe('executeRead', () => {
    it('tags the cached result with the tables the read touched, not the global tag', async () => {
      const { service, setCached } = buildService();
      await service.executeRead(
        () =>
          prismaOp(
            'Appointment',
            'findMany',
            { where: { clinicId: 'c1' }, include: { patient: { include: { user: true } } } },
            [{ id: 'a1' }]
          ),
        { where: { clinicId: 'c1' }, clinicId: 'c1' }
      );
      await flushImmediates();

      const tags = tagsOfLastCacheWrite(setCached);
      expect(tags).toEqual(
        expect.arrayContaining(['read', 'tbl:appointment', 'tbl:patient', 'tbl:user', 'clinic:c1'])
      );
      expect(tags).not.toContain('database');
    });

    it('keeps the global tag on a read that ran raw SQL', async () => {
      const { service, setCached } = buildService();
      await service.executeRead(
        () => prismaOp(undefined, '$queryRaw', { strings: ['SELECT 1'], values: [] }, [{ one: 1 }]),
        { operationName: 'rawStats' }
      );
      await flushImmediates();
      expect(tagsOfLastCacheWrite(setCached)).toEqual(expect.arrayContaining(['read', 'database']));
    });

    it('keeps the global tag on a read in which no query was observed', async () => {
      const { service, setCached } = buildService();
      await service.executeRead(() => Promise.resolve([1, 2, 3]), { operationName: 'computed' });
      await flushImmediates();
      expect(tagsOfLastCacheWrite(setCached)).toContain('database');
    });

    it('does not cache a result one of whose tables was invalidated while it was being read', async () => {
      const { service, setCached } = buildService();
      await service.executeRead(
        async () => {
          const rows = await prismaOp('Invoice', 'findMany', {}, [{ id: 'old' }]);
          // A write to Invoice commits and invalidates while this read is still in flight.
          await service.invalidateEntityCache('invoice');
          return rows;
        },
        { operationName: 'invoices' }
      );
      await flushImmediates();
      expect(setCached).not.toHaveBeenCalled();
    });

    it('still caches when an unrelated table was invalidated meanwhile', async () => {
      const { service, setCached } = buildService();
      await service.executeRead(
        async () => {
          const rows = await prismaOp('Invoice', 'findMany', {}, [{ id: 'i' }]);
          await service.invalidateEntityCache('ward');
          return rows;
        },
        { operationName: 'invoices' }
      );
      await flushImmediates();
      expect(setCached).toHaveBeenCalledTimes(1);
    });
  });

  describe('cross-process and re-check', () => {
    it('does not cache a read whose table another process invalidated meanwhile', async () => {
      const { service, setCached, remoteListeners } = buildService();
      service.onModuleInit();
      await service.executeRead(
        async () => {
          const rows = await prismaOp('Invoice', 'findMany', {}, [{ id: 'old' }]);
          // Another API/worker process wrote Invoice; its broadcast arrives mid-read.
          for (const listener of remoteListeners) listener('tbl:invoice');
          return rows;
        },
        { operationName: 'invoices' }
      );
      await flushImmediates();
      expect(setCached).not.toHaveBeenCalled();
      service.onModuleDestroy();
    });

    it('treats a remote full clear as invalidating every table', async () => {
      const { service, setCached, remoteListeners } = buildService();
      service.onModuleInit();
      await service.executeRead(
        async () => {
          const rows = await prismaOp('Ward', 'findMany', {}, []);
          for (const listener of remoteListeners) listener(null);
          return rows;
        },
        { operationName: 'wards' }
      );
      await flushImmediates();
      expect(setCached).not.toHaveBeenCalled();
      service.onModuleDestroy();
    });

    it('re-checks right before the deferred cache write', async () => {
      const { service, setCached } = buildService();
      await service.executeRead(() => prismaOp('Invoice', 'findMany', {}, [{ id: 'i' }]), {
        operationName: 'invoices',
      });
      // The read passed the first check; an invalidation lands before the setImmediate runs.
      await service.invalidateEntityCache('invoice');
      await flushImmediates();
      expect(setCached).not.toHaveBeenCalled();
    });

    it("repeats a write's invalidation after the delay (double delete)", async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });
      const { service, invalidateCacheByTag } = buildService();
      await service.executeWrite(
        () => prismaOp('Invoice', 'update', { data: {} }, {}),
        audit({ resourceType: 'INVOICE' })
      );
      await flushImmediates();
      await flushImmediates();
      invalidateCacheByTag.mockClear();
      jest.advanceTimersByTime(2000);
      await flushImmediates();
      expect(invalidatedTags(invalidateCacheByTag)).toEqual(
        expect.arrayContaining(['tbl:invoice', 'database'])
      );
    });
  });

  describe('executeWrite', () => {
    it('invalidates the written tables plus the resourceType tags, each exactly once', async () => {
      const { service, invalidateCacheByTag, queryCacheInvalidate } = buildService();
      await service.executeWrite(
        () =>
          prismaOp(
            'Appointment',
            'update',
            { where: { id: 'a1' }, data: { patient: { connect: { id: 'p1' } } } },
            { id: 'a1' }
          ),
        audit({ resourceType: 'APPOINTMENT', resourceId: 'a1' })
      );
      await flushImmediates();
      await flushImmediates();

      const tags = invalidatedTags(invalidateCacheByTag);
      expect(tags).toEqual(expect.arrayContaining(['tbl:appointment', 'tbl:patient', 'database']));
      // Not the whole query cache
      expect(tags).not.toContain('read');
      // Each tag once: the duplicate QueryCacheService pass is gone
      expect(new Set(tags).size).toBe(tags.length);
      expect(queryCacheInvalidate).not.toHaveBeenCalled();
    });

    it('empties the whole query cache when no write was observed in the scope', async () => {
      const { service, invalidateCacheByTag } = buildService();
      await service.executeWrite(
        () => Promise.resolve('done'),
        audit({ resourceType: 'SOMETHING' })
      );
      await flushImmediates();
      await flushImmediates();
      expect(invalidatedTags(invalidateCacheByTag)).toContain('read');
    });

    it('respects skipCacheInvalidation', async () => {
      const { service, invalidateCacheByTag } = buildService();
      await service.executeWrite(
        () => prismaOp('AuditLog', 'create', { data: {} }, {}),
        audit({ resourceType: 'AUDIT', operation: 'CREATE', skipCacheInvalidation: true })
      );
      await flushImmediates();
      await flushImmediates();
      expect(invalidateCacheByTag).not.toHaveBeenCalled();
    });

    it('makes a cached read of the written table stale-proof: the entry is invalidated', async () => {
      const { service, setCached, invalidateCacheByTag } = buildService();
      await service.executeRead(() => prismaOp('Ward', 'findMany', {}, [{ id: 'w', beds: 1 }]), {
        operationName: 'wards',
      });
      await flushImmediates();
      const readTags = tagsOfLastCacheWrite(setCached);

      await service.executeWrite(
        () => prismaOp('Ward', 'update', { data: {} }, {}),
        audit({ resourceType: 'WARD' })
      );
      await flushImmediates();
      await flushImmediates();

      // Some tag the entry is registered under is invalidated by the write.
      expect(readTags.filter(tag => invalidatedTags(invalidateCacheByTag).includes(tag))).toContain(
        'tbl:ward'
      );
    });
  });

  describe('independent review fixes', () => {
    it('invalidates what a failed write had already committed', async () => {
      const { service, invalidateCacheByTag } = buildService();
      await expect(
        service.executeWrite(
          async () => {
            await prismaOp('Appointment', 'update', { data: {} }, {});
            throw new Error('unique constraint on the second write');
          },
          audit({ resourceType: 'APPOINTMENT' })
        )
      ).rejects.toThrow();
      await flushImmediates();
      await flushImmediates();
      expect(invalidatedTags(invalidateCacheByTag)).toContain('tbl:appointment');
    });

    it('tags an outer read as untracked when a nested cached read hit the cache', async () => {
      const { service, setCached, getCached } = buildService();
      await service.executeRead(
        async () => {
          getCached.mockResolvedValueOnce([{ id: 'cached' }]); // the nested read hits
          await service.executeRead(() => prismaOp('Invoice', 'findMany', {}, []), {
            operationName: 'inner',
          });
          return 'outer';
        },
        { operationName: 'outer' }
      );
      await flushImmediates();
      expect(tagsOfLastCacheWrite(setCached)).toContain('database');
    });

    it('invalidates the table tag for an entity name in any casing', async () => {
      const { service, invalidateCacheByTag } = buildService();
      await service.invalidateEntityCache('HealthRecord');
      expect(invalidatedTags(invalidateCacheByTag)).toContain('tbl:health_record');
    });
  });

  describe('QueryCacheService PHI TTL', () => {
    it('caps a PHI entry at the PHI TTL even when the caller passes a longer one', async () => {
      const cache = jest.fn().mockResolvedValue(undefined);
      const cacheStub: Partial<CacheService> = { cache };
      const loggingStub: Partial<LoggingService> = { log: jest.fn().mockResolvedValue(undefined) };
      const queryCache = new QueryCacheService(
        cacheStub as CacheService,
        loggingStub as LoggingService
      );
      await queryCache.setCached('k', { a: 1 }, { ttl: 3600, containsPHI: true, tags: [] });
      await queryCache.setCached('k2', { a: 1 }, { ttl: 3600, containsPHI: false, tags: [] });
      expect((cache.mock.calls[0][2] as { ttl: number }).ttl).toBe(60);
      expect((cache.mock.calls[1][2] as { ttl: number }).ttl).toBe(3600);
    });
  });

  describe('executeTransaction', () => {
    it('invalidates the tables the transaction changed after it commits', async () => {
      const { service, invalidateCacheByTag } = buildService();
      await service.executeTransaction(async () => {
        await prismaOp('Invoice', 'create', { data: {} }, {});
        await prismaOp('Payment', 'update', { data: {} }, {});
      });
      await flushImmediates();
      await flushImmediates();
      expect(invalidatedTags(invalidateCacheByTag)).toEqual(
        expect.arrayContaining(['tbl:invoice', 'tbl:payment', 'database'])
      );
    });

    it('invalidates nothing for a read-only transaction', async () => {
      const { service, invalidateCacheByTag } = buildService();
      await service.executeTransaction(() => prismaOp('Invoice', 'count', {}, 3));
      await flushImmediates();
      expect(invalidateCacheByTag).not.toHaveBeenCalled();
    });
  });

  describe('writes outside executeWrite (direct db.prisma calls)', () => {
    it('invalidates their tables at once and again after the transaction-safety delay', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });
      const { service, invalidateCacheByTag } = buildService();
      service.onModuleInit();

      await prismaOp('Bed', 'update', { data: {} }, {});
      await prismaOp('Ward', 'create', { data: {} }, {});
      await flushImmediates();
      await flushImmediates();
      const first = invalidatedTags(invalidateCacheByTag);
      expect(first).toEqual(expect.arrayContaining(['tbl:bed', 'tbl:ward', 'database']));
      expect(first).not.toContain('read');

      invalidateCacheByTag.mockClear();
      jest.advanceTimersByTime(2000);
      await flushImmediates();
      expect(invalidatedTags(invalidateCacheByTag)).toEqual(
        expect.arrayContaining(['tbl:bed', 'tbl:ward', 'database'])
      );
      service.onModuleDestroy();
    });

    it('empties the whole query cache for a raw write that is not an advisory lock', async () => {
      const { service, invalidateCacheByTag } = buildService();
      service.onModuleInit();
      await prismaOp(undefined, '$executeRaw', { strings: ['DELETE FROM "Bed"'], values: [] }, 3);
      await flushImmediates();
      await flushImmediates();
      expect(invalidatedTags(invalidateCacheByTag)).toContain('read');
      service.onModuleDestroy();
    });

    it('ignores advisory locks', async () => {
      const { service, invalidateCacheByTag } = buildService();
      service.onModuleInit();
      await prismaOp(
        undefined,
        '$executeRaw',
        { strings: ['SELECT pg_advisory_xact_lock(', ')'], values: [7] },
        0
      );
      await flushImmediates();
      expect(invalidateCacheByTag).not.toHaveBeenCalled();
      service.onModuleDestroy();
    });
  });
});
