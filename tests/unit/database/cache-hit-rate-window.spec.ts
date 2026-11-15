/// <reference types="jest" />
/**
 * "Low cache hit rate detected" used to fire with almost no traffic: the rate came from the last
 * 1000 hits and the last 1000 misses (count-capped, no time window), and a dashboard reading
 * appointments every ~12 minutes misses every time because PHI entries live 60 s. The rate and the
 * warning now use one 10-minute window and need at least 100 cacheable reads in it.
 */

import { DatabaseMetricsService } from '@infrastructure/database/internal/database-metrics.service';

type Metrics = { performance: { cacheHitRate: number } };

function makeService(): { service: DatabaseMetricsService; log: jest.Mock } {
  const log = jest.fn(() => Promise.resolve());
  const service = new DatabaseMetricsService(
    {} as never,
    {} as never,
    { log } as never,
    {} as never
  );
  return { service, log };
}

function lowRateWarnings(log: jest.Mock): number {
  return log.mock.calls.filter(call => String(call[2]).startsWith('Low cache hit rate')).length;
}

function rateOf(service: DatabaseMetricsService): number {
  return (service as unknown as { currentMetrics: Metrics }).currentMetrics.performance
    .cacheHitRate;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-15T05:00:00Z'));
});
afterEach(() => jest.useRealTimers());

describe('cache hit rate window', () => {
  it('does not warn with light traffic, however low the rate', () => {
    const { service, log } = makeService();
    // Two hours of a read every 70 s, all misses: never 100 reads inside 10 minutes.
    for (let i = 0; i < 100; i++) {
      service.recordCacheMiss(5);
      jest.advanceTimersByTime(70_000);
    }

    expect(rateOf(service)).toBe(0);
    expect(lowRateWarnings(log)).toBe(0);
  });

  it('warns once there are enough reads in the window and the rate is low', () => {
    const { service, log } = makeService();
    for (let i = 0; i < 99; i++) service.recordCacheMiss(5);
    expect(lowRateWarnings(log)).toBe(0);

    service.recordCacheMiss(5);
    expect(lowRateWarnings(log)).toBe(1);
  });

  it('measures only the last 10 minutes, hits and misses alike', () => {
    const { service } = makeService();
    for (let i = 0; i < 300; i++) service.recordCacheMiss(5);
    jest.advanceTimersByTime(11 * 60_000);
    for (let i = 0; i < 30; i++) service.recordCacheHit(1);

    expect(rateOf(service)).toBe(1);
  });

  it('counts hits and misses in one window', () => {
    const { service } = makeService();
    for (let i = 0; i < 75; i++) service.recordCacheHit(1);
    for (let i = 0; i < 25; i++) service.recordCacheMiss(5);

    expect(rateOf(service)).toBeCloseTo(0.75);
  });
});
