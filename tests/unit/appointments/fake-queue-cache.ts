/**
 * An in-memory stand-in for the slice of CacheService that both CheckInLocationService (locks,
 * tag invalidation, plain get / set) and the real AppointmentQueueService (lists, key scans,
 * locks) use. List keys are stored under the names the code passes, so what check-in writes is
 * exactly what the queue reads back, with glob matching for `keys(pattern)`.
 */
import { jest } from '@jest/globals';

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export class FakeQueueCache {
  readonly lists = new Map<string, string[]>();
  readonly values = new Map<string, unknown>();
  readonly locks = new Set<string>();

  /** Make every acquireLock fail like an unavailable cache client does. */
  lockUnavailable = false;
  /** Make every acquireLock throw (a provider that raises instead of returning false). */
  lockThrows = false;

  readonly acquireLock = jest.fn(async (key: string, _ttlSeconds: number, _value?: string) => {
    if (this.lockThrows) {
      throw new Error('cache client is not ready');
    }
    if (this.lockUnavailable || this.locks.has(key)) {
      return false;
    }
    this.locks.add(key);
    return true;
  });

  readonly releaseLock = jest.fn(async (key: string) => this.locks.delete(key));

  readonly invalidateCacheByTag = jest.fn(async (..._args: unknown[]) => 0);

  async get(key: string): Promise<unknown> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: unknown, _ttlSeconds?: number): Promise<void> {
    this.values.set(key, value);
  }

  readonly counters = new Map<string, number>();

  async incr(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  async expire(_key: string, _seconds: number): Promise<number> {
    return 1;
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      removed += Number(this.lists.delete(key)) + Number(this.values.delete(key));
    }
    return removed;
  }

  async rPush(key: string, value: string): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.push(value);
    this.lists.set(key, list);
    return list.length;
  }

  async lLen(key: string): Promise<number> {
    return (this.lists.get(key) ?? []).length;
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    return stop === -1 ? list.slice(start) : list.slice(start, stop + 1);
  }

  async keys(pattern: string): Promise<string[]> {
    const matcher = globToRegExp(pattern);
    return [...this.lists.keys(), ...this.values.keys()].filter(key => matcher.test(key));
  }

  /** The queue list keys written so far, for assertions. */
  queueKeys(): string[] {
    return [...this.lists.keys()].filter(key => key.startsWith('queue:'));
  }
}
