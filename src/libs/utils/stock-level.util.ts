/**
 * One definition of a medicine's stock level, shared by the pharmacy stats, the inventory summary
 * and the clinic-admin dashboard so every screen counts the same way:
 *  - out of stock: stock <= 0
 *  - low stock:    0 < stock <= reorder level (`minStockThreshold`)
 *  - in stock:     anything above the reorder level
 * Low and out are disjoint: a medicine with no stock is "out", never also "low".
 */

export type StockLevel = 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK';

export interface StockLevelRow {
  stock?: number | null;
  minStockThreshold?: number | null;
  price?: number | null;
}

export interface StockLevelSummary {
  total: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
  /** Sum of stock x listed price over the rows with stock, in rupees (2 decimals). */
  totalValue: number;
}

function finite(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function classifyStockLevel(
  stock: number | null | undefined,
  minStockThreshold: number | null | undefined
): StockLevel {
  const onHand = finite(stock);
  if (onHand <= 0) return 'OUT_OF_STOCK';
  return onHand <= finite(minStockThreshold) ? 'LOW_STOCK' : 'IN_STOCK';
}

export function summarizeStockLevels(rows: readonly StockLevelRow[]): StockLevelSummary {
  let lowStock = 0;
  let outOfStock = 0;
  let value = 0;
  for (const row of rows) {
    const level = classifyStockLevel(row.stock, row.minStockThreshold);
    if (level === 'OUT_OF_STOCK') outOfStock += 1;
    else if (level === 'LOW_STOCK') lowStock += 1;
    const onHand = finite(row.stock);
    if (onHand > 0) value += onHand * Math.max(0, finite(row.price));
  }
  return {
    total: rows.length,
    inStock: rows.length - outOfStock,
    lowStock,
    outOfStock,
    totalValue: Math.round(value * 100) / 100,
  };
}
