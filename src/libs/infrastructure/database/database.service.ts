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
import type { LoggingService } from '@infrastructure/logging/logging.service';
import type { CacheService } from '@infrastructure/cache/cache.service';
import { CircuitBreakerService } from '@core/resilience/circuit-breaker.service';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { getEnv } from '@config/environment/utils';

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
import { ClinicMetricsMethods } from './methods/clinic-metrics.methods';

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
  private readonly serviceStartTime = Date.now(); // Track service start time for startup grace period

  // Method class instances (code splitting)
  private readonly userMethods: UserMethods;
  private readonly permissionMethods: PermissionMethods;
  private readonly roleMethods: RoleMethods;
  private readonly userRoleMethods: UserRoleMethods;
  private readonly clinicAdminMethods: ClinicAdminMethods;
  private readonly appointmentMethods: AppointmentMethods;
  private readonly billingMethods: BillingMethods;
  private readonly clinicMethods: ClinicMethods;
  private readonly clinicMetricsMethods: ClinicMetricsMethods;

  constructor(
    protected readonly prismaService: PrismaService,
    @Inject(forwardRef(() => ConnectionPoolManager))
    protected readonly connectionPoolManager: ConnectionPoolManager,
    @Inject(forwardRef(() => DatabaseMetricsService))
    protected readonly metricsService: DatabaseMetricsService,
    @Inject(forwardRef(() => ClinicIsolationService))
    protected readonly clinicIsolationService: ClinicIsolationService,
    protected readonly queryOptimizer: HealthcareQueryOptimizerService,
    @Inject('LOGGING_SERVICE')
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
    @Inject('CACHE_SERVICE')
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

    this.clinicMetricsMethods = new ClinicMetricsMethods(
      this.prismaService,
      this.queryOptionsBuilder,
      this.queryKeyFactory,
      this.cacheService,
      this.loggingService,
      executeReadFn,
      executeWriteFn,
      'ClinicMetricsMethods'
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

    // Generate cache key if caching is enabled.
    // IMPORTANT: Cache keys MUST include query-defining params (where/include/select/pagination/etc).
    // A coarse key (e.g., only operationName) causes collisions and returns the wrong entity.
    const cacheParams: Record<string, unknown> = {
      ...(queryOptions.clinicId ? { clinicId: queryOptions.clinicId } : {}),
      ...(queryOptions.userId ? { userId: queryOptions.userId } : {}),
      ...(queryOptions.where ? { where: queryOptions.where } : {}),
      ...(queryOptions.select ? { select: queryOptions.select } : {}),
      ...(queryOptions.include ? { include: queryOptions.include } : {}),
      ...(queryOptions.orderBy ? { orderBy: queryOptions.orderBy } : {}),
      ...(queryOptions.page !== undefined ? { page: queryOptions.page } : {}),
      ...(queryOptions.limit !== undefined ? { limit: queryOptions.limit } : {}),
      ...(queryOptions.cacheStrategy ? { cacheStrategy: queryOptions.cacheStrategy } : {}),
      ...(queryOptions.hipaaCompliant !== undefined
        ? { hipaaCompliant: queryOptions.hipaaCompliant }
        : {}),
    };

    const hasDiscriminatingParams =
      'where' in cacheParams ||
      'select' in cacheParams ||
      'include' in cacheParams ||
      'orderBy' in cacheParams ||
      'page' in cacheParams ||
      'limit' in cacheParams;

    const cacheKey =
      queryOptions.useCache !== false && this.queryCache && hasDiscriminatingParams
        ? this.queryKeyFactory.fromOperation(operationName, cacheParams)
        : null;

    // Check cache first (if enabled and not bypassed)
    // Optimized for 10M+ users: Fast cache check with minimal overhead
    if (cacheKey && queryOptions.useCache !== false && this.queryCache) {
      try {
        const cached = await this.queryCache.getCached<T>(cacheKey);
        if (cached !== null) {
          const cacheTime = Date.now() - startTime;
          // Optimized: Record cache hit asynchronously to avoid blocking
          setImmediate(() => {
            this.metricsService.recordCacheHit(cacheTime);
          });
          // Only log in debug mode for performance (10M+ users)
          // Use helper function (which uses dotenv) for environment variable access
          if (getEnv('LOG_LEVEL') === 'DEBUG') {
            void this.loggingService.log(
              LogType.DATABASE,
              LogLevel.DEBUG,
              `Cache hit for read operation: ${cacheKey.substring(0, 100)}`,
              this.serviceName,
              { cacheTime }
            );
          }
          return cached;
        }
        // Record cache miss asynchronously
        setImmediate(() => {
          this.metricsService.recordCacheMiss(Date.now() - startTime);
        });
      } catch (cacheError) {
        // Cache error should not block query execution
        // Log asynchronously to avoid blocking query path
        setImmediate(() => {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Cache check failed, proceeding with query: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`,
            this.serviceName
          );
        });
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
      // CRITICAL: Wait for Prisma to be ready before executing queries
      // This prevents "Retry failed" errors during application startup
      if (!this.prismaService.isReady()) {
        const isReady = await this.prismaService.waitUntilReady(30000); // 30 second timeout
        if (!isReady) {
          throw new HealthcareError(
            ErrorCode.DATABASE_CONNECTION_FAILED,
            'Prisma client not ready within timeout',
            undefined,
            {},
            this.serviceName
          );
        }
      }

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
        const executionTime = performance.now() - startTime;

        // Cache result asynchronously (non-blocking for 2-7ms target)
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
            // Cache asynchronously to avoid blocking response
            setImmediate(() => {
              void this.queryCache.setCached(cacheKey, result, {
                ttl,
                containsPHI: queryOptions.hipaaCompliant === true,
                priority:
                  (queryOptions.priority === 'critical' ? 'high' : queryOptions.priority) ||
                  'normal',
                tags: [
                  'database',
                  'read',
                  ...(queryOptions.clinicId ? [`clinic:${queryOptions.clinicId}`] : []),
                ],
              });
            });
          }
        }

        // Record metrics asynchronously (non-blocking)
        setImmediate(() => {
          this.metricsService.recordQueryExecution(
            operationName,
            Math.round(executionTime * 100) / 100,
            true,
            queryOptions.clinicId
          );
        });

        return result;
      } else {
        // Execute without retry
        const result = await executeWithRetry();
        const executionTime = performance.now() - startTime;

        // Cache result asynchronously (non-blocking for 2-7ms target)
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
            // Cache asynchronously to avoid blocking response
            setImmediate(() => {
              void this.queryCache.setCached(cacheKey, result, {
                ttl,
                containsPHI: queryOptions.hipaaCompliant === true,
                priority:
                  (queryOptions.priority === 'critical' ? 'high' : queryOptions.priority) ||
                  'normal',
                tags: [
                  'database',
                  'read',
                  ...(queryOptions.clinicId ? [`clinic:${queryOptions.clinicId}`] : []),
                ],
              });
            });
          }
        }

        // Record metrics asynchronously (non-blocking)
        setImmediate(() => {
          this.metricsService.recordQueryExecution(
            operationName,
            Math.round(executionTime * 100) / 100,
            true,
            queryOptions.clinicId
          );
        });

        return result;
      }
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const dbError = error instanceof Error ? error : new Error(String(error));

      // Record circuit breaker failure if applicable
      // Note: CircuitBreakerService now has startup grace period built-in
      if (this.circuitBreaker) {
        this.circuitBreaker.recordFailure('database');
      }

      // Execute middleware chain on error
      await this.middlewareChain.onError(middlewareContext, dbError);

      // Record metrics asynchronously (non-blocking)
      setImmediate(() => {
        this.metricsService.recordQueryExecution(
          operationName,
          Math.round(executionTime * 100) / 100,
          false,
          queryOptions.clinicId,
          queryOptions.userId
        );
      });

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
      // CRITICAL: Wait for Prisma to be ready before executing queries
      // This prevents "Retry failed" errors during application startup
      if (!this.prismaService.isReady()) {
        const isReady = await this.prismaService.waitUntilReady(30000); // 30 second timeout
        if (!isReady) {
          throw new HealthcareError(
            ErrorCode.DATABASE_CONNECTION_FAILED,
            'Prisma client not ready within timeout',
            undefined,
            {},
            this.serviceName
          );
        }
      }

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

      // Automatic cache invalidation after write (non-blocking)
      // Invalidates all cache layers to prevent stale data
      setImmediate(() => {
        void this.autoInvalidateCacheAfterWrite(
          auditInfo.resourceType,
          auditInfo.resourceId,
          auditInfo.clinicId
        );
      });

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
      // Note: CircuitBreakerService now has startup grace period built-in
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
   * ============================================================================
   * ABSTRACTION LEVELS GUIDE
   * ============================================================================
   *
   * This service provides methods at different abstraction levels:
   *
   * ┌─────────────────────────────────────────────────────────────────────┐
   * │ HIGH-LEVEL METHODS (Recommended for most use cases)                 │
   * ├─────────────────────────────────────────────────────────────────────┤
   * │ • findUserByEmailSafe()     - Type-safe, cached, optimized          │
   * │ • createUserSafe()          - Includes audit, validation, cache     │
   * │ • updateUserSafe()          - Automatic cache invalidation          │
   * │ • findAppointmentByIdSafe() - Full optimization layers              │
   * │                                                                     │
   * │ ✅ USE WHEN:                                                         │
   * │   - Standard CRUD operations                                        │
   * │   - Need type safety                                                │
   * │   - Want automatic caching                                          │
   * │   - Need audit trails                                               │
   * │   - 95% of use cases                                                │
   * └─────────────────────────────────────────────────────────────────────┘
   *
   * ┌─────────────────────────────────────────────────────────────────────┐
   * │ MID-LEVEL METHODS (For custom queries with optimization)            │
   * ├─────────────────────────────────────────────────────────────────────┤
   * │ • executeHealthcareRead()   - Custom queries with caching           │
   * │ • executeHealthcareWrite()  - Custom writes with audit trails       │
   * │ • executeWithClinicContext() - Multi-tenant operations               │
   * │                                                                     │
   * │ ✅ USE WHEN:                                                         │
   * │   - Custom queries not covered by high-level methods                │
   * │   - Need complex filtering/joins                                    │
   * │   - Want optimization layers (cache, metrics, security)             │
   * │   - Still need HIPAA compliance                                     │
   * └─────────────────────────────────────────────────────────────────────┘
   *
   * ┌─────────────────────────────────────────────────────────────────────┐
   * │ LOW-LEVEL METHODS (Use sparingly - bypasses optimizations)          │
   * ├─────────────────────────────────────────────────────────────────────┤
   * │ • executeRawQuery()         - Raw SQL, no caching, no optimization  │
   * │ • getPrismaClient()         - Direct Prisma access (legacy)         │
   * │                                                                     │
   * │ ⚠️ USE WHEN:                                                         │
   * │   - Complex SQL that Prisma can't express                           │
   * │   - Performance-critical bulk operations                            │
   * │   - Database migrations/maintenance                                 │
   * │   - Debugging/testing                                               │
   * │                                                                     │
   * │ ❌ AVOID FOR:                                                        │
   * │   - Regular CRUD operations (use high-level methods)                │
   * │   - Production user-facing queries                                  │
   * │   - Operations requiring audit trails                                │
   * └─────────────────────────────────────────────────────────────────────┘
   *
   * ============================================================================
   */

  /**
   * Execute healthcare-specific read operations with HIPAA compliance
   *
   * MID-LEVEL ABSTRACTION: Use for custom queries that need optimization layers
   *
   * Features:
   * - Automatic caching (if enabled)
   * - Read replica routing
   * - Query optimization
   * - Metrics tracking
   * - Security checks
   *
   * @example
   * ```typescript
   * // Custom query with optimization layers
   * const users = await database.executeHealthcareRead(async (client) => {
   *   return client.user.findMany({
   *     where: { role: 'DOCTOR', isActive: true },
   *     include: { doctor: true }
   *   });
   * });
   * ```
   *
   * @see IHealthcareDatabaseClient.executeHealthcareRead
   */
  async executeHealthcareRead<T>(
    operation: (client: PrismaTransactionClient) => Promise<T>
  ): Promise<T> {
    return this.executeRead(async prisma => {
      return operation(this.toTransactionClient(prisma));
    });
  }

  /**
   * Execute healthcare-specific write operations with audit trails
   *
   * MID-LEVEL ABSTRACTION: Use for custom write operations
   *
   * Features:
   * - Automatic audit logging
   * - Automatic cache invalidation
   * - Data masking
   * - Row-level security
   * - Metrics tracking
   *
   * @example
   * ```typescript
   * // Custom write with automatic cache invalidation
   * const user = await database.executeHealthcareWrite(
   *   async (client) => {
   *     return client.user.update({
   *       where: { id },
   *       data: { name: 'New Name' }
   *     });
   *   },
   *   {
   *     userId: context.user.id,
   *     userRole: context.user.role,
   *     clinicId: context.clinicId,
   *     operation: 'UPDATE_USER',
   *     resourceType: 'USER',
   *     resourceId: id,
   *     timestamp: new Date()
   *   }
   * );
   * ```
   *
   * @see IHealthcareDatabaseClient.executeHealthcareWrite
   */
  async executeHealthcareWrite<T>(
    operation: (client: PrismaTransactionClient) => Promise<T>,
    auditInfo: AuditInfo
  ): Promise<T> {
    return this.executeWrite(async prisma => {
      return operation(this.toTransactionClient(prisma));
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
      return operation(this.toTransactionClient(prisma));
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
      return operation(this.toTransactionClient(prisma));
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

    // Get staff count and location count in parallel (optimized for 2-7ms)
    // OPTIMIZATION: Use Prisma count() methods instead of raw SQL for better optimization
    const [staffCount, locationCount] = await Promise.all([
      // Count all staff types associated with clinic using optimized Prisma queries
      this.executeRead<number>(
        async prisma => {
          // Count doctors through DoctorClinic junction table using Prisma
          // OPTIMIZATION: Use Prisma's groupBy to count distinct doctors
          // Note: Prisma doesn't support distinct in count, so we use groupBy and count groups
          // Use toTransactionClient to get the raw Prisma client with all models
          const client = this.toTransactionClient(prisma);
          const doctorGroups = await (
            client as unknown as {
              doctorClinic: {
                groupBy: (args: {
                  by: string[];
                  where: { clinicId: string };
                }) => Promise<Array<{ doctorId: string }>>;
              };
            }
          ).doctorClinic.groupBy({
            by: ['doctorId'],
            where: { clinicId },
          });
          const doctors = doctorGroups.length;

          // Count receptionists (direct relationship) - already using Prisma count
          const receptionists = await prisma.receptionist.count({
            where: { clinicId },
          });

          // Count clinic admins - already using Prisma count
          const clinicAdmins = await prisma.clinicAdmin.count({
            where: { clinicId },
          });

          // Note: Other staff types (Nurse, Pharmacist, etc.) don't have direct clinic relationships
          // They are linked through User.clinics relationship, which would require additional queries
          // For now, we count doctors, receptionists, and clinic admins as the primary staff
          return doctors + receptionists + clinicAdmins;
        },
        {
          clinicId,
          useCache: true,
          cacheStrategy: 'long',
          priority: 'normal',
        }
      ),

      // Count locations using optimized Prisma count
      this.executeRead<number>(
        async prisma => {
          // OPTIMIZATION: Use Prisma's count() instead of raw SQL for better optimization
          // Use toTransactionClient to get the raw Prisma client with all models
          const client = this.toTransactionClient(prisma);
          return await (
            client as unknown as {
              clinicLocation: {
                count: (args: { where: { clinicId: string } }) => Promise<number>;
              };
            }
          ).clinicLocation.count({
            where: { clinicId },
          });
        },
        {
          clinicId,
          useCache: true,
          cacheStrategy: 'long',
          priority: 'normal',
        }
      ),
    ]);

    return {
      ...baseMetrics,
      clinicId,
      clinicName,
      patientCount: clinicMetrics?.patientCount || 0,
      appointmentCount: clinicMetrics?.appointmentCount || 0,
      staffCount,
      locationCount,
    };
  }

  /**
   * Get clinic dashboard statistics
   * Optimized for 2-7ms execution with parallel queries and caching
   * @see IHealthcareDatabaseClient.getClinicDashboardStats
   */
  async getClinicDashboardStats(clinicId: string): Promise<ClinicDashboardStats> {
    return this.clinicMetricsMethods.getClinicDashboardStats(clinicId);
  }

  /**
   * Get clinic patients with pagination and filtering
   * Optimized for 2-7ms execution with indexed queries and caching
   * @see IHealthcareDatabaseClient.getClinicPatients
   */
  async getClinicPatients(
    clinicId: string,
    options?: ClinicPatientOptions
  ): Promise<ClinicPatientResult> {
    return this.clinicMetricsMethods.getClinicPatients(clinicId, options);
  }

  /**
   * Get clinic appointments with advanced filtering
   * Optimized for 2-7ms execution with indexed queries, date range optimization, and caching
   * @see IHealthcareDatabaseClient.getClinicAppointments
   */
  async getClinicAppointments(
    clinicId: string,
    options?: ClinicAppointmentOptions
  ): Promise<ClinicAppointmentResult> {
    return this.clinicMetricsMethods.getClinicAppointments(clinicId, options);
  }

  /**
   * Get the underlying Prisma client
   * Legacy method - Use executeRead/Write methods instead to benefit from caching, metrics, and optimization layers
   * @see IDatabaseClient.getPrismaClient
   */
  getPrismaClient(): PrismaService {
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.WARN,
      'Legacy method getPrismaClient() called - use executeRead/Write instead for optimal performance',
      this.serviceName,
      { stack: new Error().stack }
    );
    return this.prismaService;
  }

  /**
   * Get connection health status
   * @see IDatabaseClient.getHealthStatus
   */
  async getHealthStatus(): Promise<DatabaseHealthStatus> {
    try {
      // Check if Prisma is ready first
      // During startup grace period (first 180 seconds), return healthy for liveness checks
      // BUT: For readiness checks, we require actual connection
      // This prevents health checks from failing during normal startup in production
      // Production factors: network latency, database load, connection pool initialization, retries
      // Increased from 90s to 180s to account for production connection delays
      const STARTUP_GRACE_PERIOD = 180000; // 180 seconds (3 minutes) - increased for production
      const timeSinceStart = Date.now() - this.serviceStartTime;
      const isInStartupGracePeriod = timeSinceStart < STARTUP_GRACE_PERIOD;

      if (!this.prismaService || !this.prismaService.isReady()) {
        // During startup grace period, return healthy for liveness (app is starting)
        // But include a warning in errors to indicate connection is still in progress
        // After grace period, return unhealthy if Prisma still isn't ready
        if (isInStartupGracePeriod) {
          return {
            isHealthy: true, // Liveness: app is starting
            connectionCount: 0,
            activeQueries: 0,
            avgResponseTime: -1,
            lastHealthCheck: new Date(),
            errors: ['Database connection in progress - not ready for requests yet'],
          };
        }
        return {
          isHealthy: false,
          connectionCount: 0,
          activeQueries: 0,
          avgResponseTime: -1,
          lastHealthCheck: new Date(),
          errors: ['Prisma client not ready'],
        };
      }

      const connectionMetrics = this.connectionPoolManager.getMetrics();
      const healthStatus = this.healthMonitor.getHealthStatus();

      // If health monitor shows default status (latency 0, no real check performed), perform real-time check
      // This happens if health monitoring hasn't started yet or if the last check was too long ago
      const timeSinceLastCheck = Date.now() - healthStatus.lastCheck.getTime();
      const shouldPerformRealtimeCheck =
        (healthStatus.status === 'healthy' && healthStatus.latency === 0) || // Default status
        timeSinceLastCheck > 60000; // Last check was more than 60 seconds ago

      if (shouldPerformRealtimeCheck) {
        try {
          // Perform a quick real-time health check
          const startTime = Date.now();
          await Promise.race([
            this.prismaService.$queryRaw`SELECT 1`,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Health check timeout')), 5000)
            ),
          ]);
          const latency = Date.now() - startTime;

          return {
            isHealthy: connectionMetrics.isHealthy && latency < 5000,
            connectionCount: connectionMetrics.totalConnections,
            activeQueries: connectionMetrics.activeConnections,
            avgResponseTime: latency,
            lastHealthCheck: new Date(),
            errors: latency >= 5000 ? ['Database health check timeout'] : [],
          };
        } catch (checkError) {
          return {
            isHealthy: false,
            connectionCount: connectionMetrics.totalConnections,
            activeQueries: connectionMetrics.activeConnections,
            avgResponseTime: -1,
            lastHealthCheck: new Date(),
            errors: [
              checkError instanceof Error ? checkError.message : 'Database health check failed',
            ],
          };
        }
      }

      // Use cached health status from monitor
      // Properly extract error message from details (handles both string and object errors)
      let errorMessage = 'Database health check failed';
      if (healthStatus.status === 'unhealthy' && healthStatus.details?.['error']) {
        const errorDetail = healthStatus.details['error'];
        if (typeof errorDetail === 'string') {
          errorMessage = errorDetail;
        } else if (errorDetail instanceof Error) {
          errorMessage = errorDetail.message;
        } else if (typeof errorDetail === 'object' && errorDetail !== null) {
          // For objects, try to extract a meaningful message or stringify safely
          errorMessage =
            'message' in errorDetail && typeof errorDetail.message === 'string'
              ? errorDetail.message
              : JSON.stringify(errorDetail);
        }
      }

      return {
        isHealthy: connectionMetrics.isHealthy && healthStatus.status === 'healthy',
        connectionCount: connectionMetrics.totalConnections,
        activeQueries: connectionMetrics.activeConnections,
        avgResponseTime: healthStatus.latency,
        lastHealthCheck: healthStatus.lastCheck,
        errors: healthStatus.status === 'unhealthy' ? [errorMessage] : [],
      };
    } catch (error) {
      return {
        isHealthy: false,
        connectionCount: 0,
        activeQueries: 0,
        avgResponseTime: -1,
        lastHealthCheck: new Date(),
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
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
   * Execute a raw SQL query
   *
   * LOW-LEVEL ABSTRACTION: Use sparingly - bypasses optimization layers
   *
   * ⚠️ WARNING: This method bypasses:
   * - Caching (no cache hits/misses)
   * - Query optimization
   * - Automatic security checks
   * - Read replica routing
   * - Some metrics tracking
   *
   * ✅ USE FOR:
   * - Complex SQL that Prisma can't express
   * - Performance-critical bulk operations
   * - Database migrations/maintenance
   * - Analytics/reporting queries
   *
   * ❌ AVOID FOR:
   * - Regular CRUD operations (use high-level methods)
   * - User-facing queries (use executeHealthcareRead/Write)
   * - Operations requiring audit trails
   *
   * @example
   * ```typescript
   * // Complex analytics query
   * const stats = await database.executeRawQuery<{count: number}[]>(
   *   'SELECT COUNT(*) as count FROM "User" WHERE "createdAt" > $1',
   *   [new Date('2024-01-01')]
   * );
   * ```
   *
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
      return operation(this.toTransactionClient(prisma));
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
   * Convert PrismaService to PrismaTransactionClient
   * Centralized conversion to avoid repeated casting (DRY principle)
   * Optimized for 10M+ users - single conversion point
   */
  private toTransactionClient(prisma: PrismaService): PrismaTransactionClient {
    return prisma.getRawPrismaClient() as unknown as PrismaTransactionClient;
  }

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
  //
  // HIGH-LEVEL ABSTRACTION: Recommended for 95% of use cases
  //
  // These methods provide convenient, type-safe access to common database operations.
  // All methods use executeRead/Write for full optimization layers:
  // - Automatic caching with smart TTL
  // - Automatic cache invalidation on writes
  // - Query optimization
  // - Metrics tracking
  // - Security checks
  // - Audit trails (for writes)
  //
  // Code splitting: Methods are delegated to method classes organized by entity type
  //
  // ✅ USE THESE METHODS FOR:
  //   - Standard CRUD operations
  //   - Type-safe queries
  //   - Automatic optimization
  //   - Production user-facing features
  //
  // ============================================================================

  // ===== User Methods =====
  async findUserByIdSafe(id: string): Promise<UserWithRelations | null> {
    return this.userMethods.findUserByIdSafe(id);
  }

  async findUserByEmailSafe(
    email: string,
    includeRelations?: Partial<{
      doctor: true;
      patient: true;
      receptionists: true;
      clinicAdmins: true;
      superAdmin: true;
      pharmacist: true;
      therapist: true;
      labTechnician: true;
      financeBilling: true;
      supportStaff: true;
      nurse: true;
      counselor: true;
    }>
  ): Promise<UserWithRelations | null> {
    return this.userMethods.findUserByEmailSafe(email, includeRelations);
  }

  async findUserByEmailForAuth(
    email: string
  ): Promise<(UserWithRelations & { password: string }) | null> {
    const result = await this.userMethods.findUserByEmailForAuth(email);
    return result as (UserWithRelations & { password: string }) | null;
  }

  async findUsersSafe(
    where: UserWhereInput,
    pagination?: { take?: number; skip?: number }
  ): Promise<UserWithRelations[]> {
    return this.userMethods.findUsersSafe(where, pagination);
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

  // ============ Notification Preferences ============

  async findNotificationPreferenceByUserIdSafe(userId: string) {
    return this.executeRead(async prisma => {
      const client = this.toTransactionClient(prisma);
      const notificationPreferenceClient = client as unknown as {
        notificationPreference: {
          findUnique: (args: { where: { userId: string } }) => Promise<unknown>;
        };
      };
      return (await notificationPreferenceClient.notificationPreference.findUnique({
        where: { userId },
      })) as {
        id: string;
        userId: string;
        emailEnabled: boolean;
        smsEnabled: boolean;
        pushEnabled: boolean;
        socketEnabled: boolean;
        whatsappEnabled: boolean;
        appointmentEnabled: boolean;
        ehrEnabled: boolean;
        billingEnabled: boolean;
        systemEnabled: boolean;
        quietHoursStart: string | null;
        quietHoursEnd: string | null;
        quietHoursTimezone: string | null;
        categoryPreferences: Record<string, unknown> | null;
        createdAt: Date;
        updatedAt: Date;
      } | null;
    }, this.queryOptionsBuilder.where({ userId }).useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(false).rowLevelSecurity(false).build());
  }

  async createNotificationPreferenceSafe(data: {
    userId: string;
    emailEnabled: boolean;
    smsEnabled: boolean;
    pushEnabled: boolean;
    socketEnabled: boolean;
    whatsappEnabled: boolean;
    appointmentEnabled: boolean;
    ehrEnabled: boolean;
    billingEnabled: boolean;
    systemEnabled: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    quietHoursTimezone: string | null;
    categoryPreferences: Record<string, unknown> | null;
  }) {
    return this.executeWrite(
      async prisma => {
        const client = this.toTransactionClient(prisma);
        const notificationPreferenceClient = client as unknown as {
          notificationPreference: {
            create: (args: {
              data: {
                userId: string;
                emailEnabled: boolean;
                smsEnabled: boolean;
                pushEnabled: boolean;
                socketEnabled: boolean;
                whatsappEnabled: boolean;
                appointmentEnabled: boolean;
                ehrEnabled: boolean;
                billingEnabled: boolean;
                systemEnabled: boolean;
                quietHoursStart: string | null;
                quietHoursEnd: string | null;
                quietHoursTimezone: string | null;
                categoryPreferences: Record<string, unknown> | null;
              };
            }) => Promise<unknown>;
          };
        };
        return (await notificationPreferenceClient.notificationPreference.create({
          data: {
            userId: data.userId,
            emailEnabled: data.emailEnabled,
            smsEnabled: data.smsEnabled,
            pushEnabled: data.pushEnabled,
            socketEnabled: data.socketEnabled,
            whatsappEnabled: data.whatsappEnabled,
            appointmentEnabled: data.appointmentEnabled,
            ehrEnabled: data.ehrEnabled,
            billingEnabled: data.billingEnabled,
            systemEnabled: data.systemEnabled,
            quietHoursStart: data.quietHoursStart,
            quietHoursEnd: data.quietHoursEnd,
            quietHoursTimezone: data.quietHoursTimezone,
            categoryPreferences: data.categoryPreferences,
          },
        })) as {
          id: string;
          userId: string;
          emailEnabled: boolean;
          smsEnabled: boolean;
          pushEnabled: boolean;
          socketEnabled: boolean;
          whatsappEnabled: boolean;
          appointmentEnabled: boolean;
          ehrEnabled: boolean;
          billingEnabled: boolean;
          systemEnabled: boolean;
          quietHoursStart: string | null;
          quietHoursEnd: string | null;
          quietHoursTimezone: string | null;
          categoryPreferences: Record<string, unknown> | null;
          createdAt: Date;
          updatedAt: Date;
        };
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'createNotificationPreference',
        resourceType: 'NOTIFICATION_PREFERENCE',
        resourceId: 'pending',
        timestamp: new Date(),
      },
      this.queryOptionsBuilder
        .useCache(false)
        .priority('normal')
        .hipaaCompliant(false)
        .rowLevelSecurity(false)
        .retries(2)
        .build()
    );
  }

  async updateNotificationPreferenceSafe(
    id: string,
    data: {
      emailEnabled?: boolean;
      smsEnabled?: boolean;
      pushEnabled?: boolean;
      socketEnabled?: boolean;
      whatsappEnabled?: boolean;
      appointmentEnabled?: boolean;
      ehrEnabled?: boolean;
      billingEnabled?: boolean;
      systemEnabled?: boolean;
      quietHoursStart?: string | null;
      quietHoursEnd?: string | null;
      quietHoursTimezone?: string | null;
      categoryPreferences?: Record<string, unknown> | null;
    }
  ) {
    return this.executeWrite(
      async prisma => {
        const client = this.toTransactionClient(prisma);
        const notificationPreferenceClient = client as unknown as {
          notificationPreference: {
            update: (args: {
              where: { id: string };
              data: {
                emailEnabled?: boolean;
                smsEnabled?: boolean;
                pushEnabled?: boolean;
                socketEnabled?: boolean;
                whatsappEnabled?: boolean;
                appointmentEnabled?: boolean;
                ehrEnabled?: boolean;
                billingEnabled?: boolean;
                systemEnabled?: boolean;
                quietHoursStart?: string | null;
                quietHoursEnd?: string | null;
                quietHoursTimezone?: string | null;
                categoryPreferences?: Record<string, unknown> | null;
              };
            }) => Promise<unknown>;
          };
        };
        return (await notificationPreferenceClient.notificationPreference.update({
          where: { id },
          data: {
            ...(data.emailEnabled !== undefined && { emailEnabled: data.emailEnabled }),
            ...(data.smsEnabled !== undefined && { smsEnabled: data.smsEnabled }),
            ...(data.pushEnabled !== undefined && { pushEnabled: data.pushEnabled }),
            ...(data.socketEnabled !== undefined && { socketEnabled: data.socketEnabled }),
            ...(data.whatsappEnabled !== undefined && { whatsappEnabled: data.whatsappEnabled }),
            ...(data.appointmentEnabled !== undefined && {
              appointmentEnabled: data.appointmentEnabled,
            }),
            ...(data.ehrEnabled !== undefined && { ehrEnabled: data.ehrEnabled }),
            ...(data.billingEnabled !== undefined && { billingEnabled: data.billingEnabled }),
            ...(data.systemEnabled !== undefined && { systemEnabled: data.systemEnabled }),
            ...(data.quietHoursStart !== undefined && { quietHoursStart: data.quietHoursStart }),
            ...(data.quietHoursEnd !== undefined && { quietHoursEnd: data.quietHoursEnd }),
            ...(data.quietHoursTimezone !== undefined && {
              quietHoursTimezone: data.quietHoursTimezone,
            }),
            ...(data.categoryPreferences !== undefined && {
              categoryPreferences: data.categoryPreferences,
            }),
          },
        })) as {
          id: string;
          userId: string;
          emailEnabled: boolean;
          smsEnabled: boolean;
          pushEnabled: boolean;
          socketEnabled: boolean;
          whatsappEnabled: boolean;
          appointmentEnabled: boolean;
          ehrEnabled: boolean;
          billingEnabled: boolean;
          systemEnabled: boolean;
          quietHoursStart: string | null;
          quietHoursEnd: string | null;
          quietHoursTimezone: string | null;
          categoryPreferences: Record<string, unknown> | null;
          createdAt: Date;
          updatedAt: Date;
        };
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'updateNotificationPreference',
        resourceType: 'NOTIFICATION_PREFERENCE',
        resourceId: id,
        timestamp: new Date(),
      },
      this.queryOptionsBuilder
        .where({ id })
        .useCache(false)
        .priority('normal')
        .hipaaCompliant(false)
        .rowLevelSecurity(false)
        .retries(2)
        .build()
    );
  }

  async deleteNotificationPreferenceSafe(id: string) {
    return this.executeWrite(
      async prisma => {
        const client = this.toTransactionClient(prisma);
        const notificationPreferenceClient = client as unknown as {
          notificationPreference: {
            delete: (args: { where: { id: string } }) => Promise<unknown>;
          };
        };
        return (await notificationPreferenceClient.notificationPreference.delete({
          where: { id },
        })) as {
          id: string;
          userId: string;
          emailEnabled: boolean;
          smsEnabled: boolean;
          pushEnabled: boolean;
          socketEnabled: boolean;
          whatsappEnabled: boolean;
          appointmentEnabled: boolean;
          ehrEnabled: boolean;
          billingEnabled: boolean;
          systemEnabled: boolean;
          quietHoursStart: string | null;
          quietHoursEnd: string | null;
          quietHoursTimezone: string | null;
          categoryPreferences: Record<string, unknown> | null;
        };
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'deleteNotificationPreference',
        resourceType: 'NOTIFICATION_PREFERENCE',
        resourceId: id,
        timestamp: new Date(),
      },
      this.queryOptionsBuilder
        .where({ id })
        .useCache(false)
        .priority('normal')
        .hipaaCompliant(false)
        .rowLevelSecurity(false)
        .retries(2)
        .build()
    );
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

  async findAppointmentsSafe(
    where: AppointmentWhereInput,
    options?: {
      skip?: number;
      take?: number;
      orderBy?: { date?: 'asc' | 'desc' } | { createdAt?: 'asc' | 'desc' };
    }
  ): Promise<AppointmentWithRelations[]> {
    return this.appointmentMethods.findAppointmentsSafe(where, options);
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
    isActive: boolean;
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
   * ============================================================================
   * CENTRALIZED CACHE INVALIDATION SYSTEM
   * ============================================================================
   *
   * This system provides consistent, automatic cache invalidation across all
   * cache layers (Redis, in-memory, query cache).
   *
   * Features:
   * - Automatic invalidation on writes
   * - Consistent tag generation
   * - Multi-layer invalidation (all cache layers)
   * - Error handling (cache failures don't block operations)
   * - Performance optimized (async, non-blocking)
   * ============================================================================
   */

  /**
   * Generate consistent cache tags for an entity
   * Centralized tag generation to avoid edge cases and stale cache
   *
   * @param entityType - Entity type (e.g., 'user', 'appointment', 'patient')
   * @param entityId - Entity ID (optional)
   * @param clinicId - Clinic ID (optional, for multi-tenant)
   * @returns Array of cache tags
   */
  private generateCacheTags(entityType: string, entityId?: string, clinicId?: string): string[] {
    const tags: string[] = [
      'database', // Global database tag
      entityType.toLowerCase(), // Entity type tag (e.g., 'user')
      `${entityType.toLowerCase()}s`, // Plural tag (e.g., 'users')
    ];

    if (entityId) {
      tags.push(`${entityType.toLowerCase()}:${entityId}`); // Specific entity tag
    }

    if (clinicId) {
      tags.push(`clinic:${clinicId}`); // Clinic-specific tag
      tags.push(`clinic:${clinicId}:${entityType.toLowerCase()}`); // Clinic + entity tag
    }

    return tags;
  }

  /**
   * Invalidate cache across all layers with consistent tag strategy
   *
   * This method invalidates cache in:
   * - QueryCacheService (query result cache)
   * - CacheService (Redis/in-memory cache)
   * - All cache layers using tag-based invalidation
   *
   * @param tags - Cache tags to invalidate
   * @param entityType - Optional entity type for additional tag generation
   * @param entityId - Optional entity ID for specific invalidation
   * @param clinicId - Optional clinic ID for clinic-specific invalidation
   */
  private async invalidateCache(
    tags: string[],
    entityType?: string,
    entityId?: string,
    clinicId?: string
  ): Promise<void> {
    // Generate additional tags if entity info provided
    const allTags = entityType
      ? [...tags, ...this.generateCacheTags(entityType, entityId, clinicId)]
      : tags;

    // Remove duplicates
    const uniqueTags = Array.from(new Set(allTags));

    if (!this.cacheService) {
      return;
    }

    try {
      // Invalidate across all cache layers in parallel
      const invalidationPromises = [
        // Invalidate by tags (Redis/in-memory cache)
        ...uniqueTags.map(tag => this.cacheService!.invalidateCacheByTag(tag)),
        // Invalidate query cache if available
        ...(this.queryCache ? [this.queryCache.invalidateCache(undefined, uniqueTags)] : []),
      ];

      await Promise.all(invalidationPromises);

      // Log invalidation for debugging (only in debug mode for performance)
      // Use helper function (which uses dotenv) for environment variable access
      if (getEnv('LOG_LEVEL') === 'DEBUG') {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.DEBUG,
          `Cache invalidated: ${uniqueTags.length} tags`,
          this.serviceName,
          { tags: uniqueTags, entityType, entityId, clinicId }
        );
      }
    } catch (error) {
      // Cache invalidation failures should not block operations
      // Log warning but don't throw
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.WARN,
        `Cache invalidation failed (non-blocking): ${error instanceof Error ? error.message : String(error)}`,
        this.serviceName,
        {
          tags: uniqueTags,
          entityType,
          entityId,
          clinicId,
          error: error instanceof Error ? error.stack : String(error),
        }
      );
    }
  }

  /**
   * Automatically invalidate cache after write operations
   * Called automatically by executeWrite for all write operations
   *
   * @param resourceType - Type of resource modified (e.g., 'USER', 'APPOINTMENT')
   * @param resourceId - ID of resource modified
   * @param clinicId - Clinic ID (for multi-tenant invalidation)
   */
  private async autoInvalidateCacheAfterWrite(
    resourceType: string,
    resourceId?: string,
    clinicId?: string
  ): Promise<void> {
    const entityType = resourceType.toLowerCase();
    await this.invalidateCache([], entityType, resourceId, clinicId);
  }

  /**
   * Manually invalidate cache for specific entity
   *
   * PUBLIC METHOD: Use when you need to manually invalidate cache
   * (e.g., after external data changes, bulk operations, migrations)
   *
   * NOTE: For normal write operations, cache invalidation is automatic.
   * This method is only needed for edge cases.
   *
   * @param entityType - Entity type (e.g., 'user', 'appointment', 'patient')
   * @param entityId - Optional entity ID for specific invalidation
   * @param clinicId - Optional clinic ID for clinic-specific invalidation
   *
   * @example
   * ```typescript
   * // Invalidate all user cache
   * await database.invalidateEntityCache('user');
   *
   * // Invalidate specific user cache
   * await database.invalidateEntityCache('user', userId);
   *
   * // Invalidate clinic-specific cache
   * await database.invalidateEntityCache('appointment', undefined, clinicId);
   * ```
   */
  async invalidateEntityCache(
    entityType: string,
    entityId?: string,
    clinicId?: string
  ): Promise<void> {
    await this.invalidateCache([], entityType, entityId, clinicId);
  }

  /**
   * Construct clinic-specific database connection string
   *
   * Utility method to build database connection strings for clinic-specific databases.
   * Extracts connection details from the main DATABASE_URL and constructs a new connection
   * string for a clinic-specific database.
   *
   * SECURITY: All credentials must come from environment variables. No hardcoded defaults.
   *
   * @param databaseName - Name of the clinic-specific database
   * @param customConnectionString - Optional custom connection string (if provided, uses as-is)
   * @returns Clinic-specific database connection string
   * @throws HealthcareError if required database credentials are missing from environment variables
   *
   * @example
   * ```typescript
   * const clinicDbUrl = this.databaseService.constructClinicDatabaseUrl('clinic_123');
   * // Returns: postgresql://user:password@host:port/clinic_123
   * ```
   */
  constructClinicDatabaseUrl(databaseName: string, customConnectionString?: string): string {
    // If custom connection string provided, use it as-is
    if (customConnectionString) {
      return customConnectionString;
    }

    // Get database URL from environment variables (no hardcoded defaults for security)
    const dbUrl = getEnv('DATABASE_URL');

    if (dbUrl) {
      // Parse DATABASE_URL: postgresql://user:password@host:port/database
      const urlMatch = dbUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\//);
      if (urlMatch && urlMatch[1] && urlMatch[2] && urlMatch[3] && urlMatch[4]) {
        const dbUser = urlMatch[1];
        const dbPassword = urlMatch[2];
        const dbHost = urlMatch[3];
        const dbPort = urlMatch[4];

        // Construct clinic-specific database connection string
        return `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${databaseName}`;
      }
    }

    // Fallback to individual environment variables (all required, no defaults)
    const dbHost = getEnv('DATABASE_HOST');
    const dbPort = getEnv('DATABASE_PORT');
    const dbUser = getEnv('DATABASE_USER');
    const dbPassword = getEnv('DATABASE_PASSWORD');

    // Validate all required credentials are present
    if (!dbHost || !dbPort || !dbUser || !dbPassword) {
      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        'Database credentials are missing. Please set DATABASE_URL or DATABASE_HOST, DATABASE_PORT, DATABASE_USER, and DATABASE_PASSWORD environment variables.',
        undefined,
        {
          missingFields: {
            host: !dbHost,
            port: !dbPort,
            user: !dbUser,
            password: !dbPassword,
          },
        },
        this.serviceName
      );
    }

    // Construct clinic-specific database connection string
    return `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${databaseName}`;
  }
}
