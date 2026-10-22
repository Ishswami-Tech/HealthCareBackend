/**
 * Unit tests for the cross-process L1 invalidation broadcast helpers.
 */

import { describe, expect, it } from '@jest/globals';
import {
  BoundedIdSet,
  MAX_BROADCAST_KEYS,
  buildInvalidationMessage,
  l1ActionFor,
  parseInvalidationMessage,
} from '@infrastructure/cache/utils/cache-invalidation-broadcast.util';

const SELF = 'proc-api';
const WORKER = 'proc-worker';

describe('cache invalidation broadcast', () => {
  it('round-trips a message', () => {
    const raw = buildInvalidationMessage('m1', WORKER, 'tag', 'user:42');
    expect(parseInvalidationMessage(raw)).toEqual({
      id: 'm1',
      origin: WORKER,
      scope: 'tag',
      value: 'user:42',
    });
  });

  it('clears L1 for a tag / pattern / clear from another process', () => {
    expect(l1ActionFor(buildInvalidationMessage('a', WORKER, 'tag', 'user:42'), SELF)).toEqual({
      kind: 'clear',
    });
    expect(
      l1ActionFor(buildInvalidationMessage('b', WORKER, 'pattern', 'billing:*'), SELF)
    ).toEqual({
      kind: 'clear',
    });
    expect(l1ActionFor(buildInvalidationMessage('c', WORKER, 'clear'), SELF)).toEqual({
      kind: 'clear',
    });
  });

  it('deletes only the named keys for key / keys messages', () => {
    expect(l1ActionFor(buildInvalidationMessage('d', WORKER, 'key', 'k1'), SELF)).toEqual({
      kind: 'delete',
      keys: ['k1'],
    });
    expect(l1ActionFor(buildInvalidationMessage('e', WORKER, 'keys', ['k1', 'k2']), SELF)).toEqual({
      kind: 'delete',
      keys: ['k1', 'k2'],
    });
  });

  it('turns an oversized key batch into a full clear', () => {
    const keys = Array.from({ length: MAX_BROADCAST_KEYS + 1 }, (_, i) => `k${i}`);
    expect(l1ActionFor(buildInvalidationMessage('f', WORKER, 'keys', keys), SELF)).toEqual({
      kind: 'clear',
    });
  });

  it('ignores its own messages and only accepts its own pings', () => {
    expect(l1ActionFor(buildInvalidationMessage('g', SELF, 'tag', 'x'), SELF)).toEqual({
      kind: 'ignore',
    });
    expect(l1ActionFor(buildInvalidationMessage('p1', SELF, 'ping'), SELF)).toEqual({
      kind: 'ping',
      id: 'p1',
    });
    expect(l1ActionFor(buildInvalidationMessage('p2', WORKER, 'ping'), SELF)).toEqual({
      kind: 'ignore',
    });
  });

  it('falls back to a clear for malformed or legacy payloads', () => {
    expect(l1ActionFor('not json', SELF)).toEqual({ kind: 'clear' });
    expect(l1ActionFor(JSON.stringify({ scope: 'tag', value: 'x' }), SELF)).toEqual({
      kind: 'clear',
    });
    expect(l1ActionFor(JSON.stringify({ id: 'x', origin: WORKER, scope: 'bogus' }), SELF)).toEqual({
      kind: 'clear',
    });
  });
});

describe('BoundedIdSet', () => {
  it('dedupes ids and forgets the oldest past capacity', () => {
    const ids = new BoundedIdSet(2);
    expect(ids.add('a')).toBe(true);
    expect(ids.add('a')).toBe(false);
    expect(ids.add('b')).toBe(true);
    expect(ids.add('c')).toBe(true);
    expect(ids.size).toBe(2);
    expect(ids.add('a')).toBe(true);
  });
});
