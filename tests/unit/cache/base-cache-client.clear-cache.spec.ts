/// <reference types="jest" />
/**
 * Pattern deletes, key listing and tag-set expiry with an ioredis `keyPrefix`.
 *
 * ioredis prefixes the key arguments of DEL but not the glob of KEYS/SCAN, and KEYS/SCAN return
 * the raw (already prefixed) names. `clearCache()` used to hand KEYS the logical pattern and DEL
 * the raw names, so with `keyPrefix: 'healthcare:'` it never deleted anything, and `keys()` never
 * matched a prefixed key. The fake server in support/ delegates the prefixing decision to ioredis'
 * own `Command`, so the tests exercise the real client semantics.
 */

import { Command } from 'ioredis';

import { HealthcareError } from '@core/errors';
import { LogLevel } from '@core/types';
import { DELETE_BATCH_SIZE, SCAN_PAGE_SIZE } from '@infrastructure/cache/utils/pattern-delete.util';
import { PREFIX, TestCacheClient, createFakeCacheServer } from './support/fake-cache-server';

jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@config/cache.config', () => ({
  isCacheEnabled: (): boolean => true,
  getCacheProvider: (): string => 'dragonfly',
}));

function setup(
  rawKeys: readonly string[] = [],
  options: { modern?: boolean; prefix?: string } = {}
) {
  const prefix = options.prefix ?? PREFIX;
  const server = createFakeCacheServer({
    keyPrefix: prefix,
    ...(options.modern !== undefined && { modern: options.modern }),
  });
  rawKeys.forEach(key => server.seedRaw(key));
  const logger = { log: jest.fn() };
  const cache = new TestCacheClient(prefix, server.client, logger);
  const logged = (level: LogLevel): string[] =>
    logger.log.mock.calls.filter(call => call[1] === level).map(call => String(call[2]));
  return { server, cache, logger, logged };
}

