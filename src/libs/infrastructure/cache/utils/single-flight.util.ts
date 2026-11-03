/**
 * In-process single-flight: concurrent callers asking for the same key share ONE execution of
 * the loader instead of each hitting the database on a cache miss (cache stampede). The entry is
 * removed as soon as the shared promise settles, so a later call starts a fresh load and an
 * error is never cached.
 *
 * This only coalesces within one process; CacheService additionally takes a short distributed
 * fill lock so several API replicas do not all rebuild the same cold key at once.
 */
export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  /** Number of keys currently loading (for metrics/tests). */
  get size(): number {
    return this.inFlight.size;
  }

  /** True when a load for `key` is already running in this process. */
  has(key: string): boolean {
    return this.inFlight.has(key);
  }

  /**
   * Runs `loader` for `key`, or joins the load already running for it. Every caller receives
   * the same resolution or rejection.
   */
  run<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const shared = (async (): Promise<T> => {
      try {
        return await loader();
      } finally {
        this.inFlight.delete(key);
      }
    })();
    // Marks the rejection as handled: callers still see it, but a rejection that settles before
    // a caller attached its handler is not reported as an unhandledRejection.
    shared.catch((): void => undefined);
    this.inFlight.set(key, shared);
    return shared;
  }
}

/**
 * Deep copy for values handed to coalesced followers, so one request mutating its response can
 * never change another request's response. Falls back to the shared reference when the value
 * cannot be cloned (functions, class instances with native slots).
 */
export function cloneForFollower<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}
