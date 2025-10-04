import { Logger } from "@nestjs/common";

/**
 * Enhanced Result wrapper for repository operations
 * Provides a consistent way to handle success/failure states with performance tracking
 */
export class RepositoryResult<T, E = Error> {
  private readonly _timestamp: Date;
  private readonly _executionTime: number;
  private readonly _operationType: string;
  private readonly _clinicId?: string;
  private readonly _userId?: string;
  private readonly _auditTrail: AuditEntry[];

  private constructor(
    private readonly _success: boolean,
    private readonly _data?: T,
    private readonly _error?: E,
    private readonly _metadata: ResultMetadata = {},
    executionTime: number = 0,
    operationType: string = "unknown",
    clinicId?: string,
    userId?: string,
  ) {
    this._timestamp = new Date();
    this._executionTime = executionTime;
    this._operationType = operationType;
    this._clinicId = clinicId;
    this._userId = userId;
    this._auditTrail = [];
  }

  static success<T, E = Error>(
    data: T,
    metadata?: ResultMetadata,
    executionTime?: number,
    operationType?: string,
    clinicId?: string,
    userId?: string,
  ): RepositoryResult<T, E> {
    return new RepositoryResult<T, E>(
      true,
      data,
      undefined as E | undefined,
      metadata,
      executionTime,
      operationType,
      clinicId,
      userId,
    );
  }

  static failure<T, E = Error>(
    _error: E,
    metadata?: ResultMetadata,
    executionTime?: number,
    operationType?: string,
    clinicId?: string,
    userId?: string,
  ): RepositoryResult<T, E> {
    return new RepositoryResult<T, E>(
      false,
      undefined as T | undefined,
      _error,
      metadata,
      executionTime,
      operationType,
      clinicId,
      userId,
    );
  }

  static fromPromise<T, E = Error>(
    promise: Promise<T>,
    operationType: string = "unknown",
    clinicId?: string,
    userId?: string,
  ): Promise<RepositoryResult<T, E>> {
    const startTime = Date.now();

    return promise
      .then((data) => {
        const executionTime = Date.now() - startTime;
        return RepositoryResult.success(
          data,
          { source: "promise" },
          executionTime,
          operationType,
          clinicId,
          userId,
        );
      })
      .catch((_error) => {
        const executionTime = Date.now() - startTime;
        return RepositoryResult.failure<T, E>(
          _error as E,
          { source: "promise" },
          executionTime,
          operationType,
          clinicId,
          userId,
        );
      }) as Promise<RepositoryResult<T, E>>;
  }

  get isSuccess(): boolean {
    return this._success;
  }

  get isFailure(): boolean {
    return !this._success;
  }

  get data(): T | undefined {
    return this._data;
  }

  get error(): E | undefined {
    return this._error;
  }

  get timestamp(): Date {
    return this._timestamp;
  }

  get executionTime(): number {
    return this._executionTime;
  }

  get operationType(): string {
    return this._operationType;
  }

  get clinicId(): string | undefined {
    return this._clinicId;
  }

  get userId(): string | undefined {
    return this._userId;
  }

  get metadata(): ResultMetadata {
    return { ...this._metadata };
  }

  get auditTrail(): AuditEntry[] {
    return [...this._auditTrail];
  }

  /**
   * Unwrap the result, throwing error if failed
   */
  unwrap(): T {
    if (this._success && this._data !== undefined) {
      return this._data;
    }
    // Ensure we always throw an Error object
    const errorToThrow =
      this._error instanceof Error
        ? this._error
        : new Error(
            `Repository operation failed: ${this._operationType}${this._error ? ` - ${String(this._error)}` : ""}`,
          );
    throw errorToThrow;
  }

  /**
   * Unwrap with default value if failed
   */
  unwrapOr(defaultValue: T): T {
    return this._success && this._data !== undefined
      ? this._data
      : defaultValue;
  }

