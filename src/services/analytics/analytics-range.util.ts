/**
 * Pure helpers of the clinic analytics: the custom date window of a request and the money
 * figures of that window. Nothing here is a demo value — an empty window folds to zeros.
 */

export interface AnalyticsDateRange {
  readonly from: Date;
  readonly to: Date;
}

export interface RangeFinancials {
  /** Completed payments taken inside the window (gross). */
  readonly totalRevenue: number;
  /** Money refunded inside the window. */
  readonly totalRefunds: number;
  /** totalRevenue - totalRefunds. */
  readonly netRevenue: number;
  /** Clinic expenses dated inside the window. */
  readonly totalExpenses: number;
  /** netRevenue - totalExpenses. */
  readonly netProfit: number;
  readonly from: string;
  readonly to: string;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * The window of a request: explicit `startDate` / `endDate` (when both parse and are in order)
 * win over the `period` window the caller already resolved.
 */
export function resolveAnalyticsRange(
  periodRange: AnalyticsDateRange,
  filters: { readonly startDate?: unknown; readonly endDate?: unknown } = {}
): AnalyticsDateRange {
  const from = toDate(filters.startDate);
  const to = toDate(filters.endDate);
  if (from && to && from.getTime() <= to.getTime()) {
    return { from, to };
  }
  return periodRange;
}

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const finite = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** Money of one window from the three database sums (null sums = nothing in the window). */
export function foldRangeFinancials(
  range: AnalyticsDateRange,
  sums: {
    readonly revenue: number | null | undefined;
    readonly refunds: number | null | undefined;
    readonly expenses: number | null | undefined;
  }
): RangeFinancials {
  const totalRevenue = roundMoney(finite(sums.revenue));
  const totalRefunds = roundMoney(finite(sums.refunds));
  const totalExpenses = roundMoney(finite(sums.expenses));
  const netRevenue = roundMoney(totalRevenue - totalRefunds);
  return {
    totalRevenue,
    totalRefunds,
    netRevenue,
    totalExpenses,
    netProfit: roundMoney(netRevenue - totalExpenses),
    from: range.from.toISOString(),
    to: range.to.toISOString(),
  };
}
