/**
 * Cross-process L1 invalidation broadcast (`cache:invalidation` channel).
 *
 * Every process keeps its own in-memory L1 layer. A write in one process (e.g. the worker voiding
 * an invoice) invalidates L2 and its own L1, then publishes a message so every OTHER process drops
 * the matching L1 entries; otherwise an API process keeps serving the old entry until its L1 TTL.
 *
 * - `key` / `keys` messages delete just those keys; `tag` / `pattern` / `clear` (and anything that
 *   cannot be parsed) clear the whole L1, because L1 has no tag or pattern index.
 * - Messages carry an id (deduped on receipt, bounded) and the publisher's origin id (a process
 *   ignores its own messages: it already updated its L1).
 * - `ping` messages are self-addressed and only confirm that the subscription is live: the cache
 *   client's subscribe() silently does nothing while its connection is not ready yet.
 */

export const CACHE_INVALIDATION_CHANNEL = 'cache:invalidation';
/** Keys per `keys` message; a larger batch is sent as a full clear instead. */
export const MAX_BROADCAST_KEYS = 200;

export type CacheInvalidationScope = 'key' | 'keys' | 'pattern' | 'tag' | 'clear' | 'ping';

export interface CacheInvalidationMessage {
  readonly id: string;
  readonly origin: string;
  readonly scope: CacheInvalidationScope;
  readonly value?: string | readonly string[];
}

export type L1InvalidationAction =
  | { readonly kind: 'ignore' }
  | { readonly kind: 'ping'; readonly id: string }
  | { readonly kind: 'delete'; readonly keys: readonly string[] }
  | { readonly kind: 'clear' };

const SCOPES: ReadonlySet<string> = new Set(['key', 'keys', 'pattern', 'tag', 'clear', 'ping']);

export function buildInvalidationMessage(
  id: string,
  origin: string,
  scope: CacheInvalidationScope,
  value?: string | readonly string[]
): string {
  if (scope === 'keys' && Array.isArray(value) && value.length > MAX_BROADCAST_KEYS) {
    return JSON.stringify({ id, origin, scope: 'clear' });
  }
  return JSON.stringify(value === undefined ? { id, origin, scope } : { id, origin, scope, value });
}

export function parseInvalidationMessage(raw: string): CacheInvalidationMessage | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    const { id, origin, scope, value } = parsed;
    if (typeof id !== 'string' || typeof origin !== 'string' || typeof scope !== 'string') {
      return null;
    }
    if (!SCOPES.has(scope)) return null;
    const cleanValue =
      typeof value === 'string'
        ? value
        : Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === 'string')
          : undefined;
    return {
      id,
      origin,
      scope: scope as CacheInvalidationScope,
      ...(cleanValue !== undefined ? { value: cleanValue } : {}),
    };
  } catch {
    return null;
  }
}

/** What a receiving process does to its L1 for `raw` (unparseable -> clear, the safe default). */
export function l1ActionFor(raw: string, selfOrigin: string): L1InvalidationAction {
  const message = parseInvalidationMessage(raw);
  if (!message) return { kind: 'clear' };
  if (message.scope === 'ping') {
    return message.origin === selfOrigin ? { kind: 'ping', id: message.id } : { kind: 'ignore' };
  }
  if (message.origin === selfOrigin) return { kind: 'ignore' };
  if (message.scope === 'key' && typeof message.value === 'string') {
    return { kind: 'delete', keys: [message.value] };
  }
  if (message.scope === 'keys' && Array.isArray(message.value)) {
    return { kind: 'delete', keys: message.value };
  }
  return { kind: 'clear' };
}

/** Insertion-ordered id set that forgets the oldest ids past `capacity`. */
export class BoundedIdSet {
  private readonly ids = new Set<string>();

  constructor(private readonly capacity: number) {}

  /** True when `id` was new (and is now remembered); false for a duplicate. */
  add(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.capacity) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    return true;
  }

  get size(): number {
    return this.ids.size;
  }
}
