/**
 * One stock-level definition for every screen (N10): out = stock <= 0, low = 0 < stock <= reorder
 * level, and the server-wide stock value (N11). src/libs/utils/stock-level.util.ts
 */
import { describe, expect, it } from '@jest/globals';
import { classifyStockLevel, summarizeStockLevels } from '@utils/stock-level.util';

describe('classifyStockLevel', () => {
  it('treats zero or negative stock as out of stock, even with no reorder level', () => {
    expect(classifyStockLevel(0, 10)).toBe('OUT_OF_STOCK');
    expect(classifyStockLevel(-2, 0)).toBe('OUT_OF_STOCK');
    expect(classifyStockLevel(null, null)).toBe('OUT_OF_STOCK');
  });

  it('is low when stock is above zero and at or below the reorder level', () => {
    expect(classifyStockLevel(1, 10)).toBe('LOW_STOCK');
    expect(classifyStockLevel(10, 10)).toBe('LOW_STOCK');
  });

  it('is in stock above the reorder level, or with a positive stock and no reorder level', () => {
    expect(classifyStockLevel(11, 10)).toBe('IN_STOCK');
    expect(classifyStockLevel(5, 0)).toBe('IN_STOCK');
    expect(classifyStockLevel(5, null)).toBe('IN_STOCK');
  });
});

describe('summarizeStockLevels', () => {
  it('counts low and out separately and values only stock on hand', () => {
    const summary = summarizeStockLevels([
      { stock: 0, minStockThreshold: 10, price: 5 },
      { stock: -1, minStockThreshold: 10, price: 5 },
      { stock: 4, minStockThreshold: 10, price: 2.5 },
      { stock: 50, minStockThreshold: 10, price: 1.1 },
      { stock: 3, minStockThreshold: 0, price: null },
    ]);
    expect(summary).toEqual({ total: 5, inStock: 3, lowStock: 1, outOfStock: 2, totalValue: 65 });
  });

  it('returns zeros for an empty inventory', () => {
    expect(summarizeStockLevels([])).toEqual({
      total: 0,
      inStock: 0,
      lowStock: 0,
      outOfStock: 0,
      totalValue: 0,
    });
  });
});
