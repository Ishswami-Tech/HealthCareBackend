/**
 * Cache tags of the pharmacy read routes that depend on stock and supplier data: the dashboard
 * stats, the sales report, low-stock / expiring lists and the supplier list. Every cached
 * /pharmacy route carries the shared `pharmacy` tag, so busting these tags drops them all.
 */
export const PHARMACY_STOCK_CACHE_TAGS: readonly string[] = ['pharmacy', 'inventory'];
export const PHARMACY_SUPPLIER_CACHE_TAGS: readonly string[] = ['suppliers', 'pharmacy'];

/**
 * Drops the cached responses behind the given tags. A cache failure must never fail the write
 * that already committed, so it is logged and swallowed.
 */
export async function invalidatePharmacyCacheTags(
  cache: { invalidateCacheByTag: (tag: string) => Promise<unknown> },
  logger: { warn: (message: string, context?: Record<string, unknown>) => unknown },
  tags: readonly string[],
  reason: string
): Promise<void> {
  try {
    for (const tag of tags) {
      await cache.invalidateCacheByTag(tag);
    }
  } catch (error) {
    logger.warn('Failed to invalidate pharmacy caches', {
      reason,
      tags: [...tags],
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
