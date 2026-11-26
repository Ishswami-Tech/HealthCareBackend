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
import {
  isCallerFetchError,
  markCallerFetchError,
  unwrapCallerFetchError,
} from '@infrastructure/cache/utils/caller-fetch-error.util';

function createService(cacheRepositoryCache: jest.Mock) {
  const recordFailure = jest.fn();
  const log = jest.fn().mockResolvedValue(undefined);
  const handleWithFallback = jest.fn(
    async (_error: unknown, _ctx: unknown, fallback: () => Promise<unknown>) => fallback()
  );
  const service = Object.create(CacheService.prototype) as CacheService;
  Object.assign(service, {
    config: {},
    advancedProvider: {},
    enableL1: false,
    l1CacheService: null,
    cacheRepository: { cache: cacheRepositoryCache },
    readFlight: new SingleFlight(),
    circuitBreaker: { canExecute: () => true, recordSuccess: jest.fn(), recordFailure },
    metrics: { recordOperation: jest.fn() },
    loggingService: { log },
    errorHandler: { handleWithFallback },
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(true),
  });
  return { service, recordFailure, log, handleWithFallback };
}

/** A strategy that misses and calls the coordinated fetch it was given. */
const missingStrategy = () =>
  jest.fn(async (_key: string, fetch: () => Promise<unknown>) => fetch());

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

  it('also rethrows when a strategy wraps the caller error as its cause', async () => {
    const notFound = new NotFoundException('Clinic not found');
    const wrappingStrategy = jest.fn(async (_key: string, fetch: () => Promise<unknown>) => {
      try {
        return await fetch();
      } catch (error) {
        throw Object.assign(new Error('strategy fetch failed'), { cause: error });
      }
    });
    const { service, recordFailure } = createService(wrappingStrategy);
    const fetchFn = jest.fn().mockRejectedValue(notFound);

    await expect(service.cache('k', fetchFn, {})).rejects.toBe(notFound);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('still falls back to a direct fetch when the cache store itself fails', async () => {
    const brokenStore = jest.fn().mockRejectedValue(new Error('connection reset'));
    const { service, recordFailure, handleWithFallback } = createService(brokenStore);
    const fetchFn = jest.fn().mockResolvedValue({ id: 'c1' });

    await expect(service.cache('k', fetchFn, {})).resolves.toEqual({ id: 'c1' });
    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(handleWithFallback).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
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
