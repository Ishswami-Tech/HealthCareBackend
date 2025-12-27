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
   * Optimized TTLs to improve cache hit rate (target: 70%+)
   */
  protected calculateTTL(options: CacheOperationOptions): number {
    if (options.ttl) {
      return options.ttl;
    }

    // Optimized TTLs for better cache hit rates
    if (options.emergencyData) return 600; // Increased from 300 to 10 minutes
    if (options.containsPHI) return 3600; // Increased from 1800 to 1 hour (PHI data changes less frequently)
    if (options.patientSpecific) return 7200; // Increased from 3600 to 2 hours
    if (options.doctorSpecific) return 14400; // Increased from 7200 to 4 hours (doctor data is relatively static)
    if (options.clinicSpecific) return 28800; // Increased from 14400 to 8 hours (clinic data changes infrequently)

    // Compliance-based TTL
    switch (options.complianceLevel) {
      case 'restricted':
        return 1800; // Increased from 900 to 30 minutes
      case 'sensitive':
        return 3600; // Increased from 1800 to 1 hour
      case 'standard':
      default:
        return 7200; // Increased from 3600 to 2 hours (default TTL for better hit rates)
    }
  }
}
