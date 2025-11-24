/**
 * Base Query Middleware
 * @class BaseQueryMiddleware
 * @description Base implementation for query middleware
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import type { IQueryMiddleware, QueryMiddlewareContext } from './query-middleware.interface';

// Re-export for convenience
export type { QueryMiddlewareContext } from './query-middleware.interface';

/**
 * Base query middleware with chain support
 */
export abstract class BaseQueryMiddleware implements IQueryMiddleware {
  protected nextMiddleware?: IQueryMiddleware;

  setNext(middleware: IQueryMiddleware): void {
    this.nextMiddleware = middleware;
  }

  async before(context: QueryMiddlewareContext): Promise<QueryMiddlewareContext> {
    const processed = await this.processBefore(context);
    if (this.nextMiddleware) {
      return this.nextMiddleware.before?.(processed) ?? processed;
    }
    return processed;
  }

  async after<T>(context: QueryMiddlewareContext, result: T): Promise<T> {
    const processed = await this.processAfter(context, result);
    if (this.nextMiddleware) {
      return this.nextMiddleware.after?.(context, processed) ?? processed;
    }
    return processed;
  }

  async onError(context: QueryMiddlewareContext, error: Error): Promise<Error> {
    const processed = await this.processError(context, error);
    if (this.nextMiddleware) {
      return this.nextMiddleware.onError?.(context, processed) ?? processed;
    }
    return processed;
  }

  protected abstract processBefore(
    context: QueryMiddlewareContext
  ): Promise<QueryMiddlewareContext> | QueryMiddlewareContext;

  protected abstract processAfter<T>(context: QueryMiddlewareContext, result: T): Promise<T> | T;

  protected abstract processError(
    context: QueryMiddlewareContext,
    error: Error
  ): Promise<Error> | Error;
}
