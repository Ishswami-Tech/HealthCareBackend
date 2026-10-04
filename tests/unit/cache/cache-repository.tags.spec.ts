/// <reference types="jest" />
/**
 * Tag-index bookkeeping of CacheRepository against an in-memory server reached through a real
 * `DragonflyCacheProvider` and `BaseCacheClientService`.
 *
 * - The tag set must live as long as its longest-lived member. The old `EXPIRE tagKey ttl+60` ran
 *   unconditionally, so a short-lived entry registered last shortened the set and a later
 *   invalidation missed the long-lived entry.
 * - Invalidation deletes members in chunks of at most 500, removes a chunk from the set only after
 *   it was deleted, and never scans the keyspace.
 */

import { CacheRepository } from '@infrastructure/cache/repositories/cache.repository';
import { CacheVersioningService } from '@infrastructure/cache/services/cache-versioning.service';
import { CacheKeyFactory } from '@infrastructure/cache/factories/cache-key.factory';
import { DragonflyCacheProvider } from '@infrastructure/cache/providers/dragonfly-cache.provider';
import type { DragonflyService } from '@cache/dragonfly/dragonfly.service';
import { DELETE_BATCH_SIZE } from '@infrastructure/cache/utils/pattern-delete.util';
import { LogLevel } from '@core/types';
import { PREFIX, TestCacheClient, createFakeCacheServer } from './support/fake-cache-server';

jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@config/cache.config', () => ({
  isCacheEnabled: (): boolean => true,
  getCacheProvider: (): string => 'dragonfly',
}));

const TAG = 'appointments';
const TAG_KEY = `cache:tag:${TAG}`;

function createStack() {
  const server = createFakeCacheServer();
  const logger = { log: jest.fn() };
  const client = new TestCacheClient(PREFIX, server.client, logger);
  const provider = new DragonflyCacheProvider(
    client as unknown as DragonflyService,
    { isDevelopment: (): boolean => false } as never,
    logger as never
  );
  const keyFactory = new CacheKeyFactory();
  const repository = new CacheRepository(
    { getBasicProvider: () => provider, getProvider: () => provider } as never,
    {} as never,
    {} as never,
    new CacheVersioningService(keyFactory),
    keyFactory,
    logger as never
  );
  const warnings = (): string[] =>
    logger.log.mock.calls.filter(call => call[1] === LogLevel.WARN).map(call => String(call[2]));
  return { server, repository, logger, warnings };
}

describe('CacheRepository tag index lifetime', () => {
  it('a short-lived entry registered last does not shorten the tag set (entry A ttl 300, entry B ttl 30)', async () => {
    const { server, repository } = createStack();
    await repository.set('entry:a', { patient: 'A' }, { ttl: 300, tags: [TAG] });
    await repository.set('entry:b', { patient: 'B' }, { ttl: 30, tags: [TAG] });

    expect(await server.client.ttl(TAG_KEY)).toBe(360);

    server.clock.nowMs += 120_000;
    expect(server.has('entry:b:v1')).toBe(false); // B expired by itself
    expect(server.has('entry:a:v1')).toBe(true);

    const deleted = await repository.invalidateByTags([TAG]);

    expect(deleted).toBe(1);
    expect(server.has('entry:a:v1')).toBe(false); // A is still reached at t=120
  });

  it('a longer entry registered later extends the set', async () => {
    const { server, repository } = createStack();
    await repository.set('entry:a', 'x', { ttl: 30, tags: [TAG] });
    await repository.set('entry:b', 'y', { ttl: 600, tags: [TAG] });

    expect(await server.client.ttl(TAG_KEY)).toBe(660);
  });

  it('gives a brand new tag set its first TTL (a set without one would live forever)', async () => {
    const { server, repository } = createStack();

    await repository.set('entry:a', 'x', { ttl: 100, tags: [TAG] });

    expect(await server.client.ttl(TAG_KEY)).toBe(160);
  });

  it('registers every tag of an entry', async () => {
    const { server, repository } = createStack();

    await repository.set('entry:a', 'x', { ttl: 100, tags: ['t1', 't2', 't1'] });

    expect(server.logicalKeys()).toEqual(
      expect.arrayContaining(['cache:tag:t1', 'cache:tag:t2', 'entry:a:v1'])
    );
  });

  it('logs a WARN instead of failing the write when tag bookkeeping fails', async () => {
    const { server, repository, warnings } = createStack();
    // EXPIRE ... NX is rejected and the read-then-extend fallback cannot read the TTL either.
    server.failNext('expire', new Error('READONLY'));
    server.failNext('ttl', new Error('READONLY'));

    await expect(
      repository.set('entry:a', 'x', { ttl: 100, tags: [TAG] })
    ).resolves.toBeUndefined();

    expect(server.has('entry:a:v1')).toBe(true);
    expect(warnings().join('\n')).toContain('Failed to register cache tag');
  });
});

