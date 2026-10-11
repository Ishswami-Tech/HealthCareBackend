import { describe, it, expect, jest } from '@jest/globals';
import {
  PHARMACY_STOCK_CACHE_TAGS,
  PHARMACY_SUPPLIER_CACHE_TAGS,
  invalidatePharmacyCacheTags,
} from '@services/pharmacy-inventory/services/pharmacy-cache-invalidation.util';

describe('invalidatePharmacyCacheTags', () => {
  it('busts every given tag, in order', async () => {
    const invalidateCacheByTag = jest.fn(async (_tag: string) => 1);
    const warn = jest.fn();

    await invalidatePharmacyCacheTags({ invalidateCacheByTag }, { warn }, ['a', 'b'], 'test');

    expect(invalidateCacheByTag.mock.calls.map(call => call[0])).toEqual(['a', 'b']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs and swallows a cache failure so the committed write is not failed', async () => {
    const invalidateCacheByTag = jest.fn(async (_tag: string): Promise<number> => {
      throw new Error('redis down');
    });
    const warn = jest.fn();

    await expect(
      invalidatePharmacyCacheTags({ invalidateCacheByTag }, { warn }, ['pharmacy'], 'batch-created')
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('covers the tags of the cached stats, sales, low-stock and supplier routes', () => {
    expect(PHARMACY_STOCK_CACHE_TAGS).toEqual(expect.arrayContaining(['pharmacy', 'inventory']));
    expect(PHARMACY_SUPPLIER_CACHE_TAGS).toEqual(expect.arrayContaining(['suppliers', 'pharmacy']));
  });
});
