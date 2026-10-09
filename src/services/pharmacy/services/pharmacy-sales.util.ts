/**
 * Pure helpers of the pharmacy dashboard figures and the sales report: IST period windows and
 * the aggregation of dispensed items and paid invoices. Money is summed in integer paise.
 */
import { formatDateKeyInIST } from '@utils/date-time.util';

export type StatsPeriod = 'day' | 'week' | 'month' | 'year';
export const STATS_PERIODS: readonly StatsPeriod[] = ['day', 'week', 'month', 'year'];
export const DEFAULT_STATS_PERIOD: StatsPeriod = 'month';

export type SalesGroupBy = 'day' | 'medicine';
export const SALES_GROUP_BY: readonly SalesGroupBy[] = ['day', 'medicine'];

/** The longest window a sales report may cover. */
export const MAX_SALES_RANGE_DAYS = 366;

export interface DateRange {
  /** Inclusive start. */
  from: Date;
  /** Exclusive end. */
  to: Date;
}

const DAY_MS = 86_400_000;

/** Midnight (IST) of an IST calendar day key (YYYY-MM-DD). */
export function istDayStart(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00+05:30`);
}

const toPaise = (rupees: number): number => Math.round(rupees * 100);

/**
 * The window of a dashboard period, ending now. day = today (IST), week = the last 7 days
 * including today, month = this calendar month so far, year = this calendar year so far.
 */
export function resolvePeriodRange(period: StatsPeriod, now: Date = new Date()): DateRange {
  const todayKey = formatDateKeyInIST(now);
  const today = istDayStart(todayKey);
  const to = new Date(now.getTime() + 1);
  switch (period) {
    case 'day':
      return { from: today, to };
    case 'week':
      return { from: new Date(today.getTime() - 6 * DAY_MS), to };
    case 'year':
      return { from: istDayStart(`${todayKey.slice(0, 4)}-01-01`), to };
    case 'month':
    default:
      return { from: istDayStart(`${todayKey.slice(0, 7)}-01`), to };
  }
}

/** The calendar month so far (IST), the window of `monthlyDispensed`. */
export function currentMonthRange(now: Date = new Date()): DateRange {
  return resolvePeriodRange('month', now);
}

export class SalesRangeError extends Error {}

/**
 * The window of a sales report from `from` / `to` day keys (inclusive, IST). Defaults to the
 * month so far. Rejects an inverted or oversized window.
 */
export function resolveSalesRange(
  from: string | undefined,
  to: string | undefined,
  now: Date = new Date()
): DateRange {
  const defaults = resolvePeriodRange('month', now);
  const start = from ? istDayStart(formatDateKeyInIST(new Date(from))) : defaults.from;
  const end = to
    ? new Date(istDayStart(formatDateKeyInIST(new Date(to))).getTime() + DAY_MS)
    : new Date(istDayStart(formatDateKeyInIST(now)).getTime() + DAY_MS);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new SalesRangeError('from and to must be valid dates.');
  }
  if (start >= end) {
    throw new SalesRangeError('from must not be after to.');
  }
  if ((end.getTime() - start.getTime()) / DAY_MS > MAX_SALES_RANGE_DAYS) {
    throw new SalesRangeError(`The report range may not exceed ${MAX_SALES_RANGE_DAYS} days.`);
  }
  return { from: start, to: end };
}

export interface DispensedItemRow {
  prescriptionId: string;
  medicineId: string | null;
  medicineName: string | null;
  unitPrice: number;
  dispensedQuantity: number;
  dispensedAt: Date;
}

export interface PaidInvoiceRow {
  paidAt: Date;
  totalAmount: number;
}

export interface SalesTotals {
  prescriptions: number;
  quantity: number;
  /** Rupees collected on paid pharmacy invoices in the window. */
  revenue: number;
}

export interface DaySalesRow {
  date: string;
  prescriptions: number;
  quantity: number;
  revenue: number;
}

export interface MedicineSalesRow {
  medicineId: string | null;
  medicineName: string;
  prescriptions: number;
  quantity: number;
  /** Dispensed quantity x the medicine's current unit price (an estimate, not a ledger figure). */
  revenue: number;
}

export interface SalesReport {
  from: string;
  to: string;
  groupBy: SalesGroupBy;
  totals: SalesTotals;
  breakdown: Array<DaySalesRow | MedicineSalesRow>;
}

function distinctCount(values: Iterable<string>): number {
  return new Set(values).size;
}

/** Aggregates dispensed items and paid invoices of one window into the report body. */
export function buildSalesReport(
  range: DateRange,
  groupBy: SalesGroupBy,
  items: readonly DispensedItemRow[],
  invoices: readonly PaidInvoiceRow[]
): SalesReport {
  const revenuePaise = invoices.reduce((sum, inv) => sum + toPaise(inv.totalAmount), 0);
  const totals: SalesTotals = {
    prescriptions: distinctCount(items.map(i => i.prescriptionId)),
    quantity: items.reduce((sum, i) => sum + i.dispensedQuantity, 0),
    revenue: revenuePaise / 100,
  };
  const breakdown = groupBy === 'day' ? groupByDay(items, invoices) : groupByMedicine(items);
  return {
    from: formatDateKeyInIST(range.from),
    to: formatDateKeyInIST(new Date(range.to.getTime() - 1)),
    groupBy,
    totals,
    breakdown,
  };
}

function groupByDay(
  items: readonly DispensedItemRow[],
  invoices: readonly PaidInvoiceRow[]
): DaySalesRow[] {
  const days = new Map<string, { rx: Set<string>; quantity: number; paise: number }>();
  const bucket = (key: string) => {
    const existing = days.get(key);
    if (existing) return existing;
    const created = { rx: new Set<string>(), quantity: 0, paise: 0 };
    days.set(key, created);
    return created;
  };
  for (const item of items) {
    const day = bucket(formatDateKeyInIST(item.dispensedAt));
    day.rx.add(item.prescriptionId);
    day.quantity += item.dispensedQuantity;
  }
  for (const invoice of invoices) {
    bucket(formatDateKeyInIST(invoice.paidAt)).paise += toPaise(invoice.totalAmount);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      prescriptions: d.rx.size,
      quantity: d.quantity,
      revenue: d.paise / 100,
    }));
}

function groupByMedicine(items: readonly DispensedItemRow[]): MedicineSalesRow[] {
  const medicines = new Map<
    string,
    { id: string | null; name: string; rx: Set<string>; quantity: number; paise: number }
  >();
  for (const item of items) {
    const key = item.medicineId ?? 'unknown';
    const row = medicines.get(key) ?? {
      id: item.medicineId,
      name: item.medicineName ?? 'Unknown medicine',
      rx: new Set<string>(),
      quantity: 0,
      paise: 0,
    };
    row.rx.add(item.prescriptionId);
    row.quantity += item.dispensedQuantity;
    row.paise += item.dispensedQuantity * toPaise(item.unitPrice);
    medicines.set(key, row);
  }
  return [...medicines.values()]
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
    .map(row => ({
      medicineId: row.id,
      medicineName: row.name,
      prescriptions: row.rx.size,
      quantity: row.quantity,
      revenue: row.paise / 100,
    }));
}
