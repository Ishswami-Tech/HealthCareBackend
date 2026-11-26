/// <reference types="jest" />
/**
 * When the caller's own fetch inside `cache()` throws (e.g. NotFoundException for an unknown
 * clinic), that is the caller's result, not a cache failure. Before this change `cache()`
 * recorded a circuit-breaker failure, logged "cache() failed ... falling back to direct fetch",
 * sent it through the error handler (more ERROR logs) and ran the same fetch twice more.
 * A genuine cache failure (the store or a strategy throwing) still degrades to a direct fetch.
 */

import { NotFoundException } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache/cache.service';
import { SingleFlight } from '@infrastructure/cache/utils/single-flight.util';
import { MetricsCacheMiddleware } from '@infrastructure/cache/middleware/metrics-cache.middleware';
import {
  isCallerFetchError,
  markCallerFetchError,
  unwrapCallerFetchError,
} from '@infrastructure/cache/utils/caller-fetch-error.util';

interface ServiceDouble {
  readonly service: CacheService;
  readonly recordFailure: jest.Mock;
  readonly log: jest.Mock;
  readonly handleWithFallback: jest.Mock;
}

/** `cacheThroughLayers` only touches these collaborators; everything else is stubbed off. */
function createService(
  cacheRepositoryCache: jest.Mock,
  options: { circuitOpen?: boolean } = {}
): ServiceDouble {
  const recordFailure = jest.fn();
  const log = jest.fn().mockResolvedValue(undefined);
  const handleWithFallback = jest.fn(
    async (_error: unknown, _ctx: unknown, fallback: () => Promise<unknown>): Promise<unknown> =>
      fallback()
  );
  const service = Object.create(CacheService.prototype) as CacheService;
  Object.assign(service, {
    config: {},
    advancedProvider: {},
    enableL1: false,
    l1CacheService: null,
    cacheRepository: { cache: cacheRepositoryCache },
    readFlight: new SingleFlight(),
    circuitBreaker: {
      canExecute: (): boolean => !options.circuitOpen,
      recordSuccess: jest.fn(),
      recordFailure,
    },
    metrics: { recordOperation: jest.fn() },
    loggingService: { log },
    errorHandler: { handleWithFallback },
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(true),
  });
  return { service, recordFailure, log, handleWithFallback };
}

/** A strategy that misses and calls the coordinated fetch it was given. */
function missingStrategy(): jest.Mock {
  return jest.fn(async (_key: string, fetch: () => Promise<unknown>): Promise<unknown> => fetch());
}

describe('CacheService.cache() when the caller fetch throws', () => {
  it('rethrows the same error once, without cache-failure handling or a second fetch', async () => {
    const { service, recordFailure, log, handleWithFallback } = createService(missingStrategy());
    const notFound = new NotFoundException('Clinic not found');
    const fetchFn = jest.fn().mockRejectedValue(notFound);

    await expect(service.cache('clinic:app:missing', fetchFn, {})).rejects.toBe(notFound);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(handleWithFallback).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('does the same on the forceRefresh path', async () => {
    const { service, recordFailure, handleWithFallback } = createService(missingStrategy());
    const notFound = new NotFoundException('Clinic not found');
    const fetchFn = jest.fn().mockRejectedValue(notFound);

    await expect(service.cache('k', fetchFn, { forceRefresh: true })).rejects.toBe(notFound);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(handleWithFallback).not.toHaveBeenCalled();
  });

  it('does the same while the circuit breaker is open (cache store unavailable)', async () => {
    const store = missingStrategy();
    const { service, recordFailure, log, handleWithFallback } = createService(store, {
      circuitOpen: true,
    });
    const notFound = new NotFoundException('Clinic not found');
    const fetchFn = jest.fn().mockRejectedValue(notFound);

    await expect(service.cache('k', fetchFn, {})).rejects.toBe(notFound);

    expect(store).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(handleWithFallback).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('also rethrows when a strategy wraps the caller error as its cause', async () => {
    const notFound = new NotFoundException('Clinic not found');
    const wrappingStrategy = jest.fn(
      async (_key: string, fetch: () => Promise<unknown>): Promise<unknown> => {
        try {
          return await fetch();
        } catch (error) {
          throw Object.assign(new Error('strategy fetch failed'), { cause: error });
        }
      }
    );
    const { service, recordFailure } = createService(wrappingStrategy);
    const fetchFn = jest.fn().mockRejectedValue(notFound);

    await expect(service.cache('k', fetchFn, {})).rejects.toBe(notFound);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled();
  });
});

describe('CacheService.cache() when the cache itself fails', () => {
  it('still falls back to a direct fetch once', async () => {
    const brokenStore = jest.fn().mockRejectedValue(new Error('connection reset'));
    const { service, recordFailure, handleWithFallback } = createService(brokenStore);
    const fetchFn = jest.fn().mockResolvedValue({ id: 'c1' });

    await expect(service.cache('k', fetchFn, {})).resolves.toEqual({ id: 'c1' });
    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(handleWithFallback).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns the fallback fetch error as-is instead of fetching a second time', async () => {
    const brokenStore = jest.fn().mockRejectedValue(new Error('connection reset'));
    const { service, handleWithFallback } = createService(brokenStore);
    const notFound = new NotFoundException('Clinic not found');
    const fetchFn = jest.fn().mockRejectedValue(notFound);

    await expect(service.cache('k', fetchFn, {})).rejects.toBe(notFound);
    expect(handleWithFallback).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('MetricsCacheMiddleware.onError', () => {
  it('neither counts nor logs an error thrown by the caller fetch', async () => {
    const log = jest.fn().mockResolvedValue(undefined);
    const middleware = new MetricsCacheMiddleware({ log });
    const notFound = new NotFoundException('Clinic not found');
    markCallerFetchError(notFound);

    await expect(middleware.onError({ key: 'k', options: {} }, notFound)).resolves.toBe(notFound);

    expect(log).not.toHaveBeenCalled();
    expect(middleware.getMetrics().failedOperations).toBe(0);
  });

  it('still counts and logs a real cache failure', async () => {
    const log = jest.fn().mockResolvedValue(undefined);
    const middleware = new MetricsCacheMiddleware({ log });

    await middleware.onError({ key: 'k', options: {} }, new Error('connection reset'));

    expect(log).toHaveBeenCalledTimes(1);
    expect(middleware.getMetrics().failedOperations).toBe(1);
  });
});

describe('caller-fetch-error util', () => {
  it('marks objects, ignores primitives and unwraps one cause level', () => {
    const original = new Error('boom');
    markCallerFetchError(original);
    markCallerFetchError('not an object');
    const wrapped = Object.assign(new Error('wrapper'), { cause: original });

    expect(isCallerFetchError(original)).toBe(true);
    expect(isCallerFetchError(wrapped)).toBe(true);
    expect(isCallerFetchError(new Error('other'))).toBe(false);
    expect(isCallerFetchError('not an object')).toBe(false);
    expect(unwrapCallerFetchError(wrapped)).toBe(original);
    expect(unwrapCallerFetchError(original)).toBe(original);
  });
});
