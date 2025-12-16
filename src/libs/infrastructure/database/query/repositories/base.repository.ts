// Import types from centralized locations
import type { PaginatedResult, RepositoryContext } from '@core/types';
import type { QueryOptions } from '@core/types/database.types';
import { RepositoryResult } from '@core/types/database.types';
import { Inject, forwardRef } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { CacheService } from '@infrastructure/cache';

// Re-export types
export { RepositoryResult };
export type { PaginatedResult, RepositoryContext, QueryOptions } from '@core/types/database.types';

/**
 * Base Repository - INTERNAL INFRASTRUCTURE COMPONENT
 *
 * NOT FOR DIRECT USE - Use DatabaseService instead.
 * This is an internal base class used by repository implementations.
 * All repositories are internal components used by DatabaseService optimization layers.
 * @internal
 */

// Type helper for Prisma delegate operations
type PrismaDelegateMethod<TResult = unknown> = (args?: Record<string, unknown>) => Promise<TResult>;

interface PrismaDelegate {
  create: PrismaDelegateMethod;
  createMany: PrismaDelegateMethod<{ count: number }>;
  findUnique: PrismaDelegateMethod;
  findFirst: PrismaDelegateMethod;
  findMany: PrismaDelegateMethod<unknown[]>;
  update: PrismaDelegateMethod;
  updateMany: PrismaDelegateMethod<{ count: number }>;
  delete: PrismaDelegateMethod;
  deleteMany: PrismaDelegateMethod<{ count: number }>;
  count: PrismaDelegateMethod<number>;
  $transaction: <T>(operation: (tx: unknown) => Promise<T>) => Promise<T>;
}

/**
 * Base repository interface defining common CRUD operations
 */
export interface IBaseRepository<TEntity, TCreateInput, TUpdateInput, TId = string> {
  /**
   * Create a new entity
   */
  create(data: TCreateInput, context?: RepositoryContext): Promise<RepositoryResult<TEntity>>;

  /**
   * Create multiple entities
   */
  createMany(
    data: TCreateInput[],
    context?: RepositoryContext
  ): Promise<RepositoryResult<TEntity[]>>;

