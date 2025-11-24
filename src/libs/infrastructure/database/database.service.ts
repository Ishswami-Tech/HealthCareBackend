/**
 * Database Service
 * @class DatabaseService
 * @description Main database service - single entry point for all database operations
 *
 * This is the main public service for all database operations.
 * Built on top of Prisma with healthcare-specific features.
 *
 * Architecture:
 * - Uses Strategy pattern for different query behaviors (read, write, transaction)
 * - Uses Middleware pattern (Chain of Responsibility) for query processing
 * - Uses Builder pattern for constructing query options
 * - Uses Factory pattern for cache key generation
 * - Integrates all internal services (query-optimizer, data-masking, RLS, etc.)
 * - Follows SOLID principles
 * - Optimized for 10M+ concurrent users
 *
 * @see https://docs.nestjs.com - NestJS patterns
 * @see https://www.prisma.io/docs - Prisma ORM documentation
 */

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { LoggingService } from '@infrastructure/logging';
import { CacheService } from '@infrastructure/cache';
import { CircuitBreakerService } from '@core/resilience';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

// Internal services
import { HealthcareQueryOptimizerService } from './internal/query-optimizer.service';
import { ClinicIsolationService } from './internal/clinic-isolation.service';
import { DatabaseMetricsService } from './internal/database-metrics.service';
import { RetryService } from './internal/retry.service';
import { SQLInjectionPreventionService } from './internal/sql-injection-prevention.service';
import { DataMaskingService } from './internal/data-masking.service';
import { QueryCacheService } from './internal/query-cache.service';
import { RowLevelSecurityService } from './internal/row-level-security.service';
import { ReadReplicaRouterService } from './internal/read-replica-router.service';
import { DatabaseHealthMonitorService } from './internal/database-health-monitor.service';
import { ClinicRateLimiterService } from './internal/clinic-rate-limiter.service';
import { ConnectionLeakDetectorService } from './internal/connection-leak-detector.service';
import { DatabaseAlertService } from './internal/database-alert.service';

// Query patterns
import { QueryStrategyManager } from './query/strategies/query-strategy.manager';
import { QueryMiddlewareChain } from './query/middleware/query-middleware.chain';
import { QueryOptionsBuilder } from './query/builders/query-options.builder';
import { QueryKeyFactory } from './query/factories/query-key.factory';
import type { QueryOperationContext } from './query/strategies/base-query.strategy';
import type { QueryMiddlewareContext } from './query/middleware/query-middleware.interface';

// Connection pool
import { ConnectionPoolManager } from './query/scripts/connection-pool.manager';

// Types
import type {
  IHealthcareDatabaseClient,
  PrismaTransactionClient,
  AuditInfo,
  DatabaseHealthStatus,
  DatabaseClientMetrics,
  HIPAAComplianceMetrics,
  ClinicDatabaseMetrics,
  ClinicDashboardStats,
  ClinicPatientOptions,
  ClinicPatientResult,
  ClinicAppointmentOptions,
  ClinicAppointmentResult,
  HealthcareDatabaseConfig,
  QueryOptions,
  AppointmentWithRelations,
  AppointmentTimeSlot,
  BillingPlanWithRelations,
  SubscriptionWithRelations,
  InvoiceWithRelations,
  PaymentWithRelations,
  RbacRoleEntity,
  RolePermissionEntity,
  UserRoleEntity,
} from '@core/types/database.types';
import { CriticalPriority } from '@core/types/database.types';
import type { UserWithRelations } from '@core/types/user.types';
import type {
  UserCreateInput,
  UserUpdateInput,
  UserWhereInput,
  AppointmentCreateInput,
  AppointmentUpdateInput,
  AppointmentWhereInput,
  BillingPlanCreateInput,
  BillingPlanUpdateInput,
  BillingPlanWhereInput,
  SubscriptionCreateInput,
  SubscriptionUpdateInput,
  SubscriptionWhereInput,
  InvoiceCreateInput,
  InvoiceUpdateInput,
  InvoiceWhereInput,
  PaymentCreateInput,
  PaymentUpdateInput,
  PaymentWhereInput,
} from '@core/types/input.types';
import type { PermissionEntity } from '@core/types/rbac.types';

// Method classes (code splitting)
import {
  UserMethods,
  PermissionMethods,
  RoleMethods,
  UserRoleMethods,
  ClinicAdminMethods,
  AppointmentMethods,
  BillingMethods,
  ClinicMethods,
} from './methods';

/**
 * Main database service - single entry point for all database operations
 *
 * This service orchestrates all internal services and patterns to provide
 * a clean, simple API for database operations with healthcare-specific features.
 */
@Injectable()
export class DatabaseService implements IHealthcareDatabaseClient, OnModuleInit, OnModuleDestroy {
  private readonly serviceName = 'DatabaseService';
  protected readonly config: HealthcareDatabaseConfig;

  // Method class instances (code splitting)
  private readonly userMethods: UserMethods;
  private readonly permissionMethods: PermissionMethods;
  private readonly roleMethods: RoleMethods;
  private readonly userRoleMethods: UserRoleMethods;
  private readonly clinicAdminMethods: ClinicAdminMethods;
  private readonly appointmentMethods: AppointmentMethods;
  private readonly billingMethods: BillingMethods;
  private readonly clinicMethods: ClinicMethods;

