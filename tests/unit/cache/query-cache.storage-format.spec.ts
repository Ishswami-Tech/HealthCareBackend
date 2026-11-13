/// <reference types="jest" />
/**
 * Query results must be stored in the format they are read back in.
 *
 * QueryCacheService wrote through CacheService.cache() with the default options, so the SWR
 * strategy stored every result wrapped as { data, timestamp }, while QueryCacheService.getCached()
 * reads with CacheService.get(), which returns the stored value as-is. Every database-layer cache
 * hit therefore handed callers the wrapper: permission lookups failed with "Invalid permission
 * entity structure", cached lists with "results.map is not a function". These tests drive the real
 * strategy manager and strategies over an in-memory store.
 */

jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));

import { CacheStrategyManager } from '@infrastructure/cache/strategies/cache-strategy.manager';
import { decryptPHIValue } from '@infrastructure/cache/utils/phi-encryption.util';
import { QueryCacheService } from '@infrastructure/database/internal/query-cache.service';
import { QueryKeyFactory } from '@infrastructure/database/query/factories/query-key.factory';
import type { CacheOperationOptions } from '@core/types';

function inMemoryProvider() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    exists: jest.fn(async (key: string) => store.has(key)),
  };
}

function strategyManager(provider: ReturnType<typeof inMemoryProvider>): CacheStrategyManager {
  const logger = { log: jest.fn().mockResolvedValue(undefined) };
  return new CacheStrategyManager({ getBasicProvider: () => provider } as never, logger as never);
}

/** Exactly what QueryCacheService.setCached passes to CacheService.cache(). */
async function capturedSetCachedOptions(containsPHI: boolean): Promise<CacheOperationOptions> {
  const cacheService = { cache: jest.fn().mockResolvedValue(undefined) };
  const logging = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new QueryCacheService(cacheService as never, logging as never);
  await service.setCached('k', { id: 'p1' }, { ttl: 3600, containsPHI, tags: ['database'] });
  return cacheService.cache.mock.calls[0]?.[2] as CacheOperationOptions;
}

const PERMISSION = { id: 'perm-1', resource: 'users', action: 'read', domain: 'clinic' };

describe('query cache storage format', () => {
  it('stores a non-PHI query result as the value itself, which is what get() returns', async () => {
    const provider = inMemoryProvider();
    const options = await capturedSetCachedOptions(false);

    await strategyManager(provider).execute('perm-key', async () => PERMISSION, options);

    expect(provider.store.get('perm-key')).toEqual(PERMISSION);
  });

  it('keeps cached lists as arrays (results.map must work on a hit)', async () => {
    const provider = inMemoryProvider();
    const options = await capturedSetCachedOptions(false);
    const rows = [PERMISSION, { ...PERMISSION, id: 'perm-2' }];

    await strategyManager(provider).execute('list-key', async () => rows, options);

    expect(Array.isArray(provider.store.get('list-key'))).toBe(true);
  });

  it('stores a PHI query result encrypted, and it decrypts back to the value itself', async () => {
    const provider = inMemoryProvider();
    const options = await capturedSetCachedOptions(true);
    const record = { id: 'hr-1', patientId: 'p-1' };

    await strategyManager(provider).execute('phi-key', async () => record, options);

    expect(decryptPHIValue(provider.store.get('phi-key'))).toEqual(record);
  });

  it('documents the old bug: the default (SWR) options store an envelope, not the value', async () => {
    const provider = inMemoryProvider();

    await strategyManager(provider).execute('swr-key', async () => PERMISSION, { ttl: 3600 });

    // CacheService.get() now unwraps this envelope too (cache-service.swr-envelope.spec.ts).
    expect(provider.store.get('swr-key')).toEqual({
      data: PERMISSION,
      timestamp: expect.any(Number),
      __swr: 1,
    });
  });

  it('uses a new key namespace, so entries written in the old wrapped format are never read', () => {
    const key = new QueryKeyFactory().fromOperation('findPermissionByResourceActionSafe', {
      where: { resource: 'users', action: 'read' },
    });

    expect(
      key.startsWith('healthcare:query:v2:operation:findPermissionByResourceActionSafe:')
    ).toBe(true);
  });
});
