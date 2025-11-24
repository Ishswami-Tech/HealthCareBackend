/**
 * Query Middleware Interface
 * @interface IQueryMiddleware
 * @description Interface for query middleware (Chain of Responsibility pattern)
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import type { QueryOptions } from '@core/types/database.types';

/**
 * Query middleware context
 */
export interface QueryMiddlewareContext {
  operation: string;
  options: QueryOptions;
  clinicId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  startTime: number;
}

/**
 * Query middleware interface
 */
export interface IQueryMiddleware {
  setNext(middleware: IQueryMiddleware): void;
  before(context: QueryMiddlewareContext): Promise<QueryMiddlewareContext> | QueryMiddlewareContext;
  after<T>(context: QueryMiddlewareContext, result: T): Promise<T> | T;
  onError(context: QueryMiddlewareContext, error: Error): Promise<Error> | Error;
}