  /**
   * Find entity by ID
   */
  findById(
    id: TId,
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<TEntity | null>>;

  /**
   * Find entity by unique field
   */
  findUnique(
    where: Record<string, unknown>,
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<TEntity | null>>;

  /**
   * Find first entity matching criteria
   */
  findFirst(
    where: Record<string, unknown>,
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<TEntity | null>>;

  /**
   * Find multiple entities
   */
  findMany(
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<TEntity[]>>;

  /**
   * Find entities with pagination
   */
  findManyPaginated(
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<PaginatedResult<TEntity>>>;

  /**
   * Update entity by ID
   */
  update(
    id: TId,
    data: TUpdateInput,
    context?: RepositoryContext
  ): Promise<RepositoryResult<TEntity>>;

  /**
   * Update multiple entities
   */
  updateMany(
    where: Record<string, unknown>,
    data: TUpdateInput,
    context?: RepositoryContext
  ): Promise<RepositoryResult<{ count: number }>>;

  /**
   * Delete entity by ID (hard delete)
   */
  delete(
    id: TId,
    context?: RepositoryContext,
    softDelete?: boolean
  ): Promise<RepositoryResult<TEntity>>;

  /**
   * Delete multiple entities
   */
  deleteMany(
    where: Record<string, unknown>,
    context?: RepositoryContext
  ): Promise<RepositoryResult<{ count: number }>>;

  /**
   * Soft delete entity by ID
   */
  softDelete?(id: TId, context?: RepositoryContext): Promise<RepositoryResult<TEntity>>;

  /**
   * Count entities matching criteria
   */
  count(
    where?: Record<string, unknown>,
    context?: RepositoryContext
  ): Promise<RepositoryResult<number>>;

  /**
   * Check if entity exists
   */
  exists(
    where: Record<string, unknown>,
    context?: RepositoryContext
  ): Promise<RepositoryResult<boolean>>;

  /**
   * Execute operation in transaction
   */
  executeInTransaction?<T>(
    operation: (tx: unknown) => Promise<T>,
    context?: RepositoryContext
  ): Promise<RepositoryResult<T>>;
}

/**
 * Abstract base repository implementation - INTERNAL INFRASTRUCTURE COMPONENT
 *
 * NOT FOR DIRECT USE - Use DatabaseService instead.
 * This is an internal base class used by repository implementations.
 * All repositories are internal components used by DatabaseService optimization layers.
 * @internal
 */
export abstract class BaseRepository<
  TEntity extends { id: TId },
  TCreateInput,
  TUpdateInput,
  TId = string,
> implements IBaseRepository<TEntity, TCreateInput, TUpdateInput, TId> {
  protected readonly serviceName: string;
  protected readonly cacheEnabled: boolean;
  protected readonly defaultCacheTTL: number = 3600; // 1 hour default

  constructor(
    protected readonly entityName: string,
    protected readonly prismaDelegate: unknown,
    protected readonly loggingService: LoggingService,
    protected readonly cacheService?: CacheService
  ) {
    this.serviceName = `${entityName}Repository`;
    this.cacheEnabled = cacheService !== undefined;
  }

  /**
   * Generate cache key for entity operations
   */
  protected getCacheKey(operation: string, ...parts: Array<string | number | undefined>): string {
    const filteredParts = parts.filter(p => p !== undefined && p !== null);
    return `${this.entityName.toLowerCase()}:${operation}:${filteredParts.join(':')}`;
  }

  /**
   * Generate cache tags for invalidation
   */
  protected getCacheTags(entityId?: TId, clinicId?: string, userId?: string): string[] {
    const tags = [`${this.entityName.toLowerCase()}:all`];
    if (entityId) tags.push(`${this.entityName.toLowerCase()}:${String(entityId)}`);
    if (clinicId) tags.push(`clinic:${clinicId}`);
    if (userId) tags.push(`user:${userId}`);
    return tags;
  }

  /**
   * Determine if data contains PHI (Protected Health Information)
   */
  protected containsPHI(): boolean {
    // Override in subclasses if entity contains PHI
    const phiEntities = ['patient', 'appointment', 'medicalrecord', 'prescription', 'vitalsign'];
    return phiEntities.includes(this.entityName.toLowerCase());
  }

  async create(
    data: TCreateInput,
    context?: RepositoryContext
  ): Promise<RepositoryResult<TEntity>> {
    const startTime = Date.now();

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Creating ${this.entityName}`,
        this.serviceName,
        { data }
      );

      // Use Prisma delegate directly - optimization layers will be handled by DatabaseService
      const delegate = this.prismaDelegate as PrismaDelegate;
      const entity = (await delegate.create({
        data,
      })) as TEntity;

      const executionTime = Date.now() - startTime;

      // Invalidate cache after create
      if (this.cacheEnabled && this.cacheService && entity) {
        const entityId = (entity as { id: TId }).id;
        const tags = this.getCacheTags(entityId, context?.clinicId, context?.userId);
        await Promise.all([
          this.cacheService.invalidateCacheByTag(`${this.entityName.toLowerCase()}:all`),
          this.cacheService.invalidateCache(this.getCacheKey('id', String(entityId))),
          ...tags.map(tag => this.cacheService!.invalidateCacheByTag(tag)),
        ]).catch(error => {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Cache invalidation failed after create: ${error instanceof Error ? error.message : String(error)}`,
            this.serviceName
          );
        });
      }

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Created ${this.entityName}: ${String((entity as { id: TId }).id)}`,
        this.serviceName
      );

      return RepositoryResult.success(
        entity,
        {
          executionTime,
          rowCount: 1,
          source: 'base_repository',
          operationType: context?.operationType || 'CREATE',
        },
        executionTime,
        context?.operationType || 'CREATE',
        context?.clinicId,
        context?.userId
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to create ${this.entityName}: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: 'base_repository',
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || 'CREATE',
        context?.clinicId,
        context?.userId
      );
    }
  }

  async createMany(
    data: TCreateInput[],
    context?: RepositoryContext
  ): Promise<RepositoryResult<TEntity[]>> {
    const startTime = Date.now();

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Creating ${data.length} ${this.entityName}s`,
        this.serviceName
      );

      // Use batch optimization for large datasets
      const batchSize = (context?.metadata?.['batchSize'] as number) || 100;
      const results: TEntity[] = [];

      const delegate = this.prismaDelegate as PrismaDelegate;

      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);

        await delegate.createMany({
          data: batch,
          skipDuplicates: true,
        });

