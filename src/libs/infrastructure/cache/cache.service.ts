/**
 * Cache Service
 * @class CacheService
 * @description Main cache service using new architecture (SOLID, DRY, KISS)
 *
 * This is the SINGLE ENTRY POINT for all cache operations.
 * Provider-agnostic: works with Redis, Dragonfly, or any cache provider.
 * Provider is selected via configuration (CACHE_PROVIDER environment variable).
 */

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
// IMPORTANT: avoid importing from the @config barrel in infra boot code (SWC TDZ/cycles).
import { ConfigService } from '@config/config.service';

// Interfaces - Centralized
import type { IAdvancedCacheProvider } from '@core/types';

// Services
import { CacheRepository } from '@infrastructure/cache/repositories/cache.repository';
import { CacheKeyFactory } from '@infrastructure/cache/factories/cache-key.factory';
import { CircuitBreakerService } from '@core/resilience/circuit-breaker.service';
import { CacheMetricsService } from '@infrastructure/cache/services/cache-metrics.service';
import { FeatureFlagsService } from '@infrastructure/cache/services/feature-flags.service';
import { CacheVersioningService } from '@infrastructure/cache/services/cache-versioning.service';
import { CacheHealthMonitorService } from '@infrastructure/cache/services/cache-health-monitor.service';
import { CacheErrorHandler } from '@core/errors';
import { CacheOptionsBuilder } from '@infrastructure/cache/builders/cache-options.builder';
import { CacheProviderFactory } from '@infrastructure/cache/providers/cache-provider.factory';

// Multi-Layer Cache (L1) - Optional
import { InMemoryCacheService } from '@infrastructure/cache/layers/in-memory-cache.service';

// Types
import type { CacheOperationOptions, HealthcareCacheConfig } from '@core/types';
import { LogType, LogLevel } from '@core/types';
import type { LoggerLike } from '@core/types';

