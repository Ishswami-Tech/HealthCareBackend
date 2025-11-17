import { Injectable, Inject, Optional, forwardRef } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma/prisma.service';
import { EventService } from '@infrastructure/events';
import type { PrismaClient } from '@infrastructure/database/prisma/prisma.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { UserWithRelations } from '@core/types/user.types';
import type {
  AppointmentWithRelations,
  AppointmentTimeSlot,
  BillingPlanWithRelations,
  SubscriptionWithRelations,
  InvoiceWithRelations,
  PaymentWithRelations,
  PatientWithUser,
} from '@core/types/database.types';
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
import { ConnectionPoolManager } from '@infrastructure/database/connection-pool.manager';
import { DatabaseMetricsService } from '@infrastructure/database/database-metrics.service';
import { ClinicIsolationService } from '@infrastructure/database/clinic-isolation.service';
import { HealthcareQueryOptimizerService } from '@infrastructure/database/query-optimizer.service';
import {
  calculatePagination,
  addDateRangeFilter,
  buildOrderBy,
} from '@infrastructure/database/query/query.utils';
import { CacheService } from '@infrastructure/cache';
import { RepositoryResult } from '@core/types/database.types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import type { IHealthcareDatabaseClient } from '@core/types/database.types';
import type {
  DatabaseHealthStatus,
  DatabaseClientMetrics,
  HealthcareDatabaseConfig,
  AuditInfo,
  HIPAAComplianceMetrics,
  ClinicDatabaseMetrics,
  DatabaseErrorCacheEntry,
  PrismaTransactionClient,
  ClinicDashboardStats,
  ClinicRecentActivity,
  ClinicPatientOptions,
  ClinicPatientResult,
  ClinicAppointmentOptions,
  ClinicAppointmentResult,
  RbacRoleEntity,
  RolePermissionEntity,
  UserRoleEntity,
} from '@core/types/database.types';
import type { PermissionEntity } from '@core/types/rbac.types';
import { CriticalPriority } from '@core/types/database.types';
import { type IEventService, isEventService, EventCategory, EventPriority } from '@core/types';
import type { EnterpriseEventPayload } from '@core/types/event.types';

/**
 * Healthcare Database Client Implementation
 *
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 * This class is exported publicly as "DatabaseService" for external services.
 *
 * IMPORTANT: External services should ALWAYS import and use DatabaseService:
 * ```typescript
 * import { DatabaseService } from "@infrastructure/database";
 * ```
 *
 * DO NOT import HealthcareDatabaseClient directly from external services.
 * This class name is only used internally by database infrastructure components.
 *
 * Provides core database operations for healthcare application with:
 * - Connection pooling for 10M+ users
 * - Metrics tracking and monitoring
 * - Error handling with RepositoryResult
 * - Health monitoring and circuit breakers
 * - Transaction support with audit trails
 * - Multi-tenant clinic isolation
 * - HIPAA compliance features
 * - Query caching and optimization
 * - Read replica routing
 *
 * Features:
 * - Error event caching and emission
 * - Comprehensive error handling
 * - Logging with LoggingService
 * - Event-driven error notifications
 *
 * @internal This class is internal infrastructure - use DatabaseService instead
 */
@Injectable()
export class HealthcareDatabaseClient implements IHealthcareDatabaseClient {
  private auditLog: AuditInfo[] = [];
  // Rate limiting for slow query warnings to prevent log spam
  private lastSlowQueryWarning: number = 0;
  private lastSlowWriteWarning: number = 0;
  private lastHipaaLogWarning: number = 0;
  private readonly SLOW_QUERY_WARNING_INTERVAL = 60000; // Only log slow query warnings once per minute
  private readonly HIPAA_LOG_INTERVAL = 60000; // Only log HIPAA access once per minute
  private slowQueryCount = 0; // Track number of slow queries since last warning
  private slowWriteQueryCount = 0; // Track number of slow write queries since last warning
  private hipaaLogCount = 0; // Track number of HIPAA logs since last warning
  private readonly maxAuditLogSize = 10000;

  // Error cache for deduplication and tracking
  private readonly errorCache = new Map<string, DatabaseErrorCacheEntry>();
  private readonly maxErrorCacheSize = 1000;
  private readonly errorCacheTTL = 5 * 60 * 1000; // 5 minutes
  private typedEventService?: IEventService;

  protected readonly config: HealthcareDatabaseConfig;

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

