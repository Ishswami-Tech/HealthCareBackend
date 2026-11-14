/// <reference types="jest" />
/**
 * Topology heartbeats are rewritten by every replica every 15 s with a 45 s TTL. Read through
 * get(), each reader kept an L1 copy for the entry's remaining TTL, so the dashboard showed live
 * replicas with heartbeats up to 45 s old (drawn as stale). get(key, { skipL1: true }) reads the
 * distributed cache directly and keeps no local copy; plain get() is unchanged.
 */

jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));

import { CacheService } from '@infrastructure/cache/cache.service';

function serviceWith(l1Value: unknown, l2Value: unknown) {
  const l1Get = jest.fn().mockReturnValue(l1Value);
  const l1Set = jest.fn();
  const l2Get = jest.fn().mockResolvedValue(l2Value);
  const getTTL = jest.fn().mockResolvedValue(40);
  const service = Object.create(CacheService.prototype) as CacheService;
  Object.assign(service, {
    config: {},
    advancedProvider: {},
    enableL1: true,
    l1TTL: 300,
    l1CacheService: { get: l1Get, set: l1Set },
    cacheRepository: { get: l2Get, getTTL },
  });
  return { service, l1Get, l1Set, l2Get, getTTL };
}

describe('CacheService.get() skipL1', () => {
  const stale = { lastHeartbeat: '2026-11-14T03:00:00.000Z' };
  const fresh = { lastHeartbeat: '2026-11-14T03:00:40.000Z' };

  it('plain get() still returns the L1 copy without touching L2', async () => {
    const { service, l2Get } = serviceWith(stale, fresh);

    await expect(service.get('cluster:topology:worker:6:1')).resolves.toEqual(stale);
    expect(l2Get).not.toHaveBeenCalled();
  });

  it('plain get() on an L1 miss still populates L1, capped at the remaining TTL', async () => {
    const { service, l1Set } = serviceWith(null, fresh);

    await expect(service.get('k')).resolves.toEqual(fresh);
    expect(l1Set).toHaveBeenCalledWith('k', fresh, 40);
  });

  it('skipL1 ignores the L1 copy, reads L2, and keeps no local copy', async () => {
    const { service, l1Get, l1Set, l2Get, getTTL } = serviceWith(stale, fresh);

    await expect(service.get('cluster:topology:worker:6:1', { skipL1: true })).resolves.toEqual(
      fresh
    );
    expect(l1Get).not.toHaveBeenCalled();
    expect(l2Get).toHaveBeenCalledWith('cluster:topology:worker:6:1');
    expect(getTTL).not.toHaveBeenCalled();
    expect(l1Set).not.toHaveBeenCalled();
  });
});
