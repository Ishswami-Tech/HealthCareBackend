/// <reference types="jest" />
/**
 * Every Dragonfly client (cache, BullMQ, dead-letter queue, rate limiter, Socket.IO adapter)
 * builds its target from getCacheConnectionTarget, so turning on Sentinel is one env change and
 * leaving it off keeps today's direct host:port exactly.
 */

import Redis from 'ioredis';

import {
  DEFAULT_SENTINEL_MASTER_NAME,
  describeCacheTarget,
  getCacheConnectionTarget,
  parseSentinelAddresses,
} from '@infrastructure/cache/utils/cache-connection-target.util';

const DIRECT = { host: '10.201.0.1', port: 6512 };

function envOf(values: Record<string, string>): (key: string) => string | undefined {
  return key => values[key];
}

describe('getCacheConnectionTarget', () => {
  it('keeps the direct host:port when no Sentinel is configured', () => {
    expect(getCacheConnectionTarget(envOf({}), DIRECT)).toEqual(DIRECT);
    expect(getCacheConnectionTarget(envOf({ CACHE_SENTINELS: ' ' }), DIRECT)).toEqual(DIRECT);
  });

  it('switches to Sentinel discovery with failover detection when CACHE_SENTINELS is set', () => {
    const target = getCacheConnectionTarget(
      envOf({
        CACHE_SENTINELS: '10.201.0.1:26379, 10.201.0.7',
        CACHE_SENTINEL_MASTER_NAME: 'dragonfly-cache',
        CACHE_SENTINEL_PASSWORD: 's3cret',
      }),
      DIRECT
    );

    expect(target).toEqual({
      sentinels: [
        { host: '10.201.0.1', port: 26379 },
        { host: '10.201.0.7', port: 26379 },
      ],
      name: 'dragonfly-cache',
      sentinelPassword: 's3cret',
      failoverDetector: true,
    });
    expect('host' in target).toBe(false);
  });

  it('defaults the master name and omits an empty Sentinel password', () => {
    expect(
      getCacheConnectionTarget(envOf({ CACHE_SENTINELS: '10.201.0.1:26379' }), DIRECT)
    ).toEqual({
      sentinels: [{ host: '10.201.0.1', port: 26379 }],
      name: DEFAULT_SENTINEL_MASTER_NAME,
      failoverDetector: true,
    });
  });

  it('rejects a malformed entry instead of silently connecting somewhere else', () => {
    expect(() => parseSentinelAddresses('10.201.0.1:notaport')).toThrow(/CACHE_SENTINELS/);
    expect(() => parseSentinelAddresses(':26379')).toThrow(/CACHE_SENTINELS/);
  });

  it('describes the target for logs without a password', () => {
    const target = getCacheConnectionTarget(
      envOf({ CACHE_SENTINELS: '10.201.0.1:26379', CACHE_SENTINEL_PASSWORD: 's3cret' }),
      DIRECT
    );
    expect(describeCacheTarget(target)).toBe('sentinel master "dragonfly" via 10.201.0.1:26379');
    expect(describeCacheTarget(DIRECT)).toBe('10.201.0.1:6512');
  });

  it('is accepted by ioredis as Sentinel options', () => {
    const target = getCacheConnectionTarget(envOf({ CACHE_SENTINELS: '10.201.0.1:26379' }), DIRECT);
    const client = new Redis({ ...target, lazyConnect: true });
    try {
      expect(client.options.sentinels).toEqual([{ host: '10.201.0.1', port: 26379 }]);
      expect(client.options.name).toBe('dragonfly');
      expect(client.options.failoverDetector).toBe(true);
    } finally {
      client.disconnect();
    }
  });
});