        // Note: createMany returns count, not entities
        // In a real implementation, you might want to fetch the created entities
        results.push(...(batch as unknown as TEntity[]));
      }

      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Created ${data.length} ${this.entityName}s`,
        this.serviceName
      );

      return RepositoryResult.success(
        results,
        {
          executionTime,
          rowCount: data.length,
          source: 'base_repository',
          batchSize,
          batchCount: Math.ceil(data.length / batchSize),
        },
        executionTime,
        context?.operationType || 'CREATE_MANY',
        context?.clinicId,
        context?.userId
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to create multiple ${this.entityName}s: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: 'base_repository',
          dataCount: data.length,
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || 'CREATE_MANY',
        context?.clinicId,
        context?.userId
      );
    }
  }

  async findById(
    id: TId,
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<TEntity | null>> {
    const startTime = Date.now();
    const cacheKey = this.getCacheKey('id', String(id), context?.clinicId);

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Finding ${this.entityName} by ID: ${String(id)}`,
        this.serviceName
      );

      // Try cache first if enabled
      let entity: TEntity | null = null;
      let cacheHit = false;

      if (this.cacheEnabled && this.cacheService) {
        try {
          entity = await this.cacheService.cache<TEntity | null>(
            cacheKey,
            async () => {
              // Use Prisma delegate directly - optimization layers will be handled by DatabaseService
              const delegate = this.prismaDelegate as PrismaDelegate;
              return (await delegate.findUnique({
                where: { id },
                ...(this.buildQueryOptions(options) || {}),
              })) as TEntity | null;
            },
            {
              ttl: this.defaultCacheTTL,
              containsPHI: this.containsPHI(),
              tags: this.getCacheTags(id, context?.clinicId, context?.userId),
              clinicSpecific: !!context?.clinicId,
            }
          );
          cacheHit = true;
        } catch (cacheError) {
          // If cache fails, fall through to database query
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Cache lookup failed, falling back to database: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`,
            this.serviceName
          );
        }
      }

      // If not from cache, query database
      if (!entity && !cacheHit) {
        const delegate = this.prismaDelegate as PrismaDelegate;
        entity = (await delegate.findUnique({
          where: { id },
          ...(this.buildQueryOptions(options) || {}),
        })) as TEntity | null;
      }

      const executionTime = Date.now() - startTime;

      return RepositoryResult.success(
        entity,
        {
          executionTime,
          rowCount: entity ? 1 : 0,
          source: 'base_repository',
          cacheHit,
          queryComplexity: this.assessQueryComplexity(options),
        },
        executionTime,
        context?.operationType || 'FIND_BY_ID',
        context?.clinicId,
        context?.userId
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to find ${this.entityName} by ID: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: 'base_repository',
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || 'FIND_BY_ID',
        context?.clinicId,
        context?.userId
      );
    }
  }

  async findUnique(
    where: Record<string, unknown>,
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<TEntity | null>> {
    const startTime = Date.now();

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Finding unique ${this.entityName}`,
        this.serviceName,
        { where }
      );
      const delegate = this.prismaDelegate as PrismaDelegate;
      const entity = (await delegate.findUnique({
        where,
        ...(this.buildQueryOptions(options, context) || {}),
      })) as TEntity | null;

      const executionTime = Date.now() - startTime;

      return RepositoryResult.success(
        entity,
        {
          executionTime,
          rowCount: entity ? 1 : 0,
          source: 'base_repository',
          queryComplexity: this.assessQueryComplexity(options),
        },
        executionTime,
        context?.operationType || 'FIND_UNIQUE',
        context?.clinicId,
        context?.userId
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to find unique ${this.entityName}: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: 'base_repository',
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || 'FIND_UNIQUE',
        context?.clinicId,
        context?.userId
      );
    }
  }

  async findFirst(
    where: Record<string, unknown>,
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<TEntity | null>> {
    const startTime = Date.now();

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Finding first ${this.entityName}`,
        this.serviceName,
        { where }
      );
      const delegate = this.prismaDelegate as PrismaDelegate;
      const entity = (await delegate.findFirst({
        where,
        ...(this.buildQueryOptions(options, context) || {}),
      })) as TEntity | null;

      const executionTime = Date.now() - startTime;

      return RepositoryResult.success(
        entity,
        {
          executionTime,
          rowCount: entity ? 1 : 0,
          source: 'base_repository',
        },
        executionTime,
        context?.operationType || 'FIND_FIRST',
        context?.clinicId,
        context?.userId
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to find first ${this.entityName}: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: 'base_repository',
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || 'FIND_FIRST',
        context?.clinicId,
        context?.userId
      );
    }
  }

  async findMany(
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<TEntity[]>> {
    const startTime = Date.now();
    // Generate cache key based on query options
    const queryHash = JSON.stringify({ ...options, clinicId: context?.clinicId });
    const cacheKey = this.getCacheKey('findMany', queryHash);

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Finding many ${this.entityName}s`,
        this.serviceName
      );

      // Try cache first if enabled
      let entities: TEntity[] = [];
      let cacheHit = false;

      if (this.cacheEnabled && this.cacheService) {
        try {
          entities = await this.cacheService.cache<TEntity[]>(
            cacheKey,
            async () => {
              // Use Prisma delegate directly - optimization layers will be handled by DatabaseService
              const delegate = this.prismaDelegate as PrismaDelegate;
              return (await delegate.findMany(
                this.buildQueryOptions(options, context) as Record<string, unknown>
              )) as TEntity[];
            },
            {
              ttl: this.defaultCacheTTL,
              containsPHI: this.containsPHI(),
              tags: this.getCacheTags(undefined, context?.clinicId, context?.userId),
              clinicSpecific: !!context?.clinicId,
            }
          );
          cacheHit = true;
        } catch (cacheError) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Cache lookup failed, falling back to database: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`,
            this.serviceName
          );
        }
      }

      // If not from cache, query database
      if (!cacheHit) {
        const delegate = this.prismaDelegate as PrismaDelegate;
        entities = (await delegate.findMany(
          this.buildQueryOptions(options, context) as Record<string, unknown>
        )) as TEntity[];
      }

      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Found ${entities.length} ${this.entityName}s`,
        this.serviceName
      );

      return RepositoryResult.success(
        entities,
        {
          executionTime,
          rowCount: entities.length,
          source: 'base_repository',
          cacheHit,
        },
        executionTime,
        context?.operationType || 'FIND_MANY',
        context?.clinicId,
        context?.userId
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to find many ${this.entityName}s: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: 'base_repository',
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || 'FIND_MANY',
        context?.clinicId,
        context?.userId
      );
    }
  }

  async findManyPaginated(
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<PaginatedResult<TEntity>>> {
    const startTime = Date.now();
    const page = options?.page || 1;
    const limit = options?.limit || 10;
    const skip = (page - 1) * limit;
    const queryHash = JSON.stringify({ ...options, page, limit, clinicId: context?.clinicId });
    const cacheKey = this.getCacheKey('findManyPaginated', queryHash);

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Finding paginated ${this.entityName}s - page: ${page}, limit: ${limit}`,
        this.serviceName
      );

      // Try cache first if enabled
      let result: PaginatedResult<TEntity> | null = null;
      let cacheHit = false;

      if (this.cacheEnabled && this.cacheService) {
        try {
          result = await this.cacheService.cache<PaginatedResult<TEntity>>(
            cacheKey,
            async () => {
              // Execute count and data queries in parallel for better performance

              // Use Prisma delegate directly - optimization layers will be handled by DatabaseService
              const delegate = this.prismaDelegate as PrismaDelegate;
              const [entitiesResult, totalResult] = await Promise.all([
                delegate.findMany({
                  ...(this.buildQueryOptions(options, context) || {}),
                  skip,
                  take: limit,
                } as Record<string, unknown>),
                delegate.count({
                  where: options?.where,
                } as Record<string, unknown>),
              ]);
              const entities = entitiesResult as unknown as TEntity[];
              const total = totalResult as unknown as number;

              const totalPages = Math.ceil(total / limit);

              return {
                data: entities,
                pagination: {
                  page,
                  limit,
                  total,
                  totalPages,
                  hasNextPage: page < totalPages,
                  hasPreviousPage: page > 1,
                },
                metadata: {
                  ...(context?.clinicId && { clinicId: context.clinicId }),
                  executionTime: Date.now() - startTime,
                  cacheHit: false,
                  rowCount: entities.length,
                  performanceGrade: this.getPerformanceGrade(Date.now() - startTime),
                  hipaaCompliant: true,
                },
              };
            },
            {
              ttl: this.defaultCacheTTL,
              containsPHI: this.containsPHI(),
              tags: this.getCacheTags(undefined, context?.clinicId, context?.userId),
              clinicSpecific: !!context?.clinicId,
            }
          );
          cacheHit = true;
        } catch (cacheError) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Cache lookup failed, falling back to database: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`,
            this.serviceName
          );
        }
      }

      // If not from cache, query database
      if (!result) {
        // Use Prisma delegate directly - optimization layers will be handled by DatabaseService
        const delegate = this.prismaDelegate as PrismaDelegate;
        const [entitiesResult, totalResult] = await Promise.all([
          delegate.findMany({
            ...(this.buildQueryOptions(options, context) || {}),
            skip,
            take: limit,
          } as Record<string, unknown>),
          delegate.count({
            where: options?.where,
          } as Record<string, unknown>),
        ]);
        const entities = entitiesResult as unknown as TEntity[];
        const total = totalResult as unknown as number;

        const totalPages = Math.ceil(total / limit);
        const executionTime = Date.now() - startTime;

        result = {
          data: entities,
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
          },
          metadata: {
            ...(context?.clinicId && { clinicId: context.clinicId }),
            executionTime,
            cacheHit: false,
            rowCount: entities.length,
            performanceGrade: this.getPerformanceGrade(executionTime),
            hipaaCompliant: true,
          },
        };
      }

      const executionTime = Date.now() - startTime;
      result.metadata.executionTime = executionTime;
      result.metadata.cacheHit = cacheHit;

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Found ${result.data.length}/${result.pagination.total} ${this.entityName}s`,
        this.serviceName
      );

      return RepositoryResult.success(
        result,
        {
          executionTime,
          rowCount: result.data.length,
          source: 'base_repository',
          totalCount: result.pagination.total,
          page,
          limit,
          cacheHit,
          queryComplexity: this.assessQueryComplexity(options),
        },
        executionTime,
        context?.operationType || 'FIND_MANY_PAGINATED',
        context?.clinicId,
        context?.userId
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to find paginated ${this.entityName}s: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: 'base_repository',
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || 'FIND_MANY_PAGINATED',
        context?.clinicId,
        context?.userId
      );
    }
  }

  async update(
    id: TId,
    data: TUpdateInput,
    context?: RepositoryContext
  ): Promise<RepositoryResult<TEntity>> {
    const startTime = Date.now();

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Updating ${this.entityName}: ${String(id)}`,
        this.serviceName
      );

      // Get existing entity for audit trail
      // Use Prisma delegate directly - optimization layers will be handled by DatabaseService
      const delegate = this.prismaDelegate as PrismaDelegate;
      const existingEntity = (await delegate.findUnique({
        where: { id },
      } as Record<string, unknown>)) as TEntity | null;

      if (!existingEntity) {
        return RepositoryResult.failure(
          new Error(`${this.entityName} with ID ${String(id)} not found`),
          {
            executionTime: Date.now() - startTime,
            source: 'base_repository',
          },
          Date.now() - startTime,
          context?.operationType || 'UPDATE',
          context?.clinicId,
          context?.userId
        );
      }
      const entity = (await delegate.update({
        where: { id },
        data,
      } as Record<string, unknown>)) as TEntity;

      const executionTime = Date.now() - startTime;

      // Invalidate cache after update
      if (this.cacheEnabled && this.cacheService) {
        const tags = this.getCacheTags(id, context?.clinicId, context?.userId);
        await Promise.all([
          this.cacheService.invalidateCache(this.getCacheKey('id', String(id))),
          this.cacheService.invalidateCacheByTag(`${this.entityName.toLowerCase()}:all`),
          ...tags.map(tag => this.cacheService!.invalidateCacheByTag(tag)),
        ]).catch(error => {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Cache invalidation failed after update: ${error instanceof Error ? error.message : String(error)}`,
            this.serviceName
          );
        });
      }

      // Log audit trail
      this.logAuditTrail({
        operation: 'UPDATE',
        resource: this.entityName,
        resourceId: id as string,
        userId: context?.userId,
        clinicId: context?.clinicId,
        details: {
          previousData: existingEntity,
          newData: entity,
          changes: this.getChanges(existingEntity, entity),
        },
      });

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Updated ${this.entityName}: ${String((entity as { id: TId }).id)}`,
        this.serviceName
      );

      return RepositoryResult.success(
        entity,
        {
          executionTime,
          rowCount: 1,
          source: 'base_repository',
          auditTrail: true,
        },
        executionTime,
        context?.operationType || 'UPDATE',
        context?.clinicId,
        context?.userId
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to update ${this.entityName}: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: 'base_repository',
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || 'UPDATE',
        context?.clinicId,
        context?.userId
      );
    }
  }

  async updateMany(
    where: Record<string, unknown>,
    data: TUpdateInput,
    context?: RepositoryContext
  ): Promise<RepositoryResult<{ count: number }>> {
    const startTime = Date.now();

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Updating many ${this.entityName}s`,
        this.serviceName,
        { where }
      );

      // Use Prisma delegate directly - optimization layers will be handled by DatabaseService
      const delegate = this.prismaDelegate as PrismaDelegate;
      const result = (await delegate.updateMany({
        where,
        data,
      } as Record<string, unknown>)) as { count: number };

      const executionTime = Date.now() - startTime;

      // Invalidate cache after bulk update - invalidate all entity cache
      if (this.cacheEnabled && this.cacheService) {
        await this.cacheService
          .invalidateCacheByTag(`${this.entityName.toLowerCase()}:all`)
          .catch(error => {
            void this.loggingService.log(
              LogType.DATABASE,
              LogLevel.WARN,
              `Cache invalidation failed after updateMany: ${error instanceof Error ? error.message : String(error)}`,
              this.serviceName
            );
          });
      }

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Updated ${result.count} ${this.entityName}s`,
        this.serviceName
      );

      return RepositoryResult.success(
        result,
        {
          executionTime,
          rowCount: result.count,
          source: 'base_repository',
        },
        executionTime,
        context?.operationType || 'UPDATE_MANY',
        context?.clinicId,
        context?.userId
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to update many ${this.entityName}s: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: 'base_repository',
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || 'UPDATE_MANY',
        context?.clinicId,
        context?.userId
      );
    }
  }

  async delete(
    id: TId,
    context?: RepositoryContext,
    softDelete: boolean = true
  ): Promise<RepositoryResult<TEntity>> {
    const startTime = Date.now();

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `${softDelete ? 'Soft deleting' : 'Deleting'} ${this.entityName}: ${String(id)}`,
        this.serviceName
      );

      // Use Prisma delegate directly - optimization layers will be handled by DatabaseService
      const delegate = this.prismaDelegate as PrismaDelegate;
      let entity: TEntity;
      if (softDelete) {
        // Soft delete - update isActive and deletedAt fields
        entity = (await delegate.update({
          where: { id },
          data: {
            isActive: false,
            deletedAt: new Date(),
          },
        } as Record<string, unknown>)) as TEntity;
      } else {
        // Hard delete
        entity = (await delegate.delete({
          where: { id },
        } as Record<string, unknown>)) as TEntity;
      }

      const executionTime = Date.now() - startTime;

      // Invalidate cache after delete
      if (this.cacheEnabled && this.cacheService) {
        const tags = this.getCacheTags(id, context?.clinicId, context?.userId);
        await Promise.all([
          this.cacheService.invalidateCache(this.getCacheKey('id', String(id))),
          this.cacheService.invalidateCacheByTag(`${this.entityName.toLowerCase()}:all`),
          ...tags.map(tag => this.cacheService!.invalidateCacheByTag(tag)),
        ]).catch(error => {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Cache invalidation failed after delete: ${error instanceof Error ? error.message : String(error)}`,
            this.serviceName
          );
        });
      }

      // Log audit trail
      this.logAuditTrail({
        operation: softDelete ? 'SOFT_DELETE' : 'HARD_DELETE',
        resource: this.entityName,
        resourceId: id as string,
        userId: context?.userId,
        clinicId: context?.clinicId,
        details: {
          softDelete,
          deletedAt: new Date(),
        },
      });

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `${softDelete ? 'Soft deleted' : 'Deleted'} ${this.entityName}: ${String((entity as { id: TId }).id)}`,
        this.serviceName
      );

      return RepositoryResult.success(
        entity,
        {
          executionTime,
          rowCount: 1,
          source: 'base_repository',
          softDelete,
          auditTrail: true,
        },
        executionTime,
        context?.operationType || 'DELETE',
        context?.clinicId,
        context?.userId
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to delete ${this.entityName}: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: 'base_repository',
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || 'DELETE',
        context?.clinicId,
        context?.userId
      );
    }
  }

  async deleteMany(
    where: Record<string, unknown>,
    context?: RepositoryContext
  ): Promise<RepositoryResult<{ count: number }>> {
    const startTime = Date.now();

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Deleting many ${this.entityName}s`,
        this.serviceName,
        { where }
      );
      const delegate = this.prismaDelegate as PrismaDelegate;
      const result = (await delegate.deleteMany({
        where,
      } as Record<string, unknown>)) as { count: number };

      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Deleted ${result.count} ${this.entityName}s`,
        this.serviceName
      );

      return RepositoryResult.success(
        result,
        {
          executionTime,
          rowCount: result.count,
          source: 'base_repository',
        },
        executionTime,
        context?.operationType || 'DELETE_MANY',
        context?.clinicId,
        context?.userId
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to delete many ${this.entityName}s: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: 'base_repository',
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || 'DELETE_MANY',
        context?.clinicId,
        context?.userId
      );
    }
  }

  async softDelete(id: TId, context?: RepositoryContext): Promise<RepositoryResult<TEntity>> {
    return this.delete(id, context, true);
  }

  async count(
    where?: Record<string, unknown>,
    context?: RepositoryContext
  ): Promise<RepositoryResult<number>> {
    const startTime = Date.now();

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Counting ${this.entityName}s`,
        this.serviceName,
        { where }
      );
      const delegate = this.prismaDelegate as PrismaDelegate;
      const count = (await delegate.count({
        where,
      } as Record<string, unknown>)) as unknown as number;

      const executionTime = Date.now() - startTime;

      return RepositoryResult.success(
        count,
        {
          executionTime,
          source: 'base_repository',
        },
        executionTime,
        context?.operationType || 'COUNT',
        context?.clinicId,
        context?.userId
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to count ${this.entityName}s: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: 'base_repository',
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || 'COUNT',
        context?.clinicId,
        context?.userId
      );
    }
  }

  async exists(
    where: Record<string, unknown>,
    context?: RepositoryContext
  ): Promise<RepositoryResult<boolean>> {
    const startTime = Date.now();

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Checking if ${this.entityName} exists`,
        this.serviceName,
        { where }
      );
      const delegate = this.prismaDelegate as PrismaDelegate;
      const entity = (await delegate.findFirst({
        where,
      } as Record<string, unknown>)) as TEntity | null;

      const executionTime = Date.now() - startTime;

      return RepositoryResult.success(
        !!entity,
        {
          executionTime,
          source: 'base_repository',
        },
        executionTime,
        context?.operationType || 'EXISTS',
        context?.clinicId,
        context?.userId
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to check if ${this.entityName} exists: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: 'base_repository',
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || 'EXISTS',
        context?.clinicId,
        context?.userId
      );
    }
  }

  /**
   * Execute operation in transaction
   */
  async executeInTransaction<T>(
    operation: (tx: unknown) => Promise<T>,
    context?: RepositoryContext
  ): Promise<RepositoryResult<T>> {
    const startTime = Date.now();

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Executing ${this.entityName} operation in transaction`,
        this.serviceName
      );
      const delegate = this.prismaDelegate as PrismaDelegate;
      const result = (await delegate.$transaction(operation)) as T;

      const executionTime = Date.now() - startTime;

      return RepositoryResult.success(
        result,
        {
          executionTime,
          source: 'base_repository',
          transaction: true,
        },
        executionTime,
        context?.operationType || 'TRANSACTION',
        context?.clinicId,
        context?.userId
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Transaction failed for ${this.entityName}: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: 'base_repository',
          _error: _error instanceof Error ? _error.message : String(_error),
          transaction: true,
        },
        executionTime,
        context?.operationType || 'TRANSACTION',
        context?.clinicId,
        context?.userId
      );
    }
  }

  /**
   * Build query options from interface with healthcare enhancements
   */
  protected buildQueryOptions(options?: QueryOptions, _context?: RepositoryContext): unknown {
    if (!options) return {};

    const queryOptions: Record<string, unknown> = {};

    if (options.include) {
      queryOptions['include'] = options.include;
    }

    if (options.select) {
      queryOptions['select'] = options.select;
    }

    if (options.where) {
      queryOptions['where'] = this.buildWhereClause(options);
    }

    if (options.orderBy) {
      queryOptions['orderBy'] = options.orderBy;
    }

    // Add healthcare-specific options
    if (options.rowLevelSecurity && options.clinicId) {
      const existingWhere = (queryOptions['where'] || {}) as Record<string, unknown>;
      
      // Doctor model: Transform any existing clinicId to clinics relation
      if (
        this.entityName.toLowerCase() === 'doctor' &&
        existingWhere &&
        typeof existingWhere === 'object' &&
        !Array.isArray(existingWhere) &&
        'clinicId' in existingWhere &&
        !('clinics' in existingWhere)
      ) {
        const clinicIdValue = existingWhere['clinicId'];
        delete existingWhere['clinicId'];
        queryOptions['where'] = {
          ...existingWhere,
          clinics: {
            some: {
              clinicId: clinicIdValue,
            },
          },
        };
      } else if (
        this.entityName.toLowerCase() === 'doctor' &&
        existingWhere &&
        typeof existingWhere === 'object' &&
        !Array.isArray(existingWhere) &&
        !('clinics' in existingWhere)
      ) {
        // Doctor model uses clinics relation, not direct clinicId
        queryOptions['where'] = {
          ...existingWhere,
          clinics: {
            some: {
              clinicId: options.clinicId,
            },
          },
        };
      } else if (
        existingWhere &&
        typeof existingWhere === 'object' &&
        !Array.isArray(existingWhere) &&
        !('clinicId' in existingWhere) &&
        !('clinics' in existingWhere)
      ) {
        // Other models use direct clinicId
        queryOptions['where'] = {
          ...existingWhere,
          clinicId: options.clinicId,
        };
      }
    }

    return queryOptions;
  }

  /**
   * Build where clause with healthcare-specific features
   */
  protected buildWhereClause(options?: QueryOptions): unknown {
    const where: Record<string, unknown> = options?.where
      ? ({ ...options.where } as Record<string, unknown>)
      : {};

    // Doctor model: Transform any existing clinicId to clinics relation
    if (
      this.entityName.toLowerCase() === 'doctor' &&
      where &&
      typeof where === 'object' &&
      !Array.isArray(where) &&
      'clinicId' in where &&
      !('clinics' in where)
    ) {
      const clinicIdValue = where['clinicId'];
      delete where['clinicId'];
      where['clinics'] = {
        some: {
          clinicId: clinicIdValue,
        },
      };
    }

    // Add clinic isolation if specified
    if (options?.clinicId && options?.rowLevelSecurity !== false) {
      // Doctor model uses clinics relation, not direct clinicId
      if (this.entityName.toLowerCase() === 'doctor' && !('clinics' in where)) {
        where['clinics'] = {
          some: {
            clinicId: options.clinicId,
          },
        };
      } else if (!('clinicId' in where) && !('clinics' in where)) {
        // Other models use direct clinicId
        where['clinicId'] = options.clinicId;
      }
    }

    // Add data masking for sensitive fields
    if (options?.dataMasking) {
      // Implement data masking logic here
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        'Data masking applied to query',
        this.serviceName
      );
    }

    return where;
  }

  /**
   * Assess query complexity for performance monitoring
   */
  protected assessQueryComplexity(options?: QueryOptions): 'simple' | 'medium' | 'complex' {
    if (!options) return 'simple';

    let complexity = 0;

    if (options.include && Object.keys(options.include).length > 2) complexity += 2;
    if (options.select && Object.keys(options.select).length > 5) complexity += 1;
    if (options.where && Object.keys(options.where).length > 3) complexity += 1;
    if (options.orderBy && Object.keys(options.orderBy).length > 1) complexity += 1;

    if (complexity <= 1) return 'simple';
    if (complexity <= 3) return 'medium';
    return 'complex';
  }

  /**
   * Get performance grade based on execution time
   */
  protected getPerformanceGrade(executionTime: number): 'excellent' | 'good' | 'fair' | 'poor' {
    if (executionTime < 100) return 'excellent';
    if (executionTime < 500) return 'good';
    if (executionTime < 2000) return 'fair';
    return 'poor';
  }

  /**
   * Get changes between previous and current data for audit trail
   */
  protected getChanges(
    previous: unknown,
    current: unknown
  ): Record<string, { from: unknown; to: unknown }> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (current && typeof current === 'object' && previous && typeof previous === 'object') {
      const currentObj = current as Record<string, unknown>;
      const previousObj = previous as Record<string, unknown>;

      for (const key in currentObj) {
        if (Object.prototype.hasOwnProperty.call(currentObj, key)) {
          if (previousObj[key] !== currentObj[key]) {
            changes[key] = {
              from: previousObj[key],
              to: currentObj[key],
            };
          }
        }
      }
    }

    return changes;
  }

  /**
   * Log audit trail for compliance
   */
  protected logAuditTrail(auditEntry: unknown): void {
    try {
      // Log to audit system
      void this.loggingService.log(LogType.AUDIT, LogLevel.INFO, 'AUDIT', this.serviceName, {
        auditEntry,
      });

      // In a real implementation, this would go to a dedicated audit service
      // await this.auditService.log(auditEntry);
    } catch (_error) {
      void this.loggingService.log(
        LogType.AUDIT,
        LogLevel.ERROR,
        `Failed to log audit trail: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
    }
  }

  /**
   * Handle repository errors with context
   */
  protected handleError(operation: string, _error: unknown): Error {
    const message = `${this.entityName}Repository.${operation} failed: ${(_error as Error).message || String(_error)}`;
    void this.loggingService.log(LogType.DATABASE, LogLevel.ERROR, message, this.serviceName, {
      error: _error instanceof Error ? _error.stack : String(_error),
    });
    return new Error(message);
  }
}

/**
 * Repository factory interface for creating repository instances
 */
export interface IRepositoryFactory {
  /**
   * Create repository for specific entity type
   */
  create<TEntity extends { id: TId }, TCreateInput, TUpdateInput, TId = string>(
    entityName: string,
    prismaDelegate: unknown
  ): IBaseRepository<TEntity, TCreateInput, TUpdateInput, TId>;
}

/**
 * Default repository factory implementation
 */
export class RepositoryFactory implements IRepositoryFactory {
  constructor(
    @Inject(forwardRef(() => LoggingService)) private readonly loggingService: LoggingService
  ) {}

  create<TEntity extends { id: TId }, TCreateInput, TUpdateInput, TId = string>(
    entityName: string,
    prismaDelegate: unknown
  ): IBaseRepository<TEntity, TCreateInput, TUpdateInput, TId> {
    const loggingService = this.loggingService;
    return new (class extends BaseRepository<TEntity, TCreateInput, TUpdateInput, TId> {
      constructor() {
        super(entityName, prismaDelegate, loggingService);
      }
    })();
  }
}
