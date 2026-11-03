/**
 * GET /billing/invoices/clinic list modes (pure, no Nest imports).
 *
 * The route used to return EVERY invoice of the clinic, decorated (patient contact, items,
 * balances): hundreds of kB and a slow p95 under load. Two modes now:
 *
 * - `?page=` (1-based) with optional `limit` (default 25, max 100) and filters `status`
 *   (PENDING | PAID | VOID), `q` (invoice number, patient name or phone), `dateFrom` / `dateTo`
 *   (IST days, inclusive, on createdAt): `{ data, total, page, limit, counts }`, newest first.
 *   `counts` are per status for the same filters without `status` (the status chips).
 * - no `page` (legacy clients): the bare array, but only the newest
 *   LEGACY_CLINIC_INVOICE_LIMIT rows; X-Total-Count / X-Truncated tell a client to switch to
 *   `?page=` (same pattern as the legacy prescription list).
 */

/** Newest invoices returned by the legacy (no `page`) list. */
export const LEGACY_CLINIC_INVOICE_LIMIT = 200;
export const CLINIC_INVOICE_PAGE_DEFAULT_LIMIT = 25;
export const CLINIC_INVOICE_PAGE_MAX_LIMIT = 100;
/** Statuses an invoice can have (InvoiceStatus). */
export const CLINIC_INVOICE_STATUSES = ['PENDING', 'PAID', 'VOID'] as const;
/** Query parameters that change the response (part of the HTTP cache key). */
export const CLINIC_INVOICE_QUERY_KEYS = [
  'page',
  'limit',
  'status',
  'q',
  'dateFrom',
  'dateTo',
] as const;

const MAX_SEARCH_LENGTH = 100;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export type ClinicInvoiceStatus = (typeof CLINIC_INVOICE_STATUSES)[number];

export interface ClinicInvoicePageQuery {
  readonly page: number;
  readonly limit: number;
  readonly status?: ClinicInvoiceStatus;
  readonly q?: string;
  /** Inclusive IST day bounds as instants (createdAt >= from, createdAt <= to). */
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
}

export type ClinicInvoiceListQuery =
  { readonly mode: 'legacy' } | ({ readonly mode: 'page' } & ClinicInvoicePageQuery);

export type ClinicInvoiceQueryResult =
  | { readonly ok: true; readonly query: ClinicInvoiceListQuery }
  | { readonly ok: false; readonly message: string };

export interface ClinicInvoiceStatusCounts {
  readonly all: number;
  readonly PENDING: number;
  readonly PAID: number;
  readonly VOID: number;
}

export interface ClinicInvoicePage<T> {
  readonly data: T[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly counts: ClinicInvoiceStatusCounts;
}

export interface LegacyClinicInvoiceList<T> {
  readonly data: T[];
  readonly total: number;
  readonly truncated: boolean;
}

type RawQuery = Readonly<Record<string, unknown>> | undefined;

function single(value: unknown): string | undefined {
  const first = Array.isArray(value) ? (value as unknown[])[0] : value;
  if (typeof first !== 'string' && typeof first !== 'number') return undefined;
  const text = String(first).trim();
  return text.length > 0 ? text : undefined;
}

function positiveInt(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

function istDayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000+05:30`);
}

function istDayEnd(day: string): Date {
  return new Date(`${day}T23:59:59.999+05:30`);
}

function isValidDay(day: string): boolean {
  return DAY_KEY.test(day) && !Number.isNaN(istDayStart(day).getTime());
}

/** Validates the query; a refusal carries the 400 message. */
export function parseClinicInvoiceQuery(raw: RawQuery): ClinicInvoiceQueryResult {
  const pageText = single(raw?.['page']);
  if (pageText === undefined) return { ok: true, query: { mode: 'legacy' } };

  const page = positiveInt(pageText);
  if (page === null || !Number.isInteger(page) || page < 1) {
    return { ok: false, message: 'page must be a positive integer' };
  }
  const limitValue = positiveInt(single(raw?.['limit']));
  const limit = limitValue === null ? CLINIC_INVOICE_PAGE_DEFAULT_LIMIT : limitValue;
  if (!Number.isInteger(limit) || limit < 1 || limit > CLINIC_INVOICE_PAGE_MAX_LIMIT) {
    return {
      ok: false,
      message: `limit must be an integer between 1 and ${CLINIC_INVOICE_PAGE_MAX_LIMIT}`,
    };
  }

  const statusText = single(raw?.['status'])?.toUpperCase();
  if (statusText && !(CLINIC_INVOICE_STATUSES as readonly string[]).includes(statusText)) {
    return { ok: false, message: `status must be one of ${CLINIC_INVOICE_STATUSES.join(', ')}` };
  }
  const q = single(raw?.['q']);
  if (q && q.length > MAX_SEARCH_LENGTH) {
    return { ok: false, message: `q must be at most ${MAX_SEARCH_LENGTH} characters` };
  }
  const dateFrom = single(raw?.['dateFrom']);
  const dateTo = single(raw?.['dateTo']);
  if ((dateFrom && !isValidDay(dateFrom)) || (dateTo && !isValidDay(dateTo))) {
    return { ok: false, message: 'dateFrom / dateTo must be YYYY-MM-DD' };
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return { ok: false, message: 'dateFrom must not be after dateTo' };
  }

  return {
    ok: true,
    query: {
      mode: 'page',
      page,
      limit,
      ...(statusText ? { status: statusText as ClinicInvoiceStatus } : {}),
      ...(q ? { q } : {}),
      ...(dateFrom ? { createdFrom: istDayStart(dateFrom) } : {}),
      ...(dateTo ? { createdTo: istDayEnd(dateTo) } : {}),
    },
  };
}

/** Status chip counts from a `groupBy(status)` result. */
export function clinicInvoiceStatusCounts(
  groups: ReadonlyArray<{ readonly status: unknown; readonly count: number }>
): ClinicInvoiceStatusCounts {
  const byStatus = new Map<string, number>();
  for (const group of groups) {
    const key = typeof group.status === 'string' ? group.status.toUpperCase() : '';
    byStatus.set(key, (byStatus.get(key) ?? 0) + Math.max(0, group.count));
  }
  const all = [...byStatus.values()].reduce((sum, count) => sum + count, 0);
  return {
    all,
    PENDING: byStatus.get('PENDING') ?? 0,
    PAID: byStatus.get('PAID') ?? 0,
    VOID: byStatus.get('VOID') ?? 0,
  };
}

/**
 * The legacy query asks for `limit + 1` rows: an extra row means there are more, so the count
 * only runs when the window is actually truncated.
 */
export function sliceLegacyClinicInvoices<T>(
  fetched: readonly T[],
  limit: number = LEGACY_CLINIC_INVOICE_LIMIT
): { readonly rows: T[]; readonly truncated: boolean } {
  const safeLimit = Math.max(1, Math.floor(limit));
  return fetched.length > safeLimit
    ? { rows: fetched.slice(0, safeLimit), truncated: true }
    : { rows: [...fetched], truncated: false };
}

/** Response headers of the legacy list (a cache hit replays the body only). */
export function legacyClinicInvoiceHeaders(
  list: Pick<LegacyClinicInvoiceList<unknown>, 'total' | 'truncated'>
): Readonly<Record<'X-Total-Count' | 'X-Truncated', string>> {
  return {
    'X-Total-Count': String(Math.max(0, list.total)),
    'X-Truncated': list.truncated ? 'true' : 'false',
  };
}
