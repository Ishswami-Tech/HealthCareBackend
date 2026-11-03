/**
 * Small bounded in-process LRU with a per-entry TTL (pure, no Nest imports).
 *
 * For hot, stable lookups on poll paths (e.g. userId -> patientId) where a round trip to the
 * shared cache would cost as much as the DB read it saves. Bounded so it can never grow with
 * the user base; the TTL bounds staleness when the mapping does change.
 */
export interface BoundedLruOptions {
  /** Maximum number of entries kept; the least recently used one is evicted first. */
  readonly maxEntries: number;
  /** Lifetime of an entry in milliseconds. */
  readonly ttlMs: number;
  /** Clock (tests). */
  readonly now?: () => number;
}

interface LruEntry<V> {
  readonly value: V;
  readonly expiresAt: number;
}

export class BoundedLru<K, V> {
  private readonly entries = new Map<K, LruEntry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: BoundedLruOptions) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries));
    this.ttlMs = Math.max(0, options.ttlMs);
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  /** The live value, refreshed as most recently used; undefined when absent or expired. */
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