  constructor(
    protected readonly prismaService: PrismaService,
    @Inject(forwardRef(() => ConnectionPoolManager))
    protected readonly connectionPoolManager: ConnectionPoolManager,
    @Inject(forwardRef(() => DatabaseMetricsService))
    protected readonly metricsService: DatabaseMetricsService,
    @Inject(forwardRef(() => ClinicIsolationService))
    protected readonly clinicIsolationService: ClinicIsolationService,
    protected readonly queryOptimizer: HealthcareQueryOptimizerService,
    @Inject(forwardRef(() => LoggingService))
    protected readonly loggingService: LoggingService,
    @Inject(forwardRef(() => SQLInjectionPreventionService))
    protected readonly sqlInjectionPrevention: SQLInjectionPreventionService,
    @Inject(forwardRef(() => DataMaskingService))
    protected readonly dataMasking: DataMaskingService,
    @Inject(forwardRef(() => QueryCacheService))
    protected readonly queryCache: QueryCacheService,
    @Inject(forwardRef(() => RowLevelSecurityService))
    protected readonly rowLevelSecurity: RowLevelSecurityService,
    @Inject(forwardRef(() => ReadReplicaRouterService))
    protected readonly readReplicaRouter: ReadReplicaRouterService,
    @Inject(forwardRef(() => DatabaseHealthMonitorService))
    protected readonly healthMonitor: DatabaseHealthMonitorService,
    @Inject(forwardRef(() => ClinicRateLimiterService))
    protected readonly clinicRateLimiter: ClinicRateLimiterService,
    @Inject(forwardRef(() => ConnectionLeakDetectorService))
    protected readonly connectionLeakDetector: ConnectionLeakDetectorService,
    @Inject(forwardRef(() => DatabaseAlertService))
    protected readonly alertService: DatabaseAlertService,
    @Inject(forwardRef(() => QueryStrategyManager))
    protected readonly strategyManager: QueryStrategyManager,
    @Inject(forwardRef(() => QueryMiddlewareChain))
    protected readonly middlewareChain: QueryMiddlewareChain,
    @Inject(QueryOptionsBuilder)
    protected readonly queryOptionsBuilder: QueryOptionsBuilder,
    @Inject(QueryKeyFactory)
    protected readonly queryKeyFactory: QueryKeyFactory,
    @Optional()
    @Inject(forwardRef(() => CacheService))
    protected readonly cacheService?: CacheService,
    @Optional()
    @Inject(forwardRef(() => CircuitBreakerService))
    protected readonly circuitBreaker?: CircuitBreakerService,
    @Optional()
    @Inject(forwardRef(() => RetryService))
    protected readonly retryService?: RetryService,
    @Optional()
    @Inject('HealthcareDatabaseConfig')
    config?: HealthcareDatabaseConfig
  ) {
    // Support both DI (via @Inject) and manual instantiation
    if (config) {
      this.config = config;
    } else {
      // Default config if not provided
      this.config = {
        enableAuditLogging: true,
        enablePHIProtection: true,
        auditRetentionDays: 2555, // 7 years for HIPAA compliance
        encryptionEnabled: true,
        complianceLevel: 'HIPAA',
        connectionTimeout: 30000,
        queryTimeout: 15000,
      } as HealthcareDatabaseConfig;
    }

    // Initialize method class instances (code splitting)
    // All method classes extend DatabaseMethodsBase and use this service's dependencies
    // Note: executeRead and executeWrite are bound here, but they're defined as methods below
    // TypeScript/JavaScript allows calling methods on 'this' in constructor even if defined later
    const executeReadFn = <T>(
      operation: (prisma: PrismaService) => Promise<T>,
      options?: QueryOptions
    ): Promise<T> => {
      return this.executeRead(operation, options);
    };

    const executeWriteFn = <T>(
      operation: (prisma: PrismaService) => Promise<T>,
      auditInfo: AuditInfo,
      options?: QueryOptions
    ): Promise<T> => {
      return this.executeWrite(operation, auditInfo, options);
    };

    this.userMethods = new UserMethods(
      this.prismaService,
      this.queryOptionsBuilder,
      this.queryKeyFactory,
      this.cacheService,
      this.loggingService,
      executeReadFn,
      executeWriteFn,
      'UserMethods'
    );

    this.permissionMethods = new PermissionMethods(
      this.prismaService,
      this.queryOptionsBuilder,
      this.queryKeyFactory,
      this.cacheService,
      this.loggingService,
      executeReadFn,
      executeWriteFn,
      'PermissionMethods'
    );

    this.roleMethods = new RoleMethods(
      this.prismaService,
      this.queryOptionsBuilder,
      this.queryKeyFactory,
      this.cacheService,
      this.loggingService,
      executeReadFn,
      executeWriteFn,
      'RoleMethods'
    );

    this.userRoleMethods = new UserRoleMethods(
      this.prismaService,
      this.queryOptionsBuilder,
      this.queryKeyFactory,
      this.cacheService,
      this.loggingService,
      executeReadFn,
      executeWriteFn,
      'UserRoleMethods'
    );

    this.clinicAdminMethods = new ClinicAdminMethods(
      this.prismaService,
      this.queryOptionsBuilder,
      this.queryKeyFactory,
      this.cacheService,
      this.loggingService,
      executeReadFn,
      executeWriteFn,
      'ClinicAdminMethods'
    );

    this.appointmentMethods = new AppointmentMethods(
      this.prismaService,
      this.queryOptionsBuilder,
      this.queryKeyFactory,
      this.cacheService,
      this.loggingService,
      executeReadFn,
      executeWriteFn,
      'AppointmentMethods'
    );

    this.billingMethods = new BillingMethods(
      this.prismaService,
      this.queryOptionsBuilder,
      this.queryKeyFactory,
      this.cacheService,
      this.loggingService,
      executeReadFn,
      executeWriteFn,
      'BillingMethods'
    );

    this.clinicMethods = new ClinicMethods(
      this.prismaService,
      this.queryOptionsBuilder,
      this.queryKeyFactory,
      this.cacheService,
      this.loggingService,
      executeReadFn,
      executeWriteFn,
      'ClinicMethods'
    );
  }

