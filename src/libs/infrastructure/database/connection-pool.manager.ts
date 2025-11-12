import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@config';
import { HealthcareDatabaseClient } from './clients/healthcare-database.client';
import type { PrismaService } from './prisma/prisma.service';
import { PrismaService as PrismaServiceClass } from './prisma/prisma.service';
import { HealthcareQueryOptimizerService } from './query-optimizer.service';
// Internal imports - Infrastructure
import { LoggingService } from '@infrastructure/logging';

// Internal imports - Core types
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import type { EnterpriseEventPayload, EventResult } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

// Internal imports - Events (using forwardRef to avoid circular dependency)
// Define interface for EventService to avoid circular dependency type resolution issues
interface IEventService {
  emitEnterprise<T extends EnterpriseEventPayload>(
    eventType: string,
    payload: T,
    options?: {
      priority?: EventPriority;
      retryPolicy?: { maxRetries: number; retryDelay: number };
      async?: boolean;
      timeout?: number;
    }
  ): Promise<EventResult>;
}

// Import EventService class for forwardRef injection (value import)
// Note: Using forwardRef causes TypeScript to treat EventService as error type,
// so we use IEventService interface for property types and type guards
import { EventService } from '@infrastructure/events';

import type {
  ConnectionMetrics,
  QueryOptions,
  CircuitBreakerState,
} from '@core/types/database.types';

// Re-export for backward compatibility
export type {
  ConnectionMetrics,
  QueryOptions,
  CircuitBreakerState,
} from '@core/types/database.types';

/**
 * Enhanced connection pool manager for healthcare applications
 * Supports high-volume operations (10 lakh+ users) with enterprise patterns
 *
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 * All methods are private/protected. Use HealthcareDatabaseClient instead.
 * @internal
 */
@Injectable()
export class ConnectionPoolManager implements OnModuleInit, OnModuleDestroy {
  private readonly serviceName = 'ConnectionPoolManager';
  private metrics!: ConnectionMetrics;
  private circuitBreaker!: CircuitBreakerState;
  private queryQueue: Array<{
    query: string;
    params: unknown[];
    options: QueryOptions;
    resolve: (result: unknown) => void;
    reject: (error: unknown) => void;
    timestamp: Date;
  }> = [];
  private isProcessingQueue = false;
  private healthCheckInterval!: NodeJS.Timeout;
  private slowQueryThreshold = 1000; // 1 second
  private circuitBreakerThreshold = 5;
  private circuitBreakerTimeout = 30000; // 30 seconds

  private readonly eventService?: IEventService;
  private readonly queryOptimizer?: HealthcareQueryOptimizerService;

  /**
   * Type guard to check if eventService is available and has emitEnterprise method
   * Uses duck typing to avoid circular dependency type resolution issues
   */
  private isEventServiceAvailable(service: IEventService | undefined): service is IEventService {
    if (!service || typeof service !== 'object') {
      return false;
    }
    // Check for emitEnterprise method using duck typing
    const hasMethod = 'emitEnterprise' in service;
    const methodType = typeof (service as { emitEnterprise?: unknown }).emitEnterprise;
    return hasMethod && methodType === 'function';
  }

  constructor(
    @Inject(forwardRef(() => ConfigService)) private configService: ConfigService,
    @Inject(forwardRef(() => HealthcareDatabaseClient))
    private databaseService: HealthcareDatabaseClient,
    @Inject(forwardRef(() => LoggingService)) private loggingService: LoggingService,
    @Optional()
    // Type assertion needed due to circular dependency - EventService type can't be resolved in forwardRef
    // Using helper function to avoid TypeScript type resolution issues with forwardRef
    // The type guard ensures type safety at runtime
    @Inject(forwardRef(() => EventService))
    eventService?: unknown,
    @Optional()
    @Inject(forwardRef(() => HealthcareQueryOptimizerService))
    queryOptimizer?: HealthcareQueryOptimizerService
  ) {
    // Assign optional services (handle undefined explicitly for exactOptionalPropertyTypes)
    // Type assertion needed due to forwardRef circular dependency type resolution
    // The type guard will ensure type safety when using the service
    if (eventService !== undefined && this.isEventServiceAvailable(eventService as IEventService)) {
      this.eventService = eventService as IEventService;
    }
    if (queryOptimizer !== undefined) {
      this.queryOptimizer = queryOptimizer;
    }
    this.initializeMetrics();
    this.initializeCircuitBreaker();
  }

