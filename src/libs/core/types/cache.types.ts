/**
 * Cache Types - Centralized cache-related type definitions
 * All cache types and interfaces should be defined here
 */

// ============================================================================
// CACHE CONFIGURATION TYPES
// ============================================================================

/**
 * Healthcare cache configuration interface
 * @interface HealthcareCacheConfig
 * @description Configuration for healthcare-specific caching behavior
 */
export interface HealthcareCacheConfig {
  /** TTL for patient records cache in seconds */
  readonly patientRecordsTTL: number;
  /** TTL for appointments cache in seconds */
  readonly appointmentsTTL: number;
  /** TTL for doctor profiles cache in seconds */
  readonly doctorProfilesTTL: number;
  /** TTL for clinic data cache in seconds */
  readonly clinicDataTTL: number;
  /** TTL for medical history cache in seconds */
  readonly medicalHistoryTTL: number;
  /** TTL for prescriptions cache in seconds */
  readonly prescriptionsTTL: number;
  /** TTL for emergency data cache in seconds */
  readonly emergencyDataTTL: number;
  /** Whether to enable compression for large values */
  readonly enableCompression: boolean;
  /** Whether to enable cache metrics collection */
  readonly enableMetrics: boolean;
  /** Default TTL for cache entries in seconds */
  readonly defaultTTL: number;
  /** Maximum cache size in MB */
  readonly maxCacheSize: number;
  /** Whether to enable batch cache operations */
  readonly enableBatchOperations: boolean;
  /** Compress values larger than this size in bytes */
  readonly compressionThreshold: number;
  /** Connection pool size for Redis connections */
  readonly connectionPoolSize: number;
  /** Maximum number of connections */
  readonly maxConnections: number;
  /** Connection timeout in milliseconds */
  readonly connectionTimeout: number;
  /** Command timeout in milliseconds */
  readonly commandTimeout: number;
  /** Number of retry attempts for failed operations */
  readonly retryAttempts: number;
  /** Delay between retry attempts in milliseconds */
  readonly retryDelay: number;
  /** Circuit breaker failure threshold */
  readonly circuitBreakerThreshold: number;
  /** Circuit breaker timeout in milliseconds */
  readonly circuitBreakerTimeout: number;
  /** Whether adaptive caching is enabled */
  readonly adaptiveCachingEnabled: boolean;
  /** Whether load balancing is enabled */
  readonly loadBalancingEnabled: boolean;
  /** Whether sharding is enabled */
  readonly shardingEnabled: boolean;
  /** Whether replication is enabled */
  readonly replicationEnabled: boolean;
  /** Whether memory optimization is enabled */
  readonly memoryOptimizationEnabled: boolean;
  /** Whether performance monitoring is enabled */
  readonly performanceMonitoringEnabled: boolean;
  /** Whether auto-scaling is enabled */
  readonly autoScalingEnabled: boolean;
  /** Whether cache warming is enabled */
  readonly cacheWarmingEnabled: boolean;
  /** Whether predictive caching is enabled */
  readonly predictiveCachingEnabled: boolean;
  /** Compression level (1-9) */
  readonly compressionLevel: number;
  /** Whether encryption is enabled */
  readonly encryptionEnabled: boolean;
  /** Whether audit logging is enabled */
  readonly auditLoggingEnabled: boolean;
}

/**
 * Cache options for unified cache decorator
 * @interface UnifiedCacheOptions
 * @description Options for cache decorator configuration
 */
export interface UnifiedCacheOptions {
  /** Cache key template with placeholders for dynamic values */
  readonly keyTemplate?: string;
  /** Cache TTL in seconds */
  readonly ttl?: number;
  /** Cache key prefix for namespacing */
  readonly prefix?: string;
  /** Custom function to generate cache keys */
  readonly keyGenerator?: (...args: unknown[]) => string;
  /** Whether to use Stale-While-Revalidate strategy (default: true) */
  readonly useSwr?: boolean;
  /** How long data is considered fresh before revalidation (in seconds) */
  readonly staleTime?: number;
  /** Force data refresh regardless of cache status */
  readonly forceRefresh?: boolean;
  /** Cache tags for grouped invalidation */
  readonly tags?: readonly string[];
  /** Whether to compress large cache entries */
  readonly compress?: boolean;
  /** Processing priority for cache operations */
  readonly priority?: 'critical' | 'high' | 'normal' | 'low';
  /** Whether this contains PHI (Protected Health Information) */
  readonly containsPHI?: boolean;
  /** Enable compression for large data */
  readonly enableCompression?: boolean;
  /** Enable stale-while-revalidate pattern */
  readonly enableSWR?: boolean;
  /** Condition function to determine if caching should be applied */
  readonly condition?: (context: unknown, result: unknown) => boolean;
  /** Custom key generator function */
  readonly customKeyGenerator?: (context: unknown, ...args: unknown[]) => string;
  /** Clinic-specific caching (multi-tenant support) */
  readonly clinicSpecific?: boolean;
  /** Patient-specific caching */
  readonly patientSpecific?: boolean;
  /** Doctor-specific caching */
  readonly doctorSpecific?: boolean;
  /** Emergency data flag - affects caching strategy */
  readonly emergencyData?: boolean;
  /** Compliance level for healthcare data */
  readonly complianceLevel?: 'standard' | 'sensitive' | 'restricted';
  /** Auto-invalidation patterns */
  readonly invalidateOn?: readonly string[];
}

