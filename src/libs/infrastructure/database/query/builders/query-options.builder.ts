/**
 * Query Options Builder
 * @class QueryOptionsBuilder
 * @description Builder pattern for constructing query options
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import type { QueryOptions } from '@core/types/database.types';

/**
 * Builder for query operation options
 */
export class QueryOptionsBuilder {
  private options: Partial<QueryOptions> = {};

  /**
   * Set pagination
   */
  pagination(page: number, limit: number): this {
    this.options.page = page;
    this.options.limit = limit;
    return this;
  }

  /**
   * Set order by
   */
  orderBy(orderBy: Record<string, 'asc' | 'desc'>): this {
    this.options.orderBy = orderBy;
    return this;
  }

  /**
   * Set where clause
   */
  where(where: Record<string, unknown>): this {
    this.options.where = where;
    return this;
  }

  /**
   * Set include relations
   */
  include(include: Record<string, unknown>): this {
    this.options.include = include;
    return this;
  }

  /**
   * Set select fields
   */
  select(select: Record<string, boolean>): this {
    this.options.select = select;
    return this;
  }

  /**
   * Set clinic ID
   */
  clinicId(clinicId: string): this {
    this.options.clinicId = clinicId;
    return this;
  }

  /**
   * Set user ID
   */
  userId(userId: string): this {
    this.options.userId = userId;
    return this;
  }

  /**
   * Enable HIPAA compliance
   */
  hipaaCompliant(compliant = true): this {
    this.options.hipaaCompliant = compliant;
    return this;
  }

  /**
   * Enable audit logging
   */
  auditRequired(required = true): this {
    this.options.auditRequired = required;
    return this;
  }

  /**
   * Set cache strategy
   */
  cacheStrategy(strategy: 'none' | 'short' | 'long' | 'never'): this {
    this.options.cacheStrategy = strategy;
    return this;
  }

  /**
   * Set priority
   */
  priority(priority: 'low' | 'normal' | 'high' | 'critical'): this {
    this.options.priority = priority;
    return this;
  }

  /**
   * Set timeout
   */
  timeout(timeout: number): this {
    this.options.timeout = timeout;
    return this;
  }

  /**
   * Set retries
   */
  retries(retries: number): this {
    this.options.retries = retries;
    return this;
  }

  /**
   * Enable row-level security
   */
  rowLevelSecurity(enabled = true): this {
    this.options.rowLevelSecurity = enabled;
    return this;
  }

  /**
   * Enable data masking
   */
  dataMasking(enabled = true): this {
    this.options.dataMasking = enabled;
    return this;
  }

  /**
   * Enable encryption
   */
  encryptionRequired(required = true): this {
    this.options.encryptionRequired = required;
    return this;
  }

  /**
   * Set indexes to use
   */
  useIndex(indexes: string[]): this {
    this.options.useIndex = indexes;
    return this;
  }

  /**
   * Force specific indexes
   */
  forceIndex(indexes: string[]): this {
    this.options.forceIndex = indexes;
    return this;
  }

  /**
   * Enable query explanation
   */
  explain(enable = true): this {
    this.options.explain = enable;
    return this;
  }

  /**
   * Set batch size
   */
  batchSize(size: number): this {
    this.options.batchSize = size;
    return this;
  }

  /**
   * Enable/disable cache
   */
  useCache(use = true): this {
    this.options.useCache = use;
    return this;
  }

  /**
   * Build query options
   */
  build(): QueryOptions {
    // IMPORTANT:
    // QueryOptionsBuilder is injected and shared across services.
    // If we don't reset after build, options can leak between calls (stale where/include/select),
    // causing incorrect caching keys and even incorrect query behavior.
    const built = { ...this.options } as QueryOptions;
    this.reset();
    return built;
  }

  /**
   * Reset builder
   */
  reset(): this {
    this.options = {};
    return this;
  }
}