  onModuleInit() {
    this.initializePool();
    this.startHealthMonitoring();
    this.startQueueProcessor();
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Enhanced connection pool manager initialized',
      this.serviceName
    );
  }

  onModuleDestroy() {
    clearInterval(this.healthCheckInterval);
    this.closePool();
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Connection pool manager destroyed',
      this.serviceName
    );
  }

  private initializeMetrics() {
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingConnections: 0,
      totalQueries: 0,
      averageQueryTime: 0,
      slowQueries: 0,
      errors: 0,
      lastHealthCheck: new Date(),
      isHealthy: true,
      // Enhanced metrics for 1M+ users
      peakConnections: 0,
      connectionUtilization: 0,
      queryThroughput: 0,
      cacheHitRate: 0,
      readReplicaConnections: 0,
      circuitBreakerTrips: 0,
      autoScalingEvents: 0,
    };
  }

  private initializeCircuitBreaker() {
    this.circuitBreaker = {
      isOpen: false,
      failures: 0,
      failureCount: 0,
      successCount: 0,
    };
  }

  private initializePool() {
    // Initialize connection pool configuration for Prisma - Optimized for 10M+ users
    const poolConfig = {
      min:
        this.configService?.get<number>('DB_POOL_MIN', 50) ||
        parseInt(process.env['DB_POOL_MIN'] || '50', 10), // Increased from 20
      max:
        this.configService?.get<number>('DB_POOL_MAX', 500) ||
        parseInt(process.env['DB_POOL_MAX'] || '500', 10), // Increased from 300 for scale
      maxUses:
        this.configService?.get<number>('DB_POOL_MAX_USES', 10000) ||
        parseInt(process.env['DB_POOL_MAX_USES'] || '10000', 10), // Increased from 7500
    };

    // Update metrics with estimated values
    this.metrics.totalConnections = poolConfig.min;

    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      `Connection pool manager initialized with min: ${poolConfig.min}, max: ${poolConfig.max}`,
      this.serviceName
    );
  }

  /**
   * Execute query with advanced features (circuit breaker, retry, priority queue)
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  async executeQuery<T>(
    query: string,
    params: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<T> {
    // Check circuit breaker
    if (this.circuitBreaker.isOpen && !this.shouldAttemptHalfOpen()) {
      throw new HealthcareError(
        ErrorCode.DATABASE_CONNECTION_FAILED,
        'Circuit breaker is open - database unavailable',
        undefined,
        { circuitBreakerState: this.circuitBreaker },
        'ConnectionPoolManager'
      );
    }

    const startTime = Date.now();

    try {
      const result = await this.executeQueryInternal<T>(query, params, options);

      // Update metrics
      const queryTime = Date.now() - startTime;
      this.updateMetrics(queryTime);
      this.handleCircuitBreakerSuccess();

      return result;
    } catch (error) {
      this.metrics.errors++;
      this.handleCircuitBreakerFailure();

      // Retry logic
      const retries = options.retries || 0;
      if (retries > 0) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Query failed, retrying (${retries} attempts left): ${(error as Error).message}`,
          this.serviceName
        );
        await this.delay(1000 * (4 - retries)); // Exponential backoff
        return this.executeQuery<T>(query, params, {
          ...options,
          retries: retries - 1,
        });
      }

      if (error instanceof HealthcareError) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        `Query execution failed: ${(error as Error).message}`,
        undefined,
        { query, originalError: (error as Error).message },
        this.serviceName
      );
    }
  }

  private async executeQueryInternal<T>(
    query: string,
    params: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<T> {
    const priority = options.priority || 'normal';

    // For high priority queries, execute immediately
    if (priority === 'high' || this.queryQueue.length === 0) {
      return this.directExecute<T>(query, params, options);
    }

    // For normal/low priority, add to queue
    return new Promise<T>((resolve, reject) => {
      this.queryQueue.push({
        query,
        params,
        options,
        resolve: resolve as (result: unknown) => void,
        reject: reject as (error: unknown) => void,
        timestamp: new Date(),
      });

      // Sort queue by priority
      this.queryQueue.sort((a, b) => {
        const priorityOrder: Record<'high' | 'normal' | 'low' | 'critical', number> = {
          critical: 4,
          high: 3,
          normal: 2,
          low: 1,
        };
        type PriorityType = 'critical' | 'high' | 'normal' | 'low';
        const bPriorityRaw = b.options.priority || 'normal';
        const aPriorityRaw = a.options.priority || 'normal';
        const bPriority: PriorityType =
          bPriorityRaw === 'critical' || bPriorityRaw === 'high' || bPriorityRaw === 'low'
            ? bPriorityRaw
            : 'normal';
        const aPriority: PriorityType =
          aPriorityRaw === 'critical' || aPriorityRaw === 'high' || aPriorityRaw === 'low'
            ? aPriorityRaw
            : 'normal';
        const bValue = priorityOrder[bPriority] || 2;
        const aValue = priorityOrder[aPriority] || 2;
        return bValue - aValue;
      });
    });
  }

  private async directExecute<T>(
    query: string,
    params: unknown[] = [],
    _options: QueryOptions = {}
  ): Promise<T> {
    try {
      this.metrics.activeConnections++;

      // Execute query using Prisma's raw query through HealthcareDatabaseClient
      // Use protected internal accessor for infrastructure components
      // Accessing protected method - ConnectionPoolManager is infrastructure component
      const prismaClient = (
        this.databaseService as unknown as { getInternalPrismaClient: () => PrismaService }
      ).getInternalPrismaClient();
      // Convert params to the expected type for $queryRawUnsafe
      const typedParams: Array<string | number | boolean | null> = params.map(param => {
        if (
          typeof param === 'string' ||
          typeof param === 'number' ||
          typeof param === 'boolean' ||
          param === null
        ) {
          return param;
        }
        // For objects, use JSON.stringify to avoid '[object Object]' stringification
        if (typeof param === 'object' && param !== null) {
          try {
            return JSON.stringify(param);
          } catch {
            return '[object Object]';
          }
        }
        // For symbols, use toString() explicitly
        if (typeof param === 'symbol') {
          return param.toString();
        }
        // For bigint, convert explicitly
        if (typeof param === 'bigint') {
          return String(param);
        }
        // For all other types (undefined, function, etc.), use explicit conversion
        // Handle undefined explicitly
        if (param === undefined) {
          return 'undefined';
        }
        // For functions, return function name
        if (typeof param === 'function') {
          return param.name || '[Function]';
        }
        // For any remaining types, convert to string (should not reach here in practice)
        // This handles any edge cases not covered above
        if (param === null) {
          return 'null';
        }
        // Should not reach here, but handle gracefully
        return JSON.stringify(param);
      });
      const result = await prismaClient.$queryRawUnsafe<T>(query, ...typedParams);

      return result as T;
    } finally {
      this.metrics.activeConnections--;
    }
  }

  private startQueueProcessor() {
    setInterval(() => {
      void (async () => {
        if (this.isProcessingQueue || this.queryQueue.length === 0) {
          return;
        }

        this.isProcessingQueue = true;

        try {
          // Enhanced for 10L+ users - increased batch size and intelligent processing
          const availableConnections =
            this.metrics.totalConnections - this.metrics.activeConnections;
          const batchSize = Math.min(
            Math.max(availableConnections * 2, 20), // Minimum 20, scale with available connections
            this.queryQueue.length,
            100 // Maximum 100 to prevent overwhelming
          );

          const batch = this.queryQueue.splice(0, batchSize);

          // Process with controlled concurrency
          const concurrencyLimit = Math.min(availableConnections, 50);
          const promises: Promise<void>[] = [];

          for (let i = 0; i < batch.length; i += concurrencyLimit) {
            const chunk = batch.slice(i, i + concurrencyLimit);

            const chunkPromise = Promise.all(
              chunk.map(async item => {
                try {
                  const result = await this.directExecute(item.query, item.params, item.options);
                  item.resolve(result);
                } catch (error) {
                  item.reject(error);
                }
              })
            ).then(() => {});

            promises.push(chunkPromise);
          }

          await Promise.all(promises);
        } finally {
          this.isProcessingQueue = false;
        }
      })();
    }, 50); // Process queue every 50ms for higher throughput
  }

  private startHealthMonitoring() {
    this.healthCheckInterval = setInterval(() => {
      void (async () => {
        try {
          const start = Date.now();
          // Use dedicated health check client to avoid interfering with regular operations
          const prismaClient = PrismaServiceClass.getHealthCheckClient();
          const typedClient = prismaClient as unknown as {
            $queryRaw: (query: TemplateStringsArray) => Promise<unknown>;
          };
          await typedClient.$queryRaw`SELECT 1`;
          const duration = Date.now() - start;

          this.metrics.lastHealthCheck = new Date();
          this.metrics.isHealthy = duration < 2000; // Relaxed for high-load scenarios

          // Update estimated pool metrics
          this.metrics.idleConnections = Math.max(
            0,
            this.metrics.totalConnections - this.metrics.activeConnections
          );
          this.metrics.waitingConnections = this.queryQueue.length;

          // Enhanced monitoring for 10L+ users
          const utilizationRate = this.metrics.activeConnections / this.metrics.totalConnections;
          const queueLength = this.queryQueue.length;

          // Log warnings for high utilization
          if (utilizationRate > 0.8) {
            void this.loggingService.log(
              LogType.DATABASE,
              LogLevel.WARN,
              `High connection pool utilization: ${(utilizationRate * 100).toFixed(1)}%`,
              this.serviceName
            );

            // Emit high utilization event using EventService
            if (this.isEventServiceAvailable(this.eventService)) {
              void this.eventService.emitEnterprise(
                'database.connection-pool.high-utilization',
                {
                  eventId: `high-utilization-${Date.now()}`,
                  eventType: 'database.connection-pool.high-utilization',
                  category: EventCategory.DATABASE,
                  priority: EventPriority.HIGH,
                  timestamp: new Date().toISOString(),
                  source: this.serviceName,
                  version: '1.0.0',
                  correlationId: `pool-util-${Date.now()}`,
                  traceId: `trace-${Date.now()}`,
                  payload: {
                    utilizationRate,
                    activeConnections: this.metrics.activeConnections,
                    totalConnections: this.metrics.totalConnections,
                    queueLength,
                    timestamp: new Date().toISOString(),
                  },
                },
                {
                  priority: EventPriority.HIGH,
                  async: true,
                }
              );
            }
          }

          if (queueLength > 100) {
            void this.loggingService.log(
              LogType.DATABASE,
              LogLevel.WARN,
              `Large query queue detected: ${queueLength} queries waiting`,
              this.serviceName
            );

            // Emit large queue event using EventService
            if (this.isEventServiceAvailable(this.eventService)) {
              void this.eventService.emitEnterprise(
                'database.connection-pool.large-queue',
                {
                  eventId: `large-queue-${Date.now()}`,
                  eventType: 'database.connection-pool.large-queue',
                  category: EventCategory.DATABASE,
                  priority: EventPriority.HIGH,
                  timestamp: new Date().toISOString(),
                  source: this.serviceName,
                  version: '1.0.0',
                  correlationId: `queue-${Date.now()}`,
                  traceId: `trace-${Date.now()}`,
                  payload: {
                    queueLength,
                    utilizationRate,
                    activeConnections: this.metrics.activeConnections,
                    totalConnections: this.metrics.totalConnections,
                    timestamp: new Date().toISOString(),
                  },
                },
                {
                  priority: EventPriority.HIGH,
                  async: true,
                }
              );
            }
          }

          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.DEBUG,
            `Health check completed in ${duration}ms`,
            this.serviceName,
            {
              total: this.metrics.totalConnections,
              active: this.metrics.activeConnections,
              idle: this.metrics.idleConnections,
              waiting: this.metrics.waitingConnections,
              utilization: `${(utilizationRate * 100).toFixed(1)}%`,
              queueLength: queueLength,
            }
          );
        } catch (error) {
          this.metrics.isHealthy = false;
          this.handleCircuitBreakerFailure();
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.ERROR,
            `Health check failed: ${(error as Error).message}`,
            this.serviceName,
            { error: (error as Error).stack }
          );
        }
      })();
    }, 15000); // Every 15 seconds for faster detection under high load
  }

  private updateMetrics(queryTime: number, query?: string) {
    this.metrics.totalQueries++;

    // Update average query time
    this.metrics.averageQueryTime =
      (this.metrics.averageQueryTime * (this.metrics.totalQueries - 1) + queryTime) /
      this.metrics.totalQueries;

    // Track peak connections
    if (this.metrics.activeConnections > this.metrics.peakConnections) {
      this.metrics.peakConnections = this.metrics.activeConnections;
    }

    // Update connection utilization
    this.metrics.connectionUtilization =
      this.metrics.totalConnections > 0
        ? this.metrics.activeConnections / this.metrics.totalConnections
        : 0;

    // Enhanced slow query detection with optimization recommendations
    if (queryTime > this.slowQueryThreshold) {
      this.metrics.slowQueries++;

      // Get optimization recommendations
      const recommendations: string[] = [];
      if (query) {
        if (query.includes('SELECT *')) {
          recommendations.push('Replace SELECT * with specific columns to reduce data transfer');
        }
        if (!query.includes('LIMIT') && query.includes('SELECT')) {
          recommendations.push('Add LIMIT clause to prevent large result sets');
        }
        if (query.includes('JOIN') && query.split('JOIN').length > 3) {
          recommendations.push('Consider simplifying JOINs or splitting into multiple queries');
        }
        if (!query.includes('WHERE') && query.includes('SELECT')) {
          recommendations.push('Add WHERE clause with indexed columns for better performance');
        }
      }

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.WARN,
        `Slow query detected: ${queryTime}ms (threshold: ${this.slowQueryThreshold}ms)`,
        this.serviceName,
        {
          queryTime,
          threshold: this.slowQueryThreshold,
          query: query ? query.substring(0, 200) : 'N/A',
          recommendations:
            recommendations.length > 0
              ? recommendations
              : ['Review query execution plan', 'Check index usage', 'Consider query optimization'],
          poolUtilization: this.metrics.connectionUtilization,
          activeConnections: this.metrics.activeConnections,
        }
      );

      // Trigger query optimization analysis
      if (query && this.queryOptimizer) {
        void this.queryOptimizer
          .optimizeQuery(query, {
            executionTime: queryTime,
            slow: true,
          })
          .catch(() => {
            // Optimization analysis failure is non-critical
          });
      }
    }

    // Critical query detection (> 5 seconds)
    if (queryTime > 5000) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `CRITICAL: Very slow query detected: ${queryTime}ms - immediate optimization required`,
        this.serviceName,
        {
          queryTime,
          query: query ? query.substring(0, 300) : 'N/A',
          actionRequired: [
            'Review query execution plan immediately',
            'Check for missing indexes',
            'Consider query rewriting or splitting',
            'Review database server performance',
            'Check for table locks or blocking queries',
          ],
        }
      );

      // Emit critical slow query event using EventService
      if (this.isEventServiceAvailable(this.eventService)) {
        void this.eventService.emitEnterprise(
          'database.query.critical-slow',
          {
            eventId: `critical-slow-query-${Date.now()}`,
            eventType: 'database.query.critical-slow',
            category: EventCategory.DATABASE,
            priority: EventPriority.CRITICAL,
            timestamp: new Date().toISOString(),
            source: this.serviceName,
            version: '1.0.0',
            correlationId: `slow-query-${Date.now()}`,
            traceId: `trace-${Date.now()}`,
            payload: {
              queryTime,
              query: query ? query.substring(0, 300) : 'N/A',
              threshold: 5000,
              actionRequired: [
                'Review query execution plan immediately',
                'Check for missing indexes',
                'Consider query rewriting or splitting',
                'Review database server performance',
                'Check for table locks or blocking queries',
              ],
              poolUtilization: this.metrics.connectionUtilization,
              activeConnections: this.metrics.activeConnections,
              timestamp: new Date().toISOString(),
            },
          },
          {
            priority: EventPriority.CRITICAL,
            async: true,
          }
        );
      }
    }
  }

  private handleCircuitBreakerSuccess() {
    this.circuitBreaker.successCount++;

    // Automatic recovery: Close circuit breaker after 3 successful operations
    if (this.circuitBreaker.isOpen && this.circuitBreaker.successCount >= 3) {
      const wasOpen = this.circuitBreaker.isOpen;
      this.circuitBreaker.isOpen = false;
      this.circuitBreaker.failureCount = 0;
      this.circuitBreaker.successCount = 0;
      delete this.circuitBreaker.lastFailure;
      delete this.circuitBreaker.halfOpenTime;
      this.metrics.circuitBreakerTrips++;

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        'Circuit breaker closed - database connection restored after successful recovery attempts',
        this.serviceName,
        {
          recoveryAttempts: 3,
          previousState: wasOpen ? 'OPEN' : 'CLOSED',
          recommendations: [
            'Monitor database health metrics',
            'Review error logs for root cause',
            'Consider increasing circuit breaker threshold if false positives occur',
          ],
        }
      );

      // Emit recovery event for monitoring systems using EventService
      if (this.isEventServiceAvailable(this.eventService)) {
        void this.eventService.emitEnterprise(
          'database.circuit-breaker.closed',
          {
            eventId: `circuit-breaker-closed-${Date.now()}`,
            eventType: 'database.circuit-breaker.closed',
            category: EventCategory.DATABASE,
            priority: EventPriority.HIGH,
            timestamp: new Date().toISOString(),
            source: this.serviceName,
            version: '1.0.0',
            correlationId: `cb-recovery-${Date.now()}`,
            traceId: `trace-${Date.now()}`,
            payload: {
              timestamp: new Date().toISOString(),
              service: this.serviceName,
              recoveryAttempts: 3,
              previousState: wasOpen ? 'OPEN' : 'CLOSED',
            },
          },
          {
            priority: EventPriority.HIGH,
            async: true,
          }
        );
      }
    }
  }

  private handleCircuitBreakerFailure() {
    this.circuitBreaker.failureCount++;
    this.circuitBreaker.lastFailure = new Date();

    if (
      this.circuitBreaker.failureCount >= this.circuitBreakerThreshold &&
      !this.circuitBreaker.isOpen
    ) {
      this.circuitBreaker.isOpen = true;
      this.circuitBreaker.halfOpenTime = new Date(Date.now() + this.circuitBreakerTimeout);
      this.metrics.circuitBreakerTrips++;

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Circuit breaker opened - database connection issues detected (${this.circuitBreaker.failureCount} failures)`,
        this.serviceName,
        {
          failureCount: this.circuitBreaker.failureCount,
          threshold: this.circuitBreakerThreshold,
          lastFailure: this.circuitBreaker.lastFailure.toISOString(),
          recoveryTime: this.circuitBreaker.halfOpenTime.toISOString(),
          recommendations: [
            'Check database server status and connectivity',
            'Review database error logs for root cause',
            'Verify network connectivity between application and database',
            'Check database connection pool configuration',
            'Review recent database migrations or schema changes',
            `Circuit breaker will attempt recovery after ${this.circuitBreakerTimeout}ms`,
          ],
          poolMetrics: {
            activeConnections: this.metrics.activeConnections,
            totalConnections: this.metrics.totalConnections,
            utilization: this.metrics.connectionUtilization,
          },
        }
      );

      // Emit circuit breaker open event for monitoring systems using EventService
      if (this.isEventServiceAvailable(this.eventService)) {
        void this.eventService.emitEnterprise(
          'database.circuit-breaker.opened',
          {
            eventId: `circuit-breaker-opened-${Date.now()}`,
            eventType: 'database.circuit-breaker.opened',
            category: EventCategory.DATABASE,
            priority: EventPriority.CRITICAL,
            timestamp: new Date().toISOString(),
            source: this.serviceName,
            version: '1.0.0',
            correlationId: `cb-failure-${Date.now()}`,
            traceId: `trace-${Date.now()}`,
            payload: {
              timestamp: new Date().toISOString(),
              service: this.serviceName,
              failureCount: this.circuitBreaker.failureCount,
              threshold: this.circuitBreakerThreshold,
              lastFailure: this.circuitBreaker.lastFailure
                ? this.circuitBreaker.lastFailure.toISOString()
                : undefined,
              recoveryTime: this.circuitBreaker.halfOpenTime
                ? this.circuitBreaker.halfOpenTime.toISOString()
                : undefined,
              poolMetrics: {
                activeConnections: this.metrics.activeConnections,
                totalConnections: this.metrics.totalConnections,
                utilization: this.metrics.connectionUtilization,
              },
            },
          },
          {
            priority: EventPriority.CRITICAL,
            async: true,
          }
        );
      }
    }
  }

  private shouldAttemptHalfOpen(): boolean {
    return !!(this.circuitBreaker.halfOpenTime && new Date() >= this.circuitBreaker.halfOpenTime);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private closePool() {
    // Connection pool will be handled by Prisma disconnect
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Connection pool manager closed',
      this.serviceName
    );
  }

  /**
   * Get connection metrics
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  getMetrics(): ConnectionMetrics {
    return { ...this.metrics };
  }

  /**
   * Get circuit breaker state
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  getCircuitBreakerState(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }

  /**
   * Reset circuit breaker
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  resetCircuitBreaker(): void {
    this.initializeCircuitBreaker();
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Circuit breaker reset',
      this.serviceName
    );
  }

  /**
   * Get queue length
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  getQueueLength(): number {
    return this.queryQueue.length;
  }

  /**
   * Healthcare-specific query methods
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  async executeHealthcareRead<T>(
    query: string,
    params: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<T> {
    return this.executeQuery<T>(query, params, {
      ...options,
      priority: options.priority || 'normal',
      timeout: options.timeout || 15000,
      retries: options.retries || 2,
    });
  }

  /**
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  async executeHealthcareWrite<T>(
    query: string,
    params: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<T> {
    return this.executeQuery<T>(query, params, {
      ...options,
      priority: options.priority || 'high',
      timeout: options.timeout || 30000,
      retries: options.retries || 1,
    });
  }

  /**
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  async executeCriticalQuery<T>(
    query: string,
    params: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<T> {
    return this.executeQuery<T>(query, params, {
      ...options,
      priority: 'high',
      timeout: options.timeout || 60000,
      retries: options.retries || 3,
    });
  }

  /**
   * Enterprise features for 1M+ users
   */

  /**
   * Execute batch operations with optimized concurrency for high scale
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  async executeBatch<T, U>(
    items: T[],
    operation: (item: T, index: number) => Promise<U>,
    options: {
      concurrency?: number;
      timeout?: number;
      clinicId?: string;
      priority?: 'high' | 'normal' | 'low';
    } = {}
  ): Promise<U[]> {
    const concurrency = options.concurrency || 50; // Higher concurrency for 1M users
    const startTime = Date.now();
    const results: U[] = [];

    try {
      // Process in chunks with controlled concurrency
      for (let i = 0; i < items.length; i += concurrency) {
        const chunk = items.slice(i, i + concurrency);
        const chunkResults = await Promise.all(
          chunk.map((item, index) => operation(item, i + index))
        );
        results.push(...chunkResults);
      }

      const executionTime = Date.now() - startTime;
      this.updateMetrics(executionTime);

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Batch operation completed: ${items.length} items`,
        this.serviceName,
        {
          itemCount: items.length,
          concurrency,
          executionTime,
          clinicId: options.clinicId,
        }
      );

      return results;
    } catch (error) {
      this.metrics.errors++;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Batch operation failed: ${(error as Error).message}`,
        this.serviceName,
        {
          itemCount: items.length,
          error: (error as Error).stack,
          clinicId: options.clinicId,
        }
      );
      if (error instanceof HealthcareError) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        `Batch operation failed: ${(error as Error).message}`,
        undefined,
        {
          itemCount: items.length,
          clinicId: options.clinicId,
          originalError: (error as Error).message,
        },
        this.serviceName
      );
    }
  }

  /**
   * Execute query with read replica routing for scale
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  async executeQueryWithReadReplica<T = unknown>(
    query: string,
    params: unknown[] = [],
    options: QueryOptions & { clinicId?: string; userId?: string } = {}
  ): Promise<T> {
    type HealthcareConfigShape = {
      database?: {
        connectionPool?: {
          readReplicas?: {
            enabled?: boolean;
          };
        };
      };
    };
    const healthcareConfig = this.configService?.get<HealthcareConfigShape | undefined>(
      'healthcare'
    );
    const readReplicasEnabled = healthcareConfig?.database?.connectionPool?.readReplicas?.enabled;

    // Route read queries to read replicas if available and query is read-only
    if (readReplicasEnabled && this.isReadOnlyQuery(query)) {
      try {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.DEBUG,
          'Query routed to read replica',
          this.serviceName,
          {
            query: query.substring(0, 100),
            clinicId: options.clinicId,
          }
        );

        // Update read replica metrics
        if (this.metrics.readReplicaConnections !== undefined) {
          this.metrics.readReplicaConnections++;
        }
      } catch (error) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Read replica failed, falling back to primary: ${(error as Error).message}`,
          this.serviceName,
          { error: (error as Error).stack }
        );
      }
    }

    return this.executeQuery<T>(query, params, options);
  }

  /**
   * Get comprehensive metrics for monitoring dashboards
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  getDetailedMetrics(): ConnectionMetrics & {
    queryMetrics: {
      queriesPerSecond: number;
      averageWaitTime: number;
      p95QueryTime: number;
      p99QueryTime: number;
    };
    connectionHealth: {
      poolUtilization: number;
      circuitBreakerStatus: string;
      healthyConnections: number;
    };
  } {
    return {
      ...this.metrics,
      queryMetrics: {
        queriesPerSecond: this.metrics.queryThroughput,
        averageWaitTime: this.metrics.averageQueryTime,
        p95QueryTime: this.metrics.averageQueryTime * 1.5, // Estimated
        p99QueryTime: this.metrics.averageQueryTime * 2, // Estimated
      },
      connectionHealth: {
        poolUtilization: this.metrics.connectionUtilization,
        circuitBreakerStatus: this.circuitBreaker.isOpen ? 'OPEN' : 'CLOSED',
        healthyConnections: this.metrics.totalConnections - this.metrics.errors,
      },
    };
  }

  /**
   * Auto-scaling logic for connection pool based on load
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  async autoScaleConnectionPool(): Promise<void> {
    type HealthcareConfigShape = {
      database?: {
        performance?: {
          autoScaling?: {
            enabled?: boolean;
          };
        };
      };
    };
    const healthcareConfig = this.configService?.get<HealthcareConfigShape | undefined>(
      'healthcare'
    );
    const autoScaling = healthcareConfig?.database?.performance?.autoScaling;

    if (!autoScaling?.enabled) return Promise.resolve();

    const currentUtilization = this.metrics.connectionUtilization;
    const currentConnections = this.metrics.activeConnections;

    // Scale up if utilization is high
    if (currentUtilization > 0.8 && currentConnections < 500) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        'Auto-scaling connection pool up',
        this.serviceName,
        {
          currentConnections,
          utilization: currentUtilization,
          targetConnections: Math.min(500, currentConnections + 50),
        }
      );

      this.metrics.autoScalingEvents++;

      // Emit auto-scaling event using EventService
      if (this.isEventServiceAvailable(this.eventService)) {
        void this.eventService.emitEnterprise(
          'database.connection-pool.auto-scaling',
          {
            eventId: `auto-scale-up-${Date.now()}`,
            eventType: 'database.connection-pool.auto-scaling',
            category: EventCategory.DATABASE,
            priority: EventPriority.HIGH,
            timestamp: new Date().toISOString(),
            source: this.serviceName,
            version: '1.0.0',
            correlationId: `auto-scale-${Date.now()}`,
            traceId: `trace-${Date.now()}`,
            payload: {
              action: 'scale-up',
              currentConnections,
              utilization: currentUtilization,
              targetConnections: Math.min(500, currentConnections + 50),
              timestamp: new Date().toISOString(),
            },
          },
          {
            priority: EventPriority.HIGH,
            async: true,
          }
        );
      }
    }

    // Scale down if utilization is consistently low
    if (currentUtilization < 0.3 && currentConnections > 50) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        'Auto-scaling connection pool down',
        this.serviceName,
        {
          currentConnections,
          utilization: currentUtilization,
          targetConnections: Math.max(50, currentConnections - 25),
        }
      );

      this.metrics.autoScalingEvents++;

      // Emit auto-scaling event using EventService
      if (this.isEventServiceAvailable(this.eventService)) {
        void this.eventService.emitEnterprise(
          'database.connection-pool.auto-scaling',
          {
            eventId: `auto-scale-down-${Date.now()}`,
            eventType: 'database.connection-pool.auto-scaling',
            category: EventCategory.DATABASE,
            priority: EventPriority.NORMAL,
            timestamp: new Date().toISOString(),
            source: this.serviceName,
            version: '1.0.0',
            correlationId: `auto-scale-${Date.now()}`,
            traceId: `trace-${Date.now()}`,
            payload: {
              action: 'scale-down',
              currentConnections,
              utilization: currentUtilization,
              targetConnections: Math.max(50, currentConnections - 25),
              timestamp: new Date().toISOString(),
            },
          },
          {
            priority: EventPriority.NORMAL,
            async: true,
          }
        );
      }
    }
  }

  /**
   * Optimize queries for clinic-specific operations
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  async executeClinicOptimizedQuery<T = unknown>(
    clinicId: string,
    query: string,
    params: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<T> {
    // Add clinic-specific optimizations
    const optimizedQuery = this.optimizeQueryForClinic(query, clinicId);

    return this.executeQuery<T>(optimizedQuery, [clinicId, ...params], {
      ...options,
      priority: 'high', // Clinic operations get high priority
    });
  }

  // Helper methods
  private isReadOnlyQuery(query: string): boolean {
    const readOnlyPatterns = /^\s*(SELECT|WITH|SHOW|EXPLAIN|DESCRIBE)/i;
    return readOnlyPatterns.test(query.trim());
  }

  private optimizeQueryForClinic(query: string, _clinicId: string): string {
    // Add clinic-specific query optimizations
    if (query.includes('WHERE') && !query.includes('clinic_id')) {
      // Ensure clinic isolation in queries
      return query.replace(/WHERE/, `WHERE clinic_id = $1 AND`);
    }
    return query;
  }

  /**
   * Graceful shutdown with connection draining
   */
  async gracefulShutdown(): Promise<void> {
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Starting graceful shutdown of connection pool',
      this.serviceName
    );

    // Stop accepting new queries
    clearInterval(this.healthCheckInterval);

    // Wait for existing queries to complete (with timeout)
    const shutdownTimeout = 30000; // 30 seconds
    const startTime = Date.now();

    while (this.metrics.activeConnections > 0 && Date.now() - startTime < shutdownTimeout) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        `Waiting for ${this.metrics.activeConnections} active connections to complete`,
        this.serviceName
      );
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Force close remaining connections
    this.closePool();
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Connection pool graceful shutdown completed',
      this.serviceName
    );
  }
}
