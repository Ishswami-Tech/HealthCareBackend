import { describe, it, expect } from '@jest/globals';
import {
  SalesRangeError,
  buildSalesReport,
  currentMonthRange,
  resolvePeriodRange,
  resolveSalesRange,
} from '@services/pharmacy/services/pharmacy-sales.util';

// 2026-10-15 12:00 IST
const NOW = new Date('2026-10-15T06:30:00.000Z');

describe('pharmacy period windows (IST)', () => {
  it('day starts at IST midnight', () => {
    expect(resolvePeriodRange('day', NOW).from.toISOString()).toBe('2026-10-14T18:30:00.000Z');
  });
  it('week covers the last 7 days including today', () => {
    expect(resolvePeriodRange('week', NOW).from.toISOString()).toBe('2026-10-08T18:30:00.000Z');
  });
  it('month and year start on the 1st (IST)', () => {
    expect(resolvePeriodRange('month', NOW).from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(currentMonthRange(NOW).from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(resolvePeriodRange('year', NOW).from.toISOString()).toBe('2025-12-31T18:30:00.000Z');
  });
});

describe('resolveSalesRange', () => {
  it('is inclusive of the to day', () => {
    const r = resolveSalesRange('2026-10-01', '2026-10-03', NOW);
    expect(r.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-03T18:30:00.000Z');
  });
  it('defaults to the month so far', () => {
    const r = resolveSalesRange(undefined, undefined, NOW);
    expect(r.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-15T18:30:00.000Z');
  });
  it('rejects inverted and oversized windows', () => {
    expect(() => resolveSalesRange('2026-10-05', '2026-10-01', NOW)).toThrow(SalesRangeError);
    expect(() => resolveSalesRange('2024-01-01', '2026-01-01', NOW)).toThrow(/may not exceed/);
  });
});

describe('buildSalesReport', () => {
  const range = resolveSalesRange('2026-10-01', '2026-10-02', NOW);
  const items = [
    {
      prescriptionId: 'rx1',
      medicineId: 'm1',
      medicineName: 'Paracetamol',
      unitPrice: 2.5,
      dispensedQuantity: 10,
      dispensedAt: new Date('2026-10-01T05:00:00Z'),
    },
    {
      prescriptionId: 'rx1',
      medicineId: 'm2',
      medicineName: 'Cough syrup',
      unitPrice: 80,
      dispensedQuantity: 1,
      dispensedAt: new Date('2026-10-01T05:00:00Z'),
    },
    {
      prescriptionId: 'rx2',
      medicineId: 'm1',
      medicineName: 'Paracetamol',
      unitPrice: 2.5,
      dispensedQuantity: 20,
      dispensedAt: new Date('2026-10-02T05:00:00Z'),
    },
  ];
  const invoices = [
    { paidAt: new Date('2026-10-01T06:00:00Z'), totalAmount: 105.1 },
    { paidAt: new Date('2026-10-02T06:00:00Z'), totalAmount: 50.2 },
  ];

  it('totals count distinct prescriptions, units and paid revenue', () => {
    const report = buildSalesReport(range, 'day', items, invoices);
    expect(report.totals).toEqual({ prescriptions: 2, quantity: 31, revenue: 155.3 });
    expect(report.from).toBe('2026-10-01');
    expect(report.to).toBe('2026-10-02');
  });

  it('groups by day, ordered', () => {
    const { breakdown } = buildSalesReport(range, 'day', items, invoices);
    expect(breakdown).toEqual([
      { date: '2026-10-01', prescriptions: 1, quantity: 11, revenue: 105.1 },
      { date: '2026-10-02', prescriptions: 1, quantity: 20, revenue: 50.2 },
    ]);
  });

  it('groups by medicine, best seller first', () => {
    const { breakdown } = buildSalesReport(range, 'medicine', items, invoices);
    expect(breakdown).toEqual([
      {
        medicineId: 'm1',
        medicineName: 'Paracetamol',
        prescriptions: 2,
        quantity: 30,
        revenue: 75,
      },
      { medicineId: 'm2', medicineName: 'Cough syrup', prescriptions: 1, quantity: 1, revenue: 80 },
    ]);
  });

  it('an empty window yields zero totals', () => {
    const report = buildSalesReport(range, 'day', [], []);
    expect(report.totals).toEqual({ prescriptions: 0, quantity: 0, revenue: 0 });
    expect(report.breakdown).toEqual([]);
  });
});
