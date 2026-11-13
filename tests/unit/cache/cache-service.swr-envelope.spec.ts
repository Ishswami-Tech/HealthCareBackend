/// <reference types="jest" />
/**
 * cache() with SWR stores an entry as an envelope ({ data, timestamp, __swr }), and get() used to
 * return that envelope as if it were the value: every caller pairing the two (the database query
 * cache, the location cache) got the wrapper on a hit, and get() copied the wrapper into L1, where
 * a later cache() L1 hit returned it too. get() now returns the value inside, the same way it
 * already decrypts PHI entries written by cache().
 */

jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));

import { CacheService } from '@infrastructure/cache/cache.service';
import { CacheStrategyManager } from '@infrastructure/cache/strategies/cache-strategy.manager';
import { unwrapSwrEnvelope } from '@infrastructure/cache/strategies/swr-cache.strategy';
import { isCachedEmptyArray, unwrapCacheValue } from '@core/interceptors/cache-value.util';

const LOCATION = { id: 'loc-1', name: 'Main branch', clinicId: 'clinic-1' };

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

function serviceOver(provider: ReturnType<typeof inMemoryProvider>) {
  const l1Set = jest.fn();
  const service = Object.create(CacheService.prototype) as CacheService;
  Object.assign(service, {
    config: {},
    advancedProvider: {},
    enableL1: true,
    l1TTL: 300,
    l1CacheService: { get: jest.fn().mockReturnValue(null), set: l1Set },
    cacheRepository: { get: provider.get, getTTL: jest.fn().mockResolvedValue(-1) },
  });
  return { service, l1Set };
}

async function writeThroughSwr(
  provider: ReturnType<typeof inMemoryProvider>,
  key: string,
  value: unknown
): Promise<void> {
  const logger = { log: jest.fn().mockResolvedValue(undefined) };
  const manager = new CacheStrategyManager(
    { getBasicProvider: () => provider } as never,
    logger as never
  );
  await manager.execute(key, async () => value, { ttl: 3600 });
}

describe('CacheService.get() after cache() with SWR', () => {
  it('stores a marked envelope', async () => {
    const provider = inMemoryProvider();
    await writeThroughSwr(provider, 'location:v2:loc-1', LOCATION);

    expect(provider.store.get('location:v2:loc-1')).toEqual({
      data: LOCATION,
      timestamp: expect.any(Number),
      __swr: 1,
    });
  });

  it('returns the value itself, and keeps the value (not the envelope) in L1', async () => {
    const provider = inMemoryProvider();
    await writeThroughSwr(provider, 'location:v2:loc-1', LOCATION);
    const { service, l1Set } = serviceOver(provider);

    await expect(service.get('location:v2:loc-1')).resolves.toEqual(LOCATION);
    expect(l1Set).toHaveBeenCalledWith('location:v2:loc-1', LOCATION, 300);
  });

  it('returns a cached list as an array', async () => {
    const provider = inMemoryProvider();
    await writeThroughSwr(provider, 'location:v2:list:clinic-1', [LOCATION]);
    const { service } = serviceOver(provider);

    await expect(service.get('location:v2:list:clinic-1')).resolves.toEqual([LOCATION]);
  });

  it('leaves a value written with set() alone, even one with data and timestamp fields', async () => {
    const provider = inMemoryProvider();
    const response = { success: true, data: [LOCATION], timestamp: 1_700_000_000_000 };
    provider.store.set('response', response);
    const { service } = serviceOver(provider);

    await expect(service.get('response')).resolves.toEqual(response);
  });
});

describe('unwrapSwrEnvelope', () => {
  it('only unwraps marked envelopes', () => {
    expect(unwrapSwrEnvelope({ data: 1, timestamp: 2, __swr: 1 })).toBe(1);
    expect(unwrapSwrEnvelope({ data: 1, timestamp: 2 })).toEqual({ data: 1, timestamp: 2 });
    expect(unwrapSwrEnvelope(null)).toBeNull();
    expect(unwrapSwrEnvelope('plain')).toBe('plain');
  });
});

describe('HealthcareCacheInterceptor value helpers after get() unwraps', () => {
  it('does not strip an API response that has its own data and timestamp fields', () => {
    const response = { success: true, data: { id: 'a-1' }, timestamp: 1_700_000_000_000 };

    expect(unwrapCacheValue(response)).toBe(response);
    expect(isCachedEmptyArray({ success: true, data: [], timestamp: 1 })).toBe(false);
  });

  it('still unwraps a legacy two-key { data, timestamp } entry', () => {
    expect(unwrapCacheValue({ data: { id: 'a-1' }, timestamp: 1 })).toEqual({ id: 'a-1' });
    expect(isCachedEmptyArray({ data: [], timestamp: 1 })).toBe(true);
  });
});