    @Inject(forwardRef(() => EventService))
    protected readonly eventService: unknown,
    @Optional()
    @Inject(forwardRef(() => CacheService))
    protected readonly cacheService?: CacheService,
    @Optional()
    @Inject('HealthcareDatabaseConfig')
    config?: HealthcareDatabaseConfig
  ) {
    // Type guard ensures type safety when using the service
    if (isEventService(this.eventService)) {
      this.typedEventService = this.eventService;
    }
    // Support both DI (via @Inject) and manual instantiation
    if (config) {
      this.config = config;
    } else {
      // Default config if not provided (for manual instantiation)
      this.config = {
        enableAuditLogging: true,
        enablePHIProtection: true,
        auditRetentionDays: 2555,
        encryptionEnabled: true,
        complianceLevel: 'HIPAA',
        connectionTimeout: 30000,
        queryTimeout: 15000,
        maxConnections: 50, // Reduced to prevent connection pool exhaustion (matches connection_limit in DATABASE_URL)
        healthCheckInterval: 30000,
      } as HealthcareDatabaseConfig;
    }
    // Clean up expired error cache entries periodically
    setInterval(() => this.cleanExpiredErrorCache(), 60000); // Every minute

    // Trigger auto-scaling check periodically (every 5 minutes)
    setInterval(
      () => {
        void this.triggerAutoScaling().catch(error => {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Auto-scaling check failed: ${error instanceof Error ? error.message : String(error)}`,
            'HealthcareDatabaseClient'
          );
        });
      },
      5 * 60 * 1000
    ); // Every 5 minutes
  }

  /**
   * Generate error cache key from error and operation
   */
  private getErrorCacheKey(error: Error, operation: string): string {
    const errorType = error.constructor.name;
    const errorMessage = error.message.substring(0, 100); // Limit message length
    return `${operation}:${errorType}:${errorMessage}`;
  }

  /**
   * Cache and emit database error events
   */
  private handleDatabaseError(
    error: Error,
    operation: string,
    context?: Record<string, string | number | boolean>
  ): void {
    const cacheKey = this.getErrorCacheKey(error, operation);
    const now = new Date();

    // Get or create cache entry
    let cacheEntry = this.errorCache.get(cacheKey);
    if (cacheEntry) {
      cacheEntry.retryCount++;
      cacheEntry.lastRetry = now;
    } else {
      // Create new cache entry
      const errorCode = (error as { code?: string }).code;
      cacheEntry = {
        error,
        timestamp: now,
        operation,
        ...(errorCode !== undefined && { errorCode }),
        retryCount: 1,
        lastRetry: now,
      };

      // Limit cache size
      if (this.errorCache.size >= this.maxErrorCacheSize) {
        // Remove oldest entry
        const firstKey = this.errorCache.keys().next().value;
        if (firstKey) {
          this.errorCache.delete(firstKey);
        }
      }

      this.errorCache.set(cacheKey, cacheEntry);
    }

    // Ensure cacheEntry is defined before using it
    if (cacheEntry && this.typedEventService) {
      // Emit error event via centralized EventService
      void this.typedEventService.emitEnterprise('database.error', {
        eventId: `db_error_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        eventType: 'database.error',
        category: EventCategory.DATABASE,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: 'HealthcareDatabaseClient',
        version: '1.0.0',
        payload: {
          error: {
            message: error.message,
            stack: error.stack,
            code: (error as { code?: string }).code,
            name: error.name,
          },
          operation,
          context: context || {},
          cacheEntry: {
            retryCount: cacheEntry.retryCount,
            firstOccurrence: cacheEntry.timestamp,
            lastRetry: cacheEntry.lastRetry,
          },
          timestamp: now,
        },
      } as EnterpriseEventPayload);

      // Log error using LoggingService
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Database operation failed: ${operation}`,
        'HealthcareDatabaseClient',
        {
          error: error.message,
          errorCode: (error as { code?: string }).code,
          operation,
          retryCount: cacheEntry.retryCount,
          context,
        }
      );
    }
  }

  /**
   * Clean up expired error cache entries
   */
  private cleanExpiredErrorCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.errorCache.entries()) {
      const age = now - entry.timestamp.getTime();
      if (age > this.errorCacheTTL) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.errorCache.delete(key);
    }

    if (keysToDelete.length > 0) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Cleaned up ${keysToDelete.length} expired error cache entries`,
        'HealthcareDatabaseClient',
        { cleanedEntries: keysToDelete.length }
      );
    }
  }

  /**
   * Get error cache statistics
   */
  getErrorCacheStats(): {
    totalErrors: number;
    uniqueErrors: number;
    recentErrors: DatabaseErrorCacheEntry[];
  } {
    const now = Date.now();
    const recentErrors = Array.from(this.errorCache.values()).filter(
      entry => now - entry.timestamp.getTime() < this.errorCacheTTL
    );

    return {
      totalErrors: Array.from(this.errorCache.values()).reduce(
        (sum, entry) => sum + entry.retryCount,
        0
      ),
      uniqueErrors: this.errorCache.size,
      recentErrors,
    };
  }

  /**
   * INTERNAL: Get the underlying Prisma client - ONLY for infrastructure components
   * External services should NEVER use this - use executeHealthcareRead/Write instead
   * ConnectionPoolManager, Repositories, and other infrastructure components can use this
   * @internal
   */
  protected getInternalPrismaClient(): PrismaService {
    return this.prismaService;
  }

  /**
   * Helper method to execute cached read operation with cache miss tracking
   * @internal
   */
  private async executeCachedRead<T>(
    cacheKey: string,
    operation: () => Promise<T>,
    tags: string[],
    ttl: number = 3600
  ): Promise<T> {
    if (this.cacheService) {
      const cacheStart = Date.now();

      try {
        // Try to get from cache first
        const cached = await this.cacheService.get<T>(cacheKey);
        if (cached !== null && cached !== undefined) {
          const cacheTime = Date.now() - cacheStart;

          // Update cache hit metrics
          // metricsService is a required dependency, so recordCacheHit is guaranteed to exist
          (this.metricsService as { recordCacheHit: (time: number) => void }).recordCacheHit(
            cacheTime
          );

          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.DEBUG,
            `Cache hit for key: ${cacheKey.substring(0, 100)}`,
            'HealthcareDatabaseClient',
            { cacheKey: cacheKey.substring(0, 100), cacheTime, tags }
          );

          return cached;
        }

        // Cache miss - execute operation and cache result
        const cacheMissTime = Date.now() - cacheStart;
        // metricsService is a required dependency, so recordCacheMiss is guaranteed to exist
        (this.metricsService as { recordCacheMiss: (time: number) => void }).recordCacheMiss(
          cacheMissTime
        );

        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.DEBUG,
          `Cache miss for key: ${cacheKey.substring(0, 100)} - executing operation`,
          'HealthcareDatabaseClient',
          { cacheKey: cacheKey.substring(0, 100), cacheMissTime, tags }
        );

        const result = await operation();

        // Cache the result using cache() method which handles TTL and options
        void this.cacheService
          .cache(cacheKey, () => Promise.resolve(result), {
            ttl,
            tags,
            containsPHI: true,
            priority: 'high',
            enableSwr: true,
          })
          .catch((cacheError: unknown) => {
            const errorMessage =
              cacheError instanceof Error ? cacheError.message : String(cacheError);
            void this.loggingService.log(
              LogType.DATABASE,
              LogLevel.WARN,
              `Failed to cache result for key: ${cacheKey.substring(0, 100)}`,
              'HealthcareDatabaseClient',
              {
                cacheKey: cacheKey.substring(0, 100),
                error: errorMessage,
              }
            );
          });

        return result;
      } catch (error: unknown) {
        // If cache operation fails, fall back to direct operation
        const errorMessage = error instanceof Error ? error.message : String(error);
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Cache operation failed for key: ${cacheKey.substring(0, 100)}, falling back to direct operation`,
          'HealthcareDatabaseClient',
          {
            cacheKey: cacheKey.substring(0, 100),
            error: errorMessage,
          }
        );
        return await operation();
      }
    }

    // No cache service available - execute directly
    return await operation();
  }

  /**
   * Helper method to invalidate cache after write operations
   * @internal
   */
  private async invalidateCache(tags: string[]): Promise<void> {
    if (this.cacheService) {
      await Promise.all(
        tags.map(tag => this.cacheService!.invalidateCacheByTag(tag).catch(() => {}))
      );
    }
  }

  /**
   * @deprecated Use executeHealthcareRead/Write methods instead
   * External services should NEVER use this - use executeHealthcareRead/Write/executeWithClinicContext
   * This method exists only for interface compatibility and will be removed in future versions
   *
   * WARNING: Using this method bypasses all optimization layers:
   * - Connection pooling benefits
   * - Query metrics tracking
   * - Query optimization
   * - Circuit breaker protection
   * - Audit logging
   * - Clinic isolation
   */
  getPrismaClient(): PrismaService {
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.WARN,
      'DEPRECATED: getPrismaClient() called - use executeHealthcareRead/Write instead',
      'HealthcareDatabaseClient',
      { stack: new Error().stack }
    );
    return this.prismaService;
  }

  /**
   * Get the underlying raw PrismaClient for accessing models not exposed as delegates
   * Use this for models like therapyQueue, checkInLocation, etc. that are not typed delegates
   * NOTE: This should be used through executeHealthcareRead/Write for optimization layers
   */
  getRawPrismaClient(): Promise<PrismaClient> {
    return Promise.resolve(this.prismaService.getRawPrismaClient());
  }

  // Comprehensive type-safe database operations
  // All methods use executeHealthcareRead/Write for full optimization layers
  async findUserByIdSafe(id: string): Promise<UserWithRelations | null> {
    const cacheKey = `user:findById:${id}`;

    // Use caching if available (completes the optimization stack)
    if (this.cacheService) {
      return await this.cacheService.cache(
        cacheKey,
        async () => {
          return await this.executeHealthcareRead<UserWithRelations | null>(async _client => {
            const prismaService = this.getInternalPrismaClient();
            const result = await prismaService.findUserByIdSafe(id);
            return result;
          });
        },
        {
          ttl: 3600, // 1 hour
          tags: [`user:${id}`, 'users'],
          containsPHI: true,
          priority: 'high',
          enableSwr: true,
        }
      );
    }

    // Fallback without cache
    return await this.executeHealthcareRead<UserWithRelations | null>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findUserByIdSafe(id);
      return result;
    });
  }

  /**
   * Find user by email with optimized query for 10M+ user scale
   * Uses selective includes based on user role to minimize data transfer
   * @param email - User email (indexed field for fast lookup)
   * @param includeRelations - Optional: specify which relations to include (default: minimal)
   */
  async findUserByEmailSafe(
    email: string,
    includeRelations?: {
      doctor?: boolean;
      patient?: boolean;
      receptionists?: boolean;
      clinicAdmins?: boolean;
      superAdmin?: boolean;
    }
  ): Promise<UserWithRelations | null> {
    const cacheKey = `user:findByEmail:${email}:${JSON.stringify(includeRelations || {})}`;
    return await this.executeCachedRead(
      cacheKey,
      async () => {
        return await this.executeHealthcareRead<UserWithRelations | null>(async client => {
          // Use the client directly instead of calling prismaService.findUserByEmailSafe again
          // This avoids recursive calls and connection pool exhaustion
          // Access user delegate using dot notation - PrismaTransactionClient has user as a property
          const userDelegate = (client as { user: { findUnique: (args: { where: { email: string }; include?: Record<string, unknown> }) => Promise<UserWithRelations | null> } }).user;

          // For 10M users: Only load relations if explicitly requested
          // Following .ai-rules: Use select to limit fields, use include with select for relations
          const include: Record<string, unknown> = {};
          if (includeRelations) {
            // Use select within include to limit nested fields (per .ai-rules/database.md)
            if (includeRelations.doctor) {
              include['doctor'] = {
                select: {
                  id: true,
                  userId: true,
                  specialization: true,
                  createdAt: true,
                  // Include clinicId through DoctorClinic junction table
                  clinics: {
                    select: {
                      clinicId: true,
                    },
                    take: 1, // Get first clinic (primary clinic)
                  },
                },
              };
            }
            if (includeRelations.patient) {
              include['patient'] = {
                select: {
                  id: true,
                  userId: true,
                  createdAt: true,
                },
              };
            }
            if (includeRelations.receptionists) {
              include['receptionists'] = {
                select: {
                  id: true,
                  userId: true,
                  clinicId: true,
                  createdAt: true,
                },
              };
            }
            if (includeRelations.clinicAdmins) {
              include['clinicAdmins'] = {
                select: {
                  id: true,
                  userId: true,
                  clinicId: true,
                  isOwner: true,
                  createdAt: true,
                },
              };
            }
            if (includeRelations.superAdmin) {
              include['superAdmin'] = {
                select: {
                  id: true,
                  userId: true,
                  createdAt: true,
                },
              };
            }
          } else {
            // Default: minimal includes for backward compatibility
            // Only load relations that are commonly needed, with select to limit fields
            include['doctor'] = {
              select: {
                id: true,
                userId: true,
                specialization: true,
                createdAt: true,
                // Include clinicId through DoctorClinic junction table
                clinics: {
                  select: {
                    clinicId: true,
                  },
                  take: 1, // Get first clinic (primary clinic)
                },
              },
            };
            include['patient'] = {
              select: {
                id: true,
                userId: true,
                createdAt: true,
              },
            };
          }

          const result = await userDelegate.findUnique({
            where: { email }, // Uses indexed email field for O(1) lookup
            ...(Object.keys(include).length > 0 ? { include } : {}),
          });
          return result;
        });
      },
      [`user:email:${email}`, 'users'],
      3600 // 1 hour cache - email is unique so cache is safe
    );
  }

  /**
   * Find users with pagination and result limits for 10M+ user scale
   * CRITICAL: Always use pagination to prevent loading millions of records
   * Uses query utils for optimized pagination and filtering
   * @param where - User where conditions
   * @param options - Pagination and query options
   */
  async findUsersSafe(
    where: UserWhereInput,
    options?: {
      page?: number; // Page number (1-based)
      limit?: number; // Max records per page (default: 100, max: 1000)
      take?: number; // Alternative to limit
      skip?: number; // Offset for pagination
      sortBy?: string; // Field to sort by (default: 'createdAt')
      sortOrder?: 'asc' | 'desc'; // Sort order (default: 'desc')
      dateFrom?: Date | string; // Filter by date range start
      dateTo?: Date | string; // Filter by date range end
      includeRelations?: {
        doctor?: boolean;
        patient?: boolean;
        receptionists?: boolean;
        clinicAdmins?: boolean;
        superAdmin?: boolean;
      };
    }
  ): Promise<UserWithRelations[]> {
    // Use query utils for optimized pagination calculation
    const pagination = calculatePagination({
      ...(options?.page !== undefined && { page: options.page }),
      ...(options?.limit !== undefined && { limit: options.limit }),
      ...(options?.take !== undefined && { take: options.take }),
      ...(options?.skip !== undefined && { skip: options.skip }),
    });

    // CRITICAL for 10M users: Enforce maximum limit of 1000 records per query
    const take = Math.min(pagination.take, 1000);
    const skip = pagination.skip;

    // Add date range filtering using query utils
    const optimizedWhere =
      options?.dateFrom || options?.dateTo
        ? (addDateRangeFilter(
            where as UserWhereInput & { createdAt?: { gte?: Date; lte?: Date } },
            options?.dateFrom,
            options?.dateTo,
            'createdAt'
          ) as UserWhereInput)
        : where;

    // Build order by clause using query utils
    const orderBy = buildOrderBy(options?.sortBy || 'createdAt', options?.sortOrder || 'desc');

    // Create cache key from optimized query parameters
    const whereHash = JSON.stringify({ where: optimizedWhere, take, skip, orderBy });
    const cacheKey = `user:findMany:${Buffer.from(whereHash).toString('base64').substring(0, 50)}`;

    return await this.executeCachedRead(
      cacheKey,
      async () => {
        return await this.executeHealthcareRead<UserWithRelations[]>(async client => {
          // Use the client directly instead of calling prismaService.findUsersSafe again
          // This avoids recursive calls and connection pool exhaustion
          const userDelegate = (
            client as unknown as {
              user: { findMany: (args: unknown) => Promise<UserWithRelations[]> };
            }
          )['user'];

          // For 10M users: Only load relations if explicitly requested
          // Following .ai-rules: Use select to limit fields, use include with select for relations
          const include: Record<string, unknown> = {};
          if (options?.includeRelations) {
            // Use select within include to limit nested fields (per .ai-rules/database.md)
            if (options.includeRelations.doctor) {
              include['doctor'] = {
                select: {
                  id: true,
                  userId: true,
                  specialization: true,
                  createdAt: true,
                  // Include clinicId through DoctorClinic junction table
                  clinics: {
                    select: {
                      clinicId: true,
                    },
                    take: 1, // Get first clinic (primary clinic)
                  },
                },
              };
            }
            if (options.includeRelations.patient) {
              include['patient'] = {
                select: {
                  id: true,
                  userId: true,
                  createdAt: true,
                },
              };
            }
            if (options.includeRelations.receptionists) {
              include['receptionists'] = {
                select: {
                  id: true,
                  userId: true,
                  clinicId: true,
                  createdAt: true,
                },
              };
            }
            if (options.includeRelations.clinicAdmins) {
              include['clinicAdmins'] = {
                select: {
                  id: true,
                  userId: true,
                  clinicId: true,
                  isOwner: true,
                  createdAt: true,
                },
              };
            }
            if (options.includeRelations.superAdmin) {
              include['superAdmin'] = {
                select: {
                  id: true,
                  userId: true,
                  createdAt: true,
                },
              };
            }
          }

          // Build optimized query using query utils
          // Following .ai-rules: Use select to limit fields for 10M user scale
          const queryArgs = {
            where: optimizedWhere,
            take, // CRITICAL: Limit result size
            skip, // CRITICAL: Support pagination
            ...(Object.keys(include).length > 0 ? { include } : {}),
            orderBy: orderBy || { createdAt: 'desc' }, // Use optimized order by
          };

          // Optimize query before execution
          const queryString = JSON.stringify(queryArgs);
          await this.queryOptimizer.optimizeQuery(queryString, {
            queryType: 'HEALTHCARE_READ',
            tableName: 'users',
            executionTime: 0, // Will be measured during execution
          });

          const result = await userDelegate.findMany(queryArgs);
          return result;
        });
      },
      ['users'],
      1800 // 30 minutes for search results
    );
  }

  async createUserSafe(data: UserCreateInput): Promise<UserWithRelations> {
    // Use PrismaService directly outside transaction for now
    // The transaction is handled at a higher level if needed
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.createUserSafe(data);

    // Invalidate cache after creation
    if (result?.id) {
      await this.invalidateCache([
        `user:${result.id}`,
        `user:email:${result.email || ''}`,
        'users',
      ]);
    }

    return result;
  }

  async updateUserSafe(id: string, data: UserUpdateInput): Promise<UserWithRelations> {
    // Call prismaService.updateUserSafe directly (not wrapped in executeHealthcareWrite)
    // to avoid transaction client issues similar to createUserSafe
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.updateUserSafe(id, data);

    // Invalidate cache after update
    await this.invalidateCache([`user:${id}`, 'users']);

    return result;
  }

  async deleteUserSafe(id: string): Promise<UserWithRelations> {
    const result = await this.executeHealthcareWrite<UserWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.deleteUserSafe(id);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'DELETE_USER',
        resourceType: 'USER',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    // Invalidate cache after deletion
    await this.invalidateCache([`user:${id}`, 'users']);

    return result;
  }

  async findAppointmentByIdSafe(id: string): Promise<AppointmentWithRelations | null> {
    const cacheKey = `appointment:findById:${id}`;
    return await this.executeCachedRead(
      cacheKey,
      async () => {
        return await this.executeHealthcareRead<AppointmentWithRelations | null>(async _client => {
          const prismaService = this.getInternalPrismaClient();
          const result = await prismaService.findAppointmentByIdSafe(id);
          return result;
        });
      },
      [`appointment:${id}`, 'appointments'],
      1800 // 30 minutes (appointments change more frequently)
    );
  }

  /**
   * Find appointments with pagination and optimization for 10M+ user scale
   * Uses query utils for optimized pagination and filtering
   * @param where - Appointment where conditions
   * @param options - Pagination and query options
   */
  async findAppointmentsSafe(
    where: AppointmentWhereInput,
    options?: {
      page?: number; // Page number (1-based)
      limit?: number; // Max records per page (default: 100, max: 1000)
      take?: number; // Alternative to limit
      skip?: number; // Offset for pagination
      sortBy?: string; // Field to sort by (default: 'appointmentDateTime')
      sortOrder?: 'asc' | 'desc'; // Sort order (default: 'desc')
      dateFrom?: Date | string; // Filter by appointment date range start
      dateTo?: Date | string; // Filter by appointment date range end
    }
  ): Promise<AppointmentWithRelations[]> {
    // Use query utils for optimized pagination calculation
    const pagination = calculatePagination({
      ...(options?.page !== undefined && { page: options.page }),
      ...(options?.limit !== undefined && { limit: options.limit }),
      ...(options?.take !== undefined && { take: options.take }),
      ...(options?.skip !== undefined && { skip: options.skip }),
    });

    // CRITICAL for 10M users: Enforce maximum limit of 1000 records per query
    const take = Math.min(pagination.take, 1000);
    const skip = pagination.skip;

    // Add date range filtering using query utils (for appointmentDateTime)
    // Manually add date range filter for appointmentDateTime field
    const optimizedWhere: AppointmentWhereInput = {
      ...where,
      ...(options?.dateFrom || options?.dateTo
        ? {
            appointmentDateTime: {
              ...(options?.dateFrom && {
                gte:
                  options.dateFrom instanceof Date ? options.dateFrom : new Date(options.dateFrom),
              }),
              ...(options?.dateTo && {
                lte: options.dateTo instanceof Date ? options.dateTo : new Date(options.dateTo),
              }),
            },
          }
        : {}),
    };

    // Build order by clause using query utils
    const orderBy = buildOrderBy(
      options?.sortBy || 'appointmentDateTime',
      options?.sortOrder || 'desc'
    );

    // Create cache key from optimized query parameters
    const whereHash = JSON.stringify({ where: optimizedWhere, take, skip, orderBy });
    const cacheKey = `appointment:findMany:${Buffer.from(whereHash).toString('base64').substring(0, 50)}`;

    return await this.executeCachedRead(
      cacheKey,
      async () => {
        return await this.executeHealthcareRead<AppointmentWithRelations[]>(async client => {
          const appointmentDelegate = (
            client as unknown as {
              appointment: { findMany: (args: unknown) => Promise<AppointmentWithRelations[]> };
            }
          )['appointment'];

          // Build optimized query using query utils
          const queryArgs = {
            where: optimizedWhere,
            take, // CRITICAL: Limit result size
            skip, // CRITICAL: Support pagination
            orderBy: orderBy || { appointmentDateTime: 'desc' }, // Use optimized order by
          };

          // Optimize query before execution
          const queryString = JSON.stringify(queryArgs);
          await this.queryOptimizer.optimizeQuery(queryString, {
            queryType: 'HEALTHCARE_READ',
            tableName: 'appointments',
            executionTime: 0, // Will be measured during execution
          });

          const result = await appointmentDelegate.findMany(queryArgs);
          return result;
        });
      },
      ['appointments'],
      300 // 5 minutes (appointments change frequently)
    );
  }

  async createAppointmentSafe(data: AppointmentCreateInput): Promise<AppointmentWithRelations> {
    const result = await this.executeHealthcareWrite<AppointmentWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.createAppointmentSafe(data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: data.clinicId || '',
        operation: 'CREATE_APPOINTMENT',
        resourceType: 'APPOINTMENT',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );

    // Invalidate cache after creation
    if (result?.id) {
      await this.invalidateCache([
        `appointment:${result.id}`,
        'appointments',
        ...(data.clinicId ? [`clinic:${data.clinicId}:appointments`] : []),
      ]);
    }

    return result;
  }

  async updateAppointmentSafe(
    id: string,
    data: AppointmentUpdateInput
  ): Promise<AppointmentWithRelations> {
    const result = await this.executeHealthcareWrite<AppointmentWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.updateAppointmentSafe(id, data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: (data as { clinicId?: string }).clinicId || '',
        operation: 'UPDATE_APPOINTMENT',
        resourceType: 'APPOINTMENT',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    // Invalidate cache after update
    const clinicId = (data as { clinicId?: string }).clinicId;
    await this.invalidateCache([
      `appointment:${id}`,
      'appointments',
      ...(clinicId ? [`clinic:${clinicId}:appointments`] : []),
    ]);

    return result;
  }

  async deleteAppointmentSafe(id: string): Promise<AppointmentWithRelations> {
    const result = await this.executeHealthcareWrite<AppointmentWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.deleteAppointmentSafe(id);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'DELETE_APPOINTMENT',
        resourceType: 'APPOINTMENT',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    // Invalidate cache after deletion
    await this.invalidateCache([`appointment:${id}`, 'appointments']);

    return result;
  }

  async findAppointmentTimeSlotsSafe(
    doctorId: string,
    clinicId: string,
    date: Date
  ): Promise<AppointmentTimeSlot[]> {
    return await this.executeHealthcareRead<AppointmentTimeSlot[]>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findAppointmentTimeSlotsSafe(doctorId, clinicId, date);
      return result;
    });
  }

  async countUsersSafe(where: UserWhereInput): Promise<number> {
    return await this.executeHealthcareRead<number>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.countUsersSafe(where);
      return result;
    });
  }

  async countAppointmentsSafe(where: AppointmentWhereInput): Promise<number> {
    return await this.executeHealthcareRead<number>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.countAppointmentsSafe(where);
      return result;
    });
  }

  // Billing-related type-safe methods - all use optimization layers
  async findBillingPlanByIdSafe(id: string): Promise<BillingPlanWithRelations | null> {
    return await this.executeHealthcareRead<BillingPlanWithRelations | null>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findBillingPlanByIdSafe(id);
      return result;
    });
  }

  async findBillingPlansSafe(where: BillingPlanWhereInput): Promise<BillingPlanWithRelations[]> {
    return await this.executeHealthcareRead<BillingPlanWithRelations[]>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findBillingPlansSafe(where);
      return result;
    });
  }

  async createBillingPlanSafe(data: BillingPlanCreateInput): Promise<BillingPlanWithRelations> {
    return await this.executeHealthcareWrite<BillingPlanWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.createBillingPlanSafe(data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'CREATE_BILLING_PLAN',
        resourceType: 'BILLING_PLAN',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );
  }

  async updateBillingPlanSafe(
    id: string,
    data: BillingPlanUpdateInput
  ): Promise<BillingPlanWithRelations> {
    return await this.executeHealthcareWrite<BillingPlanWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.updateBillingPlanSafe(id, data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_BILLING_PLAN',
        resourceType: 'BILLING_PLAN',
        resourceId: id,
        timestamp: new Date(),
      }
    );
  }

  async findSubscriptionByIdSafe(id: string): Promise<SubscriptionWithRelations | null> {
    return await this.executeHealthcareRead<SubscriptionWithRelations | null>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findSubscriptionByIdSafe(id);
      return result;
    });
  }

  async findSubscriptionsSafe(where: SubscriptionWhereInput): Promise<SubscriptionWithRelations[]> {
    return await this.executeHealthcareRead<SubscriptionWithRelations[]>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findSubscriptionsSafe(where);
      return result;
    });
  }

  async createSubscriptionSafe(data: SubscriptionCreateInput): Promise<SubscriptionWithRelations> {
    return await this.executeHealthcareWrite<SubscriptionWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.createSubscriptionSafe(data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'CREATE_SUBSCRIPTION',
        resourceType: 'SUBSCRIPTION',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );
  }

  async updateSubscriptionSafe(
    id: string,
    data: SubscriptionUpdateInput
  ): Promise<SubscriptionWithRelations> {
    return await this.executeHealthcareWrite<SubscriptionWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.updateSubscriptionSafe(id, data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_SUBSCRIPTION',
        resourceType: 'SUBSCRIPTION',
        resourceId: id,
        timestamp: new Date(),
      }
    );
  }

  async findInvoiceByIdSafe(id: string): Promise<InvoiceWithRelations | null> {
    return await this.executeHealthcareRead<InvoiceWithRelations | null>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findInvoiceByIdSafe(id);
      return result;
    });
  }

  async findInvoicesSafe(where: InvoiceWhereInput): Promise<InvoiceWithRelations[]> {
    return await this.executeHealthcareRead<InvoiceWithRelations[]>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findInvoicesSafe(where);
      return result;
    });
  }

  async createInvoiceSafe(data: InvoiceCreateInput): Promise<InvoiceWithRelations> {
    return await this.executeHealthcareWrite<InvoiceWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.createInvoiceSafe(data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'CREATE_INVOICE',
        resourceType: 'INVOICE',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );
  }

  async updateInvoiceSafe(id: string, data: InvoiceUpdateInput): Promise<InvoiceWithRelations> {
    return await this.executeHealthcareWrite<InvoiceWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.updateInvoiceSafe(id, data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_INVOICE',
        resourceType: 'INVOICE',
        resourceId: id,
        timestamp: new Date(),
      }
    );
  }

  async findPaymentByIdSafe(id: string): Promise<PaymentWithRelations | null> {
    return await this.executeHealthcareRead<PaymentWithRelations | null>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findPaymentByIdSafe(id);
      return result;
    });
  }

  async findPaymentsSafe(where: PaymentWhereInput): Promise<PaymentWithRelations[]> {
    return await this.executeHealthcareRead<PaymentWithRelations[]>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findPaymentsSafe(where);
      return result;
    });
  }

  async createPaymentSafe(data: PaymentCreateInput): Promise<PaymentWithRelations> {
    return await this.executeHealthcareWrite<PaymentWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.createPaymentSafe(data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'CREATE_PAYMENT',
        resourceType: 'PAYMENT',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );
  }

  async updatePaymentSafe(id: string, data: PaymentUpdateInput): Promise<PaymentWithRelations> {
    return await this.executeHealthcareWrite<PaymentWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.updatePaymentSafe(id, data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_PAYMENT',
        resourceType: 'PAYMENT',
        resourceId: id,
        timestamp: new Date(),
      }
    );
  }

  // Delete methods - all use optimization layers
  async deleteBillingPlanSafe(id: string): Promise<BillingPlanWithRelations> {
    return await this.executeHealthcareWrite<BillingPlanWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.deleteBillingPlanSafe(id);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'DELETE_BILLING_PLAN',
        resourceType: 'BILLING_PLAN',
        resourceId: id,
        timestamp: new Date(),
      }
    );
  }

  async deleteSubscriptionSafe(id: string): Promise<SubscriptionWithRelations> {
    return await this.executeHealthcareWrite<SubscriptionWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.deleteSubscriptionSafe(id);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'DELETE_SUBSCRIPTION',
        resourceType: 'SUBSCRIPTION',
        resourceId: id,
        timestamp: new Date(),
      }
    );
  }

  async deleteInvoiceSafe(id: string): Promise<InvoiceWithRelations> {
    return await this.executeHealthcareWrite<InvoiceWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.deleteInvoiceSafe(id);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'DELETE_INVOICE',
        resourceType: 'INVOICE',
        resourceId: id,
        timestamp: new Date(),
      }
    );
  }

  async deletePaymentSafe(id: string): Promise<PaymentWithRelations> {
    return await this.executeHealthcareWrite<PaymentWithRelations>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.deletePaymentSafe(id);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'DELETE_PAYMENT',
        resourceType: 'PAYMENT',
        resourceId: id,
        timestamp: new Date(),
      }
    );
  }

  // RBAC - Permission Safe Methods
  async createPermissionSafe(data: {
    name: string;
    resource: string;
    action: string;
    description?: string | null;
    domain?: string;
    isSystemPermission?: boolean;
    isActive?: boolean;
  }): Promise<PermissionEntity> {
    return await this.executeHealthcareWrite<PermissionEntity>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.createPermissionSafe(data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'CREATE_PERMISSION',
        resourceType: 'PERMISSION',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );
  }

  async findPermissionByIdSafe(id: string): Promise<PermissionEntity | null> {
    return await this.executeHealthcareRead<PermissionEntity | null>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findPermissionByIdSafe(id);
      return result;
    });
  }

  async findPermissionByResourceActionSafe(
    resource: string,
    action: string,
    domain?: string
  ): Promise<PermissionEntity | null> {
    return await this.executeHealthcareRead<PermissionEntity | null>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findPermissionByResourceActionSafe(
        resource,
        action,
        domain
      );
      return result;
    });
  }

  async findPermissionsByResourceSafe(
    resource: string,
    domain?: string
  ): Promise<PermissionEntity[]> {
    return await this.executeHealthcareRead<PermissionEntity[]>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findPermissionsByResourceSafe(resource, domain);
      return result;
    });
  }

  async updatePermissionSafe(
    id: string,
    data: Partial<{ name?: string; description?: string | null; isActive?: boolean }> & {
      updatedAt: Date;
    }
  ): Promise<PermissionEntity> {
    return await this.executeHealthcareWrite<PermissionEntity>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.updatePermissionSafe(id, data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_PERMISSION',
        resourceType: 'PERMISSION',
        resourceId: id,
        timestamp: new Date(),
      }
    );
  }

  async countRolePermissionsSafe(permissionId: string): Promise<number> {
    return await this.executeHealthcareRead<number>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.countRolePermissionsSafe(permissionId);
      return result;
    });
  }

  async findSystemPermissionsSafe(): Promise<PermissionEntity[]> {
    return await this.executeHealthcareRead<PermissionEntity[]>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findSystemPermissionsSafe();
      return result;
    });
  }

  // RBAC - Role Safe Methods
  async findRoleByIdSafe(id: string): Promise<RbacRoleEntity | null> {
    return await this.executeHealthcareRead<RbacRoleEntity | null>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findRoleByIdSafe(id);
      return result;
    });
  }

  async findRoleByNameSafe(
    name: string,
    domain?: string,
    clinicId?: string
  ): Promise<RbacRoleEntity | null> {
    return await this.executeHealthcareRead<RbacRoleEntity | null>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findRoleByNameSafe(name, domain, clinicId);
      return result;
    });
  }

  async createRoleSafe(data: {
    name: string;
    displayName: string;
    description?: string | null;
    domain: string;
    clinicId?: string | null;
    isSystemRole?: boolean;
    isActive?: boolean;
  }): Promise<RbacRoleEntity> {
    return await this.executeHealthcareWrite<RbacRoleEntity>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.createRoleSafe(data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: data.clinicId ?? '',
        operation: 'CREATE_ROLE',
        resourceType: 'ROLE',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );
  }

  async findRolesByDomainSafe(domain?: string, clinicId?: string): Promise<RbacRoleEntity[]> {
    return await this.executeHealthcareRead<RbacRoleEntity[]>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findRolesByDomainSafe(domain, clinicId);
      return result;
    });
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
    return await this.executeHealthcareWrite<RbacRoleEntity>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.updateRoleSafe(id, data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_ROLE',
        resourceType: 'ROLE',
        resourceId: id,
        timestamp: new Date(),
      }
    );
  }

  async countUserRolesSafe(roleId: string): Promise<number> {
    return await this.executeHealthcareRead<number>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.countUserRolesSafe(roleId);
      return result;
    });
  }

  async deleteRolePermissionsSafe(roleId: string): Promise<{ count: number }> {
    return await this.executeHealthcareWrite<{ count: number }>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.deleteRolePermissionsSafe(roleId);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'DELETE_ROLE_PERMISSIONS',
        resourceType: 'ROLE_PERMISSION',
        resourceId: roleId,
        timestamp: new Date(),
      }
    );
  }

  async createRolePermissionsSafe(
    permissions: Array<{ roleId: string; permissionId: string }>
  ): Promise<{ count: number }> {
    return await this.executeHealthcareWrite<{ count: number }>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.createRolePermissionsSafe(permissions);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'CREATE_ROLE_PERMISSIONS',
        resourceType: 'ROLE_PERMISSION',
        resourceId: permissions[0]?.roleId ?? 'unknown',
        timestamp: new Date(),
      }
    );
  }

  async removeRolePermissionsSafe(
    roleId: string,
    permissionIds: string[]
  ): Promise<{ count: number }> {
    return await this.executeHealthcareWrite<{ count: number }>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.removeRolePermissionsSafe(roleId, permissionIds);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'REMOVE_ROLE_PERMISSIONS',
        resourceType: 'ROLE_PERMISSION',
        resourceId: roleId,
        timestamp: new Date(),
      }
    );
  }

  async createSystemRoleSafe(data: {
    name: string;
    displayName: string;
    description?: string | null;
    domain: string;
    clinicId?: string | null;
    isSystemRole?: boolean;
    isActive?: boolean;
  }): Promise<RbacRoleEntity> {
    return await this.executeHealthcareWrite<RbacRoleEntity>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.createSystemRoleSafe(data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: data.clinicId ?? '',
        operation: 'CREATE_SYSTEM_ROLE',
        resourceType: 'ROLE',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );
  }

  // RBAC - User Role Safe Methods
  async findUserRoleAssignmentSafe(
    userId: string,
    roleId: string,
    clinicId?: string
  ): Promise<UserRoleEntity | null> {
    return await this.executeHealthcareRead<UserRoleEntity | null>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findUserRoleAssignmentSafe(userId, roleId, clinicId);
      return result;
    });
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
    return await this.executeHealthcareWrite<UserRoleEntity>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.createUserRoleSafe(data);
        return result;
      },
      {
        userId: data.assignedBy ?? 'system',
        userRole: 'system',
        clinicId: data.clinicId ?? '',
        operation: 'CREATE_USER_ROLE',
        resourceType: 'USER_ROLE',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );
  }

  async findUserRoleForRevocationSafe(
    userId: string,
    roleId: string,
    clinicId?: string
  ): Promise<UserRoleEntity | null> {
    return await this.executeHealthcareRead<UserRoleEntity | null>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findUserRoleForRevocationSafe(userId, roleId, clinicId);
      return result;
    });
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
    return await this.executeHealthcareWrite<UserRoleEntity>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.updateUserRoleSafe(id, data);
        return result;
      },
      {
        userId: data.revokedBy ?? 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_USER_ROLE',
        resourceType: 'USER_ROLE',
        resourceId: id,
        timestamp: new Date(),
      }
    );
  }

  async findUserRolesSafe(userId: string, clinicId?: string): Promise<UserRoleEntity[]> {
    return await this.executeHealthcareRead<UserRoleEntity[]>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findUserRolesSafe(userId, clinicId);
      return result;
    });
  }

  async findRolePermissionsSafe(
    roleIds: string[]
  ): Promise<Array<RolePermissionEntity & { permission: { resource: string; action: string } }>> {
    return await this.executeHealthcareRead<
      Array<RolePermissionEntity & { permission: { resource: string; action: string } }>
    >(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findRolePermissionsSafe(roleIds);
      return result;
    });
  }

  // Clinic methods - all use optimization layers
  async findClinicByIdSafe(id: string): Promise<{
    name: string;
    address?: string;
    phone?: string;
    email?: string;
  } | null> {
    return await this.executeHealthcareRead<{
      name: string;
      address?: string;
      phone?: string;
      email?: string;
    } | null>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findClinicByIdSafe(id);
      return result;
    });
  }

  async deleteClinicSafe(id: string): Promise<{ id: string; name: string }> {
    return await this.executeHealthcareWrite<{ id: string; name: string }>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.deleteClinicSafe(id);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'DELETE_CLINIC',
        resourceType: 'CLINIC',
        resourceId: id,
        timestamp: new Date(),
      }
    );
  }

  // Clinic Admin methods - all use optimization layers
  async createClinicAdminSafe(data: {
    userId: string;
    clinicId: string;
  }): Promise<{ id: string; userId: string; clinicId: string }> {
    return await this.executeHealthcareWrite<{ id: string; userId: string; clinicId: string }>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.createClinicAdminSafe(data);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: data.clinicId,
        operation: 'CREATE_CLINIC_ADMIN',
        resourceType: 'CLINIC_ADMIN',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );
  }

  async findClinicAdminByIdSafe(id: string): Promise<{
    id: string;
    userId: string;
    clinicId: string;
    user?: { id: string; email: string; name: string; role: string };
  } | null> {
    return await this.executeHealthcareRead<{
      id: string;
      userId: string;
      clinicId: string;
      user?: { id: string; email: string; name: string; role: string };
    } | null>(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findClinicAdminByIdSafe(id);
      return result;
    });
  }

  async findClinicAdminsSafe(where: { clinicId?: string; userId?: string }): Promise<
    Array<{
      id: string;
      userId: string;
      clinicId: string;
      user?: { id: string; email: string; name: string; role: string } | undefined;
    }>
  > {
    return await this.executeHealthcareRead<
      Array<{
        id: string;
        userId: string;
        clinicId: string;
        user?: { id: string; email: string; name: string; role: string } | undefined;
      }>
    >(async _client => {
      const prismaService = this.getInternalPrismaClient();
      const result = await prismaService.findClinicAdminsSafe(where);
      return result;
    });
  }

  async deleteClinicAdminSafe(
    id: string
  ): Promise<{ id: string; userId: string; clinicId: string }> {
    return await this.executeHealthcareWrite<{ id: string; userId: string; clinicId: string }>(
      async _client => {
        const prismaService = this.getInternalPrismaClient();
        const result = await prismaService.deleteClinicAdminSafe(id);
        return result;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'DELETE_CLINIC_ADMIN',
        resourceType: 'CLINIC_ADMIN',
        resourceId: id,
        timestamp: new Date(),
      }
    );
  }

  /**
   * Execute a raw query with metrics and error handling
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
      this.handleDatabaseError(dbError, 'executeRawQuery', {
        query: query.substring(0, 100),
        executionTime,
      });

      throw dbError;
    }
  }

  /**
   * Execute operation within a transaction
   */
  async executeInTransaction<T>(
    operation: (client: PrismaTransactionClient) => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();

    try {
      // Use PrismaService's transaction method directly
      const transactionMethod = this.prismaService.$transaction as unknown as <T>(
        fn: (tx: PrismaTransactionClient) => Promise<T>,
        options?: { maxWait?: number; timeout?: number }
      ) => Promise<T>;
      const result = await transactionMethod(
        async (tx: PrismaTransactionClient) => {
          return operation(tx);
        },
        {
          maxWait: this.config.connectionTimeout || 10000,
          timeout: this.config.queryTimeout || 60000,
        }
      );

      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('TRANSACTION', executionTime, true);

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('TRANSACTION', executionTime, false);

      const dbError = error instanceof Error ? error : new Error(String(error));
      this.handleDatabaseError(dbError, 'executeInTransaction', {
        executionTime,
      });

      throw dbError;
    }
  }

  /**
   * Execute healthcare-specific read operations with HIPAA compliance
   * Uses read replica routing when available for optimal read performance
   */
  async executeHealthcareRead<T>(
    operation: (client: PrismaTransactionClient) => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    const queryTimeout = this.config.queryTimeout || 30000; // Default 30 seconds if not configured

    try {
      // Execute the operation with the Prisma client through internal accessor
      // Note: Read replica routing is handled at the Prisma client level if configured
      // Get PrismaService which has all delegates initialized as readonly properties
      const prismaService = this.getInternalPrismaClient();

      // Ensure prismaClient is initialized (this also ensures delegates are initialized)
      // PrismaService initializes delegates in constructor, but we need to ensure
      // the underlying prismaClient exists and is properly initialized
      let rawClient: PrismaClient;
      try {
        rawClient = prismaService.getRawPrismaClient();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new HealthcareError(
          ErrorCode.DATABASE_CONNECTION_FAILED,
          `PrismaClient initialization failed: ${errorMessage}. Please ensure "prisma generate" has been run and the database is accessible.`,
          undefined,
          { originalError: errorMessage },
          'HealthcareDatabaseClient.executeHealthcareRead'
        );
      }

      if (!rawClient) {
        throw new HealthcareError(
          ErrorCode.DATABASE_CONNECTION_FAILED,
          'PrismaClient is not initialized. Please ensure "prisma generate" has been run.',
          undefined,
          {},
          'HealthcareDatabaseClient.executeHealthcareRead'
        );
      }

      // PrismaService has delegates (user, clinic, appointment, etc.) as readonly properties
      // However, operations expect PrismaTransactionClient which has delegates directly on the client
      // Use the raw PrismaClient which has all delegates accessible
      // The rawClient has delegates like client.user, client.clinic, etc. directly accessible
      // Add timeout wrapper to prevent queries from running indefinitely
      // Promise.race will reject with timeout error if operation takes longer than queryTimeout
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new HealthcareError(
              ErrorCode.DATABASE_QUERY_TIMEOUT as ErrorCode,
              `Query timeout after ${queryTimeout}ms - query exceeded maximum execution time`,
              undefined,
              { queryTimeout, executionTime: Date.now() - startTime },
              'HealthcareDatabaseClient.executeHealthcareRead'
            )
          );
        }, queryTimeout);
      });

      let data: T;
      try {
        data = await Promise.race([
          operation(rawClient as unknown as PrismaTransactionClient),
          timeoutPromise,
        ]);
        // Clear timeout if operation completes before timeout
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        // Clear timeout on error
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        throw error;
      }

      const executionTime = Date.now() - startTime;

      // Record metrics for performance monitoring
      this.metricsService.recordQueryExecution('HEALTHCARE_READ', executionTime, true);

      // Optimize query and get recommendations if query is slow
      // CRITICAL for 10M users: Rate limit slow query warnings to prevent log spam
      if (executionTime > 1000) {
        this.slowQueryCount++;
        const now = Date.now();
        // Initialize lastSlowQueryWarning if it's 0 (first time)
        if (this.lastSlowQueryWarning === 0) {
          this.lastSlowQueryWarning = now;
        }
        const timeSinceLastWarning = now - this.lastSlowQueryWarning;

        // Only log slow query warning once per minute to prevent infinite logs
        if (timeSinceLastWarning >= this.SLOW_QUERY_WARNING_INTERVAL) {
          // Optimize query and get recommendations (silently, no logging)
          void this.queryOptimizer
            .optimizeQuery('read_operation', {
              executionTime,
              queryType: 'HEALTHCARE_READ',
              slow: true,
            })
            .catch(() => {
              // Query optimization failed - non-critical, don't log
            });
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Slow read query detected: ${executionTime}ms - consider optimization (${this.slowQueryCount} slow queries in last ${Math.round(timeSinceLastWarning / 1000)}s)`,
            'HealthcareDatabaseClient',
            { executionTime, slowQueryCount: this.slowQueryCount, timeSinceLastWarning }
          );
          this.lastSlowQueryWarning = now;
          this.slowQueryCount = 0; // Reset counter after logging
        }
      }

      // Log for HIPAA compliance if PHI data is involved
      // CRITICAL for 10M users: HIPAA logging is rate-limited to prevent log spam
      // Only log HIPAA access for non-routine operations (slow queries, errors, etc.)
      if (this.config.enablePHIProtection && executionTime > 1000) {
        // Rate limit HIPAA logs to prevent infinite log spam
        this.hipaaLogCount++;
        const now = Date.now();
        // Initialize lastHipaaLogWarning if it's 0 (first time)
        if (this.lastHipaaLogWarning === 0) {
          this.lastHipaaLogWarning = now;
        }
        const timeSinceLastHipaaLog = now - this.lastHipaaLogWarning;

        // Only log HIPAA access once per minute to reduce log volume by 99%+
        if (timeSinceLastHipaaLog >= this.HIPAA_LOG_INTERVAL) {
          this.logDataAccess(
            'READ',
            'HEALTHCARE_DATA',
            executionTime,
            undefined,
            this.hipaaLogCount
          );
          this.lastHipaaLogWarning = now;
          this.hipaaLogCount = 0; // Reset counter after logging
        }
      }

      return data;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('HEALTHCARE_READ', executionTime, false);

      const dbError = error instanceof Error ? error : new Error(String(error));
      const errorMessage = dbError.message || String(error);
      const errorStack = dbError.stack || 'No stack trace available';

      // Enhanced error logging with full details
      // CRITICAL: Don't log timeout errors to database (they're too noisy and cause loops)
      // Only log to console/Redis to avoid recursive database queries
      const isTimeoutError =
        dbError.name === 'HealthcareError' &&
        (errorMessage.includes('timeout') ||
          errorMessage.includes('TIMEOUT') ||
          errorMessage.includes('Query timeout'));

      if (!isTimeoutError) {
        // Only log non-timeout errors to database to prevent loops
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.ERROR,
          `Healthcare read operation failed: ${errorMessage}`,
          'HealthcareDatabaseClient.executeHealthcareRead',
          {
            error: errorMessage,
            errorStack,
            errorName: dbError.name,
            executionTime,
            errorType: typeof error,
          }
        );
      } else {
        // For timeout errors, only log to console (no database logging to prevent loops)
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Query timeout after ${executionTime}ms - skipping database audit log to prevent loops`,
          'HealthcareDatabaseClient.executeHealthcareRead',
          {
            error: errorMessage,
            executionTime,
            skippedDatabaseLog: true,
          }
        );
      }

      this.handleDatabaseError(dbError, 'executeHealthcareRead', {
        executionTime,
        errorMessage,
      });

      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        `Healthcare read operation failed: ${errorMessage}`,
        undefined,
        { executionTime, originalError: errorMessage, errorStack },
        'HealthcareDatabaseClient.executeHealthcareRead'
      );
    }
  }

  /**
   * Execute healthcare-specific write operations with audit trails
   */
  async executeHealthcareWrite<T>(
    operation: (client: PrismaTransactionClient) => Promise<T>,
    auditInfo: AuditInfo
  ): Promise<T> {
    const startTime = Date.now();

    try {
      // Use prioritized write connection
      const _result = await this.connectionPoolManager.executeHealthcareWrite<T>(
        '', // Query will be executed through Prisma client
        [],
        { priority: 'high', timeout: 60000 }
      );

      // Execute within transaction for data consistency
      const data = await this.executeInTransaction(async client => {
        const operationResult = await operation(client);

        // Create audit trail entry
        if (this.config.enableAuditLogging) {
          await this.createAuditTrail(auditInfo, 'SUCCESS');
        }

        return operationResult;
      });

      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        'HEALTHCARE_WRITE',
        executionTime,
        true,
        auditInfo.clinicId,
        auditInfo.userId
      );

      // Optimize query and get recommendations if query is slow
      // CRITICAL for 10M users: Rate limit slow query warnings to prevent log spam
      if (executionTime > 1000) {
        this.slowWriteQueryCount++;
        const now = Date.now();
        const timeSinceLastWarning = now - this.lastSlowWriteWarning;

        // Only log slow write query warning once per minute to prevent infinite logs
        if (timeSinceLastWarning >= this.SLOW_QUERY_WARNING_INTERVAL) {
          const queryIdentifier = this.extractQueryIdentifier(operation);
          void this.queryOptimizer
            .optimizeQuery(queryIdentifier || 'write_operation', {
              executionTime,
              queryType: 'HEALTHCARE_WRITE',
              slow: true,
            })
            .catch(() => {
              // Query optimization logging failed - non-critical
            });
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Slow write query detected: ${executionTime}ms - consider optimization (${this.slowWriteQueryCount} slow queries in last ${Math.round(timeSinceLastWarning / 1000)}s)`,
            'HealthcareDatabaseClient',
            {
              executionTime,
              queryIdentifier,
              slowQueryCount: this.slowWriteQueryCount,
              timeSinceLastWarning,
            }
          );
          this.lastSlowWriteWarning = now;
          this.slowWriteQueryCount = 0; // Reset counter after logging
        }
      }

      // Log for HIPAA compliance
      this.logDataAccess('WRITE', auditInfo.resourceType, executionTime, auditInfo);

      return data;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        'HEALTHCARE_WRITE',
        executionTime,
        false,
        auditInfo.clinicId,
        auditInfo.userId
      );

      // Create audit trail for failed operation
      if (this.config.enableAuditLogging) {
        try {
          await this.createAuditTrail(auditInfo, 'FAILURE', (error as Error).message);
        } catch (auditError) {
          const auditErr = auditError instanceof Error ? auditError : new Error(String(auditError));
          this.handleDatabaseError(auditErr, 'createAuditTrail', { operation: 'FAILED_WRITE' });
        }
      }

      const dbError = error instanceof Error ? error : new Error(String(error));
      this.handleDatabaseError(dbError, 'executeHealthcareWrite', {
        executionTime,
        auditInfo: JSON.stringify(auditInfo),
      });

      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        `Healthcare write operation failed: ${(error as Error).message}`,
        undefined,
        { executionTime, auditInfo, originalError: (error as Error).message },
        'HealthcareDatabaseClient.executeHealthcareWrite'
      );
    }
  }

  /**
   * Execute critical healthcare operations (emergency scenarios)
   */
  async executeCriticalOperation<T>(
    operation: (client: PrismaTransactionClient) => Promise<T>,
    priority: CriticalPriority
  ): Promise<T> {
    const startTime = Date.now();

    try {
      // Use critical operation connection with highest priority
      const _result = await this.connectionPoolManager.executeCriticalQuery<T>(
        '', // Query will be executed through Prisma client
        [],
        {
          priority: 'high',
          timeout: priority === CriticalPriority.EMERGENCY ? 120000 : 60000,
          retries: priority === CriticalPriority.EMERGENCY ? 5 : 3,
        }
      );

      // Execute the critical operation through internal accessor
      const prismaClient = this.getInternalPrismaClient() as unknown as PrismaTransactionClient;
      const data = await operation(prismaClient);

      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('CRITICAL_OPERATION', executionTime, true);

      // Log critical operation for audit
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.WARN,
        `Critical healthcare operation completed: ${priority}`,
        'HealthcareDatabaseClient',
        {
          priority,
          executionTime,
          timestamp: new Date(),
        }
      );

      return data;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('CRITICAL_OPERATION', executionTime, false);

      const dbError = error instanceof Error ? error : new Error(String(error));
      this.handleDatabaseError(dbError, 'executeCriticalOperation', {
        priority,
        executionTime,
      });

      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        `Critical healthcare operation failed: ${(error as Error).message}`,
        undefined,
        {
          priority,
          executionTime,
          originalError: (error as Error).message,
          isRetryable: priority !== CriticalPriority.EMERGENCY,
        },
        'HealthcareDatabaseClient.executeCriticalOperation'
      );
    }
  }

  /**
   * Execute operation with clinic isolation context (multi-tenant)
   */
  async executeWithClinicContext<T>(
    clinicId: string,
    operation: (client: PrismaTransactionClient) => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await this.clinicIsolationService.executeWithClinicContext(
        clinicId,
        async () => {
          return this.executeHealthcareRead(operation);
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
          'HealthcareDatabaseClient.executeWithClinicContext'
        );
      }

      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Clinic operation completed for ${clinicId} in ${executionTime}ms`,
        'HealthcareDatabaseClient',
        { clinicId, executionTime }
      );

      return result.data!;
    } catch (error) {
      const executionTime = Date.now() - startTime;

      const dbError = error instanceof Error ? error : new Error(String(error));
      this.handleDatabaseError(dbError, 'executeWithClinicContext', {
        clinicId,
        executionTime,
      });

      throw dbError;
    }
  }

  /**
   * Get connection health status
   * Optimized for fast health checks - bypasses HIPAA logging and slow query detection
   */
  async getHealthStatus(): Promise<DatabaseHealthStatus> {
    try {
      const connectionMetrics = this.connectionPoolManager.getMetrics();
      const start = Date.now();

      // Use dedicated health check client to avoid interfering with regular operations
      // This bypasses executeHealthcareRead to avoid HIPAA logging and slow query detection overhead
      const healthCheckClient = PrismaService.getHealthCheckClient();
      const typedClient = healthCheckClient as unknown as {
        $queryRaw: (query: TemplateStringsArray) => Promise<unknown>;
      };

      // Simple SELECT 1 query - fastest possible health check
      await typedClient.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - start;

      // Trigger auto-scaling check as part of health check (non-blocking with timeout)
      // Use a very short timeout to prevent health checks from being delayed
      void Promise.race([
        this.triggerAutoScaling(),
        new Promise<void>(resolve => setTimeout(() => resolve(), 500)), // 500ms timeout
      ]).catch(() => {
        // Auto-scaling failure shouldn't fail health check
      });

      return {
        isHealthy: connectionMetrics.isHealthy && responseTime < 5000,
        connectionCount: connectionMetrics.totalConnections,
        activeQueries: connectionMetrics.activeConnections,
        avgResponseTime: responseTime,
        lastHealthCheck: new Date(),
        errors: connectionMetrics.isHealthy ? [] : ['Connection pool unhealthy'],
      };
    } catch (error) {
      return {
        isHealthy: false,
        connectionCount: 0,
        activeQueries: 0,
        avgResponseTime: -1,
        lastHealthCheck: new Date(),
        errors: [(error as Error).message],
      };
    }
  }

  /**
   * Get client metrics
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
   * Get HIPAA compliance metrics
   */
  async getHIPAAMetrics(): Promise<HIPAAComplianceMetrics> {
    const currentMetrics = this.metricsService.getCurrentMetrics();
    const auditedOperations = this.auditLog.length;
    const encryptedDataAccess = this.auditLog.filter(
      log => log.operation.includes('READ') || log.operation.includes('WRITE')
    ).length;

    return Promise.resolve({
      auditedOperations,
      encryptedDataAccess,
      unauthorizedAttempts: currentMetrics.healthcare.unauthorizedAccessAttempts,
      dataRetentionCompliance: this.checkDataRetentionCompliance(),
      lastComplianceCheck: new Date(),
    });
  }

  /**
   * Get clinic-specific metrics
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

    const staffCount = await this.getStaffCount(clinicId);
    const locationCount = await this.getLocationCount(clinicId);

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
   */
  async getClinicDashboardStats(clinicId: string): Promise<ClinicDashboardStats> {
    const result = await this.executeWithResult(
      async () => {
        return this.executeWithClinicContext(clinicId, async client => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);

          type PatientDelegate = { count: <T>(args: T) => Promise<number> };
          type AppointmentDelegate = {
            count: <T>(args: T) => Promise<number>;
            findMany: <T>(args: T) => Promise<ClinicRecentActivity[]>;
          };
          type DoctorClinicDelegate = { count: <T>(args: T) => Promise<number> };
          type ClinicLocationDelegate = { count: <T>(args: T) => Promise<number> };

          const results = await Promise.all([
            // Total patients (through appointments)
            (client as unknown as { patient: PatientDelegate }).patient.count({
              where: {
                appointments: {
                  some: { clinicId },
                },
              },
            } as Record<string, unknown>),

            // Total appointments
            (async () => {
              const appointmentDelegate = (
                client as unknown as {
                  appointment: AppointmentDelegate;
                }
              ).appointment;
              return await appointmentDelegate.count({
                where: { clinicId },
              } as Record<string, unknown>);
            })(),

            // Today's appointments
            (async () => {
              const appointmentDelegate = (
                client as unknown as {
                  appointment: AppointmentDelegate;
                }
              ).appointment;
              return await appointmentDelegate.count({
                where: {
                  clinicId,
                  date: {
                    gte: today,
                    lt: tomorrow,
                  },
                },
              } as Record<string, unknown>);
            })(),

            // Upcoming appointments (next 7 days)
            (async () => {
              const appointmentDelegate = (
                client as unknown as {
                  appointment: AppointmentDelegate;
                }
              ).appointment;
              return await appointmentDelegate.count({
                where: {
                  clinicId,
                  date: {
                    gte: new Date(),
                    lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                  },
                  status: {
                    in: ['SCHEDULED', 'CONFIRMED'],
                  },
                },
              } as Record<string, unknown>);
            })(),

            // Total doctors
            (client as unknown as { doctorClinic: DoctorClinicDelegate }).doctorClinic.count({
              where: { clinicId },
            }),

            // Total locations
            (client as unknown as { clinicLocation: ClinicLocationDelegate }).clinicLocation.count({
              where: { clinicId },
            } as Record<string, unknown>),

            // Recent activity (last 10 appointments)
            (async () => {
              const appointmentDelegate = (
                client as unknown as {
                  appointment: AppointmentDelegate;
                }
              ).appointment;
              const appointmentsResult = (await appointmentDelegate.findMany({
                where: { clinicId },
                include: {
                  patient: {
                    include: {
                      user: {
                        select: {
                          name: true,
                          firstName: true,
                          lastName: true,
                        },
                      },
                    },
                  },
                },
                doctor: {
                  include: {
                    user: {
                      select: {
                        name: true,
                        firstName: true,
                        lastName: true,
                      },
                    },
                  },
                },
                orderBy: { updatedAt: 'desc' },
                take: 10,
              } as Record<string, unknown>)) as unknown;
              return appointmentsResult as ClinicRecentActivity[];
            })(),
          ]);

          const totalPatients: number = results[0];
          const totalAppointments: number = results[1];
          const todayAppointments: number = results[2];
          const upcomingAppointments: number = results[3];
          const totalDoctors: number = results[4];
          const totalLocations: number = results[5];
          const recentActivity: ClinicRecentActivity[] = results[6];

          return {
            totalPatients,
            totalAppointments,
            todayAppointments,
            upcomingAppointments,
            totalDoctors,
            totalLocations,
            recentActivity: recentActivity.map((activity: ClinicRecentActivity) => {
              return {
                patient: activity.patient,
                doctor: activity.doctor,
              };
            }),
          };
        });
      },
      'GET_CLINIC_DASHBOARD_STATS',
      clinicId
    );

    if (result.isFailure) {
      throw result.error || new Error('Operation failed');
    }

    return result.unwrap();
  }

  /**
   * Get clinic patients with pagination and filtering
   */
  async getClinicPatients(
    clinicId: string,
    options: ClinicPatientOptions = {}
  ): Promise<ClinicPatientResult> {
    const {
      page = 1,
      limit = 20,
      locationId,
      searchTerm,
      includeInactive: _includeInactive = false,
    } = options;

    const result = await this.executeWithResult(
      async () => {
        return this.executeWithClinicContext(clinicId, async _client => {
          const whereClause: Record<string, unknown> = {
            appointments: {
              some: {
                clinicId,
                ...(locationId ? { locationId } : {}),
              },
            },
          };

          // Add search filter
          if (searchTerm) {
            whereClause['user'] = {
              OR: [
                { name: { contains: searchTerm, mode: 'insensitive' } },
                { firstName: { contains: searchTerm, mode: 'insensitive' } },
                { lastName: { contains: searchTerm, mode: 'insensitive' } },
                { email: { contains: searchTerm, mode: 'insensitive' } },
                { phone: { contains: searchTerm, mode: 'insensitive' } },
              ],
            };
          }

          const skip = (page - 1) * limit;

          type PatientDelegate = {
            findMany: <T>(args: T) => Promise<PatientWithUser[]>;
            count: <T>(args: T) => Promise<number>;
          };
          const patientDelegate = (_client as unknown as { patient: PatientDelegate }).patient;

          const results = await Promise.all([
            patientDelegate.findMany({
              where: whereClause,
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    phone: true,
                    dateOfBirth: true,
                    isVerified: true,
                  },
                },
                appointments: {
                  where: { clinicId },
                  orderBy: { date: 'desc' },
                  take: 3,
                  select: {
                    id: true,
                    date: true,
                    time: true,
                    status: true,
                    type: true,
                  },
                },
              },
              orderBy: { createdAt: 'desc' },
              skip,
              take: limit,
            }),
            patientDelegate.count({ where: whereClause }),
          ]);

          const patients: PatientWithUser[] = results[0];
          const total: number = results[1];
          const totalPages = Math.ceil(total / limit);

          return {
            patients: Array.isArray(patients) ? patients : [],
            total,
            page,
            totalPages,
          };
        });
      },
      'GET_CLINIC_PATIENTS',
      clinicId
    );

    if (result.isFailure) {
      throw result.error || new Error('Operation failed');
    }

    return result.unwrap();
  }

  /**
   * Get clinic appointments with advanced filtering
   */
  async getClinicAppointments(
    clinicId: string,
    options: ClinicAppointmentOptions = {}
  ): Promise<ClinicAppointmentResult> {
    const { page = 1, limit = 50, locationId, dateFrom, dateTo, status, doctorId } = options;

    const result = await this.executeWithResult(
      async () => {
        return this.executeWithClinicContext(clinicId, async _client => {
          const whereClause: {
            clinicId: string;
            locationId?: string;
            doctorId?: string;
            status?: string;
            date?: { gte?: Date; lte?: Date };
          } = {
            clinicId,
            ...(locationId ? { locationId } : {}),
            ...(doctorId ? { doctorId } : {}),
            ...(status ? { status } : {}),
            ...(dateFrom || dateTo
              ? {
                  date: {
                    ...(dateFrom ? { gte: dateFrom } : {}),
                    ...(dateTo ? { lte: dateTo } : {}),
                  },
                }
              : {}),
          };

          const skip = (page - 1) * limit;

          type AppointmentDelegate = {
            findMany: <T>(args: T) => Promise<ClinicAppointmentResult['appointments']>;
            count: <T>(args: T) => Promise<number>;
          };
          const appointmentDelegate = (_client as { appointment: AppointmentDelegate })[
            'appointment'
          ];

          const results = await Promise.all([
            appointmentDelegate.findMany({
              where: whereClause,
              include: {
                patient: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        firstName: true,
                        lastName: true,
                        phone: true,
                        email: true,
                      },
                    },
                  },
                },
                doctor: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        firstName: true,
                        lastName: true,
                      },
                    },
                  },
                },
                location: {
                  select: {
                    id: true,
                    name: true,
                    address: true,
                  },
                },
              },
              orderBy: { date: 'asc' },
              skip,
              take: limit,
            }),
            appointmentDelegate.count({ where: whereClause }),
          ]);

          const appointments: ClinicAppointmentResult['appointments'] = results[0];
          const total: number = results[1];
          const totalPages = Math.ceil(total / limit);

          return {
            appointments,
            total,
            page,
            totalPages,
          };
        });
      },
      'GET_CLINIC_APPOINTMENTS',
      clinicId
    );

    if (result.isFailure) {
      throw result.error || new Error('Operation failed');
    }

    return result.unwrap();
  }

  /**
   * Execute batch operations with optimized concurrency for 10M+ users
   * Uses ConnectionPoolManager's batch execution with intelligent concurrency control
   */
  async executeBatch<T, U>(
    items: T[],
    operation: (item: T, index: number, client: PrismaTransactionClient) => Promise<U>,
    options: {
      concurrency?: number;
      clinicId?: string;
      priority?: 'high' | 'normal' | 'low';
      auditInfo?: AuditInfo;
    } = {}
  ): Promise<U[]> {
    const startTime = Date.now();
    const concurrency = options.concurrency || 50; // Optimized for 10M+ users

    try {
      // Use ConnectionPoolManager's batch execution
      const results = await this.connectionPoolManager.executeBatch(
        items,
        async (item, index) => {
          return this.executeHealthcareRead(async _client => {
            return operation(item, index, _client);
          });
        },
        {
          concurrency,
          ...(options.clinicId && { clinicId: options.clinicId }),
          priority: options.priority || 'normal',
        }
      );

      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        'BATCH_OPERATION',
        executionTime,
        true,
        options.clinicId
      );

      if (options.auditInfo) {
        this.logDataAccess(
          'WRITE',
          options.auditInfo.resourceType,
          executionTime,
          options.auditInfo
        );
      }

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Batch operation completed: ${items.length} items in ${executionTime}ms`,
        'HealthcareDatabaseClient',
        { itemCount: items.length, executionTime, clinicId: options.clinicId }
      );

      return results;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        'BATCH_OPERATION',
        executionTime,
        false,
        options.clinicId
      );

      const dbError = error instanceof Error ? error : new Error(String(error));
      this.handleDatabaseError(dbError, 'executeBatch', {
        itemCount: items.length,
        executionTime,
        ...(options.clinicId && { clinicId: options.clinicId }),
      });

      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        `Batch operation failed: ${(error as Error).message}`,
        undefined,
        {
          itemCount: items.length,
          clinicId: options.clinicId,
          executionTime,
          originalError: (error as Error).message,
        },
        'HealthcareDatabaseClient.executeBatch'
      );
    }
  }

  /**
   * Execute query with read replica routing for optimal read performance
   * Routes read-only queries to read replicas when available
   */
  async executeWithReadReplica<T>(
    operation: (client: PrismaTransactionClient) => Promise<T>,
    clinicId?: string
  ): Promise<T> {
    const startTime = Date.now();

    try {
      // Route to read replica through ConnectionPoolManager
      await this.connectionPoolManager.executeQueryWithReadReplica<T>(
        '', // Query executed through Prisma
        [],
        {
          ...(clinicId && { clinicId }),
          priority: 'normal',
        }
      );

      // Execute the actual operation through healthcare read
      const data = await this.executeHealthcareRead(operation);

      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Read replica query completed in ${executionTime}ms`,
        'HealthcareDatabaseClient',
        { ...(clinicId && { clinicId }), executionTime }
      );

      return data;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const dbError = error instanceof Error ? error : new Error(String(error));
      this.handleDatabaseError(dbError, 'executeWithReadReplica', {
        executionTime,
        ...(clinicId && { clinicId }),
      });

      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        `Read replica operation failed: ${(error as Error).message}`,
        undefined,
        { executionTime, clinicId, originalError: (error as Error).message },
        'HealthcareDatabaseClient.executeWithReadReplica'
      );
    }
  }

  /**
   * Execute clinic-optimized query with enhanced performance for clinic-specific operations
   */
  async executeClinicOptimizedQuery<T>(
    clinicId: string,
    operation: (client: PrismaTransactionClient) => Promise<T>
  ): Promise<T> {
    return this.executeWithClinicContext(clinicId, async client => {
      // Use clinic-optimized query execution through ConnectionPoolManager
      await this.connectionPoolManager.executeClinicOptimizedQuery<T>(
        clinicId,
        '', // Query executed through Prisma
        [],
        { priority: 'high' as const }
      );
      return operation(client);
    });
  }

  /**
   * Trigger connection pool auto-scaling check
   * Auto-scaling adjusts connection pool size based on current load
   * Optimized to avoid blocking health checks - uses timeout to prevent delays
   */
  async triggerAutoScaling(): Promise<void> {
    try {
      // Use a timeout to prevent auto-scaling from blocking health checks
      const scalingPromise = this.connectionPoolManager.autoScaleConnectionPool();
      const timeoutPromise = new Promise<void>(resolve => {
        setTimeout(() => resolve(), 1000); // 1 second timeout
      });

      await Promise.race([scalingPromise, timeoutPromise]);
    } catch (error) {
      // Auto-scaling failures should not affect health checks
      // Silently handle errors to prevent health check delays
      const errorMessage = error instanceof Error ? error.message : String(error);
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Auto-scaling check completed (may have timed out): ${errorMessage}`,
        'HealthcareDatabaseClient'
      );
    }
  }

  /**
   * Get connection pool metrics for monitoring
   */
  getConnectionPoolMetrics() {
    return this.connectionPoolManager.getMetrics();
  }

  /**
   * Get detailed connection pool metrics with query performance
   */
  getDetailedConnectionMetrics() {
    return this.connectionPoolManager.getDetailedMetrics();
  }

  /**
   * Reset circuit breaker (useful for recovery after issues)
   */
  resetCircuitBreaker(): void {
    this.connectionPoolManager.resetCircuitBreaker();
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Circuit breaker reset',
      'HealthcareDatabaseClient'
    );
  }

  /**
   * Get current queue length (queries waiting for execution)
   */
  getQueueLength(): number {
    return this.connectionPoolManager.getQueueLength();
  }

  /**
   * Close database connections
   */
  async disconnect(): Promise<void> {
    try {
      await this.prismaService.$disconnect();
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        'Database client disconnected',
        'HealthcareDatabaseClient'
      );
    } catch (error) {
      const dbError = error instanceof Error ? error : new Error(String(error));
      this.handleDatabaseError(dbError, 'disconnect');
      throw dbError;
    }
  }

  // Private helper methods

  private async executeWithResult<T>(
    operation: () => Promise<T>,
    operationName: string,
    clinicId?: string,
    userId?: string
  ): Promise<RepositoryResult<T>> {
    const startTime = Date.now();

    try {
      const result = await operation();
      const executionTime = Date.now() - startTime;

      this.metricsService.recordQueryExecution(
        operationName,
        executionTime,
        true,
        clinicId,
        userId
      );

      return RepositoryResult.success(result, {
        executionTime,
        operation: operationName,
        ...(clinicId && { clinicId }),
        ...(userId && { userId }),
        timestamp: new Date(),
      });
    } catch (error) {
      const executionTime = Date.now() - startTime;

      this.metricsService.recordQueryExecution(
        operationName,
        executionTime,
        false,
        clinicId,
        userId
      );

      const dbError = error instanceof Error ? error : new Error(String(error));
      this.handleDatabaseError(dbError, operationName, {
        executionTime,
        ...(clinicId && { clinicId: String(clinicId) }),
        ...(userId && { userId: String(userId) }),
      });

      return RepositoryResult.failure(dbError, {
        executionTime,
        operation: operationName,
        ...(clinicId && { clinicId }),
        ...(userId && { userId }),
        timestamp: new Date(),
      });
    }
  }

  private async createAuditTrail(
    auditInfo: AuditInfo,
    status: 'SUCCESS' | 'FAILURE',
    errorMessage?: string
  ): Promise<void> {
    try {
      // Store audit info in memory (in production, this should go to a dedicated audit database)
      const auditEntry = {
        ...auditInfo,
        status,
        errorMessage,
        id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      };

      this.auditLog.push(auditEntry);

      // Maintain audit log size
      if (this.auditLog.length > this.maxAuditLogSize) {
        this.auditLog.shift();
      }

      return Promise.resolve();

      // In production, create database record:
      // await this.prismaService.auditLog.create({ data: auditEntry });
    } catch (error) {
      const auditErr = error instanceof Error ? error : new Error(String(error));
      this.handleDatabaseError(auditErr, 'createAuditTrail', {
        auditInfo: JSON.stringify(auditInfo),
      });
    }
  }

  private logDataAccess(
    operation: 'READ' | 'WRITE',
    resourceType: string,
    executionTime: number,
    auditInfo?: AuditInfo,
    accessCount?: number
  ): void {
    if (this.config.enablePHIProtection) {
      const message =
        accessCount && accessCount > 1
          ? `HIPAA Data Access: ${operation} ${resourceType} (${accessCount} accesses in last minute)`
          : `HIPAA Data Access: ${operation} ${resourceType}`;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        message,
        'HealthcareDatabaseClient',
        {
          operation,
          resourceType,
          executionTime,
          clinicId: auditInfo?.clinicId,
          userId: auditInfo?.userId,
          timestamp: new Date(),
          encrypted: true,
          ...(accessCount && accessCount > 1 && { accessCount }),
        }
      );
    }
  }

  /**
   * Extract query identifier from operation for optimization tracking
   * @internal
   */
  private extractQueryIdentifier<T>(
    operation: (client: PrismaTransactionClient) => Promise<T>
  ): string {
    try {
      // Try to extract operation name from function string representation
      const operationStr = operation.toString();
      // Match common Prisma patterns: client['user'].findUnique, client['appointment'].findMany, etc.
      const match = operationStr.match(/client\[['"](\w+)['"]\]\.(\w+)/);
      if (match) {
        return `${match[1]}.${match[2]}`;
      }
      return 'unknown_operation';
    } catch {
      return 'unknown_operation';
    }
  }

  private checkDataRetentionCompliance(): boolean {
    // Simplified compliance check - in production would check actual data retention policies
    const retentionDays = this.config.auditRetentionDays || 2555; // 7 years default
    const oldestAudit = this.auditLog[0];

    if (oldestAudit && oldestAudit.timestamp) {
      const daysSinceOldest =
        (Date.now() - oldestAudit.timestamp.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceOldest <= retentionDays;
    }

    return true;
  }

  private async getStaffCount(clinicId: string): Promise<number> {
    try {
      const result = await this.executeWithClinicContext(clinicId, async client => {
        const doctorClinicDelegate = client['doctorClinic'] as {
          count: (args: { where: Record<string, unknown> }) => Promise<number>;
        };
        const receptionistsDelegate = client['receptionistsAtClinic'] as {
          count: (args: { where: Record<string, unknown> }) => Promise<number>;
        };
        const clinicAdminDelegate = client['clinicAdmin'] as {
          count: (args: { where: Record<string, unknown> }) => Promise<number>;
        };

        const results = await Promise.all([
          doctorClinicDelegate.count({ where: { clinicId } }),
          receptionistsDelegate.count({ where: { clinicId } }),
          clinicAdminDelegate.count({ where: { clinicId } }),
        ]);

        const doctors = results[0];
        const receptionists = results[1];
        const admins = results[2];

        return doctors + receptionists + admins;
      });

      return result;
    } catch (error) {
      const dbError = error instanceof Error ? error : new Error(String(error));
      this.handleDatabaseError(dbError, 'getStaffCount', { clinicId });
      return 0;
    }
  }

  private async getLocationCount(clinicId: string): Promise<number> {
    try {
      const result = await this.executeWithClinicContext(clinicId, async _client => {
        type ClinicLocationDelegate = {
          count: <T>(args: T) => Promise<number>;
        };
        const clinicLocationDelegate = (
          _client as unknown as {
            clinicLocation: ClinicLocationDelegate;
          }
        ).clinicLocation;
        const rawResult = await clinicLocationDelegate.count({
          where: { clinicId },
        } as Record<string, unknown>);
        return rawResult;
      });
      return result;
    } catch (error) {
      const dbError = error instanceof Error ? error : new Error(String(error));
      this.handleDatabaseError(dbError, 'getLocationCount', { clinicId });
      return 0;
    }
  }
}
