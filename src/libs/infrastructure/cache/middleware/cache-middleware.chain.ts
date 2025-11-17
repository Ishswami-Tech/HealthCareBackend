/**
 * Cache Middleware Chain
 * @class CacheMiddlewareChain
 * @description Manages chain of responsibility for cache middleware
 */

import { Injectable } from '@nestjs/common';
import type { ICacheMiddleware, CacheMiddlewareContext } from './cache-middleware.interface';
import { ValidationCacheMiddleware } from './validation-cache.middleware';
import { MetricsCacheMiddleware } from './metrics-cache.middleware';

/**
 * Cache middleware chain manager
 */
@Injectable()
export class CacheMiddlewareChain {
  private firstMiddleware?: ICacheMiddleware;

  constructor(
    private readonly validationMiddleware: ValidationCacheMiddleware,
    private readonly metricsMiddleware: MetricsCacheMiddleware
  ) {
    this.buildChain();
  }

  /**
   * Build middleware chain
   */
  private buildChain(): void {
    // Order: Validation -> Metrics
    this.validationMiddleware.setNext(this.metricsMiddleware);
    this.firstMiddleware = this.validationMiddleware;
  }

  /**
   * Execute before hooks
   */
  async executeBefore(context: CacheMiddlewareContext): Promise<CacheMiddlewareContext> {
    if (this.firstMiddleware) {
      return this.firstMiddleware.before?.(context) ?? context;
    }
    return context;
  }

  /**
   * Execute after hooks
   */
  async executeAfter<T>(context: CacheMiddlewareContext, result: T): Promise<T> {
    if (this.firstMiddleware) {
      return this.firstMiddleware.after?.(context, result) ?? result;
    }
    return result;
  }

  /**
   * Execute error hooks
   */
  async executeError(context: CacheMiddlewareContext, error: Error): Promise<Error> {
    if (this.firstMiddleware) {
      return this.firstMiddleware.onError?.(context, error) ?? error;
    }
    return error;
  }
}