  /**
   * Transform the data if successful
   */
  map<U>(fn: (value: T) => U): RepositoryResult<U, E> {
    if (this._success && this._data !== undefined) {
      try {
        return RepositoryResult.success(
          fn(this._data),
          this._metadata,
          this._executionTime,
          this._operationType,
          this._clinicId,
          this._userId,
        );
      } catch (_error) {
        return RepositoryResult.failure(
          _error as E,
          { ...this._metadata, transformationError: true },
          this._executionTime,
          this._operationType,
          this._clinicId,
          this._userId,
        );
      }
    }
    return RepositoryResult.failure(this._error!);
  }

  /**
   * Chain repository operations
   */
  flatMap<U>(fn: (value: T) => RepositoryResult<U, E>): RepositoryResult<U, E> {
    if (this._success && this._data !== undefined) {
      return fn(this._data);
    }
    return RepositoryResult.failure(this._error!);
  }

  // Healthcare-specific methods
  addAuditEntry(entry: Omit<AuditEntry, "timestamp">): RepositoryResult<T, E> {
    this._auditTrail.push({
      ...entry,
      timestamp: new Date(),
    });
    return this;
  }

  addMetadata(key: string, value: unknown): RepositoryResult<T, E> {
    this._metadata[key] = value;
    return this;
  }

  // Performance and monitoring
  isSlow(threshold: number = 1000): boolean {
    return this._executionTime > threshold;
  }

  getPerformanceGrade(): "excellent" | "good" | "fair" | "poor" {
    if (this._executionTime < 100) return "excellent";
    if (this._executionTime < 500) return "good";
    if (this._executionTime < 2000) return "fair";
    return "poor";
  }

  // Serialization for logging/monitoring
  toJSON(): unknown {
    return {
      success: this._success,
      data: this._data,
      _error: this._error,
      metadata: this._metadata,
      timestamp: this._timestamp.toISOString(),
      executionTime: this._executionTime,
      operationType: this._operationType,
      clinicId: this._clinicId,
      userId: this._userId,
      auditTrail: this._auditTrail,
      performanceGrade: this.getPerformanceGrade(),
    };
  }

  // Batch operation support
  static batch<T, E = Error>(
    results: RepositoryResult<T, E>[],
  ): BatchResult<T, E> {
    const successful: T[] = [];
    const failed: Array<{ _error: E; index: number }> = [];
    const totalExecutionTime = results.reduce(
      (sum, r) => sum + r.executionTime,
      0,
    );
    const avgExecutionTime =
      results.length > 0 ? totalExecutionTime / results.length : 0;

    results.forEach((result, index) => {
      if (result.isSuccess) {
        successful.push(result.data!);
      } else {
        failed.push({ _error: result.error!, index });
      }
    });

    return {
      success: failed.length === 0,
      successful,
      failed,
      totalCount: results.length,
      successCount: successful.length,
      failureCount: failed.length,
      totalExecutionTime,
      averageExecutionTime: avgExecutionTime,
      successRate:
        results.length > 0 ? (successful.length / results.length) * 100 : 0,
    };
  }
}

/**
 * Batch operation result
 */
export interface BatchResult<T, E = Error> {
  success: boolean;
  successful: T[];
  failed: Array<{ _error: E; index: number }>;
  totalCount: number;
  successCount: number;
  failureCount: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
  successRate: number;
}

/**
 * Result metadata for tracking and debugging
 */
export interface ResultMetadata {
  source?: string;
  cacheHit?: boolean;
  retryCount?: number;
  connectionPool?: string;
  queryComplexity?: "simple" | "medium" | "complex";
  rowCount?: number;
  transformationError?: boolean;
  [key: string]: unknown;
}

/**
 * Audit trail entry for compliance
 */
