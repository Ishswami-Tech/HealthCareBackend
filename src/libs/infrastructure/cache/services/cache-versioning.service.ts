/**
 * Cache Versioning Service
 * @class CacheVersioningService
 * @description Manages cache versioning for schema changes
 */

import { Injectable, Inject } from '@nestjs/common';
import { CacheKeyFactory } from '@infrastructure/cache/factories/cache-key.factory';

/**
 * Cache versioning service
 */
@Injectable()
export class CacheVersioningService {
  private readonly CURRENT_VERSION = 1;
  private readonly VERSION_KEY = 'cache:version';

  constructor(
    @Inject(CacheKeyFactory)
    private readonly keyFactory: CacheKeyFactory
  ) {}

  /**
   * Get current cache version
   */
  getCurrentVersion(): number {
    return this.CURRENT_VERSION;
  }

  /**
   * Version a cache key
   */
  versionKey(key: string): string {
    return `${key}:v${this.CURRENT_VERSION}`;
  }

  /**
   * Version a key using factory
   */
  versionFactoryKey(factoryMethod: (keyFactory: CacheKeyFactory) => string): string {
    const key = factoryMethod(this.keyFactory);
    return this.versionKey(key);
  }

  /**
   * Check if key matches current version
   */
  isCurrentVersion(key: string): boolean {
    const versionMatch = key.match(/v(\d+)$/);
    if (!versionMatch || !versionMatch[1]) {
      return false;
    }
    const keyVersion = parseInt(versionMatch[1], 10);
    return keyVersion === this.CURRENT_VERSION;
  }

  /**
   * Extract base key from versioned key
   */
  extractBaseKey(versionedKey: string): string {
    return versionedKey.replace(/:v\d+$/, '');
  }

  /**
   * Invalidate all keys of previous versions
   */
  async invalidateOldVersions(invalidateFn: (pattern: string) => Promise<number>): Promise<number> {
    let totalInvalidated = 0;
    for (let version = 1; version < this.CURRENT_VERSION; version++) {
      const pattern = `*:v${version}`;
      const count = await invalidateFn(pattern);
      totalInvalidated += count;
    }
    return totalInvalidated;
  }
}
