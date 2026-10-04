/// <reference types="jest" />

/**
 * In-memory stand-in for the slice of CacheService the Health Library uses:
 * `acquireLock` (SET NX EX) and `releaseLock`, with TTL expiry on a controllable
 * clock. `mode` reproduces the two failure shapes of the real service:
 * - `unavailable`: the provider is not connected, `acquireLock` answers false
 *   (exactly what CacheService does when the client isn't ready);
 * - `throws`: the call rejects.
 */

export type FakeCacheMode = 'ok' | 'unavailable' | 'throws';

export interface FakeCache {
  acquireLock: jest.Mock<Promise<boolean>, [string, number, (string | undefined)?]>;
  releaseLock: jest.Mock<Promise<boolean>, [string]>;
  setMode: (mode: FakeCacheMode) => void;
  /** Moves the cache clock forward so held slots can expire. */
  advanceSeconds: (seconds: number) => void;
  heldKeys: () => string[];
}

export function createFakeCache(): FakeCache {
  const expiresAtMs = new Map<string, number>();
  let nowMs = 0;
  let mode: FakeCacheMode = 'ok';

  const isHeld = (key: string): boolean => (expiresAtMs.get(key) ?? 0) > nowMs;

  // SET NX is atomic in the real cache, so check-and-set here is one synchronous step.
  const acquireLock = jest.fn(
    (key: string, ttlSeconds: number, _value?: string): Promise<boolean> => {
      if (mode === 'throws') {
        return Promise.reject(new Error('cache connection refused'));
      }
      if (mode === 'unavailable' || isHeld(key)) {
        return Promise.resolve(false);
      }
      expiresAtMs.set(key, nowMs + ttlSeconds * 1000);
      return Promise.resolve(true);
    }
  );
  const releaseLock = jest.fn((key: string): Promise<boolean> => {
    if (mode === 'throws') {
      return Promise.reject(new Error('cache connection refused'));
    }
    return Promise.resolve(expiresAtMs.delete(key));
  });

  return {
    acquireLock,
    releaseLock,
    setMode: next => {
      mode = next;
    },
    advanceSeconds: seconds => {
      nowMs += seconds * 1000;
    },
    heldKeys: () => [...expiresAtMs.keys()].filter(isHeld),
  };
}