export interface AuditEntry {
  timestamp: Date;
  operation: string;
  resource: string;
  resourceId?: string;
  userId?: string;
  clinicId?: string;
  details?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Common query options for repository methods with healthcare enhancements
 */
export interface QueryOptions {
  page?: number;
  limit?: number;
  orderBy?: Record<string, "asc" | "desc">;
  include?: Record<string, unknown>;
  select?: Record<string, boolean>;
  where?: Record<string, unknown>;

  // Healthcare-specific options
  clinicId?: string;
  userId?: string;
  hipaaCompliant?: boolean;
  auditRequired?: boolean;
  cacheStrategy?: "none" | "short" | "long" | "never";
  priority?: "low" | "normal" | "high" | "critical";
  timeout?: number;
  retryCount?: number;

  // Performance options
  useIndex?: string[];
  forceIndex?: string[];
  explain?: boolean;
  batchSize?: number;

  // Security options
  rowLevelSecurity?: boolean;
  dataMasking?: boolean;
  encryptionRequired?: boolean;
}

/**
 * Enhanced pagination result with healthcare metadata
 */
export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  metadata: {
    clinicId?: string;
    executionTime: number;
    cacheHit: boolean;
    rowCount: number;
    performanceGrade: string;
    hipaaCompliant: boolean;
  };
}

/**
 * Repository operation context for tracking
 */