describe('BaseCacheClientService.clearCache with a keyPrefix', () => {
  it('documents the ioredis behaviour the fix compensates for', () => {
    const keys = new Command('keys', ['users:*'], { keyPrefix: PREFIX });
    const scan = new Command('scan', ['0', 'MATCH', 'users:*', 'COUNT', 500], {
      keyPrefix: PREFIX,
    });
    const del = new Command('del', [`${PREFIX}users:1`], { keyPrefix: PREFIX });

    expect(keys.args).toEqual(['users:*']);
    expect(scan.args).toEqual(['0', 'MATCH', 'users:*', 'COUNT', '500']);
    expect(del.args).toEqual([`${PREFIX}${PREFIX}users:1`]);
  });

  describe.each([
    ['SCAN + UNLINK', true],
    ['KEYS + DEL fallback', false],
  ])('on a client with %s', (_label, modern) => {
    it('deletes the keys matching a logical pattern and leaves the others alone', async () => {
      const { server, cache } = setup(
        [`${PREFIX}users:1:v1`, `${PREFIX}users:2:v1`, `${PREFIX}appointments:1:v1`],
        { modern }
      );

      const deleted = await cache.clearCache('users:*:v*');

      expect(deleted).toBe(2);
      expect(server.logicalKeys()).toEqual(['appointments:1:v1']);
      const delete_ = server.wire.find(command => command.name === (modern ? 'unlink' : 'del'));
      expect(delete_?.args).toEqual([`${PREFIX}users:1:v1`, `${PREFIX}users:2:v1`]);
      const lookup = server.wire.find(command => command.name === (modern ? 'scan' : 'keys'));
      expect(lookup?.args).toContain(`${PREFIX}users:*:v*`);
    });

    it('reaches clinic-prefixed keys through a leading wildcard', async () => {
      const { server, cache } = setup(
        [
          `${PREFIX}clinic:c1:video:consultation:status:a1:getStatus:q-abcdef012345:v1`,
          `${PREFIX}clinic:c1:video:consultation:status:a2:getStatus:q-abcdef012345:v1`,
        ],
        { modern }
      );

      const deleted = await cache.clearCache('*video:consultation:status:a1:*:v*');

      expect(deleted).toBe(1);
      expect(server.logicalKeys()).toEqual([
        'clinic:c1:video:consultation:status:a2:getStatus:q-abcdef012345:v1',
      ]);
    });

    it('works for keys whose logical name already starts with the prefix text (key factory keys)', async () => {
      const logical = 'healthcare:patient:p1:records:v1';
      const { server, cache } = setup([`${PREFIX}${logical}`, `${PREFIX}other:v1`], { modern });

      const deleted = await cache.clearCache('healthcare:patient:p1:*:v*');

      expect(deleted).toBe(1);
      expect(server.logicalKeys()).toEqual(['other:v1']);
    });

    it('treats glob characters inside the configured prefix literally', async () => {
      const weird = 'app[1]*:';
      const { server, cache } = setup([`${weird}users:1`, 'appX:users:1'], {
        modern,
        prefix: weird,
      });

      const deleted = await cache.clearCache('users:*');

      expect(deleted).toBe(1);
      expect(server.store.has('appX:users:1')).toBe(true);
    });

    it('behaves exactly as before when no prefix is configured', async () => {
      const { server, cache } = setup(['users:1', 'users:2', 'other'], { modern, prefix: '' });

      const deleted = await cache.clearCache('users:*');

      expect(deleted).toBe(2);
      expect([...server.store.keys()]).toEqual(['other']);
    });

    it('does not issue a delete when nothing matches', async () => {
      const { server, cache } = setup([`${PREFIX}users:1`], { modern });

      expect(await cache.clearCache('nothing:*')).toBe(0);
      expect(server.wire.filter(c => c.name === 'del' || c.name === 'unlink')).toEqual([]);
    });
  });

  describe('SCAN walk and batching', () => {
    it('walks every page with COUNT 500 and deletes in batches of at most 500 keys', async () => {
      const total = 1200;
      const { server, cache } = setup(
        Array.from({ length: total }, (_v, index) => `${PREFIX}clinic:c1:entry:${index}:v1`)
      );
      server.seed('clinic:c2:entry:keep:v1');

      const deleted = await cache.clearCache('clinic:c1:*');

      expect(deleted).toBe(total);
      expect(server.logicalKeys()).toEqual(['clinic:c2:entry:keep:v1']);
      const scans = server.wire.filter(command => command.name === 'scan');
      expect(scans.length).toBeGreaterThan(1);
      scans.forEach(scan =>
        expect(scan.args.slice(1)).toEqual([
          'MATCH',
          `${PREFIX}clinic:c1:*`,
          'COUNT',
          String(SCAN_PAGE_SIZE),
        ])
      );
      const batches = server.wire.filter(command => command.name === 'unlink');
      expect(batches.length).toBeGreaterThanOrEqual(Math.ceil(total / DELETE_BATCH_SIZE));
      batches.forEach(batch => expect(batch.args.length).toBeLessThanOrEqual(DELETE_BATCH_SIZE));
      expect(server.wire.some(command => command.name === 'keys')).toBe(false);
    });

    it('never uses KEYS on a client that supports SCAN', async () => {
      const { server, cache } = setup([`${PREFIX}users:1`]);

      await cache.clearCache('users:*');

      expect(server.wire.map(command => command.name)).not.toContain('keys');
    });

    it('survives duplicate keys across SCAN pages', async () => {
      const { server, cache } = setup([`${PREFIX}users:1`, `${PREFIX}users:2`]);
      const scan = server.client.scan as unknown as jest.Mock;
      scan.mockResolvedValueOnce(['5', [`${PREFIX}users:1`, `${PREFIX}users:1`]]);
      scan.mockResolvedValueOnce(['0', [`${PREFIX}users:1`, `${PREFIX}users:2`]]);

      const deleted = await cache.clearCache('users:*');

      expect(deleted).toBe(2);
      expect(server.logicalKeys()).toEqual([]);
    });
  });

  describe('protected namespaces', () => {
    const SECURITY_KEYS = [
      'auth:lockout:victim@example.com:v1',
      'auth:attempts:victim@example.com:v1',
      'user_sessions:user-1:v1',
      'session:s-1:v1',
      'jwt:blacklist:jti-1:v1',
      'otp:+911234567890:v1',
      'account_lock:victim@example.com:v1',
      'security:events:user-1',
      'phi:access:audit',
      'rate_limit:api:1.2.3.4',
      'lock:booking:d1:c1:slot',
      'payment-handoff:jti:abc',
      'cache:tag:appointments',
      'cache:stats',
    ];
    const seedSecurity = (server: ReturnType<typeof createFakeCacheServer>): void => {
      SECURITY_KEYS.forEach(key => server.seed(key));
    };

    it.each([
      'auth:*',
      'auth:lockout:*',
      'user_sessions:*',
      'session*',
      'phi:access:audit',
      'cache:tag:*',
    ])('refuses the pattern %s without scanning or deleting anything, and warns', async pattern => {
      const { server, cache, logged } = setup();
      seedSecurity(server);

      const result = await cache.clearCacheDetailed(pattern);

      expect(result.refused).toBe(true);
      expect(result.deleted).toBe(0);
      expect(server.logicalKeys()).toHaveLength(SECURITY_KEYS.length);
      expect(server.wire.filter(c => c.name === 'scan' || c.name === 'unlink')).toEqual([]);
      expect(logged(LogLevel.WARN).join('\n')).toContain('protected cache namespace');
    });

    it('a broad glob deletes cache entries but skips every protected key, and warns', async () => {
      const { server, cache, logged } = setup();
      seedSecurity(server);
      server.seed('clinic:c1:appointments:list:v1');
      server.seed('appointments:detail:a1:v1');

      const result = await cache.clearCacheDetailed('*');

      expect(result.deleted).toBe(2);
      expect(result.protectedSkipped).toBe(SECURITY_KEYS.length);
      expect(server.logicalKeys().sort()).toEqual([...SECURITY_KEYS].sort());
      expect(logged(LogLevel.WARN).join('\n')).toContain(
        'skipped keys in protected cache namespaces'
      );
    });

    it("a per-user glob such as *<userId>* cannot take that user's lockout or sessions with it", async () => {
      const { server, cache } = setup();
      server.seed('auth:lockout:user-1:v1');
      server.seed('auth:attempts:user-1:v1');
      server.seed('user_sessions:user-1:v1');
      server.seed('clinic:c1:user:user-1:profile:v1');
      server.seed('users:one:user-1:v1');

      const deleted = await cache.clearCache('*user-1*');

      expect(deleted).toBe(2);
      expect(server.logicalKeys().sort()).toEqual([
        'auth:attempts:user-1:v1',
        'auth:lockout:user-1:v1',
        'user_sessions:user-1:v1',
      ]);
    });

    it('also filters a key-factory spelling of a protected key', async () => {
      const { server, cache } = setup();
      server.seed('healthcare:auth:lockout:x:v1');

      expect(await cache.clearCache('*lockout*')).toBe(0);
      expect(server.has('healthcare:auth:lockout:x:v1')).toBe(true);
    });

    it('admin tooling can opt in with allowProtected', async () => {
      const { server, cache } = setup();
      seedSecurity(server);

      const deleted = await cache.clearCache('*', { allowProtected: true });

      expect(deleted).toBe(SECURITY_KEYS.length);
      expect(server.logicalKeys()).toEqual([]);
    });
  });

  describe('failures are surfaced, not swallowed', () => {
    it('throws a HealthcareError and logs at ERROR when the scan fails', async () => {
      const { server, cache, logged } = setup([`${PREFIX}users:1`]);
      server.failNext('scan', new Error('Command timed out'));

      await expect(cache.clearCache('users:*')).rejects.toBeInstanceOf(HealthcareError);

      expect(logged(LogLevel.ERROR).join('\n')).toContain('Pattern delete failed');
    });

    it('throws when KEYS fails on the fallback path', async () => {
      const { server, cache } = setup([`${PREFIX}users:1`], { modern: false });
      server.failNext('keys', new Error('boom'));

      await expect(cache.clearCache('users:*')).rejects.toThrow('Failed to delete cache keys');
    });

    it('reports what was deleted before a mid-scan failure', async () => {
      const { server, cache } = setup(
        Array.from({ length: 30 }, (_v, index) => `${PREFIX}users:${index}`)
      );
      const scan = server.client.scan as unknown as jest.Mock;
      scan.mockResolvedValueOnce(['7', [`${PREFIX}users:1`, `${PREFIX}users:2`]]);
      scan.mockRejectedValueOnce(new Error('connection reset'));

      const result = await cache.clearCacheDetailed('users:*');

      expect(result.error).toBe('connection reset');
      expect(result.deleted).toBe(2);
      expect(server.has('users:1')).toBe(false);
      expect(server.has('users:3')).toBe(true);
    });

    it('throws when a delete batch fails', async () => {
      const { server, cache } = setup([`${PREFIX}users:1`]);
      server.failNext('unlink', new Error('OOM'));

      await expect(cache.clearCache('users:*')).rejects.toBeInstanceOf(HealthcareError);
    });

    it('returns 0, warns and does not crash when the client is missing or not ready', async () => {
      const notReady = setup();
      notReady.server.setStatus('connecting');
      const missing = new TestCacheClient(PREFIX, undefined, { log: jest.fn() });

      expect(await missing.clearCache('users:*')).toBe(0);
      expect(await notReady.cache.clearCache('users:*')).toBe(0);
      expect(notReady.logged(LogLevel.WARN).join('\n')).toContain('cache client not ready');
    });
  });
});