/**
 * Cache invalidation options
 * @interface CacheInvalidationOptions
 * @description Options for cache invalidation operations
 */
export interface CacheInvalidationOptions {
  /** Patterns to invalidate */
  readonly patterns: readonly string[];
  /** Tags to invalidate */
  readonly tags?: readonly string[];
  /** Whether to invalidate patient-specific cache */
  readonly invalidatePatient?: boolean;
  /** Whether to invalidate doctor-specific cache */
  readonly invalidateDoctor?: boolean;
  /** Whether to invalidate clinic-specific cache */
  readonly invalidateClinic?: boolean;
  /** Custom invalidation function */
  readonly customInvalidation?: (
    context: unknown,
    result: unknown,
    ...args: unknown[]
  ) => Promise<void>;
  /** Condition to determine if invalidation should occur */
  readonly condition?: (context: unknown, result: unknown, ...args: unknown[]) => boolean;
}

/**
 * Cache operation options
 * @interface CacheOperationOptions
 * @description Options for cache operations
 */
export interface CacheOperationOptions {
  /** Cache TTL in seconds */
  readonly ttl?: number;
  /** When data becomes stale */
  readonly staleTime?: number;
  /** Force refresh regardless of cache */
  readonly forceRefresh?: boolean;
  /** Compress large data */
  readonly compress?: boolean;
  /** Operation priority */
  readonly priority?: 'critical' | 'high' | 'normal' | 'low';
  /** Enable SWR (defaults to true) */
  readonly enableSwr?: boolean;
  /** Cache tags for grouped invalidation */
  readonly tags?: readonly string[];
  /** Contains Protected Health Information */
  readonly containsPHI?: boolean;
  /** Compliance level */
  readonly complianceLevel?: 'standard' | 'sensitive' | 'restricted';
  /** Emergency data flag */
  readonly emergencyData?: boolean;
  /** Patient-specific data */
  readonly patientSpecific?: boolean;
  /** Doctor-specific data */
  readonly doctorSpecific?: boolean;
  /** Clinic-specific data */
  readonly clinicSpecific?: boolean;
}

/**
 * Cache rate limit configuration
 * @interface CacheRateLimitConfig
 * @description Configuration for cache-specific rate limiting
 */
export interface CacheRateLimitConfig {
  /** Maximum number of requests */
  readonly limit: number;
  /** Time window in seconds */
  readonly window: number;
  /** Optional burst allowance */
  readonly burst?: number;
  /** Optional request cost */
  readonly cost?: number;
}

/**
 * Rate limit options
 * @interface RateLimitOptions
 * @description Options for rate limit checks
 */
export interface RateLimitOptions {
  /** Allow burst requests */
  readonly burst?: number;
  /** Request cost (default: 1) */
  readonly cost?: number;
  /** Override development mode bypass */
  readonly bypassDev?: boolean;
}

/**
 * Rate limit result
 * @interface RateLimitResult
 * @description Result of rate limit check
 */
export interface RateLimitResult {
  /** Whether the request is rate limited */
  readonly limited: boolean;
  /** Number of requests remaining */
  readonly remaining: number;
  /** Total limit */
  readonly total: number;
  /** Number of requests used */
  readonly used: number;
  /** Time when the rate limit resets */
  readonly reset: number;
}

// ============================================================================
// CACHE METRICS & STATISTICS TYPES
// ============================================================================

/**
 * Cache statistics
 * @interface CacheStats
 * @description Basic cache statistics
 */
export interface CacheStats {
  /** Number of cache hits */
  readonly hits: number;
  /** Number of cache misses */
  readonly misses: number;
}

/**
 * Cache metrics
 * @interface CacheMetrics
 * @description Comprehensive cache performance metrics
 */
export interface CacheMetrics {
  /** Total number of keys */
  readonly keys: number;
  /** Cache hit rate percentage */
  readonly hitRate: number;
  /** Memory usage information */
  readonly memory: {
    /** Used memory in bytes */
    readonly used: number;
    /** Peak memory usage in bytes */
    readonly peak: number;
    /** Memory fragmentation ratio */
    readonly fragmentation: number;
  };
  /** Cache operation counts */
  readonly operations: {
    /** Number of hits */
    readonly hits: number;
    /** Number of misses */
    readonly misses: number;
  };
}

/**
 * Healthcare cache metrics
 * @interface HealthcareCacheMetrics
 * @description Healthcare-specific cache metrics
 */
export interface HealthcareCacheMetrics {
  /** Patient cache hits */
  readonly patientCacheHits: number;
  /** Appointment cache hits */
  readonly appointmentCacheHits: number;
  /** Doctor cache hits */
  readonly doctorCacheHits: number;
  /** Emergency cache hits */
  readonly emergencyCacheHits: number;
  /** Total hits */
  readonly totalHits: number;
  /** Total misses */
  readonly totalMisses: number;
  /** Hit rate percentage */
  readonly hitRate: number;
}

