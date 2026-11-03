import { describe, expect, it } from '@jest/globals';
import {
  CLINIC_INVOICE_PAGE_DEFAULT_LIMIT,
  clinicInvoiceStatusCounts,
  legacyClinicInvoiceHeaders,
  parseClinicInvoiceQuery,
  sliceLegacyClinicInvoices,
} from '@services/billing/clinic-invoice-list.util';

describe('parseClinicInvoiceQuery', () => {
  it('no page is the legacy list (other params ignored)', () => {
    expect(parseClinicInvoiceQuery(undefined)).toEqual({ ok: true, query: { mode: 'legacy' } });
    expect(parseClinicInvoiceQuery({ limit: '5', status: 'nope' })).toEqual({
      ok: true,
      query: { mode: 'legacy' },
    });
  });

  it('page with defaults and filters (IST day bounds)', () => {
    const parsed = parseClinicInvoiceQuery({
      page: '2',
      status: 'paid',
      q: ' INV-1 ',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-22',
    });
    expect(parsed).toEqual({
      ok: true,
      query: {
        mode: 'page',
        page: 2,
        limit: CLINIC_INVOICE_PAGE_DEFAULT_LIMIT,
        status: 'PAID',
        q: 'INV-1',
        createdFrom: new Date('2026-09-30T18:30:00.000Z'),
        createdTo: new Date('2026-10-22T18:29:59.999Z'),
      },
    });
  });

  it.each([
    [{ page: '0' }, 'page must be a positive integer'],
    [{ page: 'x' }, 'page must be a positive integer'],
    [{ page: '1', limit: '101' }, 'limit must be an integer between 1 and 100'],
    [{ page: '1', limit: '0' }, 'limit must be an integer between 1 and 100'],
    [{ page: '1', status: 'REFUNDED' }, 'status must be one of PENDING, PAID, VOID'],
    [{ page: '1', dateFrom: '22-10-2026' }, 'dateFrom / dateTo must be YYYY-MM-DD'],
    [
      { page: '1', dateFrom: '2026-10-22', dateTo: '2026-10-01' },
      'dateFrom must not be after dateTo',
    ],
    [{ page: '1', q: 'x'.repeat(101) }, 'q must be at most 100 characters'],
  ])('refuses %j', (raw, message) => {
    expect(parseClinicInvoiceQuery(raw)).toEqual({ ok: false, message });
  });

  it('accepts limit 100', () => {
    const parsed = parseClinicInvoiceQuery({ page: '1', limit: '100' });
    expect(parsed.ok && parsed.query.mode === 'page' && parsed.query.limit).toBe(100);
  });
});

describe('legacy window, headers and counts', () => {
  it('slices limit + 1 rows into the window and the truncated flag', () => {
    expect(sliceLegacyClinicInvoices([1, 2, 3], 2)).toEqual({ rows: [1, 2], truncated: true });
    expect(sliceLegacyClinicInvoices([1, 2], 2)).toEqual({ rows: [1, 2], truncated: false });
  });

  it('headers carry the total and the truncation', () => {
    expect(legacyClinicInvoiceHeaders({ total: 384, truncated: true })).toEqual({
      'X-Total-Count': '384',
      'X-Truncated': 'true',
    });
  });

  it('status counts', () => {
    expect(
      clinicInvoiceStatusCounts([
        { status: 'PENDING', count: 3 },
        { status: 'PAID', count: 5 },
      ])
    ).toEqual({ all: 8, PENDING: 3, PAID: 5, VOID: 0 });
  });
});