describe('BaseCacheClientService.keys with a keyPrefix', () => {
  it('matches prefixed keys and returns them WITHOUT the prefix', async () => {
    const { server, cache } = setup([
      `${PREFIX}queue:clinic:c1:doctor-1:2026-10-03`,
      `${PREFIX}queue:clinic:c2:doctor-9:2026-10-03`,
      `${PREFIX}other:1`,
    ]);

    const keys = await cache.keys('queue:clinic:c1:*');

    expect(keys).toEqual(['queue:clinic:c1:doctor-1:2026-10-03']);
    expect(server.wire.find(command => command.name === 'scan')?.args).toContain(
      `${PREFIX}queue:clinic:c1:*`
    );
  });

  it('round-trips: write through the normal API, list with keys(), read back with lRange()', async () => {
    const { cache } = setup();
    const key = 'queue:clinic:c1:doctor-1:2026-10-03';
    await cache.rPush(key, JSON.stringify({ appointmentId: 'a1' }));
    await cache.rPush(key, JSON.stringify({ appointmentId: 'a2' }));

    const listed = await cache.keys('queue:clinic:c1:*');
    const entries = await cache.lRange(listed[0] ?? '', 0, -1);

    expect(listed).toEqual([key]);
    expect(
      entries.map(entry => (JSON.parse(entry) as { appointmentId: string }).appointmentId)
    ).toEqual(['a1', 'a2']);
  });

  it('listed keys can be handed straight back to del without a double prefix', async () => {
    const { server, cache } = setup();
    await cache.set('queue:clinic:c1:doctor-1:d', 'x');

    const [listed] = await cache.keys('queue:*');
    await cache.del(listed ?? '');

    expect(server.logicalKeys()).toEqual([]);
  });

  it('works without a prefix and on a KEYS-only client', async () => {
    const plain = setup(['queue:a', 'queue:b', 'x'], { prefix: '', modern: false });

    expect((await plain.cache.keys('queue:*')).sort()).toEqual(['queue:a', 'queue:b']);
  });

  it('logs at ERROR and returns no keys when the lookup fails', async () => {
    const { server, cache, logged } = setup([`${PREFIX}queue:a`]);
    server.failNext('scan', new Error('timeout'));

    expect(await cache.keys('queue:*')).toEqual([]);
    expect(logged(LogLevel.ERROR).join('\n')).toContain('keys() failed');
  });
});