/**
 * Cache Performance Metrics
 * @interface CachePerformanceMetrics
 * @description Cache-specific performance metrics (renamed to avoid conflicts with other PerformanceMetrics)
 */
export interface CachePerformanceMetrics {
  /** Total number of requests */
  readonly totalRequests: number;
  /** Number of successful requests */
  readonly successfulRequests: number;
  /** Number of failed requests */
  readonly failedRequests: number;
  /** Average response time in milliseconds */
  readonly averageResponseTime: number;
  /** 95th percentile response time in milliseconds */
  readonly p95ResponseTime: number;
  /** 99th percentile response time in milliseconds */
  readonly p99ResponseTime: number;
  /** Cache hit rate as a decimal (0-1) */
  readonly cacheHitRate: number;
  /** Memory usage in MB */
  readonly memoryUsage: number;
  /** Connection pool utilization as a decimal (0-1) */
  readonly connectionPoolUtilization: number;
  /** Throughput in requests per second */
  readonly throughput: number;
  /** Error rate as a decimal (0-1) */
  readonly errorRate: number;
  /** Timestamp when metrics were collected */
  readonly timestamp: Date;
}

/**
 * Cache health status
 * @interface CacheHealth
 * @description Cache service health information
 */
export interface CacheHealth {
  /** Health status */
  readonly status: 'healthy' | 'warning' | 'critical';
  /** Memory usage in MB */
  readonly memoryUsage: number;
  /** Hit rate percentage */
  readonly hitRate: number;
  /** Connection status */
  readonly connectionStatus: boolean;
  /** Last health check timestamp */
  readonly lastHealthCheck: Date;
}

// ============================================================================
// CACHE INVALIDATION TYPES
// ============================================================================

/**
 * Cache invalidation event
 * @interface CacheInvalidationEvent
 * @description Event information for cache invalidation
 */
export interface CacheInvalidationEvent {
  /** Type of invalidation event */
  readonly type:
    | 'patient_updated'
    | 'appointment_changed'
    | 'doctor_updated'
    | 'clinic_updated'
    | 'prescription_created';
  /** ID of the affected entity */
  readonly entityId: string;
  /** Optional clinic ID for clinic-specific invalidation */
  readonly clinicId?: string;
  /** Optional user ID for user-specific invalidation */
  readonly userId?: string;
  /** Timestamp when the invalidation occurred */
  readonly timestamp: Date;
  /** Cache key patterns affected by this invalidation */
  readonly affectedPatterns: readonly string[];
}

// ============================================================================
// CIRCUIT BREAKER TYPES
// ============================================================================

export type { CircuitBreakerState } from './database.types';

// ============================================================================
// CACHE SHARDING TYPES
// ============================================================================

/**
 * Cache shard configuration
 * @interface CacheShard
 * @description Information about a cache shard
 */
export interface CacheShard {
  /** Unique identifier for the shard */
  readonly id: string;
  /** Host address of the shard */
  readonly host: string;
  /** Port number of the shard */
  readonly port: number;
  /** Weight for load balancing */
  readonly weight: number;
  /** Whether the shard is currently healthy */
  readonly isHealthy: boolean;
  /** Timestamp of the last health check */
  readonly lastHealthCheck: Date;
  /** Current number of connections */
  readonly connectionCount: number;
  /** Current load factor (0-1) */
  readonly loadFactor: number;
}

// ============================================================================
// BENCHMARK TYPES
// ============================================================================

/**
 * Benchmark results
 * @interface BenchmarkResults
 * @description Results from cache benchmark operations
 */
export interface BenchmarkResults {
  /** Total duration in milliseconds */
  readonly duration: number;
  /** Operations per second */
  readonly operationsPerSecond: number;
  /** Average operation latency in milliseconds */
  readonly averageLatency: number;
  /** Operation-specific metrics */
  readonly operations: {
    /** SET operation metrics */
    readonly set: OperationMetrics;
    /** GET operation metrics */
    readonly get: OperationMetrics;
    /** DEL operation metrics */
    readonly del: OperationMetrics;
  };
}

/**
 * Operation metrics
 * @interface OperationMetrics
 * @description Metrics for a specific cache operation
 */
export interface OperationMetrics {
  /** Duration in milliseconds */
  readonly duration: number;
  /** Operations per second */
  readonly operationsPerSecond: number;
  /** Average latency in milliseconds */
  readonly averageLatency: number;
}

// ============================================================================
// CONFIGURATION UPDATE TYPES
// ============================================================================

/**
 * Cache configuration update
 * @interface CacheConfigUpdate
 * @description Configuration update payload
 */
export interface CacheConfigUpdate {
  /** Default TTL in seconds for new cache entries */
  readonly defaultTtl?: number;
  /** Rate limit configurations by type */
  readonly rateLimits?: Record<string, CacheRateLimitConfig>;
  /** Policy for memory management */
  readonly maxMemoryPolicy?:
    | 'noeviction'
    | 'allkeys-lru'
    | 'volatile-lru'
    | 'allkeys-random'
    | 'volatile-random';
}
