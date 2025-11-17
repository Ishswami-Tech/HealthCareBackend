/**
 * Cache Middleware Interface
 * @interface ICacheMiddleware
 * @description Chain of Responsibility pattern for cache operations
 */

import type { CacheOperationOptions } from '@core/types';

/**
 * Context for cache middleware
 */
export interface CacheMiddlewareContext {
  key: string;
  options: CacheOperationOptions;
  metadata?: Record<string, unknown>;
}

/**
 * Cache middleware interface
 */
export interface ICacheMiddleware {
  /**
   * Process before cache operation
   */
  before?(
    context: CacheMiddlewareContext
  ): Promise<CacheMiddlewareContext> | CacheMiddlewareContext;

  /**
   * Process after cache operation
   */
  after?<T>(context: CacheMiddlewareContext, result: T): Promise<T> | T;

  /**
   * Process on error
   */
  onError?(context: CacheMiddlewareContext, error: Error): Promise<Error> | Error;

  /**
   * Set next middleware in chain
   */
  setNext(middleware: ICacheMiddleware): void;
}
