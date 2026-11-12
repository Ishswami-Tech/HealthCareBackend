/// <reference types="jest" />
/**
 * `get()` used to copy every L2 hit into L1 for the full default L1 TTL (300s), even when the
 * entry itself lived far shorter in L2. A short-lived key written by another process (e.g. a
 * 45s topology heartbeat) was then served from this process's L1 for minutes after it expired
 * everywhere else, so the topology page dropped live workers as "stale". The L1 copy is now
 * capped at the entry's remaining L2 TTL, the same rule `set()` already applies.
 */

import { CacheService } from '@infrastructure/cache/cache.service';

const DEFAULT_L1_TTL = 300;

interface ServiceDouble {
  readonly service: CacheService;
  readonly repoGet: jest.Mock;
  readonly repoGetTTL: jest.Mock;
  readonly l1Get: jest.Mock;
  readonly l1Set: jest.Mock;
}

function createService(options: {
  value: unknown;
  ttl?: number | Error;
  enableL1?: boolean;
}): ServiceDouble {
  const repoGet = jest.fn().mockResolvedValue(options.value);
  const repoGetTTL =
    options.ttl instanceof Error
      ? jest.fn().mockRejectedValue(options.ttl)
      : jest.fn().mockResolvedValue(options.ttl ?? -1);
  const l1Get = jest.fn().mockReturnValue(null);
  const l1Set = jest.fn();
  const enableL1 = options.enableL1 ?? true;
  const service = Object.create(CacheService.prototype) as CacheService;
  Object.assign(service, {
    config: {},
    advancedProvider: {},
    enableL1,
    l1TTL: DEFAULT_L1_TTL,
    l1CacheService: enableL1 ? { get: l1Get, set: l1Set } : null,
    cacheRepository: { get: repoGet, getTTL: repoGetTTL },
  });
  return { service, repoGet, repoGetTTL, l1Get, l1Set };
}

describe('CacheService.get() L1 population is capped at the remaining L2 TTL', () => {
  it('caps a short-lived entry (45s heartbeat) at its remaining TTL instead of the default 300s', async () => {
    const heartbeat = { role: 'worker', lastHeartbeat: '2026-11-12T07:00:00.000Z' };
    const { service, l1Set } = createService({ value: heartbeat, ttl: 38 });

    const result = await service.get('cluster:topology:worker:9:1:abc:7');

    expect(result).toEqual(heartbeat);
    expect(l1Set).toHaveBeenCalledWith('cluster:topology:worker:9:1:abc:7', heartbeat, 38);
  });

  it('keeps the default L1 TTL when the entry outlives it', async () => {
    const { service, l1Set } = createService({ value: 'long-lived', ttl: 3600 });

    await service.get('some:key');

    expect(l1Set).toHaveBeenCalledWith('some:key', 'long-lived', DEFAULT_L1_TTL);
  });

  it('uses the default L1 TTL for an entry with no expiry (-1)', async () => {
    const { service, l1Set } = createService({ value: 'persistent', ttl: -1 });

    await service.get('persistent:key');

    expect(l1Set).toHaveBeenCalledWith('persistent:key', 'persistent', DEFAULT_L1_TTL);
  });

  it.each([
    ['expiring this second (0)', 0],
    ['already gone (-2)', -2],
  ])('returns the value but does not cache it in L1 when the entry is %s', async (_label, ttl) => {
    const { service, l1Set } = createService({ value: 'about-to-expire', ttl });

    const result = await service.get('expiring:key');

    expect(result).toBe('about-to-expire');
    expect(l1Set).not.toHaveBeenCalled();
  });

  it('falls back to the default L1 TTL (previous behaviour) when the TTL lookup fails', async () => {
    const { service, l1Set } = createService({
      value: 'value',
      ttl: new Error('ttl unavailable'),
    });

    const result = await service.get('flaky:key');

    expect(result).toBe('value');
    expect(l1Set).toHaveBeenCalledWith('flaky:key', 'value', DEFAULT_L1_TTL);
  });

  it('serves an L1 hit without touching L2 at all', async () => {
    const { service, repoGet, repoGetTTL, l1Get } = createService({ value: 'l2', ttl: 10 });
    l1Get.mockReturnValue('from-l1');

    const result = await service.get('hot:key');

    expect(result).toBe('from-l1');
    expect(repoGet).not.toHaveBeenCalled();
    expect(repoGetTTL).not.toHaveBeenCalled();
  });

  it('does not look up the TTL when L1 is disabled', async () => {
    const { service, repoGetTTL } = createService({ value: 'v', enableL1: false });

    const result = await service.get('no-l1:key');

    expect(result).toBe('v');
    expect(repoGetTTL).not.toHaveBeenCalled();
  });

  it('does not populate L1 on an L2 miss', async () => {
    const { service, l1Set } = createService({ value: null, ttl: -2 });

    const result = await service.get('missing:key');

    expect(result).toBeNull();
    expect(l1Set).not.toHaveBeenCalled();
  });
});