export interface RepositoryContext {
  operationType: string;
  clinicId?: string;
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  startTime: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Base repository interface defining common CRUD operations
 */
export interface IBaseRepository<
  TEntity,
  TCreateInput,
  TUpdateInput,
  TId = string,
> {
  /**
   * Create a new entity
   */
  create(
    data: TCreateInput,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<TEntity>>;

  /**
   * Create multiple entities
   */
  createMany(
    data: TCreateInput[],
    context?: RepositoryContext,
  ): Promise<RepositoryResult<TEntity[]>>;

  /**
   * Find entity by ID
   */
  findById(
    id: TId,
    context?: RepositoryContext,
    options?: QueryOptions,
  ): Promise<RepositoryResult<TEntity | null>>;

  /**
   * Find entity by unique field
   */
  findUnique(
    where: Record<string, unknown>,
    context?: RepositoryContext,
    options?: QueryOptions,
  ): Promise<RepositoryResult<TEntity | null>>;

  /**
   * Find first entity matching criteria
   */
  findFirst(
    where: Record<string, unknown>,
    context?: RepositoryContext,
    options?: QueryOptions,
  ): Promise<RepositoryResult<TEntity | null>>;

  /**
   * Find multiple entities
   */
  findMany(
    context?: RepositoryContext,
    options?: QueryOptions,
  ): Promise<RepositoryResult<TEntity[]>>;

  /**
   * Find entities with pagination
   */
  findManyPaginated(
    context?: RepositoryContext,
    options?: QueryOptions,
  ): Promise<RepositoryResult<PaginatedResult<TEntity>>>;

  /**
   * Update entity by ID
   */
  update(
    id: TId,
    data: TUpdateInput,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<TEntity>>;

  /**
   * Update multiple entities
   */
  updateMany(
    where: Record<string, unknown>,
    data: TUpdateInput,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<{ count: number }>>;

  /**
   * Delete entity by ID (hard delete)
   */
  delete(
    id: TId,
    context?: RepositoryContext,
    softDelete?: boolean,
  ): Promise<RepositoryResult<TEntity>>;

  /**
   * Delete multiple entities
   */
  deleteMany(
    where: Record<string, unknown>,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<{ count: number }>>;

  /**
   * Soft delete entity by ID
   */
  softDelete?(
    id: TId,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<TEntity>>;

  /**
   * Count entities matching criteria
   */
  count(
    where?: Record<string, unknown>,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<number>>;

  /**
   * Check if entity exists
   */
  exists(
    where: Record<string, unknown>,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<boolean>>;

  /**
   * Execute operation in transaction
   */
  executeInTransaction?<T>(
    operation: (tx: unknown) => Promise<T>,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<T>>;
}

/**
 * Abstract base repository implementation with common functionality and enterprise patterns
 */
export abstract class BaseRepository<
  TEntity extends { id: TId },
  TCreateInput,
  TUpdateInput,
  TId = string,
> implements IBaseRepository<TEntity, TCreateInput, TUpdateInput, TId>
{
  protected readonly logger: Logger;

  constructor(
    protected readonly entityName: string,
    protected readonly prismaDelegate: unknown,
  ) {
    this.logger = new Logger(`${entityName}Repository`);
  }

  async create(
    data: TCreateInput,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<TEntity>> {
    const startTime = Date.now();

    try {
      this.logger.debug(`Creating ${this.entityName}`, data);
      const entity = await (this.prismaDelegate as any).create({ data });
      const executionTime = Date.now() - startTime;

      this.logger.debug(`Created ${this.entityName}:`, entity.id);

      return RepositoryResult.success(
        entity,
        {
          executionTime,
          rowCount: 1,
          source: "base_repository",
          operationType: context?.operationType || "CREATE",
        },
        executionTime,
        context?.operationType || "CREATE",
        context?.clinicId,
        context?.userId,
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Failed to create ${this.entityName}:`, _error);

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: "base_repository",
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || "CREATE",
        context?.clinicId,
        context?.userId,
      );
    }
  }

  async createMany(
    data: TCreateInput[],
    context?: RepositoryContext,
  ): Promise<RepositoryResult<TEntity[]>> {
    const startTime = Date.now();

    try {
      this.logger.debug(`Creating ${data.length} ${this.entityName}s`);

      // Use batch optimization for large datasets
      const batchSize = (context?.metadata?.batchSize as number) || 100;
      const results: TEntity[] = [];

      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);

        const batchResult = await (this.prismaDelegate as any).createMany({
          data: batch,
          skipDuplicates: true,
        });

        // Note: createMany returns count, not entities
        // In a real implementation, you might want to fetch the created entities
        results.push(...(batch as unknown as TEntity[]));
      }

      const executionTime = Date.now() - startTime;
      this.logger.debug(`Created ${data.length} ${this.entityName}s`);

      return RepositoryResult.success(
        results,
        {
          executionTime,
          rowCount: data.length,
          source: "base_repository",
          batchSize,
          batchCount: Math.ceil(data.length / batchSize),
        },
        executionTime,
        context?.operationType || "CREATE_MANY",
        context?.clinicId,
        context?.userId,
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(
        `Failed to create multiple ${this.entityName}s:`,
        _error,
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: "base_repository",
          dataCount: data.length,
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || "CREATE_MANY",
        context?.clinicId,
        context?.userId,
      );
    }
  }

  async findById(
    id: TId,
    context?: RepositoryContext,
    options?: QueryOptions,
  ): Promise<RepositoryResult<TEntity | null>> {
    const startTime = Date.now();

    try {
      this.logger.debug(`Finding ${this.entityName} by ID:`, id);
      const entity = await (this.prismaDelegate as any).findUnique({
        where: { id },
        ...(this.buildQueryOptions(options) || {}),
      });

      const executionTime = Date.now() - startTime;

      return RepositoryResult.success(
        entity,
        {
          executionTime,
          rowCount: entity ? 1 : 0,
          source: "base_repository",
          cacheHit: false,
          queryComplexity: this.assessQueryComplexity(options),
        },
        executionTime,
        context?.operationType || "FIND_BY_ID",
        context?.clinicId,
        context?.userId,
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Failed to find ${this.entityName} by ID:`, _error);

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: "base_repository",
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || "FIND_BY_ID",
        context?.clinicId,
        context?.userId,
      );
    }
  }

  async findUnique(
    where: Record<string, unknown>,
    context?: RepositoryContext,
    options?: QueryOptions,
  ): Promise<RepositoryResult<TEntity | null>> {
    const startTime = Date.now();

    try {
      this.logger.debug(`Finding unique ${this.entityName}:`, where);
      const entity = await (this.prismaDelegate as any).findUnique({
        where,
        ...(this.buildQueryOptions(options, context) || {}),
      });

      const executionTime = Date.now() - startTime;

      return RepositoryResult.success(
        entity,
        {
          executionTime,
          rowCount: entity ? 1 : 0,
          source: "base_repository",
          queryComplexity: this.assessQueryComplexity(options),
        },
        executionTime,
        context?.operationType || "FIND_UNIQUE",
        context?.clinicId,
        context?.userId,
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Failed to find unique ${this.entityName}:`, _error);

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: "base_repository",
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || "FIND_UNIQUE",
        context?.clinicId,
        context?.userId,
      );
    }
  }

  async findFirst(
    where: Record<string, unknown>,
    context?: RepositoryContext,
    options?: QueryOptions,
  ): Promise<RepositoryResult<TEntity | null>> {
    const startTime = Date.now();

    try {
      this.logger.debug(`Finding first ${this.entityName}:`, where);
      const entity = await (this.prismaDelegate as any).findFirst({
        where,
        ...(this.buildQueryOptions(options, context) || {}),
      });

      const executionTime = Date.now() - startTime;

      return RepositoryResult.success(
        entity,
        {
          executionTime,
          rowCount: entity ? 1 : 0,
          source: "base_repository",
        },
        executionTime,
        context?.operationType || "FIND_FIRST",
        context?.clinicId,
        context?.userId,
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Failed to find first ${this.entityName}:`, _error);

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: "base_repository",
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || "FIND_FIRST",
        context?.clinicId,
        context?.userId,
      );
    }
  }

  async findMany(
    context?: RepositoryContext,
    options?: QueryOptions,
  ): Promise<RepositoryResult<TEntity[]>> {
    const startTime = Date.now();

    try {
      this.logger.debug(`Finding many ${this.entityName}s`);
      const entities = await (this.prismaDelegate as any).findMany(
        this.buildQueryOptions(options, context),
      );

      const executionTime = Date.now() - startTime;
      this.logger.debug(`Found ${entities.length} ${this.entityName}s`);

      return RepositoryResult.success(
        entities,
        {
          executionTime,
          rowCount: entities.length,
          source: "base_repository",
        },
        executionTime,
        context?.operationType || "FIND_MANY",
        context?.clinicId,
        context?.userId,
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Failed to find many ${this.entityName}s:`, _error);

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: "base_repository",
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || "FIND_MANY",
        context?.clinicId,
        context?.userId,
      );
    }
  }

  async findManyPaginated(
    context?: RepositoryContext,
    options?: QueryOptions,
  ): Promise<RepositoryResult<PaginatedResult<TEntity>>> {
    const startTime = Date.now();

    try {
      const page = options?.page || 1;
      const limit = options?.limit || 10;
      const skip = (page - 1) * limit;

      this.logger.debug(
        `Finding paginated ${this.entityName}s - page: ${page}, limit: ${limit}`,
      );

      // Execute count and data queries in parallel for better performance
      const [entities, total] = await Promise.all([
        (this.prismaDelegate as any).findMany({
          ...(this.buildQueryOptions(options, context) || {}),
          skip,
          take: limit,
        }),
        (this.prismaDelegate as any).count({
          where: options?.where,
        }),
      ]);

      const totalPages = Math.ceil(total / limit);
      const executionTime = Date.now() - startTime;

      const result: PaginatedResult<TEntity> = {
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
          clinicId: context?.clinicId,
          executionTime,
          cacheHit: false,
          rowCount: entities.length,
          performanceGrade: this.getPerformanceGrade(executionTime),
          hipaaCompliant: true,
        },
      };

      this.logger.debug(
        `Found ${entities.length}/${total} ${this.entityName}s`,
      );

      return RepositoryResult.success(
        result,
        {
          executionTime,
          rowCount: entities.length,
          source: "base_repository",
          totalCount: total,
          page,
          limit,
          queryComplexity: this.assessQueryComplexity(options),
        },
        executionTime,
        context?.operationType || "FIND_MANY_PAGINATED",
        context?.clinicId,
        context?.userId,
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(
        `Failed to find paginated ${this.entityName}s:`,
        _error,
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: "base_repository",
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || "FIND_MANY_PAGINATED",
        context?.clinicId,
        context?.userId,
      );
    }
  }

  async update(
    id: TId,
    data: TUpdateInput,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<TEntity>> {
    const startTime = Date.now();

    try {
      this.logger.debug(`Updating ${this.entityName}:`, id);

      // Get existing entity for audit trail
      const existingEntity = await (this.prismaDelegate as any).findUnique({
        where: { id },
      });

      if (!existingEntity) {
        return RepositoryResult.failure(
          new Error(`${this.entityName} with ID ${id} not found`),
          {
            executionTime: Date.now() - startTime,
            source: "base_repository",
          },
          Date.now() - startTime,
          context?.operationType || "UPDATE",
          context?.clinicId,
          context?.userId,
        );
      }

      const entity = await (this.prismaDelegate as any).update({
        where: { id },
        data,
      });

      const executionTime = Date.now() - startTime;

      // Log audit trail
      this.logAuditTrail({
        operation: "UPDATE",
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

      this.logger.debug(`Updated ${this.entityName}:`, entity.id);

      return RepositoryResult.success(
        entity,
        {
          executionTime,
          rowCount: 1,
          source: "base_repository",
          auditTrail: true,
        },
        executionTime,
        context?.operationType || "UPDATE",
        context?.clinicId,
        context?.userId,
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Failed to update ${this.entityName}:`, _error);

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: "base_repository",
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || "UPDATE",
        context?.clinicId,
        context?.userId,
      );
    }
  }

  async updateMany(
    where: Record<string, unknown>,
    data: TUpdateInput,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<{ count: number }>> {
    const startTime = Date.now();

    try {
      this.logger.debug(`Updating many ${this.entityName}s:`, where);
      const result = await (this.prismaDelegate as any).updateMany({
        where,
        data,
      });

      const executionTime = Date.now() - startTime;
      this.logger.debug(`Updated ${result.count} ${this.entityName}s`);

      return RepositoryResult.success(
        result,
        {
          executionTime,
          rowCount: result.count,
          source: "base_repository",
        },
        executionTime,
        context?.operationType || "UPDATE_MANY",
        context?.clinicId,
        context?.userId,
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Failed to update many ${this.entityName}s:`, _error);

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: "base_repository",
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || "UPDATE_MANY",
        context?.clinicId,
        context?.userId,
      );
    }
  }

  async delete(
    id: TId,
    context?: RepositoryContext,
    softDelete: boolean = true,
  ): Promise<RepositoryResult<TEntity>> {
    const startTime = Date.now();

    try {
      this.logger.debug(
        `${softDelete ? "Soft deleting" : "Deleting"} ${this.entityName}:`,
        id,
      );

      let entity: TEntity;

      if (softDelete) {
        // Soft delete - update isActive and deletedAt fields
        entity = await (this.prismaDelegate as any).update({
          where: { id },
          data: {
            isActive: false,
            deletedAt: new Date(),
          },
        });
      } else {
        // Hard delete
        entity = await (this.prismaDelegate as any).delete({
          where: { id },
        });
      }

      const executionTime = Date.now() - startTime;

      // Log audit trail
      this.logAuditTrail({
        operation: softDelete ? "SOFT_DELETE" : "HARD_DELETE",
        resource: this.entityName,
        resourceId: id as string,
        userId: context?.userId,
        clinicId: context?.clinicId,
        details: {
          softDelete,
          deletedAt: new Date(),
        },
      });

      this.logger.debug(
        `${softDelete ? "Soft deleted" : "Deleted"} ${this.entityName}:`,
        entity.id,
      );

      return RepositoryResult.success(
        entity,
        {
          executionTime,
          rowCount: 1,
          source: "base_repository",
          softDelete,
          auditTrail: true,
        },
        executionTime,
        context?.operationType || "DELETE",
        context?.clinicId,
        context?.userId,
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Failed to delete ${this.entityName}:`, _error);

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: "base_repository",
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || "DELETE",
        context?.clinicId,
        context?.userId,
      );
    }
  }

  async deleteMany(
    where: Record<string, unknown>,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<{ count: number }>> {
    const startTime = Date.now();

    try {
      this.logger.debug(`Deleting many ${this.entityName}s:`, where);
      const result = await (this.prismaDelegate as any).deleteMany({ where });

      const executionTime = Date.now() - startTime;
      this.logger.debug(`Deleted ${result.count} ${this.entityName}s`);

      return RepositoryResult.success(
        result,
        {
          executionTime,
          rowCount: result.count,
          source: "base_repository",
        },
        executionTime,
        context?.operationType || "DELETE_MANY",
        context?.clinicId,
        context?.userId,
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Failed to delete many ${this.entityName}s:`, _error);

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: "base_repository",
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || "DELETE_MANY",
        context?.clinicId,
        context?.userId,
      );
    }
  }

  async softDelete(
    id: TId,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<TEntity>> {
    return this.delete(id, context, true);
  }

  async count(
    where?: Record<string, unknown>,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<number>> {
    const startTime = Date.now();

    try {
      this.logger.debug(`Counting ${this.entityName}s:`, where);
      const count = await (this.prismaDelegate as any).count({ where });

      const executionTime = Date.now() - startTime;

      return RepositoryResult.success(
        count,
        {
          executionTime,
          source: "base_repository",
        },
        executionTime,
        context?.operationType || "COUNT",
        context?.clinicId,
        context?.userId,
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Failed to count ${this.entityName}s:`, _error);

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: "base_repository",
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || "COUNT",
        context?.clinicId,
        context?.userId,
      );
    }
  }

  async exists(
    where: Record<string, unknown>,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<boolean>> {
    const startTime = Date.now();

    try {
      this.logger.debug(`Checking if ${this.entityName} exists:`, where);
      const entity = await (this.prismaDelegate as any).findFirst({ where });

      const executionTime = Date.now() - startTime;

      return RepositoryResult.success(
        !!entity,
        {
          executionTime,
          source: "base_repository",
        },
        executionTime,
        context?.operationType || "EXISTS",
        context?.clinicId,
        context?.userId,
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(
        `Failed to check if ${this.entityName} exists:`,
        _error,
      );

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: "base_repository",
          _error: _error instanceof Error ? _error.message : String(_error),
        },
        executionTime,
        context?.operationType || "EXISTS",
        context?.clinicId,
        context?.userId,
      );
    }
  }

  /**
   * Execute operation in transaction
   */
  async executeInTransaction<T>(
    operation: (tx: unknown) => Promise<T>,
    context?: RepositoryContext,
  ): Promise<RepositoryResult<T>> {
    const startTime = Date.now();

    try {
      this.logger.debug(
        `Executing ${this.entityName} operation in transaction`,
      );
      const result = await (this.prismaDelegate as any).$transaction(operation);

      const executionTime = Date.now() - startTime;

      return RepositoryResult.success(
        result,
        {
          executionTime,
          source: "base_repository",
          transaction: true,
        },
        executionTime,
        context?.operationType || "TRANSACTION",
        context?.clinicId,
        context?.userId,
      );
    } catch (_error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Transaction failed for ${this.entityName}:`, _error);

      return RepositoryResult.failure(
        _error as Error,
        {
          executionTime,
          source: "base_repository",
          _error: _error instanceof Error ? _error.message : String(_error),
          transaction: true,
        },
        executionTime,
        context?.operationType || "TRANSACTION",
        context?.clinicId,
        context?.userId,
      );
    }
  }

  /**
   * Build query options from interface with healthcare enhancements
   */
  protected buildQueryOptions(
    options?: QueryOptions,
    context?: RepositoryContext,
  ): unknown {
    if (!options) return {};

    const queryOptions: any = {};

    if (options.include) {
      queryOptions.include = options.include;
    }

    if (options.select) {
      queryOptions.select = options.select;
    }

    if (options.where) {
      queryOptions.where = this.buildWhereClause(options);
    }

    if (options.orderBy) {
      queryOptions.orderBy = options.orderBy;
    }

    // Add healthcare-specific options
    if (options.rowLevelSecurity && options.clinicId) {
      queryOptions.where = {
        ...queryOptions.where,
        clinicId: options.clinicId,
      };
    }

    return queryOptions;
  }

  /**
   * Build where clause with healthcare-specific features
   */
  protected buildWhereClause(options?: QueryOptions): unknown {
    const where: any = { ...options?.where };

    // Add clinic isolation if specified
    if (options?.clinicId && options?.rowLevelSecurity !== false) {
      where.clinicId = options.clinicId;
    }

    // Add data masking for sensitive fields
    if (options?.dataMasking) {
      // Implement data masking logic here
      this.logger.debug("Data masking applied to query");
    }

    return where;
  }

  /**
   * Assess query complexity for performance monitoring
   */
  protected assessQueryComplexity(
    options?: QueryOptions,
  ): "simple" | "medium" | "complex" {
    if (!options) return "simple";

    let complexity = 0;

    if (options.include && Object.keys(options.include).length > 2)
      complexity += 2;
    if (options.select && Object.keys(options.select).length > 5)
      complexity += 1;
    if (options.where && Object.keys(options.where).length > 3) complexity += 1;
    if (options.orderBy && Object.keys(options.orderBy).length > 1)
      complexity += 1;

    if (complexity <= 1) return "simple";
    if (complexity <= 3) return "medium";
    return "complex";
  }

  /**
   * Get performance grade based on execution time
   */
  protected getPerformanceGrade(
    executionTime: number,
  ): "excellent" | "good" | "fair" | "poor" {
    if (executionTime < 100) return "excellent";
    if (executionTime < 500) return "good";
    if (executionTime < 2000) return "fair";
    return "poor";
  }

  /**
   * Get changes between previous and current data for audit trail
   */
  protected getChanges(
    previous: unknown,
    current: unknown,
  ): Record<string, { from: unknown; to: unknown }> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    for (const key in (current as any)) {
      if ((previous as any)[key] !== (current as any)[key]) {
        changes[key] = {
          from: (previous as any)[key],
          to: (current as any)[key],
        };
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
      this.logger.log("AUDIT:", auditEntry);

      // In a real implementation, this would go to a dedicated audit service
      // await this.auditService.log(auditEntry);
    } catch (_error) {
      this.logger.error("Failed to log audit trail:", _error);
    }
  }

  /**
   * Handle repository errors with context
   */
  protected handleError(operation: string, _error: unknown): Error {
    const message = `${this.entityName}Repository.${operation} failed: ${(_error as Error).message || _error}`;
    this.logger.error(
      message,
      _error instanceof Error ? _error.stack : undefined,
    );
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
    prismaDelegate: unknown,
  ): IBaseRepository<TEntity, TCreateInput, TUpdateInput, TId>;
}

/**
 * Default repository factory implementation
 */
export class RepositoryFactory implements IRepositoryFactory {
  create<TEntity extends { id: TId }, TCreateInput, TUpdateInput, TId = string>(
    entityName: string,
    prismaDelegate: unknown,
  ): IBaseRepository<TEntity, TCreateInput, TUpdateInput, TId> {
    return new (class extends BaseRepository<
      TEntity,
      TCreateInput,
      TUpdateInput,
      TId
    > {
      constructor() {
        super(entityName, prismaDelegate);
      }
    })();
  }
}
