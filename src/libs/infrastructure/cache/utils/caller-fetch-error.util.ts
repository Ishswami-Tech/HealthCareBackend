/**
 * Errors thrown by a caller's own fetch function inside `CacheService.cache()`.
 *
 * `cache(key, fetchFn)` runs the caller's fetchFn on a miss. When fetchFn throws (for example a
 * NotFoundException for an unknown clinic), that is the caller's result, not a cache failure. It
 * must not count against the cache circuit breaker, be logged as a cache error, or cause the
 * fetch to run again. Marking the error object lets every layer between the fetch and
 * `cache()` (strategies, repository middleware, error handler) recognise it.
 *
 * Limits: a wrapping error is recognised only one `cause` level deep (no current strategy wraps
 * at all), and a thrown non-object cannot be marked - CacheRepository re-wraps those as a plain
 * `Error`, so they keep the old "cache failure" handling.
 */
const callerFetchErrors = new WeakSet<object>();

/** Marks an error thrown by the caller's fetch function. Non-objects cannot be marked. */
export function markCallerFetchError(error: unknown): void {
  if (typeof error === 'object' && error !== null) {
    callerFetchErrors.add(error);
  }
}

/** True when `error` (or its `cause`) was thrown by a caller's fetch function. */
export function isCallerFetchError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if (callerFetchErrors.has(error)) {
    return true;
  }
  const cause = (error as { cause?: unknown }).cause;
  return typeof cause === 'object' && cause !== null && callerFetchErrors.has(cause);
}

/** The originally thrown caller error, unwrapping one `cause` level if a layer wrapped it. */
export function unwrapCallerFetchError(error: unknown): unknown {
  if (typeof error === 'object' && error !== null && !callerFetchErrors.has(error)) {
    const cause = (error as { cause?: unknown }).cause;
    if (typeof cause === 'object' && cause !== null && callerFetchErrors.has(cause)) {
      return cause;
    }
  }
  return error;
}
