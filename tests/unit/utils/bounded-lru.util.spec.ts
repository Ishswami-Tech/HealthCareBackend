import { describe, expect, it } from '@jest/globals';
import { BoundedLru } from '../../../src/libs/utils/bounded-lru.util';
import { clinicInPersonMinutesCacheKey } from '../../../src/libs/utils/visit-duration.util';

function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: ms => (current += ms) };
}

describe('BoundedLru', () => {
  it('returns stored values and undefined for missing keys', () => {
    const lru = new BoundedLru<string, string>({ maxEntries: 2, ttlMs: 1000 });
    lru.set('u1', 'p1');
    expect(lru.get('u1')).toBe('p1');
    expect(lru.get('u2')).toBeUndefined();
  });

  it('evicts the least recently used entry when over capacity', () => {
    const lru = new BoundedLru<string, number>({ maxEntries: 2, ttlMs: 1000 });
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1); // a is now most recent
    lru.set('c', 3);
    expect(lru.size).toBe(2);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    expect(lru.get('c')).toBe(3);
  });

  it('expires entries after the TTL and drops them', () => {
    const c = clock();
    const lru = new BoundedLru<string, number>({ maxEntries: 5, ttlMs: 100, now: c.now });
    lru.set('a', 1);
    c.advance(99);
    expect(lru.get('a')).toBe(1);
    c.advance(1);
    expect(lru.get('a')).toBeUndefined();
    expect(lru.size).toBe(0);
  });

  it('overwriting refreshes value and TTL; delete / clear remove entries', () => {
    const c = clock();
    const lru = new BoundedLru<string, number>({ maxEntries: 5, ttlMs: 100, now: c.now });
    lru.set('a', 1);
    c.advance(80);
    lru.set('a', 2);
    c.advance(80);
    expect(lru.get('a')).toBe(2);
    expect(lru.delete('a')).toBe(true);
    expect(lru.get('a')).toBeUndefined();
    lru.set('b', 1);
    lru.clear();
    expect(lru.size).toBe(0);
  });

  it('never holds fewer than one entry even with a bad capacity', () => {
    const lru = new BoundedLru<string, number>({ maxEntries: 0, ttlMs: 100 });
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.size).toBe(1);
    expect(lru.get('b')).toBe(2);
  });
});

describe('clinicInPersonMinutesCacheKey', () => {
  it('is per clinic and stable', () => {
    expect(clinicInPersonMinutesCacheKey('c1')).toBe('clinic:c1:in-person-minutes');
    expect(clinicInPersonMinutesCacheKey('c1')).not.toBe(clinicInPersonMinutesCacheKey('c2'));
  });
});
