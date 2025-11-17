/**
 * Base Cache Middleware
 * @class BaseCacheMiddleware
 * @description Base implementation for cache middleware
 */

import type { ICacheMiddleware, CacheMiddlewareContext } from './cache-middleware.interface';

/**
 * Base cache middleware with chain support
 */
export abstract class BaseCacheMiddleware implements ICacheMiddleware {
  protected nextMiddleware?: ICacheMiddleware;

  setNext(middleware: ICacheMiddleware): void {
    this.nextMiddleware = middleware;
  }

  async before(context: CacheMiddlewareContext): Promise<CacheMiddlewareContext> {
    const processed = await this.processBefore(context);
    if (this.nextMiddleware) {
      return this.nextMiddleware.before?.(processed) ?? processed;
    }
    return processed;
  }

  async after<T>(context: CacheMiddlewareContext, result: T): Promise<T> {
    const processed = await this.processAfter(context, result);
    if (this.nextMiddleware) {
      return this.nextMiddleware.after?.(context, processed) ?? processed;
    }
    return processed;
  }

  async onError(context: CacheMiddlewareContext, error: Error): Promise<Error> {
    const processed = await this.processError(context, error);
    if (this.nextMiddleware) {
      return this.nextMiddleware.onError?.(context, processed) ?? processed;
    }
    return processed;
  }

  protected abstract processBefore(
    context: CacheMiddlewareContext
  ): Promise<CacheMiddlewareContext> | CacheMiddlewareContext;

  protected abstract processAfter<T>(context: CacheMiddlewareContext, result: T): Promise<T> | T;

  protected abstract processError(
    context: CacheMiddlewareContext,
    error: Error
  ): Promise<Error> | Error;
}
