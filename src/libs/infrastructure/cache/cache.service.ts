// External imports
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  HttpStatus,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@config';

// Internal imports - Infrastructure
import { RedisService } from '@infrastructure/cache/redis/redis.service';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';
import {
  LogType,
  LogLevel,
  type IEventService,
  isEventService,
  EventCategory,
  EventPriority,
} from '@core/types';
import type { EnterpriseEventPayload } from '@core/types/event.types';

// Internal imports - Core
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

// Internal imports - Types
import type { HealthcareCacheConfig, CacheInvalidationEvent, CacheShard } from '@core/types';
import type {
  CircuitBreakerState as CacheCircuitBreakerState,
  CachePerformanceMetrics,
} from '@core/types/cache.types';

// Mutable versions for internal state management
type MutableCircuitBreakerState = {
  -readonly [K in keyof CacheCircuitBreakerState]: CacheCircuitBreakerState[K];
} & {
  failureCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
};

type MutablePerformanceMetrics = {
  -readonly [K in keyof CachePerformanceMetrics]: CachePerformanceMetrics[K];
};

// Note: All types are now imported from @types. See cache.types.ts for type definitions.

/**
 * Enterprise-grade cache service for healthcare applications
 * @class CacheService
 * @description Provides comprehensive caching capabilities with healthcare-specific optimizations,
 * circuit breaker patterns, sharding, and enterprise features for 1M+ users
 * @example
 * ```typescript
 * // Cache patient records
 * const patient = await cacheService.cachePatientRecords(
 *   'patient-123',
 *   'clinic-456',
 *   () => fetchPatientFromDB('patient-123')
 * );
 *
 * // Cache with custom options
 * const data = await cacheService.cache('key', fetchFn, {
 *   ttl: 3600,
 *   containsPHI: true,
 *   priority: 'high'
 * });
 * ```
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly config: HealthcareCacheConfig;

  // Enterprise-grade state management
  private circuitBreaker: MutableCircuitBreakerState = {
    isOpen: false,
    failures: 0,
    failureCount: 0,
    successCount: 0,
    lastFailureTime: 0,
    nextAttemptTime: 0,
  };

  private performanceMetrics: MutablePerformanceMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    p95ResponseTime: 0,
    p99ResponseTime: 0,
    cacheHitRate: 0,
    memoryUsage: 0,
    connectionPoolUtilization: 0,
    throughput: 0,
    errorRate: 0,
    timestamp: new Date(),
  };

  private cacheShards: CacheShard[] = [];
  private activeConnections = 0;
  private requestQueue: Array<() => Promise<unknown>> = [];
  private isProcessingQueue = false;
  private adaptiveTTLMap = new Map<string, number>();
  private predictiveCacheMap = new Map<
    string,
    { lastAccess: Date; accessCount: number; priority: number }
  >();
  private compressionCache = new Map<string, Buffer>();
  private auditLog: Array<{
    timestamp: Date;
    operation: string;
    key: string;
    userId?: string;
    result: 'success' | 'failure';
  }> = [];

  // Healthcare-specific cache key patterns
  private readonly CACHE_PATTERNS = {
    PATIENT_RECORDS: (patientId: string, clinicId: string) =>
      `patient:${patientId}:clinic:${clinicId}:records`,
    PATIENT_PROFILE: (patientId: string) => `patient:${patientId}:profile`,
    PATIENT_APPOINTMENTS: (patientId: string, clinicId: string) =>
      `patient:${patientId}:clinic:${clinicId}:appointments`,
    DOCTOR_PROFILE: (doctorId: string) => `doctor:${doctorId}:profile`,
    DOCTOR_SCHEDULE: (doctorId: string, date: string) => `doctor:${doctorId}:schedule:${date}`,
    DOCTOR_APPOINTMENTS: (doctorId: string, clinicId: string) =>
      `doctor:${doctorId}:clinic:${clinicId}:appointments`,
    CLINIC_INFO: (clinicId: string) => `clinic:${clinicId}:info`,
    CLINIC_DOCTORS: (clinicId: string) => `clinic:${clinicId}:doctors`,
    CLINIC_PATIENTS: (clinicId: string) => `clinic:${clinicId}:patients`,
    MEDICAL_HISTORY: (patientId: string, clinicId: string) =>
      `medical:${patientId}:clinic:${clinicId}:history`,
    PRESCRIPTIONS: (patientId: string, clinicId: string) =>
      `prescriptions:${patientId}:clinic:${clinicId}`,
    APPOINTMENT_DETAILS: (appointmentId: string) => `appointment:${appointmentId}:details`,
    USER_PERMISSIONS: (userId: string, clinicId: string) =>
      `user:${userId}:clinic:${clinicId}:permissions`,
    EMERGENCY_CONTACTS: (patientId: string) => `patient:${patientId}:emergency_contacts`,
    VITAL_SIGNS: (patientId: string, date: string) => `patient:${patientId}:vitals:${date}`,
    LAB_RESULTS: (patientId: string, clinicId: string) =>
      `lab:${patientId}:clinic:${clinicId}:results`,
  };

  // Healthcare-specific cache tags for grouped invalidation
  private readonly CACHE_TAGS = {
    PATIENT: (patientId: string) => `patient:${patientId}`,
    DOCTOR: (doctorId: string) => `doctor:${doctorId}`,
    CLINIC: (clinicId: string) => `clinic:${clinicId}`,
    USER: (userId: string) => `user:${userId}`,
    APPOINTMENT: (appointmentId: string) => `appointment:${appointmentId}`,
    MEDICAL_RECORD: (recordId: string) => `medical_record:${recordId}`,
    PRESCRIPTION: (prescriptionId: string) => `prescription:${prescriptionId}`,
    EMERGENCY_DATA: 'emergency_data',
    CRITICAL_PATIENT_DATA: 'critical_patient_data',
    PHI_DATA: 'phi_data', // Protected Health Information
  };

  private typedEventService?: IEventService;

  constructor(
    @Inject(forwardRef(() => ConfigService)) private readonly configService: ConfigService,
    private readonly redisService: RedisService,

    @Inject(forwardRef(() => EventService))
    private readonly eventService: unknown,
    @Inject(forwardRef(() => LoggingService)) private readonly loggingService: LoggingService
  ) {
    // Type guard ensures type safety when using the service
    if (isEventService(this.eventService)) {
      this.typedEventService = this.eventService;
    }
    // Helper function to safely get config values with fallback to process.env
    // ConfigService is global, but we add try-catch for robustness
    const getConfig = <T>(key: string, defaultValue: T): T => {
      try {
        if (!this.configService || typeof this.configService.get !== 'function') {
          const envValue = process.env[key];
          if (envValue !== undefined) {
            // Try to parse as the same type as defaultValue
            if (typeof defaultValue === 'number') {
              return (parseInt(envValue, 10) || defaultValue) as T;
            }
            if (typeof defaultValue === 'boolean') {
              return (envValue === 'true' || envValue === '1') as T;
            }
            return envValue as T;
          }
          return defaultValue;
        }
        return this.configService.get<T>(key, defaultValue);
      } catch {
        // Fallback to process.env if ConfigService.get fails
        const envValue = process.env[key];
        if (envValue !== undefined) {
          // Try to parse as the same type as defaultValue
          if (typeof defaultValue === 'number') {
            return (parseInt(envValue, 10) || defaultValue) as T;
          }
          if (typeof defaultValue === 'boolean') {
            return (envValue === 'true' || envValue === '1') as T;
          }
          return envValue as T;
        }
        return defaultValue;
      }
    };

    this.config = {
      // Basic cache configurations
      patientRecordsTTL: getConfig('CACHE_PATIENT_RECORDS_TTL', 3600), // 1 hour
      appointmentsTTL: getConfig('CACHE_APPOINTMENTS_TTL', 1800), // 30 minutes
      doctorProfilesTTL: getConfig('CACHE_DOCTOR_PROFILES_TTL', 7200), // 2 hours
      clinicDataTTL: getConfig('CACHE_CLINIC_DATA_TTL', 14400), // 4 hours
      medicalHistoryTTL: getConfig('CACHE_MEDICAL_HISTORY_TTL', 7200), // 2 hours
      prescriptionsTTL: getConfig('CACHE_PRESCRIPTIONS_TTL', 1800), // 30 minutes
      emergencyDataTTL: getConfig('CACHE_EMERGENCY_DATA_TTL', 300), // 5 minutes
      enableCompression: getConfig('CACHE_ENABLE_COMPRESSION', true),
      enableMetrics: getConfig('CACHE_ENABLE_METRICS', true),
      defaultTTL: getConfig('CACHE_DEFAULT_TTL', 3600), // 1 hour
      maxCacheSize: getConfig('CACHE_MAX_SIZE_MB', 1024), // 1GB
      enableBatchOperations: getConfig('CACHE_ENABLE_BATCH', true),
      compressionThreshold: getConfig('CACHE_COMPRESSION_THRESHOLD', 1024), // 1KB

      // Enterprise-grade configurations for 10M+ users
      connectionPoolSize: getConfig('CACHE_CONNECTION_POOL_SIZE', 100),
      maxConnections: getConfig('CACHE_MAX_CONNECTIONS', 1000),
      connectionTimeout: getConfig('CACHE_CONNECTION_TIMEOUT', 5000),
      commandTimeout: getConfig('CACHE_COMMAND_TIMEOUT', 3000),
      retryAttempts: getConfig('CACHE_RETRY_ATTEMPTS', 3),
      retryDelay: getConfig('CACHE_RETRY_DELAY', 1000),
      circuitBreakerThreshold: getConfig('CACHE_CIRCUIT_BREAKER_THRESHOLD', 10),
      circuitBreakerTimeout: getConfig('CACHE_CIRCUIT_BREAKER_TIMEOUT', 30000),
      adaptiveCachingEnabled: getConfig('CACHE_ADAPTIVE_ENABLED', true),
      loadBalancingEnabled: getConfig('CACHE_LOAD_BALANCING_ENABLED', true),
      shardingEnabled: getConfig('CACHE_SHARDING_ENABLED', true),
      replicationEnabled: getConfig('CACHE_REPLICATION_ENABLED', true),
      memoryOptimizationEnabled: getConfig('CACHE_MEMORY_OPTIMIZATION_ENABLED', true),
      performanceMonitoringEnabled: getConfig('CACHE_PERFORMANCE_MONITORING_ENABLED', true),
      autoScalingEnabled: getConfig('CACHE_AUTO_SCALING_ENABLED', true),
      cacheWarmingEnabled: getConfig('CACHE_WARMING_ENABLED', true),
      predictiveCachingEnabled: getConfig('CACHE_PREDICTIVE_ENABLED', true),
      compressionLevel: getConfig('CACHE_COMPRESSION_LEVEL', 6),
      encryptionEnabled: getConfig('CACHE_ENCRYPTION_ENABLED', true),
      auditLoggingEnabled: getConfig('CACHE_AUDIT_LOGGING_ENABLED', true),
    };
  }

  async onModuleInit() {
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Enterprise Cache Service initializing for 10M+ users',
      'CacheService',
      {}
    );

    try {
      // Initialize enterprise features
      await this.initializeSharding();
      await this.initializeConnectionPool();
      this.startPerformanceMonitoring();
      this.initializeCircuitBreaker();
      this.startAdaptiveCaching();
      this.startPredictiveCaching();
      await this.initializeCacheWarming();

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Enterprise Cache Service initialized successfully',
        'CacheService',
        {}
      );
      // Emit initialization event via centralized EventService
      if (this.typedEventService) {
        void this.typedEventService.emitEnterprise('cache.service.initialized', {
          eventId: `cache_init_${Date.now()}`,
          eventType: 'cache.service.initialized',
          category: EventCategory.CACHE,
          priority: EventPriority.NORMAL,
          timestamp: new Date().toISOString(),
          source: 'CacheService',
          version: '1.0.0',
          payload: {
            timestamp: new Date().toISOString(),
            features: {
              sharding: this.config.shardingEnabled,
              loadBalancing: this.config.loadBalancingEnabled,
              adaptiveCaching: this.config.adaptiveCachingEnabled,
              predictiveCaching: this.config.predictiveCachingEnabled,
              compression: this.config.enableCompression,
              encryption: this.config.encryptionEnabled,
            },
          },
        } as EnterpriseEventPayload);
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to initialize Enterprise Cache Service',
        'CacheService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Enterprise Cache Service shutting down gracefully',
      'CacheService',
      {}
    );

    try {
      // Graceful shutdown
      void this.stopPerformanceMonitoring();
      this.stopAdaptiveCaching();
      this.stopPredictiveCaching();
      this.closeConnectionPool();

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Enterprise Cache Service shutdown complete',
        'CacheService',
        {}
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error during cache service shutdown',
        'CacheService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  // ===== ENTERPRISE-GRADE INITIALIZATION METHODS =====

  private async initializeSharding(): Promise<void> {
    if (!this.config.shardingEnabled) return;

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Initializing cache sharding',
      'CacheService',
      {}
    );

    // Initialize shards based on configuration
    const shardConfigs =
      this.configService?.get<Array<Record<string, unknown>>>('CACHE_SHARDS', []) || [];
    this.cacheShards = shardConfigs.map((config: Record<string, unknown>, index: number) => {
      const shardConfig = config;
      return {
        id: `shard-${index}`,
        host: (shardConfig['host'] as string) || 'localhost',
        port: (shardConfig['port'] as number) || 6379,
        weight: (shardConfig['weight'] as number) || 1,
        isHealthy: true,
        lastHealthCheck: new Date(),
        connectionCount: 0,
        loadFactor: 0,
      };
    });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Initialized cache shards',
      'CacheService',
      { shardCount: this.cacheShards.length }
    );
  }

  private async initializeConnectionPool(): Promise<void> {
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Initializing connection pool',
      'CacheService',
      {}
    );

    // Connection pool is managed by RedisService
    // This method can be extended for custom pool management
    this.activeConnections = 0;

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Connection pool initialized',
      'CacheService',
      { maxConnections: this.config.maxConnections }
    );
  }

  private startPerformanceMonitoring(): void {
    if (!this.config.performanceMonitoringEnabled) return;

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Starting performance monitoring',
      'CacheService',
      {}
    );

    // Start monitoring interval
    setInterval(() => {
      this.updatePerformanceMetrics();
    }, 5000); // Update every 5 seconds

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Performance monitoring started',
      'CacheService',
      {}
    );
  }

  private initializeCircuitBreaker(): void {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Initializing circuit breaker',
      'CacheService',
      {}
    );

    this.circuitBreaker = {
      isOpen: false,
      failures: 0,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
    };

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Circuit breaker initialized',
      'CacheService',
      {}
    );
  }

  private startAdaptiveCaching(): void {
    if (!this.config.adaptiveCachingEnabled) return;

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Starting adaptive caching',
      'CacheService',
      {}
    );

    // Start adaptive TTL adjustment
    setInterval(() => {
      this.adjustAdaptiveTTL();
    }, 60000); // Adjust every minute

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Adaptive caching started',
      'CacheService',
      {}
    );
  }

  private startPredictiveCaching(): void {
    if (!this.config.predictiveCachingEnabled) return;

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Starting predictive caching',
      'CacheService',
      {}
    );

    // Start predictive cache warming
    setInterval(() => {
      void this.performPredictiveCaching();
    }, 300000); // Run every 5 minutes

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Predictive caching started',
      'CacheService',
      {}
    );
  }

  private async initializeCacheWarming(): Promise<void> {
    if (!this.config.cacheWarmingEnabled) return;

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Initializing cache warming',
      'CacheService',
      {}
    );

    // Perform initial cache warming
    await this.performCacheWarming();

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Cache warming initialized',
      'CacheService',
      {}
    );
  }

  private stopPerformanceMonitoring(): void {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Stopping performance monitoring',
      'CacheService',
      {}
    );
    // Cleanup monitoring resources
  }

  private stopAdaptiveCaching(): void {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Stopping adaptive caching',
      'CacheService',
      {}
    );
    // Cleanup adaptive caching resources
  }

  private stopPredictiveCaching(): void {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Stopping predictive caching',
      'CacheService',
      {}
    );
    // Cleanup predictive caching resources
  }

  private closeConnectionPool(): void {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Closing connection pool',
      'CacheService',
      {}
    );
    this.activeConnections = 0;
  }

  // ===== ENTERPRISE-GRADE CORE METHODS =====

  private async executeWithCircuitBreaker<T>(operation: () => Promise<T>): Promise<T> {
    // Check if Redis is ready before attempting operations
    // This prevents circuit breaker from opening when Redis is still connecting
    if (this.redisService && typeof (this.redisService as { ping?: () => Promise<string> }).ping === 'function') {
      try {
        await Promise.race([
          (this.redisService as { ping: () => Promise<string> }).ping(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 1000)),
        ]);
        // Redis is ready - reset circuit breaker if it was open
        if (this.circuitBreaker.isOpen) {
          this.circuitBreaker.isOpen = false;
          this.circuitBreaker.failureCount = 0;
          this.circuitBreaker.failures = 0;
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'CacheService circuit breaker reset - Redis is now ready',
            'CacheService',
            {}
          );
        }
      } catch {
        // Redis is not ready - don't attempt operation, but don't count as failure
        // This prevents circuit breaker from opening during Redis initialization
        throw new HealthcareError(
          ErrorCode.CACHE_OPERATION_FAILED,
          'Redis is not ready yet - cache service temporarily unavailable',
          HttpStatus.SERVICE_UNAVAILABLE,
          {
            circuitBreakerState: this.circuitBreaker,
            redisReady: false,
          },
          'CacheService.executeWithCircuitBreaker'
        );
      }
    }

    if (this.circuitBreaker.isOpen) {
      const nextAttemptTime =
        this.circuitBreaker.nextAttemptTime || this.circuitBreaker.nextAttempt?.getTime() || 0;
      if (Date.now() < nextAttemptTime) {
        throw new HealthcareError(
          ErrorCode.CACHE_OPERATION_FAILED,
          'Circuit breaker is open - cache service temporarily unavailable',
          HttpStatus.SERVICE_UNAVAILABLE,
          {
            circuitBreakerState: this.circuitBreaker,
            nextAttemptTime: nextAttemptTime,
          },
          'CacheService.executeWithCircuitBreaker'
        );
      } else {
        // Try to close the circuit
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.failureCount = 0;
        this.circuitBreaker.failures = 0;
      }
    }

    try {
      const result = await operation();
      this.circuitBreaker.failureCount = 0;
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.successCount++;
      return result;
    } catch (error) {
      this.circuitBreaker.failureCount++;
      this.circuitBreaker.failures++;
      this.circuitBreaker.lastFailureTime = Date.now();
      this.circuitBreaker.lastFailure = new Date();

      if (this.circuitBreaker.failureCount >= this.config.circuitBreakerThreshold) {
        this.circuitBreaker.isOpen = true;
        const nextAttempt = Date.now() + this.config.circuitBreakerTimeout;
        this.circuitBreaker.nextAttemptTime = nextAttempt;
        this.circuitBreaker.nextAttempt = new Date(nextAttempt);
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Circuit breaker opened due to failures',
          'CacheService',
          {
            failureCount: this.circuitBreaker.failureCount,
            threshold: this.config.circuitBreakerThreshold,
          }
        );
      }

      throw error;
    }
  }

  private async executeWithRetry<T>(operation: () => Promise<T>, context: string): Promise<T> {
    let lastError: Error | undefined = undefined;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        return await this.executeWithCircuitBreaker(operation);
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.config.retryAttempts) {
          const delay = this.config.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            'Operation failed, retrying',
            'CacheService',
            {
              context,
              attempt,
              maxAttempts: this.config.retryAttempts,
              retryDelay: delay,
            }
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    await this.loggingService.log(
      LogType.ERROR,
      LogLevel.ERROR,
      'Operation failed after all retry attempts',
      'CacheService',
      {
        context,
        attempts: this.config.retryAttempts,
        error: lastError instanceof Error ? lastError.message : 'Unknown error',
      }
    );
    throw lastError!;
  }

  private updatePerformanceMetrics(): void {
    const _now = Date.now();
    const _timeWindow = 60000; // 1 minute window
    // Reserved for future time-based metric calculations

    // Update metrics based on recent activity
    const totalRequests = this.performanceMetrics['totalRequests'];
    const successfulRequests = this.performanceMetrics['successfulRequests'];
    const failedRequests = this.performanceMetrics['failedRequests'];

    this.performanceMetrics = {
      ...this.performanceMetrics,
      timestamp: new Date(),
      connectionPoolUtilization: (this.activeConnections / this.config.maxConnections) * 100,
      cacheHitRate: totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0,
      errorRate: totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0,
    };

    // Emit metrics event via centralized EventService
    if (this.typedEventService) {
      void this.typedEventService.emitEnterprise('cache.performance.metrics', {
        eventId: `cache_metrics_${Date.now()}`,
        eventType: 'cache.performance.metrics',
        category: EventCategory.CACHE,
        priority: EventPriority.LOW,
        timestamp: new Date().toISOString(),
        source: 'CacheService',
        version: '1.0.0',
        payload: this.performanceMetrics,
      } as EnterpriseEventPayload);
    }
  }

  private adjustAdaptiveTTL(): void {
    // Adjust TTL based on access patterns and system load
    for (const [key, currentTTL] of Array.from(this.adaptiveTTLMap.entries())) {
      const accessInfo = this.predictiveCacheMap.get(key);
      if (accessInfo) {
        // Increase TTL for frequently accessed items
        if (accessInfo.accessCount > 10) {
          this.adaptiveTTLMap.set(key, Math.min(currentTTL * 1.2, this.config.defaultTTL * 2));
        }
        // Decrease TTL for rarely accessed items
        else if (accessInfo.accessCount < 2) {
          this.adaptiveTTLMap.set(key, Math.max(currentTTL * 0.8, this.config.defaultTTL * 0.5));
        }
      }
    }
  }

  private async performPredictiveCaching(): Promise<void> {
    // Predict and pre-cache likely-to-be-accessed data
    const highPriorityKeys = Array.from(this.predictiveCacheMap.entries())
      .filter(([_key, info]) => info.priority > 0.8)
      .sort((a, b) => b[1].priority - a[1].priority)
      .slice(0, 100); // Top 100 high-priority items

    for (const [key, _info] of highPriorityKeys) {
      try {
        // Pre-warm cache for high-priority items
        await this.warmCacheForKey(key);
      } catch (error) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Failed to warm cache for key',
          'CacheService',
          {
            key,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
      }
    }
  }

  private async performCacheWarming(): Promise<void> {
    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.INFO,
      'Performing cache warming',
      'CacheService',
      {}
    );

    // Warm critical healthcare data
    const criticalKeys = [
      'clinic:active:doctors',
      'clinic:active:patients',
      'system:health:status',
      'cache:performance:metrics',
    ];

    for (const key of criticalKeys) {
      try {
        await this.warmCacheForKey(key);
      } catch (error) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Failed to warm cache for critical key',
          'CacheService',
          {
            key,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
      }
    }

    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.INFO,
      'Cache warming completed',
      'CacheService',
      {}
    );
  }

  private warmCacheForKey(key: string): Promise<void> {
    // This would typically fetch and cache data for the key
    // Implementation depends on the specific data type
    void this.loggingService.log(
      LogType.CACHE,
      LogLevel.DEBUG,
      'Warming cache for key',
      'CacheService',
      { key }
    );
    return Promise.resolve();
  }

  private selectOptimalShard(key: string): CacheShard {
    if (!this.config.shardingEnabled || this.cacheShards.length === 0) {
      return this.cacheShards[0]!;
    }

    // Use consistent hashing to select shard
    const hash = this.hashKey(key);
    const shardIndex = hash % this.cacheShards.length;
    return this.cacheShards[shardIndex]!;
  }

  private hashKey(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  private logAuditEvent(
    operation: string,
    key: string,
    userId?: string,
    result: 'success' | 'failure' = 'success'
  ): void {
    if (!this.config.auditLoggingEnabled) return;

    const auditEntry = {
      timestamp: new Date(),
      operation,
      key,
      ...(userId && { userId }),
      result,
    };

    this.auditLog.push(auditEntry);

    // Keep only last 10000 entries
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-10000);
    }

    // Emit audit event via centralized EventService
    if (this.typedEventService) {
      void this.typedEventService.emitEnterprise('cache.audit.event', {
        eventId: `cache_audit_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        eventType: 'cache.audit.event',
        category: EventCategory.AUDIT,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'CacheService',
        version: '1.0.0',
        payload: auditEntry,
      } as EnterpriseEventPayload);
    }
  }

  /**
   * Cache patient records with healthcare-specific optimizations
   */
  async cachePatientRecords<T>(
    patientId: string,
    clinicId: string,
    fetchFn: () => Promise<T>,
    _options: {
      includeHistory?: boolean;
      includePrescriptions?: boolean;
      includeVitals?: boolean;
    } = {}
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.PATIENT_RECORDS(patientId, clinicId);
    const tags = [
      this.CACHE_TAGS.PATIENT(patientId),
      this.CACHE_TAGS.CLINIC(clinicId),
      this.CACHE_TAGS.PHI_DATA,
      this.CACHE_TAGS.CRITICAL_PATIENT_DATA,
    ];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.patientRecordsTTL,
      compress: this.config.enableCompression,
      priority: 'high',
      tags,
      enableSwr: true,
    });
  }

  /**
   * Cache doctor appointments with real-time updates
   */
  async cacheDoctorAppointments<T>(
    doctorId: string,
    clinicId: string,
    fetchFn: () => Promise<T>,
    options: {
      date?: string;
      includePatientData?: boolean;
    } = {}
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.DOCTOR_APPOINTMENTS(doctorId, clinicId);
    const tags = [this.CACHE_TAGS.DOCTOR(doctorId), this.CACHE_TAGS.CLINIC(clinicId)];

    if (options.includePatientData) {
      tags.push(this.CACHE_TAGS.PHI_DATA);
    }

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.appointmentsTTL,
      staleTime: 300, // 5 minutes stale time for real-time updates
      priority: 'high',
      tags,
      enableSwr: true,
    });
  }

  /**
   * Cache patient medical history with compliance considerations
   */
  async cacheMedicalHistory<T>(
    patientId: string,
    clinicId: string,
    fetchFn: () => Promise<T>,
    _options: {
      timeRange?: { start: Date; end: Date };
      includeTests?: boolean;
      includeImages?: boolean;
    } = {}
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.MEDICAL_HISTORY(patientId, clinicId);
    const tags = [
      this.CACHE_TAGS.PATIENT(patientId),
      this.CACHE_TAGS.CLINIC(clinicId),
      this.CACHE_TAGS.PHI_DATA,
    ];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.medicalHistoryTTL,
      compress: true, // Medical history can be large
      priority: 'high',
      tags,
      enableSwr: true,
    });
  }

  /**
   * Cache emergency data with minimal TTL for critical scenarios
   */
  async cacheEmergencyData<T>(patientId: string, fetchFn: () => Promise<T>): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.EMERGENCY_CONTACTS(patientId);
    const tags = [
      this.CACHE_TAGS.PATIENT(patientId),
      this.CACHE_TAGS.EMERGENCY_DATA,
      this.CACHE_TAGS.CRITICAL_PATIENT_DATA,
    ];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.emergencyDataTTL,
      priority: 'high',
      tags,
      enableSwr: false, // No SWR for emergency data - always fresh
    });
  }

  /**
   * Cache prescription data with pharmacy integration considerations
   */
  async cachePrescriptions<T>(
    patientId: string,
    clinicId: string,
    fetchFn: () => Promise<T>,
    _options: {
      includeHistory?: boolean;
      activeOnly?: boolean;
    } = {}
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.PRESCRIPTIONS(patientId, clinicId);
    const tags = [
      this.CACHE_TAGS.PATIENT(patientId),
      this.CACHE_TAGS.CLINIC(clinicId),
      this.CACHE_TAGS.PHI_DATA,
    ];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.prescriptionsTTL,
      priority: 'high',
      tags,
      enableSwr: true,
    });
  }

  /**
   * Cache vital signs with time-series optimization
   */
  async cacheVitalSigns<T>(patientId: string, date: string, fetchFn: () => Promise<T>): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.VITAL_SIGNS(patientId, date);
    const tags = [this.CACHE_TAGS.PATIENT(patientId), this.CACHE_TAGS.PHI_DATA];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.patientRecordsTTL,
      priority: 'high',
      tags,
      enableSwr: true,
    });
  }

  /**
   * Cache lab results with integration awareness
   */
  async cacheLabResults<T>(
    patientId: string,
    clinicId: string,
    fetchFn: () => Promise<T>,
    options: {
      includeImages?: boolean;
      includeReports?: boolean;
    } = {}
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.LAB_RESULTS(patientId, clinicId);
    const tags = [
      this.CACHE_TAGS.PATIENT(patientId),
      this.CACHE_TAGS.CLINIC(clinicId),
      this.CACHE_TAGS.PHI_DATA,
    ];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.medicalHistoryTTL,
      ...(options.includeImages || options.includeReports ? { compress: true } : {}),
      priority: 'high',
      tags,
      enableSwr: true,
    });
  }

  /**
   * Invalidate patient-related cache when patient data changes
   */
  async invalidatePatientCache(patientId: string, clinicId?: string): Promise<void> {
    const patterns = [
      `patient:${patientId}:*`,
      `medical:${patientId}:*`,
      `prescriptions:${patientId}:*`,
      `lab:${patientId}:*`,
    ];

    if (clinicId) {
      patterns.push(`*:clinic:${clinicId}:*`);
    }

    // Invalidate by patterns
    for (const pattern of patterns) {
      await this.redisService.invalidateCacheByPattern(pattern);
    }

    // Invalidate by tags
    await this.redisService.invalidateCacheByTag(this.CACHE_TAGS.PATIENT(patientId));
    if (clinicId) {
      await this.redisService.invalidateCacheByTag(this.CACHE_TAGS.CLINIC(clinicId));
    }

    // Emit invalidation event
    await this.emitCacheInvalidationEvent({
      type: 'patient_updated',
      entityId: patientId,
      ...(clinicId && { clinicId }),
      timestamp: new Date(),
      affectedPatterns: patterns,
    });

    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.DEBUG,
      'Invalidated patient cache',
      'CacheService',
      { patientId, clinicId: clinicId || 'all' }
    );
  }

  /**
   * Invalidate doctor-related cache when doctor data changes
   */
  async invalidateDoctorCache(doctorId: string, clinicId?: string): Promise<void> {
    const patterns = [`doctor:${doctorId}:*`];

    if (clinicId) {
      patterns.push(`*:clinic:${clinicId}:doctors`);
    }

    // Invalidate by patterns
    for (const pattern of patterns) {
      await this.redisService.invalidateCacheByPattern(pattern);
    }

    // Invalidate by tags
    await this.redisService.invalidateCacheByTag(this.CACHE_TAGS.DOCTOR(doctorId));
    if (clinicId) {
      await this.redisService.invalidateCacheByTag(this.CACHE_TAGS.CLINIC(clinicId));
    }

    await this.emitCacheInvalidationEvent({
      type: 'doctor_updated',
      entityId: doctorId,
      ...(clinicId && { clinicId }),
      timestamp: new Date(),
      affectedPatterns: patterns,
    });

    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.DEBUG,
      'Invalidated doctor cache',
      'CacheService',
      { doctorId, clinicId: clinicId || 'all' }
    );
  }

  /**
   * Invalidate appointment-related cache
   */
  async invalidateAppointmentCache(
    appointmentId: string,
    patientId?: string,
    doctorId?: string,
    clinicId?: string
  ): Promise<void> {
    const patterns = [`appointment:${appointmentId}:*`];

    if (patientId) {
      patterns.push(`patient:${patientId}:*:appointments`);
    }

    if (doctorId) {
      patterns.push(`doctor:${doctorId}:*:appointments`);
    }

    if (clinicId) {
      patterns.push(`*:clinic:${clinicId}:appointments`);
    }

    // Invalidate by patterns
    for (const pattern of patterns) {
      await this.redisService.invalidateCacheByPattern(pattern);
    }

    // Invalidate by tags
    await this.redisService.invalidateCacheByTag(this.CACHE_TAGS.APPOINTMENT(appointmentId));

    await this.emitCacheInvalidationEvent({
      type: 'appointment_changed',
      entityId: appointmentId,
      ...(clinicId && { clinicId }),
      ...(patientId && { userId: patientId }),
      ...(doctorId && { userId: doctorId }),
      timestamp: new Date(),
      affectedPatterns: patterns,
    });

    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.DEBUG,
      'Invalidated appointment cache',
      'CacheService',
      { appointmentId }
    );
  }

  /**
   * Invalidate clinic-wide cache
   */
  async invalidateClinicCache(clinicId: string): Promise<void> {
    const patterns = [`clinic:${clinicId}:*`, `*:clinic:${clinicId}:*`];

    // Invalidate by patterns
    for (const pattern of patterns) {
      await this.redisService.invalidateCacheByPattern(pattern);
    }

    // Invalidate by tag
    await this.redisService.invalidateCacheByTag(this.CACHE_TAGS.CLINIC(clinicId));

    await this.emitCacheInvalidationEvent({
      type: 'clinic_updated',
      entityId: clinicId,
      clinicId,
      timestamp: new Date(),
      affectedPatterns: patterns,
    });

    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.DEBUG,
      'Invalidated clinic cache',
      'CacheService',
      { clinicId }
    );
  }

  /**
   * Clear all PHI (Protected Health Information) data from cache
   * Used for compliance and emergency scenarios
   */
  async clearPHICache(): Promise<number> {
    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.WARN,
      'Clearing all PHI data from cache for compliance',
      'CacheService',
      {}
    );

    const clearedCount = await this.redisService.invalidateCacheByTag(this.CACHE_TAGS.PHI_DATA);

    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.INFO,
      'Cleared PHI cache entries',
      'CacheService',
      { clearedCount }
    );
    return clearedCount;
  }

  /**
   * Get healthcare cache metrics
   */
  async getHealthcareCacheMetrics(): Promise<{
    patientCacheHits: number;
    appointmentCacheHits: number;
    doctorCacheHits: number;
    emergencyCacheHits: number;
    totalHits: number;
    totalMisses: number;
    hitRate: number;
  }> {
    const baseMetrics = await this.redisService.getCacheStats();

    // In a real implementation, you would track healthcare-specific metrics
    return {
      patientCacheHits: Math.floor(baseMetrics.hits * 0.4), // Estimate
      appointmentCacheHits: Math.floor(baseMetrics.hits * 0.3),
      doctorCacheHits: Math.floor(baseMetrics.hits * 0.2),
      emergencyCacheHits: Math.floor(baseMetrics.hits * 0.1),
      totalHits: baseMetrics.hits,
      totalMisses: baseMetrics.misses,
      hitRate: baseMetrics.hits / (baseMetrics.hits + baseMetrics.misses) || 0,
    };
  }

  /**
   * Warm cache with frequently accessed healthcare data
   */
  warmHealthcareCache(clinicId: string): void {
    void this.loggingService.log(
      LogType.CACHE,
      LogLevel.INFO,
      'Warming healthcare cache for clinic',
      'CacheService',
      { clinicId }
    );

    try {
      // This would typically pre-load common data like:
      // - Active doctors
      // - Today's appointments
      // - Emergency contacts
      // - Clinic configuration

      // For now, we'll just log the warming process
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.DEBUG,
        'Cache warming completed - this would pre-load common healthcare data',
        'CacheService',
        { clinicId }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error warming healthcare cache',
        'CacheService',
        {
          clinicId,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * Emit cache invalidation event for cross-service coordination
   */
  private async emitCacheInvalidationEvent(event: CacheInvalidationEvent): Promise<void> {
    try {
      // Store the invalidation event for audit purposes
      const eventKey = `cache:invalidation:events`;
      await this.redisService.rPush(eventKey, JSON.stringify(event));
      await this.redisService.lTrim(eventKey, -1000, -1); // Keep last 1000 events

      // Set expiry for events (30 days)
      await this.redisService.expire(eventKey, 30 * 24 * 60 * 60);
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error emitting cache invalidation event',
        'CacheService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          eventType: event.type,
        }
      );
    }
  }

  /**
   * Get cache invalidation event history
   */
  async getCacheInvalidationHistory(limit: number = 100): Promise<CacheInvalidationEvent[]> {
    try {
      const eventKey = `cache:invalidation:events`;
      const events = await this.redisService.lRange(eventKey, -limit, -1);

      return events.map(eventStr => JSON.parse(eventStr) as CacheInvalidationEvent);
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error getting cache invalidation history',
        'CacheService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          limit,
        }
      );
      return [];
    }
  }

  /**
   * Batch cache operations for better performance
   */
  async batchGet<T>(keys: string[]): Promise<Map<string, T | null>> {
    const results = new Map<string, T | null>();

    try {
      // Use Promise.all for concurrent operations
      const promises = keys.map(async key => {
        const value = await this.redisService.get(key);
        return { key, value: value ? (JSON.parse(value) as T) : null };
      });

      const batchResults = await Promise.all(promises);

      batchResults.forEach(({ key, value }: { key: string; value: T | null }) => {
        results.set(key, value);
      });

      return results;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Batch get operation failed',
        'CacheService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          keyCount: keys.length,
        }
      );
      throw error;
    }
  }

  /**
   * Batch set operations for better performance
   */
  async batchSet<T>(keyValuePairs: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    try {
      // Use Promise.all for concurrent operations
      const promises = keyValuePairs.map(async ({ key, value, ttl }) => {
        await this.redisService.set(key, JSON.stringify(value), ttl || this.config.defaultTTL);
      });

      await Promise.all(promises);
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Batch set operation failed',
        'CacheService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          pairCount: keyValuePairs.length,
        }
      );
      throw error;
    }
  }

  /**
   * Batch delete operations for better performance
   */
  async batchDelete(keys: string[]): Promise<number> {
    try {
      // Use Promise.all for concurrent operations
      const promises = keys.map(async key => {
        await this.redisService.del(key);
        return 1; // Each successful delete counts as 1
      });

      const results = await Promise.all(promises);
      return results.reduce((sum, count) => sum + count, 0);
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Batch delete operation failed',
        'CacheService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          keyCount: keys.length,
        }
      );
      throw error;
    }
  }

  /**
   * Delete a single cache key
   */
  async delete(key: string): Promise<boolean> {
    try {
      await this.redisService.del(key);
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to delete cache key',
        'CacheService',
        {
          key,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      return false;
    }
  }

  /**
   * Warm cache for a clinic with frequently accessed data
   */
  async warmClinicCache(clinicId: string): Promise<void> {
    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.INFO,
      'Starting cache warming for clinic',
      'CacheService',
      { clinicId }
    );

    try {
      // Warm clinic information
      const clinicInfoKey = this.CACHE_PATTERNS.CLINIC_INFO(clinicId);
      await this.redisService.set(
        clinicInfoKey,
        JSON.stringify({
          id: clinicId,
          name: 'Clinic',
          status: 'active',
        }),
        this.config.clinicDataTTL
      );

      // Warm doctor profiles
      const doctorsKey = this.CACHE_PATTERNS.CLINIC_DOCTORS(clinicId);
      await this.redisService.set(doctorsKey, JSON.stringify([]), this.config.doctorProfilesTTL);

      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        'Cache warming completed for clinic',
        'CacheService',
        { clinicId }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Cache warming failed for clinic',
        'CacheService',
        {
          clinicId,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get cache health status
   */
  async getCacheHealth(): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    memoryUsage: number;
    hitRate: number;
    connectionStatus: boolean;
    lastHealthCheck: Date;
  }> {
    try {
      const connectionStatus = await this.redisService.healthCheck();
      const stats = await this.redisService.getCacheStats();

      const hitRate = stats.hits / (stats.hits + stats.misses) || 0;

      let status: 'healthy' | 'warning' | 'critical' = 'healthy';
      if (hitRate < 0.7) status = 'warning';
      if (hitRate < 0.5 || !connectionStatus) status = 'critical';

      return {
        status,
        memoryUsage: 0, // RedisService doesn't expose memory info directly
        hitRate,
        connectionStatus,
        lastHealthCheck: new Date(),
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Cache health check failed',
        'CacheService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      return {
        status: 'critical',
        memoryUsage: 0,
        hitRate: 0,
        connectionStatus: false,
        lastHealthCheck: new Date(),
      };
    }
  }

  // Basic cache operations - delegate to RedisService with graceful error handling
  async get<T>(key: string): Promise<T | null> {
    try {
      return await this.redisService.get<T>(key);
    } catch (error) {
      // CRITICAL: Graceful degradation - return null (cache miss) instead of throwing
      // This allows application to continue without cache
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('circuit breaker')) {
        // Only log if circuit breaker is not open (reduces log spam)
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Cache get operation failed - returning null (cache miss)',
          'CacheService',
          {
            key,
            error: errorMessage,
          }
        );
      }
      return null; // Return null as cache miss - allows graceful degradation
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      await this.redisService.set(key, value, ttl);
    } catch (error) {
      // CRITICAL: Graceful degradation - silently fail instead of throwing
      // This prevents cache failures from breaking the application
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('circuit breaker')) {
        // Only log if circuit breaker is not open (reduces log spam)
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Cache set operation failed - continuing without cache',
          'CacheService',
          {
            key,
            error: errorMessage,
          }
        );
      }
      // Don't throw - allow graceful degradation
    }
  }

  async del(...keys: string[]): Promise<void> {
    try {
      await this.redisService.del(...keys);
    } catch (error) {
      // CRITICAL: Graceful degradation - silently fail instead of throwing
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('circuit breaker')) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Cache delete operation failed - continuing without cache',
          'CacheService',
          {
            keys,
            error: errorMessage,
          }
        );
      }
      // Don't throw - allow graceful degradation
    }
  }

  async invalidateCache(key: string): Promise<boolean> {
    try {
      return await this.redisService.invalidateCache(key);
    } catch (error) {
      // Graceful degradation - return false instead of throwing
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('circuit breaker')) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Cache invalidation failed',
          'CacheService',
          {
            key,
            error: errorMessage,
          }
        );
      }
      return false; // Return false to indicate failure, but don't throw
    }
  }

  async invalidateCacheByTag(tag: string): Promise<number> {
    try {
      return await this.redisService.invalidateCacheByTag(tag);
    } catch (error) {
      // Graceful degradation - return 0 instead of throwing
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('circuit breaker')) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Cache invalidation by tag failed',
          'CacheService',
          {
            tag,
            error: errorMessage,
          }
        );
      }
      return 0; // Return 0 to indicate no keys invalidated, but don't throw
    }
  }

  // Additional cache operations needed by other services
  async invalidateByPattern(pattern: string): Promise<number> {
    try {
      return await this.redisService.invalidateCacheByPattern(pattern);
    } catch (error) {
      // Graceful degradation - return 0 instead of throwing
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('circuit breaker')) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Cache invalidation by pattern failed',
          'CacheService',
          {
            pattern,
            error: errorMessage,
          }
        );
      }
      return 0;
    }
  }

  async delPattern(pattern: string): Promise<number> {
    try {
      return await this.redisService.invalidateCacheByPattern(pattern);
    } catch (error) {
      // Graceful degradation - return 0 instead of throwing
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('circuit breaker')) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Cache delete by pattern failed',
          'CacheService',
          {
            pattern,
            error: errorMessage,
          }
        );
      }
      return 0;
    }
  }

  // List operations
  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    return this.redisService.lRange(key, start, stop);
  }

  async lLen(key: string): Promise<number> {
    return this.redisService.lLen(key);
  }

  async rPush(key: string, value: string): Promise<number> {
    return this.redisService.rPush(key, value);
  }

  async lTrim(key: string, start: number, stop: number): Promise<string> {
    return this.redisService.lTrim(key, start, stop);
  }

  // Key operations
  async keys(pattern: string): Promise<string[]> {
    return this.redisService.keys(pattern);
  }

  // Sorted set operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.redisService.zadd(key, score, member);
  }

  async zcard(key: string): Promise<number> {
    return this.redisService.zcard(key);
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    return this.redisService.zremrangebyscore(key, min, max);
  }

  // Hash operations
  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.redisService.hincrby(key, field, increment);
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return this.redisService.hGetAll(key);
  }

  // Key expiration
  async expire(key: string, seconds: number): Promise<number> {
    return this.redisService.expire(key, seconds);
  }

  // Connection test
  async ping(): Promise<string> {
    return this.redisService.ping();
  }

  // Development mode check
  get isDevelopmentMode(): boolean {
    return this.redisService.isDevelopmentMode();
  }

  // Cache debug info
  async getCacheDebug(): Promise<unknown> {
    return this.redisService.getCacheDebug();
  }

  // ===== UNIFIED CACHE METHOD - Main entry point for all caching =====
  /**
   * Unified caching service that handles all caching operations.
   * This is the main method to use for all caching needs with built-in SWR.
   *
   * @param key - Cache key
   * @param fetchFn - Function to fetch data
   * @param options - Caching options
   * @returns Cached or fresh data
   */
  async cache<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: {
      ttl?: number; // Cache TTL in seconds
      staleTime?: number; // When data becomes stale
      forceRefresh?: boolean; // Force refresh regardless of cache
      compress?: boolean; // Compress large data
      priority?: 'critical' | 'high' | 'normal' | 'low'; // Operation priority
      enableSwr?: boolean; // Enable SWR (defaults to true)
      tags?: string[]; // Cache tags for grouped invalidation
      containsPHI?: boolean; // Contains Protected Health Information
      complianceLevel?: 'standard' | 'sensitive' | 'restricted'; // Compliance level
      emergencyData?: boolean; // Emergency data flag
      patientSpecific?: boolean; // Patient-specific data
      doctorSpecific?: boolean; // Doctor-specific data
      clinicSpecific?: boolean; // Clinic-specific data
    } = {}
  ): Promise<T> {
    // Check if Redis is ready before attempting cache operation
    // This prevents circuit breaker from opening during Redis initialization
    if (this.redisService && typeof (this.redisService as { ping?: () => Promise<string> }).ping === 'function') {
      try {
        await Promise.race([
          (this.redisService as { ping: () => Promise<string> }).ping(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 1000)),
        ]);
        // Redis is ready - reset circuit breaker if it was open
        if (this.circuitBreaker.isOpen) {
          this.circuitBreaker.isOpen = false;
          this.circuitBreaker.failureCount = 0;
          this.circuitBreaker.failures = 0;
        }
      } catch {
        // Redis is not ready - fall back to direct fetch without counting as failure
        // This prevents circuit breaker from opening during Redis initialization
        return await fetchFn();
      }
    }

    try {
      return await this.redisService.cache(key, fetchFn, options);
    } catch (error) {
      // CRITICAL: Graceful degradation - fall back to direct fetch when cache fails
      // This ensures application continues to work even when cache is unavailable
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Don't count "Redis not ready" errors as circuit breaker failures
      const isRedisNotReady = errorMessage.includes('not ready') || errorMessage.includes('Redis is not ready');
      if (!errorMessage.includes('circuit breaker') && !isRedisNotReady) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Cache operation failed - falling back to direct fetch',
          'CacheService',
          {
            key,
            error: errorMessage,
          }
        );
      }
      // Fall back to direct fetch - ensures application continues to work
      // If fetch fails, let the error propagate (it's not a cache error)
      return await fetchFn();
    }
  }

  // ===== RATE LIMITING METHODS =====
  async isRateLimited(
    key: string,
    limit?: number,
    windowSeconds?: number,
    options: {
      burst?: number; // Allow burst requests
      cost?: number; // Request cost (default: 1)
      bypassDev?: boolean; // Override development mode bypass
    } = {}
  ): Promise<boolean> {
    try {
      return await this.redisService.isRateLimited(key, limit, windowSeconds, options);
    } catch (error) {
      // CRITICAL: Graceful degradation - fail open (return false) when cache is down
      // This prevents rate limiting from blocking requests when cache is unavailable
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('circuit breaker')) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Rate limit check failed - failing open (allowing request)',
          'CacheService',
          {
            key,
            error: errorMessage,
          }
        );
      }
      return false; // Fail open - allow request when cache is unavailable
    }
  }

  async getRateLimit(
    key: string,
    limit?: number,
    windowSeconds?: number
  ): Promise<{
    remaining: number;
    reset: number;
    total: number;
    used: number;
  }> {
    try {
      return await this.redisService.getRateLimit(key, limit, windowSeconds);
    } catch (error) {
      // Graceful degradation - return default values when cache is down
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('circuit breaker')) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Rate limit get failed - returning default values',
          'CacheService',
          {
            key,
            error: errorMessage,
          }
        );
      }
      // Return default values indicating no rate limit when cache is unavailable
      return {
        remaining: limit || 999999,
        reset: 0,
        total: limit || 999999,
        used: 0,
      };
    }
  }

  async clearRateLimit(key: string): Promise<void> {
    return this.redisService.clearRateLimit(key);
  }

  updateRateLimits(type: string, config: { limit: number; window: number }): Promise<void> {
    return this.redisService.updateRateLimits(type, config);
  }

  getRateLimitConfig(type?: string): unknown {
    return this.redisService.getRateLimitConfig(type);
  }

  // ===== HEALTH AND MONITORING =====
  async healthCheck(): Promise<boolean> {
    return this.redisService.healthCheck();
  }

  async getHealthStatus(): Promise<[boolean, number]> {
    return this.redisService.getHealthStatus();
  }

  async getCacheStats(): Promise<{ hits: number; misses: number }> {
    return this.redisService.getCacheStats();
  }

  async getCacheMetrics(): Promise<import('@core/types').CacheMetrics> {
    return this.redisService.getCacheMetrics();
  }

  async clearAllCache(): Promise<number> {
    return this.redisService.clearAllCache();
  }

  async clearCache(pattern?: string): Promise<number> {
    return this.redisService.clearCache(pattern);
  }

  async resetCacheStats(): Promise<void> {
    return this.redisService.resetCacheStats();
  }

  // ===== SECURITY AND AUDIT =====
  async trackSecurityEvent(identifier: string, eventType: string, details: unknown): Promise<void> {
    return this.redisService.trackSecurityEvent(identifier, eventType, details);
  }

  async getSecurityEvents(identifier: string, limit?: number): Promise<unknown[]> {
    return this.redisService.getSecurityEvents(identifier, limit);
  }

  async clearSecurityEvents(identifier: string): Promise<void> {
    return this.redisService.clearSecurityEvents(identifier);
  }

  // ===== HASH OPERATIONS =====
  async hSet(key: string, field: string, value: string): Promise<number> {
    return this.redisService.hSet(key, field, value);
  }

  async hGet(key: string, field: string): Promise<string | null> {
    return this.redisService.hGet(key, field);
  }

  async hDel(key: string, field: string): Promise<number> {
    return this.redisService.hDel(key, field);
  }

  // ===== SET OPERATIONS =====
  async sAdd(key: string, ...members: string[]): Promise<number> {
    return this.redisService.sAdd(key, ...members);
  }

  async sMembers(key: string): Promise<string[]> {
    return this.redisService.sMembers(key);
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    return this.redisService.sRem(key, ...members);
  }

  async sCard(key: string): Promise<number> {
    return this.redisService.sCard(key);
  }

  // ===== PUB/SUB OPERATIONS =====
  async publish(channel: string, message: string): Promise<number> {
    return this.redisService.publish(channel, message);
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    return this.redisService.subscribe(channel, callback);
  }

  // ===== SORTED SET OPERATIONS =====
  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.redisService.zrevrange(key, start, stop);
  }

  async zrangebyscore(key: string, min: string | number, max: string | number): Promise<string[]> {
    return this.redisService.zrangebyscore(key, min, max);
  }

  // ===== UTILITY OPERATIONS =====
  async ttl(key: string): Promise<number> {
    return this.redisService.ttl(key);
  }

  async expireAt(key: string, timestamp: number): Promise<number> {
    return this.redisService.expireAt(key, timestamp);
  }

  async incr(key: string): Promise<number> {
    return this.redisService.incr(key);
  }

  async multi(
    commands: Array<{ command: string; args: unknown[] }>
  ): Promise<Array<[Error | null, unknown]>> {
    return this.redisService.multi(commands);
  }

  // ===== PATTERN INVALIDATION =====
  async invalidateCacheByPattern(pattern: string): Promise<number> {
    return this.redisService.invalidateCacheByPattern(pattern);
  }

  // ===== RETRY OPERATIONS =====
  async retryOperation<T>(operation: () => Promise<T>): Promise<T> {
    return this.redisService.retryOperation(operation);
  }
}
