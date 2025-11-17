/**
 * Base Cache Strategy
 * @class BaseCacheStrategy
 * @description Base implementation for cache strategies
 */

import { Injectable } from '@nestjs/common';
import type { ICacheStrategy, ICacheProvider, CacheOperationOptions } from '@core/types';

/**
 * Base cache strategy with common functionality
 */
@Injectable()
export abstract class BaseCacheStrategy implements ICacheStrategy {
  constructor(protected readonly cacheProvider: ICacheProvider) {}

  abstract readonly name: string;

  abstract execute<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions
  ): Promise<T>;

  abstract shouldUse(options: CacheOperationOptions): boolean;

  /**
   * Get cached value or null
   */
  protected async getCached<T>(key: string): Promise<T | null> {
    try {
      return await this.cacheProvider.get<T>(key);
    } catch {
      return null;
    }
  }

  /**
   * Set cached value
   */
  protected async setCached<T>(key: string, value: T, ttl: number): Promise<void> {
    try {
      await this.cacheProvider.set(key, value, ttl);
    } catch {
      // Fail silently - cache is not critical
    }
  }

  /**
   * Calculate TTL from options
   */
  protected calculateTTL(options: CacheOperationOptions): number {
    if (options.ttl) {
      return options.ttl;
    }

    // Default TTLs based on data type
    if (options.emergencyData) return 300; // 5 minutes
    if (options.containsPHI) return 1800; // 30 minutes
    if (options.patientSpecific) return 3600; // 1 hour
    if (options.doctorSpecific) return 7200; // 2 hours
    if (options.clinicSpecific) return 14400; // 4 hours

    // Compliance-based TTL
    switch (options.complianceLevel) {
      case 'restricted':
        return 900; // 15 minutes
      case 'sensitive':
        return 1800; // 30 minutes
      case 'standard':
      default:
        return 3600; // 1 hour
    }
  }
}