/**
 * Main cache service - single entry point for all cache operations
 *
 * Architecture:
 * - Uses Repository pattern for cache operations
 * - Uses Strategy pattern for different cache behaviors
 * - Uses Factory pattern for key generation and provider selection
 * - Uses Chain of Responsibility for middleware
 * - Provider-agnostic: works with Redis, Dragonfly, or any cache provider
 * - Follows SOLID principles
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private config!: HealthcareCacheConfig;
  private advancedProvider!: IAdvancedCacheProvider;

  private enableL1: boolean;
  private l1TTL: number;

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => CacheRepository))
    private readonly cacheRepository: CacheRepository,
    @Inject(CacheKeyFactory)
    private readonly keyFactory: CacheKeyFactory,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly metrics: CacheMetricsService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly versioning: CacheVersioningService,
    @Inject(forwardRef(() => CacheHealthMonitorService))
    private readonly healthMonitor: CacheHealthMonitorService,
    @Inject(forwardRef(() => CacheErrorHandler))
    private readonly errorHandler: CacheErrorHandler,
    @Inject(forwardRef(() => CacheProviderFactory))
    private readonly providerFactory: CacheProviderFactory,
    // Use string token to avoid importing LoggingService (prevents SWC TDZ circular-import issues)
    @Inject('LOGGING_SERVICE')
    private readonly loggingService: LoggerLike,
    @Optional()
    @Inject(forwardRef(() => InMemoryCacheService))
    private readonly l1CacheService: InMemoryCacheService | null
  ) {
    // Don't load config in constructor - wait for onModuleInit
    // ConfigService might not be fully initialized yet
    // L1 cache configuration will be loaded in onModuleInit
    this.enableL1 = false; // Will be set in onModuleInit
    this.l1TTL = 30; // Default, will be overridden in onModuleInit
  }

  async onModuleInit(): Promise<void> {
    // Load config after module initialization when all dependencies are ready
    this.config = this.loadConfig();
    this.advancedProvider = this.providerFactory.getProvider();

    // Load L1 cache configuration
    this.enableL1 = this.configService.getEnvBoolean('L1_CACHE_ENABLED', true);
    this.l1TTL = this.configService.getEnvNumber('L1_CACHE_DEFAULT_TTL', 30);

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Cache Service initialized with new architecture',
      'CacheService',
      {
        features: this.featureFlags.getFlags(),
        version: this.versioning.getCurrentVersion(),
        l1CacheEnabled: this.enableL1 && this.l1CacheService !== null,
        multiLayer: this.enableL1 && this.l1CacheService !== null,
      }
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Cache Service shutting down',
      'CacheService',
      {}
    );
  }

  /**
   * Load configuration
   * Safe to call even if ConfigService is not fully initialized
   */
  private loadConfig(): HealthcareCacheConfig {
    // Use ConfigService (which uses dotenv) for all environment variable access
    const getConfig = <T>(key: string, defaultValue: T): T => {
      try {
        if (typeof defaultValue === 'number') {
          return this.configService.getEnvNumber(key, defaultValue as number) as unknown as T;
        }
        if (typeof defaultValue === 'boolean') {
          return this.configService.getEnvBoolean(key, defaultValue as boolean) as unknown as T;
        }
        return this.configService.getEnv(key, defaultValue as string) as unknown as T;
      } catch {
        // Defensive fallback - should rarely be needed
        return defaultValue;
      }
    };

    return {
      patientRecordsTTL: getConfig('CACHE_PATIENT_RECORDS_TTL', 3600),
      appointmentsTTL: getConfig('CACHE_APPOINTMENTS_TTL', 1800),
      doctorProfilesTTL: getConfig('CACHE_DOCTOR_PROFILES_TTL', 7200),
      clinicDataTTL: getConfig('CACHE_CLINIC_DATA_TTL', 14400),
      medicalHistoryTTL: getConfig('CACHE_MEDICAL_HISTORY_TTL', 7200),
      prescriptionsTTL: getConfig('CACHE_PRESCRIPTIONS_TTL', 1800),
      emergencyDataTTL: getConfig('CACHE_EMERGENCY_DATA_TTL', 300),
      enableCompression: getConfig('CACHE_ENABLE_COMPRESSION', true),
      enableMetrics: getConfig('CACHE_ENABLE_METRICS', true),
      defaultTTL: getConfig('CACHE_DEFAULT_TTL', 3600),
      maxCacheSize: getConfig('CACHE_MAX_SIZE_MB', 1024),
      enableBatchOperations: getConfig('CACHE_ENABLE_BATCH', true),
      compressionThreshold: getConfig('CACHE_COMPRESSION_THRESHOLD', 1024),
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
      shardingEnabled: getConfig('CACHE_SHARDING_ENABLED', false),
      replicationEnabled: getConfig('CACHE_REPLICATION_ENABLED', false),
      memoryOptimizationEnabled: getConfig('CACHE_MEMORY_OPTIMIZATION_ENABLED', true),
      performanceMonitoringEnabled: getConfig('CACHE_PERFORMANCE_MONITORING_ENABLED', true),
      autoScalingEnabled: getConfig('CACHE_AUTO_SCALING_ENABLED', false),
      cacheWarmingEnabled: getConfig('CACHE_WARMING_ENABLED', false),
      predictiveCachingEnabled: getConfig('CACHE_PREDICTIVE_ENABLED', false),
      compressionLevel: getConfig('CACHE_COMPRESSION_LEVEL', 6),
      encryptionEnabled: getConfig('CACHE_ENCRYPTION_ENABLED', true),
      auditLoggingEnabled: getConfig('CACHE_AUDIT_LOGGING_ENABLED', true),
    };
  }

  // ===== MAIN CACHE METHOD - Single entry point =====

  /**
   * Ensure config is initialized (lazy initialization)
   */
  private ensureConfigInitialized(): void {
    if (!this.config) {
      this.config = this.loadConfig();
    }
    if (!this.advancedProvider) {
      this.advancedProvider = this.providerFactory.getProvider();
    }
  }

  /**
   * Get advanced provider with lazy initialization
   */
  private getProvider(): IAdvancedCacheProvider {
    this.ensureConfigInitialized();
    return this.advancedProvider;
  }

  /**
   * Get config with lazy initialization
   */
  private getConfig(): HealthcareCacheConfig {
    this.ensureConfigInitialized();
    return this.config;
  }

  /**
   * Cache data with automatic fetch on miss
   * This is the main method to use for all caching needs
   *
   * Now supports multi-layer caching (L1 → L2 → L3):
   * - L1: In-memory cache (fastest, process-local)
   * - L2: Distributed cache (Redis/Dragonfly - this service)
   * - L3: Database (via fetchFn)
   */
  async cache<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions = {}
  ): Promise<T> {
    // Ensure config is initialized
    try {
      this.ensureConfigInitialized();
    } catch (_configError) {
      // If config initialization fails, fall back to direct fetch
      return await fetchFn();
    }

    // Check if cacheRepository is available
    if (!this.cacheRepository) {
      // Cache repository not available - fall back to direct fetch
      return await fetchFn();
    }

    const startTime = Date.now();

    try {
      // Check circuit breaker
      if (!this.circuitBreaker?.canExecute()) {
        // Circuit breaker is open or unavailable - fall back to direct fetch
        const responseTime = Date.now() - startTime;
        if (this.metrics) {
          this.metrics.recordOperation(true, responseTime, false);
        }
        return await fetchFn();
      }

      // L1: Check in-memory cache first (if enabled)
      if (this.enableL1 && this.l1CacheService && !options.forceRefresh) {
        const l1Value = this.l1CacheService.get<T>(key);
        if (l1Value !== null) {
          // L1 hit - return immediately (fastest path)
          const responseTime = Date.now() - startTime;
          if (this.metrics) {
            this.metrics.recordOperation(true, responseTime, true);
          }
          if (this.circuitBreaker) {
            this.circuitBreaker.recordSuccess();
          }
          return l1Value;
        }
      }

      // Check if key exists before executing strategy (for hit tracking)
      let keyExists = false;
      try {
        keyExists = !options.forceRefresh && (await this.cacheRepository.exists(key));
      } catch (_existsError) {
        // If exists check fails, continue with cache operation (will be treated as miss)
        keyExists = false;
      }

      // Execute cache operation (strategy handles hit/miss, stale data, SWR internally)
      // This is L2 (distributed cache)
      const result = await this.cacheRepository.cache(key, fetchFn, options);

      // Populate L1 after L2 cache operation (if enabled)
      if (this.enableL1 && this.l1CacheService) {
        // Use shorter TTL for L1 (typically 30s) vs L2 (longer TTL from options)
        const l1TTL = options.ttl ? Math.min(options.ttl, this.l1TTL) : this.l1TTL;
        this.l1CacheService.set(key, result, l1TTL);
      }

      // Record success with hit/miss tracking
      if (this.circuitBreaker) {
        this.circuitBreaker.recordSuccess();
      }
      const responseTime = Date.now() - startTime;
      if (this.metrics) {
        // Note: For SWR, if key existed it's considered a hit even if revalidated
        this.metrics.recordOperation(true, responseTime, keyExists);
      }

      return result;
    } catch (error) {
      // Record failure
      if (this.circuitBreaker) {
        this.circuitBreaker.recordFailure();
      }
      const responseTime = Date.now() - startTime;
      if (this.metrics) {
        this.metrics.recordOperation(false, responseTime, false);
      }

      // Handle error with graceful degradation
      if (this.errorHandler) {
        try {
          return await this.errorHandler.handleWithFallback(
            error,
            { operation: 'cache', key },
            fetchFn
          );
        } catch (_fallbackError) {
          // If error handler fails, fall back to direct fetch
          return await fetchFn();
        }
      } else {
        // No error handler available - fall back to direct fetch
        return await fetchFn();
      }
    }
  }

  // ===== HEALTHCARE-SPECIFIC METHODS =====

  /**
   * Cache patient records
   */
  async cachePatientRecords<T>(
    patientId: string,
    clinicId: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions = {}
  ): Promise<T> {
    const key = this.keyFactory.patient(patientId, clinicId, 'records');
    const builder = CacheOptionsBuilder.forPatient();
    const finalOptions = { ...builder.build(), ...options };
    return this.cache(key, fetchFn, finalOptions);
  }

  /**
   * Cache medical history
   */
  async cacheMedicalHistory<T>(
    patientId: string,
    clinicId: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions = {}
  ): Promise<T> {
    this.ensureConfigInitialized();
    const key = this.keyFactory.medicalHistory(patientId, clinicId);
    const builder = CacheOptionsBuilder.forPHI().ttl(this.getConfig().medicalHistoryTTL);
    const finalOptions = { ...builder.build(), ...options };
    return this.cache(key, fetchFn, finalOptions);
  }

  /**
   * Cache emergency data
   */
  async cacheEmergencyData<T>(
    patientId: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions = {}
  ): Promise<T> {
    const key = this.keyFactory.emergencyContacts(patientId);
    const builder = CacheOptionsBuilder.forEmergency();
    const finalOptions = { ...builder.build(), ...options };
    return this.cache(key, fetchFn, finalOptions);
  }

  /**
   * Cache prescriptions
   */
  async cachePrescriptions<T>(
    patientId: string,
    clinicId: string,
    fetchFn: () => Promise<T>,
    options: CacheOperationOptions = {}
  ): Promise<T> {
    const key = this.keyFactory.prescription(patientId, clinicId);
    const builder = CacheOptionsBuilder.forPHI().ttl(this.getConfig().prescriptionsTTL);
    const finalOptions = { ...builder.build(), ...options };
    return this.cache(key, fetchFn, finalOptions);
  }

  // ===== BASIC OPERATIONS =====

  async get<T>(key: string): Promise<T | null> {
    this.ensureConfigInitialized();

    // L1: Check in-memory cache first (if enabled)
    if (this.enableL1 && this.l1CacheService) {
      const l1Value = this.l1CacheService.get<T>(key);
      if (l1Value !== null) {
        return l1Value;
      }
    }

    // L2: Check distributed cache
    const l2Value = await this.cacheRepository.get<T>(key);

    // Populate L1 if L2 hit
    if (l2Value !== null && this.enableL1 && this.l1CacheService) {
      this.l1CacheService.set(key, l2Value, this.l1TTL);
    }

    return l2Value;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    this.ensureConfigInitialized();
    const options: CacheOperationOptions = ttl !== undefined ? { ttl } : {};

    // Set in L2 (distributed cache)
    await this.cacheRepository.set(key, value, options);

    // Set in L1 (in-memory cache) with shorter TTL
    if (this.enableL1 && this.l1CacheService) {
      const l1TTL = ttl ? Math.min(ttl, this.l1TTL) : this.l1TTL;
      this.l1CacheService.set(key, value, l1TTL);
    }
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    if (keys.length === 1) {
      const key = keys[0];
      if (!key) {
        return 0;
      }
      const deleted = await this.cacheRepository.delete(key);
      return deleted ? 1 : 0;
    }
    return this.cacheRepository.deleteMultiple(keys);
  }

  async exists(key: string): Promise<boolean> {
    return this.cacheRepository.exists(key);
  }

  async ttl(key: string): Promise<number> {
    return this.cacheRepository.getTTL(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.getProvider().expire(key, seconds);
  }

  // ===== INVALIDATION METHODS =====

  async invalidateCache(key: string): Promise<boolean> {
    return this.cacheRepository.delete(key);
  }

  async invalidateCacheByPattern(pattern: string): Promise<number> {
    // Invalidate L2 (distributed cache)
    const count = await this.cacheRepository.invalidateByPattern(pattern);

    // L1 doesn't support pattern matching, so clear it entirely
    // This is acceptable since L1 is small and fast to rebuild
    if (this.enableL1 && this.l1CacheService) {
      this.l1CacheService.clear();
    }

    return count;
  }

  async invalidateByPattern(pattern: string): Promise<number> {
    return this.invalidateCacheByPattern(pattern);
  }

  async delPattern(pattern: string): Promise<number> {
    return this.invalidateCacheByPattern(pattern);
  }

  async invalidateCacheByTag(tag: string): Promise<number> {
    // Invalidate L2 (distributed cache)
    const count = await this.cacheRepository.invalidateByTags([tag]);

    // L1 doesn't support tags, so clear it entirely
    if (this.enableL1 && this.l1CacheService) {
      this.l1CacheService.clear();
    }

    return count;
  }

  async invalidatePatientCache(patientId: string, clinicId?: string): Promise<number> {
    const pattern = clinicId
      ? this.keyFactory.patient(patientId, clinicId, '*')
      : this.keyFactory.patient(patientId, undefined, '*');
    return this.invalidateCacheByPattern(pattern);
  }

  async invalidateDoctorCache(doctorId: string, clinicId?: string): Promise<number> {
    const pattern = clinicId
      ? this.keyFactory.doctor(doctorId, clinicId, '*')
      : this.keyFactory.doctor(doctorId, undefined, '*');
    return this.invalidateCacheByPattern(pattern);
  }

  async invalidateAppointmentCache(
    appointmentId: string,
    _patientId?: string,
    _doctorId?: string,
    _clinicId?: string
  ): Promise<number> {
    const pattern = this.keyFactory.appointment(appointmentId, '*');
    return this.invalidateCacheByPattern(pattern);
  }

  async invalidateClinicCache(clinicId: string): Promise<number> {
    const pattern = this.keyFactory.clinic(clinicId, '*');
    return this.invalidateCacheByPattern(pattern);
  }

  async clearPHICache(): Promise<number> {
    return this.invalidateCacheByTag('phi_data');
  }

  // ===== METRICS & MONITORING =====

  getCacheMetrics() {
    return this.metrics.getMetrics();
  }

  async getCacheMetricsAsync(): Promise<import('@core/types').CacheMetrics> {
    return this.getProvider().getCacheMetrics();
  }

  getCircuitBreakerState() {
    return this.circuitBreaker.getState();
  }

  // ===== KEY FACTORY ACCESS =====

  getKeyFactory(): CacheKeyFactory {
    return this.keyFactory;
  }

  // ===== OPTIONS BUILDER ACCESS =====

  static createOptionsBuilder(): CacheOptionsBuilder {
    return new CacheOptionsBuilder();
  }

  // ===== RATE LIMITING METHODS =====

  async isRateLimited(
    key: string,
    limit?: number,
    windowSeconds?: number,
    options: {
      burst?: number;
      cost?: number;
      bypassDev?: boolean;
    } = {}
  ): Promise<boolean> {
    try {
      return await this.getProvider().isRateLimited(key, limit, windowSeconds, options);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('circuit breaker')) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Rate limit check failed - failing open',
          'CacheService',
          { key, error: errorMessage }
        );
      }
      return false; // Fail open
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
      return await this.getProvider().getRateLimit(key, limit, windowSeconds);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('circuit breaker')) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Rate limit get failed',
          'CacheService',
          { key, error: errorMessage }
        );
      }
      return {
        remaining: limit || 999999,
        reset: 0,
        total: limit || 999999,
        used: 0,
      };
    }
  }

  async clearRateLimit(key: string): Promise<void> {
    return this.getProvider().clearRateLimit(key);
  }

  updateRateLimits(type: string, config: { limit: number; window: number }): Promise<void> {
    return this.getProvider().updateRateLimits(type, config);
  }

  getRateLimitConfig(type?: string): unknown {
    return this.getProvider().getRateLimitConfig(type);
  }

  // ===== HEALTH AND MONITORING =====

  /**
   * Health check using optimized health monitor
   * Uses dedicated health check with timeout protection and caching
   */
  async healthCheck(): Promise<boolean> {
    const healthStatus = await this.healthMonitor.getHealthStatus();
    return healthStatus.healthy;
  }

  /**
   * Get health status with latency
   * Uses optimized health monitor for real-time status
   */
  async getHealthStatus(): Promise<[boolean, number]> {
    const healthStatus = await this.healthMonitor.getHealthStatus();
    return [healthStatus.healthy, healthStatus.connection.latency || 0];
  }

  async getCacheStats(): Promise<{ hits: number; misses: number }> {
    return this.getProvider().getCacheStats();
  }

  async getCacheHealth(): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    memoryUsage: number;
    hitRate: number;
    connectionStatus: boolean;
    lastHealthCheck: Date;
  }> {
    try {
      const connectionStatus = await this.getProvider().isHealthy();
      const stats = await this.getProvider().getCacheStats();
      const hitRate = stats.hits / (stats.hits + stats.misses) || 0;

      let status: 'healthy' | 'warning' | 'critical' = 'healthy';
      if (hitRate < 0.7) status = 'warning';
      if (hitRate < 0.5 || !connectionStatus) status = 'critical';

      return {
        status,
        memoryUsage: 0,
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
        { error: error instanceof Error ? error.message : 'Unknown error' }
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

  async clearAllCache(): Promise<number> {
    return this.getProvider().clearAllCache();
  }

  async clearCache(pattern?: string): Promise<number> {
    return this.getProvider().clearByPattern(pattern || '*');
  }

  async resetCacheStats(): Promise<void> {
    return this.getProvider().resetCacheStats();
  }

  async getCacheDebug(): Promise<unknown> {
    return this.getProvider().getCacheDebug();
  }

  // ===== SECURITY AND AUDIT =====

  async trackSecurityEvent(identifier: string, eventType: string, details: unknown): Promise<void> {
    return this.getProvider().trackSecurityEvent(identifier, eventType, details);
  }

  async getSecurityEvents(identifier: string, limit?: number): Promise<unknown[]> {
    return this.getProvider().getSecurityEvents(identifier, limit);
  }

  async clearSecurityEvents(identifier: string): Promise<void> {
    return this.getProvider().clearSecurityEvents(identifier);
  }

  // ===== BATCH OPERATIONS =====

  async batchGet<T>(keys: string[]): Promise<Map<string, T | null>> {
    return this.cacheRepository.getMultiple<T>(keys);
  }

  async batchSet<T>(keyValuePairs: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    await this.cacheRepository.setMultiple(keyValuePairs);
  }

  async batchDelete(keys: string[]): Promise<number> {
    return this.cacheRepository.deleteMultiple(keys);
  }

  async delete(key: string): Promise<boolean> {
    // Delete from L2 (distributed cache)
    const deleted = await this.cacheRepository.delete(key);

    // Delete from L1 (in-memory cache)
    if (this.enableL1 && this.l1CacheService) {
      this.l1CacheService.delete(key);
    }

    return deleted;
  }

  // ===== HASH OPERATIONS =====

  async hSet(key: string, field: string, value: string): Promise<number> {
    return this.getProvider().hSet(key, field, value);
  }

  async hGet(key: string, field: string): Promise<string | null> {
    return this.getProvider().hGet(key, field);
  }

  async hDel(key: string, field: string): Promise<number> {
    return this.getProvider().hDel(key, field);
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return this.getProvider().hGetAll(key);
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.getProvider().hincrby(key, field, increment);
  }

  // ===== SET OPERATIONS =====

  async sAdd(key: string, ...members: string[]): Promise<number> {
    return this.getProvider().sAdd(key, ...members);
  }

  async sMembers(key: string): Promise<string[]> {
    return this.getProvider().sMembers(key);
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    return this.getProvider().sRem(key, ...members);
  }

  async sCard(key: string): Promise<number> {
    return this.getProvider().sCard(key);
  }

  // ===== LIST OPERATIONS =====

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    return this.getProvider().lRange(key, start, stop);
  }

  async lLen(key: string): Promise<number> {
    return this.getProvider().lLen(key);
  }

  async rPush(key: string, value: string): Promise<number> {
    return this.getProvider().rPush(key, value);
  }

  async lTrim(key: string, start: number, stop: number): Promise<string> {
    return this.getProvider().lTrim(key, start, stop);
  }

  // ===== SORTED SET OPERATIONS =====

  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.getProvider().zadd(key, score, member);
  }

  async zcard(key: string): Promise<number> {
    return this.getProvider().zcard(key);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.getProvider().zrevrange(key, start, stop);
  }

  async zrangebyscore(key: string, min: string | number, max: string | number): Promise<string[]> {
    return this.getProvider().zrangebyscore(key, min, max);
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    return this.getProvider().zremrangebyscore(key, min, max);
  }

  // ===== PUB/SUB OPERATIONS =====

  async publish(channel: string, message: string): Promise<number> {
    return this.getProvider().publish(channel, message);
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    return this.getProvider().subscribe(channel, callback);
  }

  // ===== UTILITY OPERATIONS =====

  async expireAt(key: string, timestamp: number): Promise<number> {
    return this.getProvider().expireAt(key, timestamp);
  }

  async incr(key: string): Promise<number> {
    return this.getProvider().incr(key);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.getProvider().keys(pattern);
  }

  async multi(
    commands: Array<{ command: string; args: unknown[] }>
  ): Promise<Array<[Error | null, unknown]>> {
    return this.getProvider().multi(commands);
  }

  async retryOperation<T>(operation: () => Promise<T>): Promise<T> {
    return this.getProvider().retryOperation(operation);
  }

  async ping(): Promise<string> {
    return this.getProvider().ping();
  }

  // ===== CACHE WARMING =====

  async warmClinicCache(clinicId: string): Promise<void> {
    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.INFO,
      'Starting cache warming for clinic',
      'CacheService',
      { clinicId }
    );

    try {
      const clinicInfoKey = this.keyFactory.clinic(clinicId, 'info');
      await this.set(
        clinicInfoKey,
        {
          id: clinicId,
          name: 'Clinic',
          status: 'active',
        },
        this.getConfig().clinicDataTTL
      );

      const doctorsKey = this.keyFactory.clinic(clinicId, 'doctors');
      await this.set(doctorsKey, [], this.getConfig().doctorProfilesTTL);

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
        }
      );
      throw error;
    }
  }

  /**
   * Warm healthcare-specific caches
   * This method is a convenience wrapper that delegates to CacheWarmingService
   * For comprehensive warming, use CacheWarmingService directly
   *
   * @param clinicId - Clinic ID to warm caches for
   */
  async warmHealthcareCache(clinicId: string): Promise<void> {
    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.INFO,
      'Healthcare cache warming initiated',
      'CacheService',
      { clinicId }
    );

    // Delegate to warmClinicCache which handles healthcare-specific warming
    await this.warmClinicCache(clinicId);

    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.INFO,
      'Healthcare cache warming completed',
      'CacheService',
      { clinicId }
    );
  }
}
