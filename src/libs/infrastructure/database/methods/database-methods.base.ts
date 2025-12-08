/**
 * Base class for database method implementations
 * Provides shared dependencies and core methods for all convenience methods
 */

import { PrismaService } from '../prisma/prisma.service';
import { LoggingService } from '@infrastructure/logging';
import { CacheService } from '@infrastructure/cache';
import { QueryOptionsBuilder } from '../query/builders/query-options.builder';
import { QueryKeyFactory } from '../query/factories/query-key.factory';
import type { QueryOptions, AuditInfo } from '@core/types/database.types';
import { LogType, LogLevel } from '@core/types';

/**
 * Base class that provides shared dependencies and core methods
 * All method files will use this base class to access executeRead, executeWrite, etc.
 */
export class DatabaseMethodsBase {
  protected readonly serviceName: string;

  constructor(
    protected readonly prismaService: PrismaService,
    protected readonly queryOptionsBuilder: QueryOptionsBuilder,
    protected readonly queryKeyFactory: QueryKeyFactory,
    protected readonly cacheService: CacheService | undefined,
    protected readonly loggingService: LoggingService,
    protected readonly executeReadFn: <T>(
      operation: (prisma: PrismaService) => Promise<T>,
      options?: QueryOptions
    ) => Promise<T>,
    protected readonly executeWriteFn: <T>(
      operation: (prisma: PrismaService) => Promise<T>,
      auditInfo: AuditInfo,
      options?: QueryOptions
    ) => Promise<T>,
    serviceName: string
  ) {
    this.serviceName = serviceName;
  }

  /**
   * Execute read operation - delegates to the provided function
   */
  protected async executeRead<T>(
    operation: (prisma: PrismaService) => Promise<T>,
    options?: QueryOptions
  ): Promise<T> {
    return this.executeReadFn(operation, options);
  }

  /**
   * Execute write operation - delegates to the provided function
   */
  protected async executeWrite<T>(
    operation: (prisma: PrismaService) => Promise<T>,
    auditInfo: AuditInfo,
    options?: QueryOptions
  ): Promise<T> {
    return this.executeWriteFn(operation, auditInfo, options);
  }

  /**
   * Invalidate cache by tags
   *
   * NOTE: This method is kept for backward compatibility.
   * Cache invalidation is now automatically handled by DatabaseService
   * after write operations. Manual invalidation is rarely needed.
   *
   * Cache invalidation is now automatic. Only use for edge cases.
   */
  protected async invalidateCache(tags: string[]): Promise<void> {
    const cacheService = this.cacheService;
    if (cacheService) {
      try {
        const promises = tags.map(tag => cacheService.invalidateCacheByTag(tag));
        await Promise.all(promises);
      } catch (error) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Cache invalidation failed: ${error instanceof Error ? error.message : String(error)}`,
          this.serviceName,
          { tags, error: error instanceof Error ? error.stack : String(error) }
        );
      }
    }
  }
}