describe('BaseCacheClientService.extendExpiry', () => {
  it('gives a key without a TTL its first one', async () => {
    const { server, cache } = setup();
    server.seed('cache:tag:x');

    await cache.extendExpiry('cache:tag:x', 360);

    expect(await cache.ttl('cache:tag:x')).toBe(360);
  });

  it('extends a shorter TTL but never shortens a longer one', async () => {
    const { server, cache } = setup();
    server.seed('cache:tag:x', '1', 100);

    await cache.extendExpiry('cache:tag:x', 360);
    expect(await cache.ttl('cache:tag:x')).toBe(360);

    await cache.extendExpiry('cache:tag:x', 90);
    expect(await cache.ttl('cache:tag:x')).toBe(360);
  });

  it('sends EXPIRE with NX then GT, with the key prefixed by ioredis', async () => {
    const { server, cache } = setup();
    server.seed('cache:tag:x');

    await cache.extendExpiry('cache:tag:x', 60);

    const expires = server.wire.filter(command => command.name === 'expire');
    expect(expires.map(command => command.args)).toEqual([
      [`${PREFIX}cache:tag:x`, '60', 'NX'],
      [`${PREFIX}cache:tag:x`, '60', 'GT'],
    ]);
  });

  it('falls back to read-then-extend on a server that rejects the options', async () => {
    const { server, cache } = setup();
    server.seed('cache:tag:x', '1', 100);
    server.failNext('expire', new Error('ERR syntax error'));

    await cache.extendExpiry('cache:tag:x', 360);

    expect(await cache.ttl('cache:tag:x')).toBe(360);
  });
});

describe('BaseCacheClientService.deleteKeysStrict', () => {
  it('deletes in batches of at most 500 keys', async () => {
    const { server, cache } = setup();
    const keys = Array.from({ length: 1100 }, (_v, index) => `entry:${index}`);
    keys.forEach(key => server.seed(key));

    const deleted = await cache.deleteKeysStrict(keys);

    expect(deleted).toBe(1100);
    expect(server.logicalKeys()).toEqual([]);
    server.wire
      .filter(command => command.name === 'unlink')
      .forEach(command => expect(command.args.length).toBeLessThanOrEqual(DELETE_BATCH_SIZE));
  });

  it('throws when a batch fails, instead of reporting a partial delete as success', async () => {
    const { server, cache } = setup();
    server.seed('entry:1');
    server.failNext('unlink', new Error('OOM'));

    await expect(cache.deleteKeysStrict(['entry:1'])).rejects.toThrow('OOM');
  });

  it('throws when the client is not ready', async () => {
    const { server, cache } = setup();
    server.setStatus('reconnecting');

    await expect(cache.deleteKeysStrict(['entry:1'])).rejects.toBeInstanceOf(HealthcareError);
  });
});
