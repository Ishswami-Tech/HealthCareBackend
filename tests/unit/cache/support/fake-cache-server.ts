/**
 * An in-memory stand-in for a Redis/Dragonfly server, reached through a client configured with an
 * ioredis `keyPrefix`.
 *
 * The prefixing decision is delegated to ioredis' own `Command`, so tests exercise the real client
 * semantics rather than a re-implementation of them: key ARGUMENTS (GET, DEL, UNLINK, EXPIRE,
 * SADD, ...) are prefixed on the way out, KEYS/SCAN globs are NOT, and KEYS/SCAN return the raw
 * (already prefixed) names. The server only ever sees and stores RAW key names.
 */

import { Command } from 'ioredis';
import type Redis from 'ioredis';

import { BaseCacheClientService } from '@infrastructure/cache/base-cache-client.service';

export const PREFIX = 'healthcare:';

/** Redis glob: `*`, `?`, and `\x` for a literal x (character classes are not needed here). */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index);
    if (char === '\\') {
      index += 1;
      source += (glob.charAt(index) || '\\').replace(/[.+^${}()|[\]\\*?]/g, '\\$&');
    } else if (char === '*') {
      source += '.*';
    } else if (char === '?') {
      source += '.';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

type FakeValue = string | string[] | Set<string>;

interface FakeEntry {
  value: FakeValue;
  expiresAtMs: number | undefined;
}

export interface FakeClock {
  nowMs: number;
}

export interface WireCommand {
  readonly name: string;
  readonly args: readonly string[];
}

export interface FakeServerOptions {
  readonly keyPrefix?: string;
  /** Expose SCAN/UNLINK (a modern client). Without it only KEYS/DEL exist. */
  readonly modern?: boolean;
  /** Keys examined per SCAN page when the client sends no COUNT. */
  readonly scanPageSize?: number;
}

export interface FakeCacheServer {
  readonly client: Redis;
  /** RAW key names (with the prefix) -> entries. */
  readonly store: Map<string, FakeEntry>;
  readonly clock: FakeClock;
  /** Every command as it reached the server, after ioredis applied `keyPrefix`. */
  readonly wire: WireCommand[];
  /** Stored key names with the prefix removed (what application code calls "the key"). */
  logicalKeys(): string[];
  /** Writes a string entry the way the application would (a LOGICAL key, optional TTL). */
  seed(logicalKey: string, value?: string, ttlSeconds?: number): void;
  seedRaw(rawKey: string, value?: string): void;
  has(logicalKey: string): boolean;
  /** Makes the next command with this name reject. */
  failNext(commandName: string, error: Error): void;
  setStatus(status: string): void;
}

export function createFakeCacheServer(options: FakeServerOptions = {}): FakeCacheServer {
  const keyPrefix = options.keyPrefix ?? PREFIX;
  const modern = options.modern ?? true;
  const defaultPage = options.scanPageSize ?? 10;
  const store = new Map<string, FakeEntry>();
  const clock: FakeClock = { nowMs: 1_000_000 };
  const wire: WireCommand[] = [];
  const failures = new Map<string, Error>();
  const state = { status: 'ready' };
  let scanSnapshot: string[] = [];

  function send(name: string, args: readonly (string | number)[]): string[] {
    const sent = new Command(name, [...args], { keyPrefix }).args.map(String);
    wire.push({ name, args: sent });
    const failure = failures.get(name);
    if (failure) {
      failures.delete(name);
      throw failure;
    }
    return sent;
  }

  function live(rawKey: string): FakeEntry | undefined {
    const entry = store.get(rawKey);
    if (entry?.expiresAtMs !== undefined && entry.expiresAtMs <= clock.nowMs) {
      store.delete(rawKey);
      return undefined;
    }
    return entry;
  }

  function liveKeys(): string[] {
    return [...store.keys()].filter(key => live(key)).sort();
  }

  function removeAll(rawKeys: readonly string[]): number {
    return rawKeys.reduce(
      (removed, key) => (live(key) && store.delete(key) ? removed + 1 : removed),
      0
    );
  }

  function asSet(rawKey: string): Set<string> {
    const entry = live(rawKey);
    if (entry && entry.value instanceof Set) return entry.value;
    const created = new Set<string>();
    store.set(rawKey, { value: created, expiresAtMs: entry?.expiresAtMs });
    return created;
  }

  function asList(rawKey: string): string[] {
    const entry = live(rawKey);
    if (entry && Array.isArray(entry.value)) return entry.value;
    const created: string[] = [];
    store.set(rawKey, { value: created, expiresAtMs: entry?.expiresAtMs });
    return created;
  }

  function ttlSeconds(rawKey: string): number {
    const entry = live(rawKey);
    if (!entry) return -2;
    if (entry.expiresAtMs === undefined) return -1;
    return Math.ceil((entry.expiresAtMs - clock.nowMs) / 1000);
  }

  function expire(rawKey: string, seconds: number, flag: string | undefined): number {
    const entry = live(rawKey);
    if (!entry) return 0;
    const current = ttlSeconds(rawKey);
    if (flag === 'NX' && current !== -1) return 0;
    if (flag === 'GT' && (current === -1 || seconds <= current)) return 0;
    entry.expiresAtMs = clock.nowMs + seconds * 1000;
    return 1;
  }

  const handlers = {
    keys: jest.fn((pattern: string) => {
      const [glob = ''] = send('keys', [pattern]);
      const matcher = globToRegExp(glob);
      return Promise.resolve(liveKeys().filter(key => matcher.test(key)));
    }),
    del: jest.fn((...names: string[]) => Promise.resolve(removeAll(send('del', names)))),
    get: jest.fn((key: string) => {
      const [raw = ''] = send('get', [key]);
      const entry = live(raw);
      return Promise.resolve(typeof entry?.value === 'string' ? entry.value : null);
    }),
    set: jest.fn((key: string, value: string) => {
      const [raw = ''] = send('set', [key, value]);
      store.set(raw, { value, expiresAtMs: undefined });
      return Promise.resolve('OK');
    }),
    setex: jest.fn((key: string, seconds: number, value: string) => {
      const [raw = ''] = send('setex', [key, seconds, value]);
      store.set(raw, { value, expiresAtMs: clock.nowMs + seconds * 1000 });
      return Promise.resolve('OK');
    }),
    ttl: jest.fn((key: string) => {
      const [raw = ''] = send('ttl', [key]);
      return Promise.resolve(ttlSeconds(raw));
    }),
    expire: jest.fn((key: string, seconds: number, flag?: string) => {
      const [raw = ''] = send('expire', flag ? [key, seconds, flag] : [key, seconds]);
      return Promise.resolve(expire(raw, seconds, flag));
    }),
    sadd: jest.fn((key: string, ...members: string[]) => {
      const [raw = '', ...rest] = send('sadd', [key, ...members]);
      const set = asSet(raw);
      const before = set.size;
      rest.forEach(member => set.add(member));
      return Promise.resolve(set.size - before);
    }),
    smembers: jest.fn((key: string) => {
      const [raw = ''] = send('smembers', [key]);
      const entry = live(raw);
      return Promise.resolve(entry?.value instanceof Set ? [...entry.value] : []);
    }),
    srem: jest.fn((key: string, ...members: string[]) => {
      const [raw = '', ...rest] = send('srem', [key, ...members]);
      const entry = live(raw);
      if (!(entry?.value instanceof Set)) return Promise.resolve(0);
      const removed = rest.filter(member => (entry.value as Set<string>).delete(member)).length;
      if (entry.value.size === 0) store.delete(raw);
      return Promise.resolve(removed);
    }),
    rpush: jest.fn((key: string, value: string) => {
      const [raw = '', item = ''] = send('rpush', [key, value]);
      const list = asList(raw);
      list.push(item);
      return Promise.resolve(list.length);
    }),
    publish: jest.fn(() => Promise.resolve(0)),
    lrange: jest.fn((key: string, start: number, stop: number) => {
      const [raw = ''] = send('lrange', [key, start, stop]);
      const entry = live(raw);
      const list = Array.isArray(entry?.value) ? entry.value : [];
      return Promise.resolve(list.slice(start, stop === -1 ? undefined : stop + 1));
    }),
  };

  const modernHandlers = {
    unlink: jest.fn((...names: string[]) => Promise.resolve(removeAll(send('unlink', names)))),
    scan: jest.fn(
      (cursor: string, _match: 'MATCH', pattern: string, _count?: 'COUNT', count?: number) => {
        const [, , glob = ''] = send(
          'scan',
          count === undefined
            ? [cursor, 'MATCH', pattern]
            : [cursor, 'MATCH', pattern, 'COUNT', count]
        );
        const matcher = globToRegExp(glob);
        // Like a real SCAN, an iteration sees every key that exists for its whole duration even
        // when earlier pages were deleted meanwhile: the key order is fixed when the cursor is 0.
        if (cursor === '0') scanSnapshot = liveKeys();
        const start = Number(cursor);
        const size = count ?? defaultPage;
        const page = scanSnapshot
          .slice(start, start + size)
          .filter(key => live(key) && matcher.test(key));
        const next = start + size >= scanSnapshot.length ? '0' : String(start + size);
        return Promise.resolve<[string, string[]]>([next, page]);
      }
    ),
  };

  const client = {
    get status(): string {
      return state.status;
    },
    ...handlers,
    ...(modern ? modernHandlers : {}),
  } as unknown as Redis;

  return {
    client,
    store,
    clock,
    wire,
    logicalKeys: (): string[] =>
      liveKeys().map(key => (key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key)),
    seed: (logicalKey, value = '1', ttl): void => {
      store.set(`${keyPrefix}${logicalKey}`, {
        value,
        expiresAtMs: ttl === undefined ? undefined : clock.nowMs + ttl * 1000,
      });
    },
    seedRaw: (rawKey, value = '1'): void => {
      store.set(rawKey, { value, expiresAtMs: undefined });
    },
    has: (logicalKey): boolean => live(`${keyPrefix}${logicalKey}`) !== undefined,
    failNext: (commandName, error): void => {
      failures.set(commandName, error);
    },
    setStatus: (status): void => {
      state.status = status;
    },
  };
}

interface TestProductionConfig {
  maxMemoryPolicy: string;
  maxConnections: number;
  connectionTimeout: number;
  commandTimeout: number;
  retryOnFailover: boolean;
  enableAutoPipelining: boolean;
  maxRetriesPerRequest: number;
  keyPrefix: string;
}

export interface TestLogger {
  readonly log: jest.Mock;
}

/** A BaseCacheClientService wired to a fake server and a recording logger. */
export class TestCacheClient extends BaseCacheClientService {
  protected readonly PROVIDER_NAME = 'dragonfly' as const;
  protected readonly DEFAULT_HOST = 'localhost';
  protected readonly HOST_ENV_VAR = 'TEST_HOST';
  protected readonly PORT_ENV_VAR = 'TEST_PORT';
  protected readonly PASSWORD_ENV_VAR = 'TEST_PASSWORD';
  protected readonly PRODUCTION_CONFIG: TestProductionConfig;

  constructor(keyPrefix: string, client: Redis | undefined, logger: TestLogger) {
    super(
      { isDevelopment: (): boolean => false, getEnvBoolean: (): boolean => false } as never,
      logger as never
    );
    this.PRODUCTION_CONFIG = {
      maxMemoryPolicy: 'noeviction',
      maxConnections: 1,
      connectionTimeout: 1,
      commandTimeout: 1,
      retryOnFailover: false,
      enableAutoPipelining: false,
      maxRetriesPerRequest: 1,
      keyPrefix,
    };
    if (client) this.client = client;
  }
}
