/**
 * Query Utilities for Healthcare Applications
 *
 * Provides reusable query building utilities following DRY principles
 * for common database query patterns in healthcare applications.
 *
 * @fileoverview Query utilities for healthcare database operations
 * @description Reusable query building functions and interfaces
 * @version 1.0.0
 * @author Healthcare Backend Team
 * @since 2024
 */

/**
 * Base where clause with common fields
 *
 * @interface BaseWhereClause
 * @description Common fields used in database where clauses
 */
export interface BaseWhereClause {
  clinicId?: string;
  userId?: string;
  createdAt?: {
    gte?: Date;
    lte?: Date;
  };
  updatedAt?: {
    gte?: Date;
    lte?: Date;
  };
}

/**
 * Pagination parameters
 *
 * @interface PaginationParams
 * @description Parameters for paginating database queries
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  skip?: number;
  take?: number;
}

/**
 * Date range filter parameters
 *
 * @interface DateRangeParams
 * @description Parameters for filtering by date ranges
 */
export interface DateRangeParams {
  dateFrom?: Date | string;
  dateTo?: Date | string;
}

/**
 * Interface for date range where clause
 */
interface DateRangeWhere {
  gte?: Date;
  lte?: Date;
}

/**
 * Add date range filter to where clause
 *
 * @template T - Type extending base where clause with date fields
 * @param where - Where clause object to modify
 * @param dateFrom - Start date for filtering
 * @param dateTo - End date for filtering
 * @param fieldName - Name of the date field to filter on
 * @returns Modified where clause with date range filter
 *
 * @description Adds date range filtering to a where clause object.
 * Follows DRY principle by centralizing date range logic.
 *
 * @example
 * ```typescript
 * const where = { clinicId: 'clinic-123' };
 * const filteredWhere = addDateRangeFilter(
 *   where,
 *   '2024-01-01',
 *   '2024-12-31',
 *   'createdAt'
 * );
 * // Returns: { clinicId: 'clinic-123', createdAt: { gte: Date, lte: Date } }
 * ```
 */
export function addDateRangeFilter<
  T extends {
    createdAt?: DateRangeWhere;
    updatedAt?: DateRangeWhere;
    recordedAt?: DateRangeWhere;
    date?: DateRangeWhere;
  },
>(
  where: T,
  dateFrom?: Date | string,
  dateTo?: Date | string,
  fieldName: 'createdAt' | 'updatedAt' | 'recordedAt' | 'date' = 'createdAt'
): T {
  const hasDateFilter = dateFrom || dateTo;

  if (!hasDateFilter) {
    return where;
  }

  // Convert string dates to Date objects
  const fromDate = dateFrom instanceof Date ? dateFrom : dateFrom ? new Date(dateFrom) : undefined;
  const toDate = dateTo instanceof Date ? dateTo : dateTo ? new Date(dateTo) : undefined;

  // Add date range to where clause
  const whereWithDate = where as T & Record<string, DateRangeWhere>;
  whereWithDate[fieldName] = {};
  if (fromDate) {
    whereWithDate[fieldName].gte = fromDate;
  }
  if (toDate) {
    whereWithDate[fieldName].lte = toDate;
  }

  return whereWithDate as T;
}

/**
 * Calculate pagination values
 *
 * @param params - Pagination parameters
 * @returns Object containing calculated pagination values
 *
 * @description Calculates pagination values from input parameters.
 * Follows DRY principle by centralizing pagination logic.
 *
 * @example
 * ```typescript
 * const pagination = calculatePagination({ page: 2, limit: 20 });
 * // Returns: { skip: 20, take: 20, page: 2 }
 * ```
 */
export function calculatePagination(params: PaginationParams): {
  skip: number;
  take: number;
  page: number;
} {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 10)); // Max 100, min 1
  const skip = params.skip !== undefined ? params.skip : (page - 1) * limit;
  const take = params.take !== undefined ? params.take : limit;

  return {
    skip,
    take,
    page,
  };
}

/**
 * Build pagination metadata
 *
 * @param total - Total number of items
 * @param page - Current page number
 * @param limit - Items per page
 * @returns Object containing pagination metadata
 *
 * @description Builds comprehensive pagination metadata including
 * total pages, navigation flags, and current page information.
 *
 * @example
 * ```typescript
 * const meta = buildPaginationMeta(150, 3, 20);
 * // Returns: { total: 150, page: 3, limit: 20, totalPages: 8, hasNext: true, hasPrev: true }
 * ```
 */
export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number
): {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
} {
  const totalPages = Math.ceil(total / limit);

  return {
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Add string filter (contains, case-insensitive)
 *
 * @template T - Type of where clause object
 * @param where - Where clause object to modify
 * @param fieldName - Name of the field to filter on
 * @param searchTerm - Search term to filter by
 * @returns Modified where clause with string filter
 *
 * @description Adds case-insensitive string filtering to a where clause.
 * Follows DRY principle by centralizing string search logic.
 *
 * @example
 * ```typescript
 * const where = { clinicId: 'clinic-123' };
 * const filteredWhere = addStringFilter(where, 'name', 'john');
 * // Returns: { clinicId: 'clinic-123', name: { contains: 'john', mode: 'insensitive' } }
 * ```
 */
export function addStringFilter<T extends Record<string, unknown>>(
  where: T,
  fieldName: string,
  searchTerm?: string
): T {
  if (!searchTerm) {
    return where;
  }

  const whereWithString = where as T & Record<string, { contains: string; mode: string }>;
  (whereWithString as Record<string, { contains: string; mode: string }>)[fieldName] = {
    contains: searchTerm,
    mode: 'insensitive',
  };

  return whereWithString as T;
}

/**
 * Build order by clause
 *
 * @param sortBy - Field name to sort by
 * @param sortOrder - Sort order (asc or desc)
 * @returns Order by clause object or undefined
 *
 * @description Builds an order by clause for database queries.
 * Returns undefined if no sort field is specified.
 *
 * @example
 * ```typescript
 * const orderBy = buildOrderBy('createdAt', 'desc');
 * // Returns: { createdAt: 'desc' }
 *
 * const noOrder = buildOrderBy();
 * // Returns: undefined
 * ```
 */
export function buildOrderBy(
  sortBy?: string,
  sortOrder: 'asc' | 'desc' = 'desc'
): Record<string, 'asc' | 'desc'> | undefined {
  if (!sortBy) {
    return undefined;
  }

  return {
    [sortBy]: sortOrder,
  };
}

/**
 * Extract search terms from query string
 *
 * @param terms - Comma-separated search terms
 * @returns Array of trimmed search terms or undefined
 *
 * @description Parses comma-separated search terms and returns
 * an array of trimmed, non-empty terms.
 *
 * @example
 * ```typescript
 * const terms = parseSearchTerms('john, doe, smith');
 * // Returns: ['john', 'doe', 'smith']
 *
 * const empty = parseSearchTerms();
 * // Returns: undefined
 * ```
 */
export function parseSearchTerms(terms?: string): string[] | undefined {
  if (!terms) {
    return undefined;
  }

  return terms
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

/**
 * Common select fields for user data (privacy-safe)
 *
 * @description Standard fields to select when querying user data
 * while maintaining privacy and security.
 */
export const USER_SELECT_FIELDS = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
} as const;

/**
 * Common select fields for user data (minimal)
 *
 * @description Minimal fields to select when querying user data
 * for basic display purposes.
 */
export const USER_SELECT_MINIMAL = {
  id: true,
  firstName: true,
  lastName: true,
} as const;