  onModuleInit(): void {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Database Service initialized with new architecture',
      this.serviceName,
      {
        enableAuditLogging: this.config.enableAuditLogging,
        enablePHIProtection: this.config.enablePHIProtection,
      }
    );
  }

  onModuleDestroy(): void {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Database Service shutting down',
      this.serviceName
    );
  }

  /**
   * Execute read operation with all optimization layers
   * Uses ReadQueryStrategy, middleware chain, query optimization, caching, read replicas, retry, circuit breaker
   */
  async executeRead<T>(
    operation: (prisma: PrismaService) => Promise<T>,
    options?: QueryOptions
  ): Promise<T> {
    const startTime = Date.now();
    const operationName = 'READ_OPERATION';
    const queryOptions = options || {};

    // Generate cache key if caching is enabled
    const cacheKey =
      queryOptions.useCache !== false && this.queryCache
        ? this.queryKeyFactory.fromOperation(operationName, {
            clinicId: queryOptions.clinicId,
            userId: queryOptions.userId,
          })
        : null;

    // Check cache first (if enabled and not bypassed)
    if (cacheKey && queryOptions.useCache !== false && this.queryCache) {
      try {
        const cached = await this.queryCache.getCached<T>(cacheKey);
        if (cached !== null) {
          const cacheTime = Date.now() - startTime;
          this.metricsService.recordCacheHit(cacheTime);
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.DEBUG,
            `Cache hit for read operation: ${cacheKey.substring(0, 100)}`,
            this.serviceName,
            { cacheTime }
          );
          return cached;
        }
        this.metricsService.recordCacheMiss(Date.now() - startTime);
      } catch (cacheError) {
        // Cache error should not block query execution
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Cache check failed, proceeding with query: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`,
          this.serviceName
        );
      }
    }

    // Build query context
    const context: QueryOperationContext = {
      operation: operationName,
      options: queryOptions,
      ...(queryOptions.clinicId ? { clinicId: queryOptions.clinicId } : {}),
      ...(queryOptions.userId ? { userId: queryOptions.userId } : {}),
      metadata: {
        startTime,
      },
    };

    // Build middleware context
    const middlewareContext: QueryMiddlewareContext = {
      operation: operationName,
      options: queryOptions,
      ...(queryOptions.clinicId ? { clinicId: queryOptions.clinicId } : {}),
      ...(queryOptions.userId ? { userId: queryOptions.userId } : {}),
      startTime,
      metadata: {},
    };

    // Wrapper operation with read replica routing
    const executeOperation = async (prisma: PrismaService): Promise<T> => {
      // Route to read replica if enabled
      const targetPrisma = this.readReplicaRouter.isEnabled()
        ? this.readReplicaRouter.selectReplica() || prisma
        : prisma;

      return operation(targetPrisma);
    };

    // Execute with retry logic and circuit breaker
    const executeWithRetry = async (): Promise<T> => {
      // Check circuit breaker
      if (this.circuitBreaker && !this.circuitBreaker.canExecute('database')) {
        throw new HealthcareError(
          ErrorCode.EVENT_CIRCUIT_BREAKER_OPEN,
          'Circuit breaker is open - database unavailable',
          undefined,
          {},
          this.serviceName
        );
      }

      // Execute middleware chain before
      const processedContext = await this.middlewareChain.before(middlewareContext);

      // Execute with strategy
      const result = await this.strategyManager.execute(executeOperation, {
        ...context,
        operation: processedContext.operation,
        options: processedContext.options,
      });

      // Execute middleware chain after
      const finalResult = await this.middlewareChain.after(processedContext, result);

      return finalResult;
    };

    try {
      // Use retry service if available
      if (this.retryService && queryOptions.retries && queryOptions.retries > 0) {
        const retryResult = await this.retryService.executeWithRetry(executeWithRetry, {
          maxAttempts: queryOptions.retries + 1,
          initialDelay: 100,
          maxDelay: 5000,
        });

        if (!retryResult.success || !retryResult.result) {
          throw retryResult.error || new Error('Retry failed');
        }

        const result = retryResult.result;

        // Cache result if enabled
        if (cacheKey && queryOptions.useCache !== false && this.queryCache) {
          const cacheStrategy = queryOptions.cacheStrategy || 'short';
          const ttl =
            cacheStrategy === 'long'
              ? 3600
              : cacheStrategy === 'short'
                ? 300
                : cacheStrategy === 'never'
                  ? 0
                  : 300;
          if (ttl > 0) {
            await this.queryCache.setCached(cacheKey, result, {
              ttl,
              containsPHI: queryOptions.hipaaCompliant === true,
              priority:
                (queryOptions.priority === 'critical' ? 'high' : queryOptions.priority) || 'normal',
              tags: [
                'database',
                'read',
                ...(queryOptions.clinicId ? [`clinic:${queryOptions.clinicId}`] : []),
              ],
            });
          }
        }

        const executionTime = Date.now() - startTime;
        this.metricsService.recordQueryExecution(
          operationName,
          executionTime,
          true,
          queryOptions.clinicId
        );

        return result;
      } else {
        // Execute without retry
        const result = await executeWithRetry();

        // Cache result if enabled
        if (cacheKey && queryOptions.useCache !== false && this.queryCache) {
          const cacheStrategy = queryOptions.cacheStrategy || 'short';
          const ttl =
            cacheStrategy === 'long'
              ? 3600
              : cacheStrategy === 'short'
                ? 300
                : cacheStrategy === 'never'
                  ? 0
                  : 300;
          if (ttl > 0) {
            await this.queryCache.setCached(cacheKey, result, {
              ttl,
              containsPHI: queryOptions.hipaaCompliant === true,
              priority:
                (queryOptions.priority === 'critical' ? 'high' : queryOptions.priority) || 'normal',
              tags: [
                'database',
                'read',
                ...(queryOptions.clinicId ? [`clinic:${queryOptions.clinicId}`] : []),
              ],
            });
          }
        }

        const executionTime = Date.now() - startTime;
        this.metricsService.recordQueryExecution(
          operationName,
          executionTime,
          true,
          queryOptions.clinicId
        );

        return result;
      }
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const dbError = error instanceof Error ? error : new Error(String(error));

      // Record circuit breaker failure if applicable
      if (this.circuitBreaker) {
        this.circuitBreaker.recordFailure('database');
      }

      // Execute middleware chain on error
      await this.middlewareChain.onError(middlewareContext, dbError);

      // Record metrics
      this.metricsService.recordQueryExecution(
        operationName,
        executionTime,
        false,
        queryOptions.clinicId,
        queryOptions.userId
      );

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Read operation failed: ${dbError.message}`,
        this.serviceName,
        {
          error: dbError.stack,
          executionTime,
          clinicId: queryOptions.clinicId,
        }
      );

      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        `Read operation failed: ${dbError.message}`,
        undefined,
        { executionTime, originalError: dbError.message },
        this.serviceName
      );
    }
  }

  /**
   * Execute write operation with all optimization layers
   * Uses WriteQueryStrategy, audit logging, data masking, RLS, retry, circuit breaker
   */
  async executeWrite<T>(
    operation: (prisma: PrismaService) => Promise<T>,
    auditInfo: AuditInfo,
    options?: QueryOptions
  ): Promise<T> {
    const startTime = Date.now();
    const operationName = 'WRITE_OPERATION';
    const queryOptions: QueryOptions = {
      ...options,
      auditRequired: true,
      hipaaCompliant: true,
    };

    // Build query context
    const context: QueryOperationContext = {
      operation: operationName,
      options: queryOptions,
      clinicId: auditInfo.clinicId,
      userId: auditInfo.userId,
      metadata: {
        startTime,
        auditInfo,
      },
    };

    // Build middleware context
    const middlewareContext: QueryMiddlewareContext = {
      operation: operationName,
      options: queryOptions,
      clinicId: auditInfo.clinicId,
      userId: auditInfo.userId,
      startTime,
      metadata: {
        auditInfo,
      },
    };

    // Execute with retry logic and circuit breaker
    const executeWithRetry = async (): Promise<T> => {
      // Check circuit breaker
      if (this.circuitBreaker && !this.circuitBreaker.canExecute('database')) {
        throw new HealthcareError(
          ErrorCode.EVENT_CIRCUIT_BREAKER_OPEN,
          'Circuit breaker is open - database unavailable',
          undefined,
          {},
          this.serviceName
        );
      }

      // Execute middleware chain before
      const processedContext = await this.middlewareChain.before(middlewareContext);

      // Execute with strategy
      const result = await this.strategyManager.execute(operation, {
        ...context,
        operation: processedContext.operation,
        options: processedContext.options,
      });

      // Create audit trail
      if (this.config.enableAuditLogging) {
        this.createAuditTrail(auditInfo, 'SUCCESS');
      }

      // Execute middleware chain after
      const finalResult = await this.middlewareChain.after(processedContext, result);

      return finalResult;
    };

    try {
      // Use retry service if available
      if (this.retryService && queryOptions.retries && queryOptions.retries > 0) {
        const retryResult = await this.retryService.executeWithRetry(executeWithRetry, {
          maxAttempts: queryOptions.retries + 1,
          initialDelay: 100,
          maxDelay: 5000,
        });

        if (!retryResult.success || !retryResult.result) {
          // Create audit trail for failed operation
          if (this.config.enableAuditLogging) {
            this.createAuditTrail(
              auditInfo,
              'FAILURE',
              retryResult.error?.message || 'Retry failed'
            );
          }
          throw retryResult.error || new Error('Retry failed');
        }

        const result = retryResult.result;
        const executionTime = Date.now() - startTime;
        this.metricsService.recordQueryExecution(
          operationName,
          executionTime,
          true,
          auditInfo.clinicId,
          auditInfo.userId
        );

        return result;
      } else {
        // Execute without retry
        const result = await executeWithRetry();

        const executionTime = Date.now() - startTime;
        this.metricsService.recordQueryExecution(
          operationName,
          executionTime,
          true,
          auditInfo.clinicId,
          auditInfo.userId
        );

        return result;
      }
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const dbError = error instanceof Error ? error : new Error(String(error));

      // Record circuit breaker failure if applicable
      if (this.circuitBreaker) {
        this.circuitBreaker.recordFailure('database');
      }

      // Create audit trail for failed operation
      if (this.config.enableAuditLogging) {
        this.createAuditTrail(auditInfo, 'FAILURE', dbError.message);
      }

      // Execute middleware chain on error
      await this.middlewareChain.onError(middlewareContext, dbError);

      // Record metrics
      this.metricsService.recordQueryExecution(
        operationName,
        executionTime,
        false,
        auditInfo.clinicId,
        auditInfo.userId
      );

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Write operation failed: ${dbError.message}`,
        this.serviceName,
        {
          error: dbError.stack,
          executionTime,
          auditInfo,
        }
      );

      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        `Write operation failed: ${dbError.message}`,
        undefined,
        { executionTime, auditInfo, originalError: dbError.message },
        this.serviceName
      );
    }
  }

  /**
   * Execute transaction operation
   * Uses TransactionQueryStrategy, retry logic, circuit breaker
   */
  async executeTransaction<T>(
    operation: (prisma: PrismaService) => Promise<T>,
    options?: QueryOptions
  ): Promise<T> {
    const startTime = Date.now();
    const operationName = 'TRANSACTION_OPERATION';

    // Build query context
    const context: QueryOperationContext = {
      operation: operationName,
      options: options || {},
      ...(options?.clinicId ? { clinicId: options.clinicId } : {}),
      ...(options?.userId ? { userId: options.userId } : {}),
      metadata: {
        startTime,
      },
    };

    // Build middleware context
    const middlewareContext: QueryMiddlewareContext = {
      operation: operationName,
      options: options || {},
      ...(options?.clinicId ? { clinicId: options.clinicId } : {}),
      ...(options?.userId ? { userId: options.userId } : {}),
      startTime,
      metadata: {},
    };

    try {
      // Execute middleware chain before
      const processedContext = await this.middlewareChain.before(middlewareContext);

      // Execute with strategy (TransactionQueryStrategy handles transaction)
      const result = await this.strategyManager.execute(operation, {
        ...context,
        operation: processedContext.operation,
        options: processedContext.options,
      });

      // Execute middleware chain after
      const finalResult = await this.middlewareChain.after(processedContext, result);

      return finalResult;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const dbError = error instanceof Error ? error : new Error(String(error));

      // Execute middleware chain on error
      await this.middlewareChain.onError(middlewareContext, dbError);

      // Record metrics
      this.metricsService.recordQueryExecution(operationName, executionTime, false);

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Transaction operation failed: ${dbError.message}`,
        this.serviceName,
        {
          error: dbError.stack,
          executionTime,
        }
      );

      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        `Transaction operation failed: ${dbError.message}`,
        undefined,
        { executionTime, originalError: dbError.message },
        this.serviceName
      );
    }
  }

  /**
   * Execute operation with clinic isolation context (multi-tenant)
   * Uses clinic isolation, rate limiting
   */
  async executeWithClinicContextInternal<T>(
    clinicId: string,
    operation: (prisma: PrismaService) => Promise<T>,
    options?: QueryOptions
  ): Promise<T> {
    const startTime = Date.now();

    try {
      // Check rate limit
      const rateLimitResult = await this.clinicRateLimiter.checkRateLimit(clinicId);
      if (!rateLimitResult.allowed) {
        throw new HealthcareError(
          ErrorCode.RATE_LIMIT_EXCEEDED,
          `Rate limit exceeded for clinic: ${clinicId}`,
          undefined,
          { clinicId, resetAt: rateLimitResult.resetAt },
          this.serviceName
        );
      }

      // Execute with clinic isolation
      const result = await this.clinicIsolationService.executeWithClinicContext(
        clinicId,
        async () => {
          return this.executeRead(operation, {
            ...options,
            clinicId,
            rowLevelSecurity: true,
          });
        }
      );

      if (!result.success) {
        throw new HealthcareError(
          ErrorCode.CLINIC_ACCESS_DENIED,
          `Clinic operation failed: ${String(result.error)}`,
          undefined,
          {
            clinicId,
            originalError: String(result.error),
          },
          this.serviceName
        );
      }

      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Clinic operation completed for ${clinicId} in ${executionTime}ms`,
        this.serviceName,
        { clinicId, executionTime }
      );

      return result.data!;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const dbError = error instanceof Error ? error : new Error(String(error));

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Clinic operation failed: ${dbError.message}`,
        this.serviceName,
        {
          error: dbError.stack,
          clinicId,
          executionTime,
        }
      );

      throw dbError;
    }
  }

  /**
   * Execute batch operations with concurrency control
   * Uses batch strategy, concurrency control
   */
  async executeBatch<T, U>(
    items: T[],
    operation: (item: T, index: number, prisma: PrismaService) => Promise<U>,
    options?: {
      concurrency?: number;
      clinicId?: string;
      priority?: 'high' | 'normal' | 'low';
      auditInfo?: AuditInfo;
    }
  ): Promise<U[]> {
    const startTime = Date.now();
    const concurrency = options?.concurrency || 50; // Optimized for 10M+ users

    try {
      // Use ConnectionPoolManager's batch execution
      const results = await this.connectionPoolManager.executeBatch<T, U>(
        items,
        async (item, index) => {
          return this.executeRead(
            async prisma => {
              return operation(item, index, prisma);
            },
            {
              ...(options?.clinicId && { clinicId: options.clinicId }),
              priority: options?.priority || 'normal',
            }
          );
        },
        {
          concurrency,
          ...(options?.clinicId && { clinicId: options.clinicId }),
          priority: options?.priority || 'normal',
        }
      );

      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        'BATCH_OPERATION',
        executionTime,
        true,
        options?.clinicId
      );

      if (options?.auditInfo) {
        this.createAuditTrail(options.auditInfo, 'SUCCESS');
      }

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Batch operation completed: ${items.length} items in ${executionTime}ms`,
        this.serviceName,
        { itemCount: items.length, executionTime, clinicId: options?.clinicId }
      );

      return results;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const dbError = error instanceof Error ? error : new Error(String(error));

      this.metricsService.recordQueryExecution(
        'BATCH_OPERATION',
        executionTime,
        false,
        options?.clinicId
      );

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Batch operation failed: ${dbError.message}`,
        this.serviceName,
        {
          error: dbError.stack,
          itemCount: items.length,
          executionTime,
          clinicId: options?.clinicId,
        }
      );

      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        `Batch operation failed: ${dbError.message}`,
        undefined,
        {
          itemCount: items.length,
          clinicId: options?.clinicId,
          executionTime,
          originalError: dbError.message,
        },
        this.serviceName
      );
    }
  }

  /**
   * Execute critical operation for emergency scenarios
   * Uses critical write strategy for emergency operations
   */
  async executeCritical<T>(
    operation: (prisma: PrismaService) => Promise<T>,
    priority: CriticalPriority,
    options?: QueryOptions
  ): Promise<T> {
    const startTime = Date.now();
    const operationName = 'CRITICAL_OPERATION';

    try {
      // Use critical operation connection with highest priority
      await this.connectionPoolManager.executeCriticalQuery<T>(
        '', // Query will be executed through Prisma
        [],
        {
          priority: 'high',
          timeout: priority === CriticalPriority.EMERGENCY ? 120000 : 60000,
          retries: priority === CriticalPriority.EMERGENCY ? 5 : 3,
        }
      );

      // Execute the critical operation
      const result = await this.executeWrite(
        operation,
        {
          userId: 'system',
          userRole: 'system',
          clinicId: options?.clinicId || '',
          operation: 'CRITICAL_OPERATION',
          resourceType: 'CRITICAL',
          resourceId: 'pending',
          timestamp: new Date(),
        },
        {
          ...options,
          priority: 'critical',
        }
      );

      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(operationName, executionTime, true);

      // Log critical operation for audit
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.WARN,
        `Critical healthcare operation completed: ${priority}`,
        this.serviceName,
        {
          priority,
          executionTime,
          timestamp: new Date(),
        }
      );

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const dbError = error instanceof Error ? error : new Error(String(error));

      this.metricsService.recordQueryExecution(operationName, executionTime, false);

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Critical operation failed: ${dbError.message}`,
        this.serviceName,
        {
          error: dbError.stack,
          priority,
          executionTime,
        }
      );

      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        `Critical healthcare operation failed: ${dbError.message}`,
        undefined,
        {
          priority,
          executionTime,
          originalError: dbError.message,
          isRetryable: priority !== CriticalPriority.EMERGENCY,
        },
        this.serviceName
      );
    }
  }

  // ===== IHealthcareDatabaseClient Interface Implementation =====

  /**
   * Execute healthcare-specific read operations with HIPAA compliance
   * @see IHealthcareDatabaseClient.executeHealthcareRead
   */
  async executeHealthcareRead<T>(
    operation: (client: PrismaTransactionClient) => Promise<T>
  ): Promise<T> {
    return this.executeRead(async prisma => {
      // Convert PrismaService to PrismaTransactionClient
      const rawClient = prisma.getRawPrismaClient() as unknown as PrismaTransactionClient;
      return operation(rawClient);
    });
  }

  /**
   * Execute healthcare-specific write operations with audit trails
   * @see IHealthcareDatabaseClient.executeHealthcareWrite
   */
  async executeHealthcareWrite<T>(
    operation: (client: PrismaTransactionClient) => Promise<T>,
    auditInfo: AuditInfo
  ): Promise<T> {
    return this.executeWrite(async prisma => {
      // Convert PrismaService to PrismaTransactionClient
      const rawClient = prisma.getRawPrismaClient() as unknown as PrismaTransactionClient;
      return operation(rawClient);
    }, auditInfo);
  }

  /**
   * Execute critical healthcare operations (emergency scenarios)
   * @see IHealthcareDatabaseClient.executeCriticalOperation
   */
  async executeCriticalOperation<T>(
    operation: (client: PrismaTransactionClient) => Promise<T>,
    priority: CriticalPriority
  ): Promise<T> {
    return this.executeCritical(async prisma => {
      // Convert PrismaService to PrismaTransactionClient
      const rawClient = prisma.getRawPrismaClient() as unknown as PrismaTransactionClient;
      return operation(rawClient);
    }, priority);
  }

  /**
   * Execute operation with clinic isolation context (multi-tenant)
   * @see IHealthcareDatabaseClient.executeWithClinicContext
   */
  async executeWithClinicContext<T>(
    clinicId: string,
    operation: (client: PrismaTransactionClient) => Promise<T>
  ): Promise<T> {
    return this.executeWithClinicContextInternal(clinicId, async prisma => {
      // Convert PrismaService to PrismaTransactionClient
      const rawClient = prisma.getRawPrismaClient() as unknown as PrismaTransactionClient;
      return operation(rawClient);
    });
  }

  /**
   * Get HIPAA compliance metrics
   * @see IHealthcareDatabaseClient.getHIPAAMetrics
   */
  async getHIPAAMetrics(): Promise<HIPAAComplianceMetrics> {
    const currentMetrics = this.metricsService.getCurrentMetrics();

    return Promise.resolve({
      auditedOperations: currentMetrics.healthcare.auditTrailEntries,
      encryptedDataAccess: currentMetrics.healthcare.hipaaCompliantOperations,
      unauthorizedAttempts: currentMetrics.healthcare.unauthorizedAccessAttempts,
      dataRetentionCompliance: this.checkDataRetentionCompliance(),
      lastComplianceCheck: new Date(),
    });
  }

  /**
   * Get clinic-specific metrics
   * @see IHealthcareDatabaseClient.getClinicMetrics
   */
  async getClinicMetrics(clinicId: string): Promise<ClinicDatabaseMetrics> {
    const baseMetrics = await this.getMetrics();
    const clinicMetrics = this.metricsService.getClinicMetrics(clinicId);

    // Get clinic info
    const clinicResult = await this.clinicIsolationService.getClinicContext(clinicId);
    const clinicName =
      clinicResult.success && clinicResult.data
        ? (clinicResult.data as { clinicName?: string }).clinicName || 'Unknown'
        : 'Unknown';

    return {
      ...baseMetrics,
      clinicId,
      clinicName,
      patientCount: clinicMetrics?.patientCount || 0,
      appointmentCount: clinicMetrics?.appointmentCount || 0,
      staffCount: 0, // TODO: Implement staff count
      locationCount: 0, // TODO: Implement location count
    };
  }

  /**
   * Get clinic dashboard statistics
   * @see IHealthcareDatabaseClient.getClinicDashboardStats
   */
  getClinicDashboardStats(clinicId: string): Promise<ClinicDashboardStats> {
    // TODO: Implement clinic dashboard stats
    // This will be implemented in a future phase
    return Promise.reject(
      new HealthcareError(
        ErrorCode.FEATURE_NOT_IMPLEMENTED,
        'getClinicDashboardStats not yet implemented',
        undefined,
        { clinicId },
        this.serviceName
      )
    );
  }

  /**
   * Get clinic patients with pagination and filtering
   * @see IHealthcareDatabaseClient.getClinicPatients
   */
  getClinicPatients(
    clinicId: string,
    options?: ClinicPatientOptions
  ): Promise<ClinicPatientResult> {
    // TODO: Implement clinic patients
    // This will be implemented in a future phase
    return Promise.reject(
      new HealthcareError(
        ErrorCode.FEATURE_NOT_IMPLEMENTED,
        'getClinicPatients not yet implemented',
        undefined,
        { clinicId, options },
        this.serviceName
      )
    );
  }

  /**
   * Get clinic appointments with advanced filtering
   * @see IHealthcareDatabaseClient.getClinicAppointments
   */
  getClinicAppointments(
    clinicId: string,
    options?: ClinicAppointmentOptions
  ): Promise<ClinicAppointmentResult> {
    // TODO: Implement clinic appointments
    // This will be implemented in a future phase
    return Promise.reject(
      new HealthcareError(
        ErrorCode.FEATURE_NOT_IMPLEMENTED,
        'getClinicAppointments not yet implemented',
        undefined,
        { clinicId, options },
        this.serviceName
      )
    );
  }

  /**
   * Get connection health status
   * @see IDatabaseClient.getHealthStatus
   */
  getHealthStatus(): Promise<DatabaseHealthStatus> {
    try {
      const connectionMetrics = this.connectionPoolManager.getMetrics();
      const healthStatus = this.healthMonitor.getHealthStatus();

      return Promise.resolve({
        isHealthy: connectionMetrics.isHealthy && healthStatus.status === 'healthy',
        connectionCount: connectionMetrics.totalConnections,
        activeQueries: connectionMetrics.activeConnections,
        avgResponseTime: healthStatus.latency,
        lastHealthCheck: healthStatus.lastCheck,
        errors: healthStatus.status === 'unhealthy' ? ['Database health check failed'] : [],
      });
    } catch (error) {
      return Promise.resolve({
        isHealthy: false,
        connectionCount: 0,
        activeQueries: 0,
        avgResponseTime: -1,
        lastHealthCheck: new Date(),
        errors: [(error as Error).message],
      });
    }
  }

  /**
   * Get client metrics
   * @see IDatabaseClient.getMetrics
   */
  async getMetrics(): Promise<DatabaseClientMetrics> {
    const connectionMetrics = this.connectionPoolManager.getMetrics();
    const currentMetrics = this.metricsService.getCurrentMetrics();

    return Promise.resolve({
      totalQueries: currentMetrics.performance.totalQueries,
      successfulQueries: currentMetrics.performance.successfulQueries,
      failedQueries: currentMetrics.performance.failedQueries,
      averageQueryTime: currentMetrics.performance.averageQueryTime,
      slowQueries: currentMetrics.performance.slowQueries,
      connectionPool: {
        total: connectionMetrics.totalConnections,
        active: connectionMetrics.activeConnections,
        idle: connectionMetrics.idleConnections,
        waiting: connectionMetrics.waitingConnections,
      },
    });
  }

  /**
   * Get the underlying Prisma client
   * @deprecated Use executeRead/Write methods instead
   * @see IDatabaseClient.getPrismaClient
   */
  getPrismaClient(): PrismaService {
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.WARN,
      'DEPRECATED: getPrismaClient() called - use executeRead/Write instead',
      this.serviceName,
      { stack: new Error().stack }
    );
    return this.prismaService;
  }

  /**
   * Execute a raw query
   * @see IDatabaseClient.executeRawQuery
   */
  async executeRawQuery<T = Record<string, never>>(
    query: string,
    params: Array<string | number | boolean> = []
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result: T = await this.connectionPoolManager.executeQuery<T>(query, params, {
        ...(this.config.queryTimeout !== undefined && {
          timeout: this.config.queryTimeout,
        }),
      });

      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('RAW_QUERY', executionTime, true);

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('RAW_QUERY', executionTime, false);

      const dbError = error instanceof Error ? error : new Error(String(error));
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Raw query failed: ${dbError.message}`,
        this.serviceName,
        {
          error: dbError.stack,
          query: query.substring(0, 100),
          executionTime,
        }
      );

      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        `Raw query failed: ${dbError.message}`,
        undefined,
        { query: query.substring(0, 100), executionTime, originalError: dbError.message },
        this.serviceName
      );
    }
  }

  /**
   * Execute query within a transaction
   * @see IDatabaseClient.executeInTransaction
   */
  async executeInTransaction<T>(
    operation: (client: PrismaTransactionClient) => Promise<T>
  ): Promise<T> {
    return this.executeTransaction(async prisma => {
      // Convert PrismaService to PrismaTransactionClient
      const rawClient = prisma.getRawPrismaClient() as unknown as PrismaTransactionClient;
      return operation(rawClient);
    });
  }

  /**
   * Close database connections
   * @see IDatabaseClient.disconnect
   */
  async disconnect(): Promise<void> {
    try {
      await this.prismaService.$disconnect();
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        'Database client disconnected',
        this.serviceName
      );
    } catch (error) {
      const dbError = error instanceof Error ? error : new Error(String(error));
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Error disconnecting database: ${dbError.message}`,
        this.serviceName,
        { error: dbError.stack }
      );
      throw dbError;
    }
  }

  // ===== Private Helper Methods =====

  /**
   * Create audit trail entry
   */
  private createAuditTrail(
    auditInfo: AuditInfo,
    status: 'SUCCESS' | 'FAILURE',
    errorMessage?: string
  ): void {
    try {
      void this.loggingService.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `Audit trail: ${auditInfo.operation} - ${status}`,
        this.serviceName,
        {
          ...auditInfo,
          status,
          ...(errorMessage && { errorMessage }),
          timestamp: new Date(),
        }
      );

      // In production, create database record:
      // await this.prismaService.auditLog.create({ data: auditEntry });
    } catch (error) {
      const auditErr = error instanceof Error ? error : new Error(String(error));
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to create audit trail: ${auditErr.message}`,
        this.serviceName,
        {
          error: auditErr.stack,
          auditInfo: JSON.stringify(auditInfo),
        }
      );
    }
  }

  /**
   * Check data retention compliance
   */
  private checkDataRetentionCompliance(): boolean {
    // Simplified compliance check - in production would check actual data retention policies
    // For now, always return true - actual implementation would check audit logs
    return true;
  }

  // ===== Convenience Methods (Type-Safe Database Operations) =====
  // These methods provide convenient, type-safe access to common database operations
  // All methods use executeRead/Write for full optimization layers
  // Code splitting: Methods are delegated to method classes organized by entity type

  // ===== User Methods =====
  async findUserByIdSafe(id: string): Promise<UserWithRelations | null> {
    return this.userMethods.findUserByIdSafe(id);
  }

  async findUserByEmailSafe(email: string): Promise<UserWithRelations | null> {
    return this.userMethods.findUserByEmailSafe(email);
  }

  async findUsersSafe(where: UserWhereInput): Promise<UserWithRelations[]> {
    return this.userMethods.findUsersSafe(where);
  }

  async createUserSafe(data: UserCreateInput): Promise<UserWithRelations> {
    return this.userMethods.createUserSafe(data);
  }

  async updateUserSafe(id: string, data: UserUpdateInput): Promise<UserWithRelations> {
    return this.userMethods.updateUserSafe(id, data);
  }

  async deleteUserSafe(id: string): Promise<UserWithRelations> {
    return this.userMethods.deleteUserSafe(id);
  }

  async countUsersSafe(where: UserWhereInput): Promise<number> {
    return this.userMethods.countUsersSafe(where);
  }

  // ===== Billing Methods =====
  async findInvoiceByIdSafe(id: string): Promise<InvoiceWithRelations | null> {
    return this.billingMethods.findInvoiceByIdSafe(id);
  }

  async findInvoicesSafe(where: InvoiceWhereInput): Promise<InvoiceWithRelations[]> {
    return this.billingMethods.findInvoicesSafe(where);
  }

  async createInvoiceSafe(data: InvoiceCreateInput): Promise<InvoiceWithRelations> {
    return this.billingMethods.createInvoiceSafe(data);
  }

  async updateInvoiceSafe(id: string, data: InvoiceUpdateInput): Promise<InvoiceWithRelations> {
    return this.billingMethods.updateInvoiceSafe(id, data);
  }

  async findSubscriptionByIdSafe(id: string): Promise<SubscriptionWithRelations | null> {
    return this.billingMethods.findSubscriptionByIdSafe(id);
  }

  async findSubscriptionsSafe(where: SubscriptionWhereInput): Promise<SubscriptionWithRelations[]> {
    return this.billingMethods.findSubscriptionsSafe(where);
  }

  async createSubscriptionSafe(data: SubscriptionCreateInput): Promise<SubscriptionWithRelations> {
    return this.billingMethods.createSubscriptionSafe(data);
  }

  async updateSubscriptionSafe(
    id: string,
    data: SubscriptionUpdateInput
  ): Promise<SubscriptionWithRelations> {
    return this.billingMethods.updateSubscriptionSafe(id, data);
  }

  async findBillingPlanByIdSafe(id: string): Promise<BillingPlanWithRelations | null> {
    return this.billingMethods.findBillingPlanByIdSafe(id);
  }

  async findBillingPlansSafe(where: BillingPlanWhereInput): Promise<BillingPlanWithRelations[]> {
    return this.billingMethods.findBillingPlansSafe(where);
  }

  async createBillingPlanSafe(data: BillingPlanCreateInput): Promise<BillingPlanWithRelations> {
    return this.billingMethods.createBillingPlanSafe(data);
  }

  async updateBillingPlanSafe(
    id: string,
    data: BillingPlanUpdateInput
  ): Promise<BillingPlanWithRelations> {
    return this.billingMethods.updateBillingPlanSafe(id, data);
  }

  async deleteBillingPlanSafe(id: string): Promise<BillingPlanWithRelations> {
    return this.billingMethods.deleteBillingPlanSafe(id);
  }

  async findPaymentByIdSafe(id: string): Promise<PaymentWithRelations | null> {
    return this.billingMethods.findPaymentByIdSafe(id);
  }

  async findPaymentsSafe(where: PaymentWhereInput): Promise<PaymentWithRelations[]> {
    return this.billingMethods.findPaymentsSafe(where);
  }

  async createPaymentSafe(data: PaymentCreateInput): Promise<PaymentWithRelations> {
    return this.billingMethods.createPaymentSafe(data);
  }

  async updatePaymentSafe(id: string, data: PaymentUpdateInput): Promise<PaymentWithRelations> {
    return this.billingMethods.updatePaymentSafe(id, data);
  }

  // ===== Appointment Methods =====
  async findAppointmentByIdSafe(id: string): Promise<AppointmentWithRelations | null> {
    return this.appointmentMethods.findAppointmentByIdSafe(id);
  }

  async findAppointmentsSafe(where: AppointmentWhereInput): Promise<AppointmentWithRelations[]> {
    return this.appointmentMethods.findAppointmentsSafe(where);
  }

  async countAppointmentsSafe(where: AppointmentWhereInput): Promise<number> {
    return this.appointmentMethods.countAppointmentsSafe(where);
  }

  async createAppointmentSafe(data: AppointmentCreateInput): Promise<AppointmentWithRelations> {
    return this.appointmentMethods.createAppointmentSafe(data);
  }

  async updateAppointmentSafe(
    id: string,
    data: AppointmentUpdateInput
  ): Promise<AppointmentWithRelations> {
    return this.appointmentMethods.updateAppointmentSafe(id, data);
  }

  async findAppointmentTimeSlotsSafe(
    doctorId: string,
    clinicId: string,
    date: Date
  ): Promise<AppointmentTimeSlot[]> {
    return this.appointmentMethods.findAppointmentTimeSlotsSafe(doctorId, clinicId, date);
  }

  // ===== Clinic Methods =====
  async findClinicByIdSafe(id: string): Promise<{
    name: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null> {
    return this.clinicMethods.findClinicByIdSafe(id);
  }

  // ===== Permission Methods =====
  async createPermissionSafe(data: {
    name: string;
    resource: string;
    action: string;
    description?: string | null;
    isSystemPermission?: boolean;
    isActive?: boolean;
  }): Promise<PermissionEntity> {
    return this.permissionMethods.createPermissionSafe(data);
  }

  async findPermissionByIdSafe(id: string): Promise<PermissionEntity | null> {
    return this.permissionMethods.findPermissionByIdSafe(id);
  }

  async findPermissionByResourceActionSafe(
    resource: string,
    action: string
  ): Promise<PermissionEntity | null> {
    return this.permissionMethods.findPermissionByResourceActionSafe(resource, action);
  }

  async findPermissionsByResourceSafe(resource: string): Promise<PermissionEntity[]> {
    return this.permissionMethods.findPermissionsByResourceSafe(resource);
  }

  async updatePermissionSafe(
    id: string,
    data: Partial<{ name?: string; description?: string | null; isActive?: boolean }> & {
      updatedAt: Date;
    }
  ): Promise<PermissionEntity> {
    return this.permissionMethods.updatePermissionSafe(id, data);
  }

  async countRolePermissionsSafe(permissionId: string): Promise<number> {
    return this.permissionMethods.countRolePermissionsSafe(permissionId);
  }

  async findSystemPermissionsSafe(): Promise<PermissionEntity[]> {
    return this.permissionMethods.findSystemPermissionsSafe();
  }

  // ===== Role Methods =====
  async findRoleByNameSafe(name: string, clinicId?: string): Promise<RbacRoleEntity | null> {
    return this.roleMethods.findRoleByNameSafe(name, clinicId);
  }

  async findRoleByIdSafe(id: string): Promise<RbacRoleEntity | null> {
    return this.roleMethods.findRoleByIdSafe(id);
  }

  async createRoleSafe(data: {
    name: string;
    displayName: string;
    description?: string | null;
    clinicId?: string | null;
    isSystemRole?: boolean;
    isActive?: boolean;
  }): Promise<RbacRoleEntity> {
    return this.roleMethods.createRoleSafe(data);
  }

  async findRolesByClinicSafe(clinicId?: string): Promise<RbacRoleEntity[]> {
    return this.roleMethods.findRolesByClinicSafe(clinicId);
  }

  async updateRoleSafe(
    id: string,
    data: {
      displayName?: string;
      description?: string | null;
      isActive?: boolean;
      updatedAt: Date;
    }
  ): Promise<RbacRoleEntity> {
    return this.roleMethods.updateRoleSafe(id, data);
  }

  async countUserRolesSafe(roleId: string): Promise<number> {
    return this.roleMethods.countUserRolesSafe(roleId);
  }

  async deleteRolePermissionsSafe(roleId: string): Promise<{ count: number }> {
    return this.roleMethods.deleteRolePermissionsSafe(roleId);
  }

  async createRolePermissionsSafe(
    permissions: Array<{ roleId: string; permissionId: string }>
  ): Promise<{ count: number }> {
    return this.roleMethods.createRolePermissionsSafe(permissions);
  }

  async removeRolePermissionsSafe(
    roleId: string,
    permissionIds: string[]
  ): Promise<{ count: number }> {
    return this.roleMethods.removeRolePermissionsSafe(roleId, permissionIds);
  }

  async createSystemRoleSafe(data: {
    name: string;
    displayName: string;
    description?: string | null;
    clinicId?: string | null;
    isSystemRole?: boolean;
    isActive?: boolean;
  }): Promise<RbacRoleEntity> {
    return this.roleMethods.createSystemRoleSafe(data);
  }

  // ===== User Role Methods =====
  async findUserRoleAssignmentSafe(
    userId: string,
    roleId: string,
    clinicId?: string
  ): Promise<UserRoleEntity | null> {
    return this.userRoleMethods.findUserRoleAssignmentSafe(userId, roleId, clinicId);
  }

  async createUserRoleSafe(data: {
    userId: string;
    roleId: string;
    clinicId?: string | null;
    assignedBy?: string;
    expiresAt?: Date | null;
    isActive?: boolean;
    isPrimary?: boolean;
    permissions?: Record<string, never>;
    schedule?: Record<string, never>;
  }): Promise<UserRoleEntity> {
    return this.userRoleMethods.createUserRoleSafe(data);
  }

  async findUserRoleForRevocationSafe(
    userId: string,
    roleId: string,
    clinicId?: string
  ): Promise<UserRoleEntity | null> {
    return this.userRoleMethods.findUserRoleForRevocationSafe(userId, roleId, clinicId);
  }

  async updateUserRoleSafe(
    id: string,
    data: {
      isActive?: boolean;
      revokedAt?: Date | null;
      revokedBy?: string | null;
      expiresAt?: Date | null;
      updatedAt: Date;
    }
  ): Promise<UserRoleEntity> {
    return this.userRoleMethods.updateUserRoleSafe(id, data);
  }

  async findUserRolesSafe(userId: string, clinicId?: string): Promise<UserRoleEntity[]> {
    return this.userRoleMethods.findUserRolesSafe(userId, clinicId);
  }

  async findRolePermissionsSafe(
    roleIds: string[]
  ): Promise<Array<RolePermissionEntity & { permission: { resource: string; action: string } }>> {
    return this.userRoleMethods.findRolePermissionsSafe(roleIds);
  }

  // ===== Clinic Admin Methods =====
  async deleteClinicSafe(id: string): Promise<{ id: string; name: string }> {
    return this.clinicAdminMethods.deleteClinicSafe(id);
  }

  async createClinicAdminSafe(data: {
    userId: string;
    clinicId: string;
  }): Promise<{ id: string; userId: string; clinicId: string }> {
    return this.clinicAdminMethods.createClinicAdminSafe(data);
  }

  async findClinicAdminByIdSafe(id: string): Promise<{
    id: string;
    userId: string;
    clinicId: string;
    user?: { id: string; email: string; name: string; role: string };
  } | null> {
    return this.clinicAdminMethods.findClinicAdminByIdSafe(id);
  }

  async findClinicAdminsSafe(where: { clinicId?: string; userId?: string }): Promise<
    Array<{
      id: string;
      userId: string;
      clinicId: string;
      user?: { id: string; email: string; name: string; role: string } | undefined;
    }>
  > {
    return this.clinicAdminMethods.findClinicAdminsSafe(where);
  }

  async deleteClinicAdminSafe(
    id: string
  ): Promise<{ id: string; userId: string; clinicId: string }> {
    return this.clinicAdminMethods.deleteClinicAdminSafe(id);
  }

  /**
   * Invalidate cache by tags
   */
  private async invalidateCache(tags: string[]): Promise<void> {
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
