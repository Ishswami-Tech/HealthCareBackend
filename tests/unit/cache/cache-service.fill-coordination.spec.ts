/// <reference types="jest" />
/**
 * `cache()` used to probe `cacheRepository.exists(key)` before deciding whether to
 * coordinate a fill lock with other processes - a second, separate round-trip for a
 * determination the strategy underneath re-derives itself via its own read. It's now
 * derived from whether the strategy actually invokes `fetchFn`, which is also a more
 * precise "was this a miss" signal (an exists()-true-but-expired SWR entry still needs
 * a fetch; the old check would have wrongly treated that as a hit and skipped
 * fill-coordination for it).
 */

import { CacheService } from '@infrastructure/cache/cache.service';
import { SingleFlight } from '@infrastructure/cache/utils/single-flight.util';

interface ServiceDouble {
  readonly service: CacheService;
  readonly cacheRepositoryCache: jest.Mock;
  readonly acquireLock: jest.Mock;
  readonly releaseLock: jest.Mock;
  readonly recordOperation: jest.Mock;
}

/** `cacheThroughLayers` only touches these collaborators; everything else is stubbed off. */
function createService(cacheRepositoryCache: jest.Mock): ServiceDouble {
  const acquireLock = jest.fn().mockResolvedValue(true);
  const releaseLock = jest.fn().mockResolvedValue(true);
  const recordOperation = jest.fn();
  const service = Object.create(CacheService.prototype) as CacheService;
  Object.assign(service, {
    config: {},
    advancedProvider: {},
    enableL1: false,
    l1CacheService: null,
    cacheRepository: { cache: cacheRepositoryCache },
    readFlight: new SingleFlight(),
    circuitBreaker: { canExecute: () => true, recordSuccess: jest.fn(), recordFailure: jest.fn() },
    metrics: { recordOperation },
    loggingService: { log: jest.fn().mockResolvedValue(undefined) },
    acquireLock,
    releaseLock,
  });
  return { service, cacheRepositoryCache, acquireLock, releaseLock, recordOperation };
}

describe('CacheService fill coordination (no separate exists() probe)', () => {
  it('on a hit (strategy never calls fetchFn), records a hit and never touches the fill lock', async () => {
    const cacheRepositoryCache = jest.fn().mockResolvedValue('cached-value');
    const { service, acquireLock, recordOperation } = createService(cacheRepositoryCache);
    const fetchFn = jest.fn().mockResolvedValue('fresh-value');

    const result = await service.cache('key-1', fetchFn, {});

    expect(result).toBe('cached-value');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(acquireLock).not.toHaveBeenCalled();
    expect(recordOperation).toHaveBeenCalledWith(true, expect.any(Number), true);
  });

  it('on a miss (strategy calls fetchFn), coordinates the fill lock and records a miss', async () => {
    const cacheRepositoryCache = jest.fn(
      async (_key: string, coordinatedFetchFn: () => Promise<unknown>) => coordinatedFetchFn()
    );
    const { service, acquireLock, releaseLock, recordOperation } =
      createService(cacheRepositoryCache);
    const fetchFn = jest.fn().mockResolvedValue('fresh-value');

    const result = await service.cache('key-2', fetchFn, {});

    expect(result).toBe('fresh-value');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(acquireLock).toHaveBeenCalledWith('cache:fill:key-2', expect.any(Number));
    expect(releaseLock).toHaveBeenCalledWith('cache:fill:key-2');
    expect(recordOperation).toHaveBeenCalledWith(true, expect.any(Number), false);
  });

  it('treats a fully-expired-but-still-present entry as a miss for fill coordination (the bug the old exists() probe had)', async () => {
    // Simulates an SWR entry old enough that the strategy falls through to fetchFn even
    // though the key technically still exists in the store.
    const cacheRepositoryCache = jest.fn(
      async (_key: string, coordinatedFetchFn: () => Promise<unknown>) => coordinatedFetchFn()
    );
    const { service, acquireLock, recordOperation } = createService(cacheRepositoryCache);
    const fetchFn = jest.fn().mockResolvedValue('revalidated-value');

    await service.cache('expired-but-present-key', fetchFn, {});

    // Coordination DID engage for this fetch, and it's correctly recorded as a miss -
    // the exists()-based check would have gotten both of these wrong.
    expect(acquireLock).toHaveBeenCalledTimes(1);
    expect(recordOperation).toHaveBeenCalledWith(true, expect.any(Number), false);
  });

  it('forceRefresh skips fill coordination entirely and is always recorded as a miss', async () => {
    const cacheRepositoryCache = jest.fn(
      async (_key: string, coordinatedFetchFn: () => Promise<unknown>) => coordinatedFetchFn()
    );
    const { service, acquireLock, recordOperation } = createService(cacheRepositoryCache);
    const fetchFn = jest.fn().mockResolvedValue('forced-value');

    const result = await service.cache('key-3', fetchFn, { forceRefresh: true });

    expect(result).toBe('forced-value');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(acquireLock).not.toHaveBeenCalled();
    expect(recordOperation).toHaveBeenCalledWith(true, expect.any(Number), false);
  });

  it('releases the fill lock even when fetchFn throws', async () => {
    const cacheRepositoryCache = jest.fn(
      async (_key: string, coordinatedFetchFn: () => Promise<unknown>) => coordinatedFetchFn()
    );
    const { service, acquireLock, releaseLock } = createService(cacheRepositoryCache);
    const fetchFn = jest.fn().mockRejectedValue(new Error('db unavailable'));

    await expect(service.cache('key-4', fetchFn, {})).rejects.toThrow('db unavailable');

    expect(acquireLock).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });
});
