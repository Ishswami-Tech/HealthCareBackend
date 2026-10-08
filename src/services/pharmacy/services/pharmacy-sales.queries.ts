/**
 * Database reads behind the pharmacy dashboard figures and the sales report. Everything is
 * clinic scoped. "Dispensed" means a prescription item with a dispensedAt inside the window;
 * revenue is the total of PAID pharmacy invoices whose paidAt falls inside the window.
 */
import { BadRequestException } from '@nestjs/common';
import type { DatabaseService } from '@infrastructure/database';
import {
  buildSalesReport,
  currentMonthRange,
  resolvePeriodRange,
  resolveSalesRange,
  SalesRangeError,
  type DateRange,
  type DispensedItemRow,
  type PaidInvoiceRow,
  type SalesGroupBy,
  type SalesReport,
  type StatsPeriod,
} from './pharmacy-sales.util';

/** Most dispensed items one report may read; a larger window must be narrowed. */
export const MAX_SALES_ITEMS = 20_000;

export interface PharmacyDashboardMetrics {
  totalRevenue: number;
  topSellingMedicine: string | null;
  monthlyDispensed: number;
}

interface SalesClient {
  invoice: {
    aggregate: (args: unknown) => Promise<{ _sum: { totalAmount: number | null } }>;
    findMany: (args: unknown) => Promise<PaidInvoiceRow[]>;
  };
  prescriptionItem: {
    groupBy: (
      args: unknown
    ) => Promise<Array<{ medicineId: string | null; _sum: { dispensedQuantity: number | null } }>>;
    findMany: (args: unknown) => Promise<
      Array<{
        prescriptionId: string;
        medicineId: string | null;
        dispensedQuantity: number;
        dispensedAt: Date | null;
        medicine: { name: string; price: number } | null;
      }>
    >;
  };
  medicine: {
    findFirst: (args: unknown) => Promise<{ name: string } | null>;
  };
}

const dispensedWhere = (clinicId: string, range: DateRange) => ({
  clinicId,
  dispensedQuantity: { gt: 0 },
  dispensedAt: { gte: range.from, lt: range.to },
});

const paidInvoiceWhere = (clinicId: string, range: DateRange) => ({
  clinicId,
  billType: 'PHARMACY',
  status: 'PAID',
  paidAt: { gte: range.from, lt: range.to },
});

/** Revenue, best seller (by dispensed units) of the period and prescriptions dispensed this month. */
export async function loadDashboardMetrics(
  databaseService: DatabaseService,
  clinicId: string,
  period: StatsPeriod,
  now: Date = new Date()
): Promise<PharmacyDashboardMetrics> {
  const range = resolvePeriodRange(period, now);
  const month = currentMonthRange(now);

  return await databaseService.executeHealthcareRead(async client => {
    const db = client as unknown as SalesClient;
    const [revenue, topRows, monthItems] = await Promise.all([
      db.invoice.aggregate({
        where: paidInvoiceWhere(clinicId, range),
        _sum: { totalAmount: true },
      }),
      db.prescriptionItem.groupBy({
        by: ['medicineId'],
        where: { ...dispensedWhere(clinicId, range), medicineId: { not: null } },
        _sum: { dispensedQuantity: true },
        orderBy: { _sum: { dispensedQuantity: 'desc' } },
        take: 1,
      }),
      db.prescriptionItem.findMany({
        where: dispensedWhere(clinicId, month),
        distinct: ['prescriptionId'],
        select: { prescriptionId: true },
      }),
    ]);

    const topId = topRows[0]?.medicineId ?? null;
    const top = topId
      ? await db.medicine.findFirst({ where: { id: topId, clinicId }, select: { name: true } })
      : null;

    return {
      totalRevenue: Math.round((revenue._sum.totalAmount ?? 0) * 100) / 100,
      topSellingMedicine: top?.name ?? null,
      monthlyDispensed: monthItems.length,
    };
  });
}

/** Dispensed totals with a per-day or per-medicine breakdown for `from`..`to` (IST, inclusive). */
export async function loadSalesReport(
  databaseService: DatabaseService,
  clinicId: string,
  query: { from?: string; to?: string; groupBy: SalesGroupBy },
  now: Date = new Date()
): Promise<SalesReport> {
  let range: DateRange;
  try {
    range = resolveSalesRange(query.from, query.to, now);
  } catch (error) {
    if (error instanceof SalesRangeError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }

  const { items, invoices } = await databaseService.executeHealthcareRead(async client => {
    const db = client as unknown as SalesClient;
    const [itemRows, invoiceRows] = await Promise.all([
      db.prescriptionItem.findMany({
        where: dispensedWhere(clinicId, range),
        select: {
          prescriptionId: true,
          medicineId: true,
          dispensedQuantity: true,
          dispensedAt: true,
          medicine: { select: { name: true, price: true } },
        },
        take: MAX_SALES_ITEMS + 1,
      }),
      db.invoice.findMany({
        where: paidInvoiceWhere(clinicId, range),
        select: { paidAt: true, totalAmount: true },
      }),
    ]);
    return { items: itemRows, invoices: invoiceRows };
  });

  if (items.length > MAX_SALES_ITEMS) {
    throw new BadRequestException(
      'Too many dispensed items in this range for one report. Narrow the date range.'
    );
  }

  const dispensed: DispensedItemRow[] = items.flatMap(item =>
    item.dispensedAt
      ? [
          {
            prescriptionId: item.prescriptionId,
            medicineId: item.medicineId,
            medicineName: item.medicine?.name ?? null,
            unitPrice: item.medicine?.price ?? 0,
            dispensedQuantity: item.dispensedQuantity,
            dispensedAt: item.dispensedAt,
          },
        ]
      : []
  );
  const paid = invoices.filter(invoice => invoice.paidAt instanceof Date);

  return buildSalesReport(range, query.groupBy, dispensed, paid);
}
