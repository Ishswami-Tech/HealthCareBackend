/**
 * Validation Cache Middleware
 * @class ValidationCacheMiddleware
 * @description Validates cache operations
 */

import { Injectable } from '@nestjs/common';
import { BaseCacheMiddleware } from './base-cache.middleware';
import type { CacheMiddlewareContext } from './cache-middleware.interface';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

/**
 * Validation middleware for cache operations
 */
@Injectable()
export class ValidationCacheMiddleware extends BaseCacheMiddleware {
  protected processBefore(context: CacheMiddlewareContext): CacheMiddlewareContext {
    // Validate key
    if (!context.key || context.key.trim().length === 0) {
      throw new HealthcareError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        'Cache key cannot be empty',
        undefined,
        { key: context.key },
        'ValidationCacheMiddleware'
      );
    }

    // Validate TTL if provided
    if (context.options.ttl !== undefined && context.options.ttl < 0) {
      throw new HealthcareError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        'Cache TTL cannot be negative',
        undefined,
        { ttl: context.options.ttl },
        'ValidationCacheMiddleware'
      );
    }

    return context;
  }

  protected processAfter<T>(_context: CacheMiddlewareContext, result: T): T {
    return result;
  }

  protected processError(_context: CacheMiddlewareContext, error: Error): Error {
    return error;
  }
}
