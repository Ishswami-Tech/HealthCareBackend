/**
 * Query Middleware Chain
 * @class QueryMiddlewareChain
 * @description Chain of Responsibility pattern for query middleware
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable } from '@nestjs/common';
import type { IQueryMiddleware, QueryMiddlewareContext } from './query-middleware.interface';
import { ValidationQueryMiddleware } from './validation-query.middleware';
import { SecurityQueryMiddleware } from './security-query.middleware';
import { OptimizationQueryMiddleware } from './optimization-query.middleware';
import { MetricsQueryMiddleware } from './metrics-query.middleware';

/**
 * Query middleware chain - executes middleware in order
 */
@Injectable()
export class QueryMiddlewareChain {
  private firstMiddleware?: IQueryMiddleware;

  constructor(
    private readonly validationMiddleware: ValidationQueryMiddleware,
    private readonly securityMiddleware: SecurityQueryMiddleware,
    private readonly optimizationMiddleware: OptimizationQueryMiddleware,
    private readonly metricsMiddleware: MetricsQueryMiddleware
  ) {
    // Build chain: Validation -> Security -> Optimization -> Metrics
    this.validationMiddleware.setNext(this.securityMiddleware);
    this.securityMiddleware.setNext(this.optimizationMiddleware);
    this.optimizationMiddleware.setNext(this.metricsMiddleware);
    this.firstMiddleware = this.validationMiddleware;
  }

  /**
   * Execute middleware chain before query
   */
  async before(context: QueryMiddlewareContext): Promise<QueryMiddlewareContext> {
    if (!this.firstMiddleware) {
      return context;
    }
    return this.firstMiddleware.before(context);
  }

  /**
   * Execute middleware chain after query
   */
  async after<T>(context: QueryMiddlewareContext, result: T): Promise<T> {
    if (!this.firstMiddleware) {
      return result;
    }
    return this.firstMiddleware.after(context, result);
  }

  /**
   * Execute middleware chain on error
   */
  async onError(context: QueryMiddlewareContext, error: Error): Promise<Error> {
    if (!this.firstMiddleware) {
      return error;
    }
    return this.firstMiddleware.onError(context, error);
  }
}
