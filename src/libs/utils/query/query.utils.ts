/**
 * Query Utilities - DRY principles for common query patterns
 * Following SOLID and DRY principles
 */

/**
 * Base where clause with common fields
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
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  skip?: number;
  take?: number;
}

/**
 * Date range filter parameters
 */
export interface DateRangeParams {
  dateFrom?: Date | string;
  dateTo?: Date | string;
}

/**
 * Add date range filter to where clause
 * DRY principle - centralize date range logic
 */
export function addDateRangeFilter<
  T extends { createdAt?: { gte?: Date; lte?: Date } },
>(
  where: T,
  dateFrom?: Date | string,
  dateTo?: Date | string,
  fieldName: "createdAt" | "updatedAt" | "recordedAt" | "date" = "createdAt",
): T {
  const hasDateFilter = dateFrom || dateTo;

  if (!hasDateFilter) {
    return where;
  }

  // Convert string dates to Date objects
  const fromDate =
    dateFrom instanceof Date
      ? dateFrom
      : dateFrom
        ? new Date(dateFrom)
        : undefined;
  const toDate =
    dateTo instanceof Date ? dateTo : dateTo ? new Date(dateTo) : undefined;

  // Add date range to where clause
  (where as any)[fieldName] = {};
  if (fromDate) {
    (where as any)[fieldName].gte = fromDate;
  }
  if (toDate) {
    (where as any)[fieldName].lte = toDate;
  }

  return where;
}

/**
 * Calculate pagination values
 * DRY principle - centralize pagination logic
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
 */
export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number,
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
 * DRY principle - centralize string search logic
 */
export function addStringFilter<T>(
  where: T,
  fieldName: string,
  searchTerm?: string,
): T {
  if (!searchTerm) {
    return where;
  }

  (where as any)[fieldName] = {
    contains: searchTerm,
    mode: "insensitive",
  };

  return where;
}

/**
 * Build order by clause
 */
export function buildOrderBy(
  sortBy?: string,
  sortOrder: "asc" | "desc" = "desc",
): Record<string, "asc" | "desc"> | undefined {
  if (!sortBy) {
    return undefined;
  }

  return {
    [sortBy]: sortOrder,
  };
}

/**
 * Extract search terms from query string
 * Handles comma-separated values
 */
export function parseSearchTerms(terms?: string): string[] | undefined {
  if (!terms) {
    return undefined;
  }

  return terms
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Common select fields for user data (privacy-safe)
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
 */
export const USER_SELECT_MINIMAL = {
  id: true,
  firstName: true,
  lastName: true,
} as const;