describe('CacheRepository tag invalidation', () => {
  async function seedTagged(count: number) {
    const stack = createStack();
    for (let index = 0; index < count; index += 1) {
      await stack.repository.set(`entry:${index}`, 'x', { ttl: 300, tags: [TAG] });
    }
    return stack;
  }

  it('deletes members in chunks of at most 500 keys and leaves no tag set behind', async () => {
    const { server, repository } = await seedTagged(1100);

    const deleted = await repository.invalidateByTags([TAG]);

    expect(deleted).toBe(1100);
    expect(server.logicalKeys()).toEqual([]);
    const unlinks = server.wire.filter(command => command.name === 'unlink');
    expect(unlinks).toHaveLength(Math.ceil(1100 / DELETE_BATCH_SIZE));
    unlinks.forEach(command => expect(command.args.length).toBeLessThanOrEqual(DELETE_BATCH_SIZE));
  });

  it('keeps the undeleted members indexed when a chunk fails, and retries them next time', async () => {
    const { server, repository } = await seedTagged(600);
    const unlink = server.client.unlink as unknown as jest.Mock;
    const realUnlink = unlink.getMockImplementation() as (...names: string[]) => Promise<number>;
    let calls = 0;
    unlink.mockImplementation((...names: string[]) => {
      calls += 1;
      return calls === 2 ? Promise.reject(new Error('Command timed out')) : realUnlink(...names);
    });

    await expect(repository.invalidateByTags([TAG])).rejects.toThrow('Command timed out');

    const remainingMembers = await server.client.smembers(TAG_KEY);
    expect(remainingMembers).toHaveLength(100); // the failed second chunk is still indexed
    expect(server.logicalKeys().filter(key => key.startsWith('entry:'))).toHaveLength(100);

    unlink.mockImplementation(realUnlink);
    const retried = await repository.invalidateByTags([TAG]);

    expect(retried).toBe(100);
    expect(server.logicalKeys()).toEqual([]);
  });

  it('does not lose an entry that is registered while the tag is being invalidated', async () => {
    const { server, repository } = await seedTagged(3);
    const unlink = server.client.unlink as unknown as jest.Mock;
    const realUnlink = unlink.getMockImplementation() as (...names: string[]) => Promise<number>;
    unlink.mockImplementation(async (...names: string[]) => {
      const result = await realUnlink(...names);
      await repository.set('entry:late', 'x', { ttl: 300, tags: [TAG] });
      return result;
    });

    await repository.invalidateByTags([TAG]);

    expect(await server.client.smembers(TAG_KEY)).toEqual(['entry:late:v1']);
    expect(server.has('entry:late:v1')).toBe(true);
  });

  it('never scans the keyspace for a tag without an index', async () => {
    const { server, repository } = createStack();
    server.seed('cache:tag:foo:bar'); // the index set of a tag named "foo:bar"

    const deleted = await repository.invalidateByTags(['foo']);

    expect(deleted).toBe(0);
    expect(server.has('cache:tag:foo:bar')).toBe(true);
    expect(server.wire.map(command => command.name)).not.toEqual(expect.arrayContaining(['scan']));
    expect(server.wire.map(command => command.name)).not.toEqual(expect.arrayContaining(['keys']));
  });

  it('skips members in protected namespaces and drops their index entries', async () => {
    const { server, repository, warnings } = createStack();
    server.seed('auth:lockout:victim:v1');
    server.seed('entry:ok:v1');
    await server.client.sadd(TAG_KEY, 'auth:lockout:victim:v1', 'entry:ok:v1');

    const deleted = await repository.invalidateByTags([TAG]);

    expect(deleted).toBe(1);
    expect(server.has('auth:lockout:victim:v1')).toBe(true);
    expect(server.has('entry:ok:v1')).toBe(false);
    expect(warnings().join('\n')).toContain('protected namespaces');
  });

  it('invalidating the same tag twice in one call deletes once', async () => {
    const { server, repository } = await seedTagged(2);

    expect(await repository.invalidateByTags([TAG, TAG])).toBe(2);
    expect(server.logicalKeys()).toEqual([]);
  });
});

describe('CacheRepository pattern invalidation', () => {
  it('appends the version suffix, uses the shared SCAN delete and spares security keys', async () => {
    const { server, repository } = createStack();
    server.seed('clinic:c1:appointments:list:v1');
    server.seed('clinic:c2:appointments:list:v1');
    server.seed('auth:lockout:u1:v1');

    const deleted = await repository.invalidateByPattern('clinic:c1:appointments:*');

    expect(deleted).toBe(1);
    expect(server.logicalKeys().sort()).toEqual([
      'auth:lockout:u1:v1',
      'clinic:c2:appointments:list:v1',
    ]);
  });

  it('refuses a pattern that targets a protected namespace', async () => {
    const { server, repository } = createStack();
    server.seed('auth:lockout:u1:v1');

    expect(await repository.invalidateByPattern('auth:*')).toBe(0);
    expect(server.has('auth:lockout:u1:v1')).toBe(true);
  });

  it('surfaces a failed delete as an error', async () => {
    const { server, repository } = createStack();
    server.seed('clinic:c1:x:v1');
    server.failNext('scan', new Error('Command timed out'));

    await expect(repository.invalidateByPattern('clinic:c1:*')).rejects.toThrow(
      'Failed to delete cache keys'
    );
  });
});
