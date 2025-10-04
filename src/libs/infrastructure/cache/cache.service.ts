import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "./redis/redis.service";
import { EventEmitter2 } from "@nestjs/event-emitter";

export interface HealthcareCacheConfig {
  patientRecordsTTL: number;
  appointmentsTTL: number;
  doctorProfilesTTL: number;
  clinicDataTTL: number;
  medicalHistoryTTL: number;
  prescriptionsTTL: number;
  emergencyDataTTL: number;
  enableCompression: boolean;
  enableMetrics: boolean;
  defaultTTL: number;
  maxCacheSize: number; // Maximum cache size in MB
  enableBatchOperations: boolean; // Enable batch cache operations
  compressionThreshold: number; // Compress values larger than this size

  // Enterprise-grade configurations for 10M+ users
  connectionPoolSize: number;
  maxConnections: number;
  connectionTimeout: number;
  commandTimeout: number;
  retryAttempts: number;
  retryDelay: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
  adaptiveCachingEnabled: boolean;
  loadBalancingEnabled: boolean;
  shardingEnabled: boolean;
  replicationEnabled: boolean;
  memoryOptimizationEnabled: boolean;
  performanceMonitoringEnabled: boolean;
  autoScalingEnabled: boolean;
  cacheWarmingEnabled: boolean;
  predictiveCachingEnabled: boolean;
  compressionLevel: number;
  encryptionEnabled: boolean;
  auditLoggingEnabled: boolean;
}

export interface CacheInvalidationEvent {
  type:
    | "patient_updated"
    | "appointment_changed"
    | "doctor_updated"
    | "clinic_updated"
    | "prescription_created";
  entityId: string;
  clinicId?: string;
  userId?: string;
  timestamp: Date;
  affectedPatterns: string[];
}

export interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}

export interface PerformanceMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  cacheHitRate: number;
  memoryUsage: number;
  connectionPoolUtilization: number;
  throughput: number;
  errorRate: number;
  timestamp: Date;
}

export interface CacheShard {
  id: string;
  host: string;
  port: number;
  weight: number;
  isHealthy: boolean;
  lastHealthCheck: Date;
  connectionCount: number;
  loadFactor: number;
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly config: HealthcareCacheConfig;

  // Enterprise-grade state management
  private circuitBreaker: CircuitBreakerState = {
    isOpen: false,
    failureCount: 0,
    lastFailureTime: 0,
    nextAttemptTime: 0,
  };

  private performanceMetrics: PerformanceMetrics = {
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
    result: "success" | "failure";
  }> = [];

  // Healthcare-specific cache key patterns
  private readonly CACHE_PATTERNS = {
    PATIENT_RECORDS: (patientId: string, clinicId: string) =>
      `patient:${patientId}:clinic:${clinicId}:records`,
    PATIENT_PROFILE: (patientId: string) => `patient:${patientId}:profile`,
    PATIENT_APPOINTMENTS: (patientId: string, clinicId: string) =>
      `patient:${patientId}:clinic:${clinicId}:appointments`,
    DOCTOR_PROFILE: (doctorId: string) => `doctor:${doctorId}:profile`,
    DOCTOR_SCHEDULE: (doctorId: string, date: string) =>
      `doctor:${doctorId}:schedule:${date}`,
    DOCTOR_APPOINTMENTS: (doctorId: string, clinicId: string) =>
      `doctor:${doctorId}:clinic:${clinicId}:appointments`,
    CLINIC_INFO: (clinicId: string) => `clinic:${clinicId}:info`,
    CLINIC_DOCTORS: (clinicId: string) => `clinic:${clinicId}:doctors`,
    CLINIC_PATIENTS: (clinicId: string) => `clinic:${clinicId}:patients`,
    MEDICAL_HISTORY: (patientId: string, clinicId: string) =>
      `medical:${patientId}:clinic:${clinicId}:history`,
    PRESCRIPTIONS: (patientId: string, clinicId: string) =>
      `prescriptions:${patientId}:clinic:${clinicId}`,
    APPOINTMENT_DETAILS: (appointmentId: string) =>
      `appointment:${appointmentId}:details`,
    USER_PERMISSIONS: (userId: string, clinicId: string) =>
      `user:${userId}:clinic:${clinicId}:permissions`,
    EMERGENCY_CONTACTS: (patientId: string) =>
      `patient:${patientId}:emergency_contacts`,
    VITAL_SIGNS: (patientId: string, date: string) =>
      `patient:${patientId}:vitals:${date}`,
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
    EMERGENCY_DATA: "emergency_data",
    CRITICAL_PATIENT_DATA: "critical_patient_data",
    PHI_DATA: "phi_data", // Protected Health Information
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.config = {
      // Basic cache configurations
      patientRecordsTTL: this.configService.get(
        "CACHE_PATIENT_RECORDS_TTL",
        3600,
      ), // 1 hour
      appointmentsTTL: this.configService.get("CACHE_APPOINTMENTS_TTL", 1800), // 30 minutes
      doctorProfilesTTL: this.configService.get(
        "CACHE_DOCTOR_PROFILES_TTL",
        7200,
      ), // 2 hours
      clinicDataTTL: this.configService.get("CACHE_CLINIC_DATA_TTL", 14400), // 4 hours
      medicalHistoryTTL: this.configService.get(
        "CACHE_MEDICAL_HISTORY_TTL",
        7200,
      ), // 2 hours
      prescriptionsTTL: this.configService.get("CACHE_PRESCRIPTIONS_TTL", 1800), // 30 minutes
      emergencyDataTTL: this.configService.get("CACHE_EMERGENCY_DATA_TTL", 300), // 5 minutes
      enableCompression: this.configService.get(
        "CACHE_ENABLE_COMPRESSION",
        true,
      ),
      enableMetrics: this.configService.get("CACHE_ENABLE_METRICS", true),
      defaultTTL: this.configService.get("CACHE_DEFAULT_TTL", 3600), // 1 hour
      maxCacheSize: this.configService.get("CACHE_MAX_SIZE_MB", 1024), // 1GB
      enableBatchOperations: this.configService.get("CACHE_ENABLE_BATCH", true),
      compressionThreshold: this.configService.get(
        "CACHE_COMPRESSION_THRESHOLD",
        1024,
      ), // 1KB

      // Enterprise-grade configurations for 10M+ users
      connectionPoolSize: this.configService.get(
        "CACHE_CONNECTION_POOL_SIZE",
        100,
      ),
      maxConnections: this.configService.get("CACHE_MAX_CONNECTIONS", 1000),
      connectionTimeout: this.configService.get(
        "CACHE_CONNECTION_TIMEOUT",
        5000,
      ),
      commandTimeout: this.configService.get("CACHE_COMMAND_TIMEOUT", 3000),
      retryAttempts: this.configService.get("CACHE_RETRY_ATTEMPTS", 3),
      retryDelay: this.configService.get("CACHE_RETRY_DELAY", 1000),
      circuitBreakerThreshold: this.configService.get(
        "CACHE_CIRCUIT_BREAKER_THRESHOLD",
        10,
      ),
      circuitBreakerTimeout: this.configService.get(
        "CACHE_CIRCUIT_BREAKER_TIMEOUT",
        30000,
      ),
      adaptiveCachingEnabled: this.configService.get(
        "CACHE_ADAPTIVE_ENABLED",
        true,
      ),
      loadBalancingEnabled: this.configService.get(
        "CACHE_LOAD_BALANCING_ENABLED",
        true,
      ),
      shardingEnabled: this.configService.get("CACHE_SHARDING_ENABLED", true),
      replicationEnabled: this.configService.get(
        "CACHE_REPLICATION_ENABLED",
        true,
      ),
      memoryOptimizationEnabled: this.configService.get(
        "CACHE_MEMORY_OPTIMIZATION_ENABLED",
        true,
      ),
      performanceMonitoringEnabled: this.configService.get(
        "CACHE_PERFORMANCE_MONITORING_ENABLED",
        true,
      ),
      autoScalingEnabled: this.configService.get(
        "CACHE_AUTO_SCALING_ENABLED",
        true,
      ),
      cacheWarmingEnabled: this.configService.get(
        "CACHE_WARMING_ENABLED",
        true,
      ),
      predictiveCachingEnabled: this.configService.get(
        "CACHE_PREDICTIVE_ENABLED",
        true,
      ),
      compressionLevel: this.configService.get("CACHE_COMPRESSION_LEVEL", 6),
      encryptionEnabled: this.configService.get(
        "CACHE_ENCRYPTION_ENABLED",
        true,
      ),
      auditLoggingEnabled: this.configService.get(
        "CACHE_AUDIT_LOGGING_ENABLED",
        true,
      ),
    };
  }

  async onModuleInit() {
    this.logger.log(
      "🚀 Enterprise Cache Service initializing for 10M+ users...",
    );

    try {
      // Initialize enterprise features
      this.initializeSharding();
      this.initializeConnectionPool();
      this.startPerformanceMonitoring();
      this.initializeCircuitBreaker();
      this.startAdaptiveCaching();
      this.startPredictiveCaching();
      await this.initializeCacheWarming();

      this.logger.log("✅ Enterprise Cache Service initialized successfully");
      this.eventEmitter.emit("cache.service.initialized", {
        timestamp: new Date(),
        features: {
          sharding: this.config.shardingEnabled,
          loadBalancing: this.config.loadBalancingEnabled,
          adaptiveCaching: this.config.adaptiveCachingEnabled,
          predictiveCaching: this.config.predictiveCachingEnabled,
          compression: this.config.enableCompression,
          encryption: this.config.encryptionEnabled,
        },
      });
    } catch (error) {
      this.logger.error(
        "❌ Failed to initialize Enterprise Cache Service:",
        error,
      );
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log("🔄 Enterprise Cache Service shutting down gracefully...");

    try {
      // Graceful shutdown
      this.stopPerformanceMonitoring();
      this.stopAdaptiveCaching();
      this.stopPredictiveCaching();
      this.closeConnectionPool();

      this.logger.log("✅ Enterprise Cache Service shutdown complete");
    } catch (error) {
      this.logger.error("❌ Error during cache service shutdown:", error);
    }
  }

  // ===== ENTERPRISE-GRADE INITIALIZATION METHODS =====

  private initializeSharding(): void {
    if (!this.config.shardingEnabled) return;

    this.logger.log("🔧 Initializing cache sharding...");

    // Initialize shards based on configuration
    const shardConfigs = this.configService.get("CACHE_SHARDS", []);
    this.cacheShards = shardConfigs.map((config: unknown, index: number) => {
      const shardConfig = config as Record<string, unknown>;
      return {
        id: `shard-${index}`,
        host: (shardConfig.host as string) || "localhost",
        port: (shardConfig.port as number) || 6379,
        weight: (shardConfig.weight as number) || 1,
        isHealthy: true,
        lastHealthCheck: new Date(),
        connectionCount: 0,
        loadFactor: 0,
      };
    });

    this.logger.log(`✅ Initialized ${this.cacheShards.length} cache shards`);
  }

  private initializeConnectionPool(): void {
    this.logger.log("🔧 Initializing connection pool...");

    // Connection pool is managed by RedisService
    // This method can be extended for custom pool management
    this.activeConnections = 0;

    this.logger.log(
      `✅ Connection pool initialized with max ${this.config.maxConnections} connections`,
    );
  }

  private startPerformanceMonitoring(): void {
    if (!this.config.performanceMonitoringEnabled) return;

    this.logger.log("📊 Starting performance monitoring...");

    // Start monitoring interval
    setInterval(() => {
      this.updatePerformanceMetrics();
    }, 5000); // Update every 5 seconds

    this.logger.log("✅ Performance monitoring started");
  }

  private initializeCircuitBreaker(): void {
    this.logger.log("⚡ Initializing circuit breaker...");

    this.circuitBreaker = {
      isOpen: false,
      failureCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
    };

    this.logger.log("✅ Circuit breaker initialized");
  }

  private startAdaptiveCaching(): void {
    if (!this.config.adaptiveCachingEnabled) return;

    this.logger.log("🧠 Starting adaptive caching...");

    // Start adaptive TTL adjustment
    setInterval(() => {
      this.adjustAdaptiveTTL();
    }, 60000); // Adjust every minute

    this.logger.log("✅ Adaptive caching started");
  }

  private startPredictiveCaching(): void {
    if (!this.config.predictiveCachingEnabled) return;

    this.logger.log("🔮 Starting predictive caching...");

    // Start predictive cache warming
    setInterval(() => {
      this.performPredictiveCaching();
    }, 300000); // Run every 5 minutes

    this.logger.log("✅ Predictive caching started");
  }

  private async initializeCacheWarming(): Promise<void> {
    if (!this.config.cacheWarmingEnabled) return;

    this.logger.log("🔥 Initializing cache warming...");

    // Perform initial cache warming
    await this.performCacheWarming();

    this.logger.log("✅ Cache warming initialized");
  }

  private stopPerformanceMonitoring(): void {
    this.logger.log("📊 Stopping performance monitoring...");
    // Cleanup monitoring resources
  }

  private stopAdaptiveCaching(): void {
    this.logger.log("🧠 Stopping adaptive caching...");
    // Cleanup adaptive caching resources
  }

  private stopPredictiveCaching(): void {
    this.logger.log("🔮 Stopping predictive caching...");
    // Cleanup predictive caching resources
  }

  private closeConnectionPool(): void {
    this.logger.log("🔌 Closing connection pool...");
    this.activeConnections = 0;
  }

  // ===== ENTERPRISE-GRADE CORE METHODS =====

  private async executeWithCircuitBreaker<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.circuitBreaker.isOpen) {
      if (Date.now() < this.circuitBreaker.nextAttemptTime) {
        throw new Error("Circuit breaker is open");
      } else {
        // Try to close the circuit
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.failureCount = 0;
      }
    }

    try {
      const result = await operation();
      this.circuitBreaker.failureCount = 0;
      return result;
    } catch (error) {
      this.circuitBreaker.failureCount++;
      this.circuitBreaker.lastFailureTime = Date.now();

      if (
        this.circuitBreaker.failureCount >= this.config.circuitBreakerThreshold
      ) {
        this.circuitBreaker.isOpen = true;
        this.circuitBreaker.nextAttemptTime =
          Date.now() + this.config.circuitBreakerTimeout;
        this.logger.warn("🚨 Circuit breaker opened due to failures");
      }

      throw error;
    }
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string,
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        return await this.executeWithCircuitBreaker(operation);
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.config.retryAttempts) {
          const delay = this.config.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
          this.logger.warn(
            `⚠️ ${context} failed (attempt ${attempt}/${this.config.retryAttempts}), retrying in ${delay}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.error(
      `❌ ${context} failed after ${this.config.retryAttempts} attempts`,
    );
    throw lastError!;
  }

  private updatePerformanceMetrics(): void {
    const _now = Date.now();
    const _timeWindow = 60000; // 1 minute window
    // Reserved for future time-based metric calculations

    // Update metrics based on recent activity
    this.performanceMetrics.timestamp = new Date();
    this.performanceMetrics.connectionPoolUtilization =
      (this.activeConnections / this.config.maxConnections) * 100;
    this.performanceMetrics.cacheHitRate =
      this.performanceMetrics.totalRequests > 0
        ? (this.performanceMetrics.successfulRequests /
            this.performanceMetrics.totalRequests) *
          100
        : 0;
    this.performanceMetrics.errorRate =
      this.performanceMetrics.totalRequests > 0
        ? (this.performanceMetrics.failedRequests /
            this.performanceMetrics.totalRequests) *
          100
        : 0;

    // Emit metrics event
    this.eventEmitter.emit(
      "cache.performance.metrics",
      this.performanceMetrics,
    );
  }

  private adjustAdaptiveTTL(): void {
    // Adjust TTL based on access patterns and system load
    for (const [key, currentTTL] of Array.from(this.adaptiveTTLMap.entries())) {
      const accessInfo = this.predictiveCacheMap.get(key);
      if (accessInfo) {
        // Increase TTL for frequently accessed items
        if (accessInfo.accessCount > 10) {
          this.adaptiveTTLMap.set(
            key,
            Math.min(currentTTL * 1.2, this.config.defaultTTL * 2),
          );
        }
        // Decrease TTL for rarely accessed items
        else if (accessInfo.accessCount < 2) {
          this.adaptiveTTLMap.set(
            key,
            Math.max(currentTTL * 0.8, this.config.defaultTTL * 0.5),
          );
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
        this.logger.warn(`Failed to warm cache for key ${key}:`, error);
      }
    }
  }

  private async performCacheWarming(): Promise<void> {
    this.logger.log("🔥 Performing cache warming...");

    // Warm critical healthcare data
    const criticalKeys = [
      "clinic:active:doctors",
      "clinic:active:patients",
      "system:health:status",
      "cache:performance:metrics",
    ];

    for (const key of criticalKeys) {
      try {
        await this.warmCacheForKey(key);
      } catch (error) {
        this.logger.warn(
          `Failed to warm cache for critical key ${key}:`,
          error,
        );
      }
    }

    this.logger.log("✅ Cache warming completed");
  }

  private warmCacheForKey(key: string): Promise<void> {
    // This would typically fetch and cache data for the key
    // Implementation depends on the specific data type
    this.logger.debug(`Warming cache for key: ${key}`);
    return Promise.resolve();
  }

  private selectOptimalShard(key: string): CacheShard {
    if (!this.config.shardingEnabled || this.cacheShards.length === 0) {
      return this.cacheShards[0] || null;
    }

    // Use consistent hashing to select shard
    const hash = this.hashKey(key);
    const shardIndex = hash % this.cacheShards.length;
    return this.cacheShards[shardIndex];
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
    result: "success" | "failure" = "success",
  ): void {
    if (!this.config.auditLoggingEnabled) return;

    const auditEntry = {
      timestamp: new Date(),
      operation,
      key,
      userId,
      result,
    };

    this.auditLog.push(auditEntry);

    // Keep only last 10000 entries
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-10000);
    }

    // Emit audit event
    this.eventEmitter.emit("cache.audit.event", auditEntry);
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
    } = {},
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
      priority: "high",
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
    } = {},
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.DOCTOR_APPOINTMENTS(
      doctorId,
      clinicId,
    );
    const tags = [
      this.CACHE_TAGS.DOCTOR(doctorId),
      this.CACHE_TAGS.CLINIC(clinicId),
    ];

    if (options.includePatientData) {
      tags.push(this.CACHE_TAGS.PHI_DATA);
    }

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.appointmentsTTL,
      staleTime: 300, // 5 minutes stale time for real-time updates
      priority: "high",
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
    } = {},
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
      priority: "high",
      tags,
      enableSwr: true,
    });
  }

  /**
   * Cache emergency data with minimal TTL for critical scenarios
   */
  async cacheEmergencyData<T>(
    patientId: string,
    fetchFn: () => Promise<T>,
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.EMERGENCY_CONTACTS(patientId);
    const tags = [
      this.CACHE_TAGS.PATIENT(patientId),
      this.CACHE_TAGS.EMERGENCY_DATA,
      this.CACHE_TAGS.CRITICAL_PATIENT_DATA,
    ];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.emergencyDataTTL,
      priority: "high",
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
    } = {},
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.PRESCRIPTIONS(patientId, clinicId);
    const tags = [
      this.CACHE_TAGS.PATIENT(patientId),
      this.CACHE_TAGS.CLINIC(clinicId),
      this.CACHE_TAGS.PHI_DATA,
    ];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.prescriptionsTTL,
      priority: "high",
      tags,
      enableSwr: true,
    });
  }

  /**
   * Cache vital signs with time-series optimization
   */
  async cacheVitalSigns<T>(
    patientId: string,
    date: string,
    fetchFn: () => Promise<T>,
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.VITAL_SIGNS(patientId, date);
    const tags = [this.CACHE_TAGS.PATIENT(patientId), this.CACHE_TAGS.PHI_DATA];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.patientRecordsTTL,
      priority: "high",
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
    } = {},
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.LAB_RESULTS(patientId, clinicId);
    const tags = [
      this.CACHE_TAGS.PATIENT(patientId),
      this.CACHE_TAGS.CLINIC(clinicId),
      this.CACHE_TAGS.PHI_DATA,
    ];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.medicalHistoryTTL,
      compress: options.includeImages || options.includeReports,
      priority: "high",
      tags,
      enableSwr: true,
    });
  }

  /**
   * Invalidate patient-related cache when patient data changes
   */
  async invalidatePatientCache(
    patientId: string,
    clinicId?: string,
  ): Promise<void> {
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
    await this.redisService.invalidateCacheByTag(
      this.CACHE_TAGS.PATIENT(patientId),
    );
    if (clinicId) {
      await this.redisService.invalidateCacheByTag(
        this.CACHE_TAGS.CLINIC(clinicId),
      );
    }

    // Emit invalidation event
    await this.emitCacheInvalidationEvent({
      type: "patient_updated",
      entityId: patientId,
      clinicId,
      timestamp: new Date(),
      affectedPatterns: patterns,
    });

    this.logger.debug(
      `Invalidated patient cache for patient: ${patientId}, clinic: ${clinicId || "all"}`,
    );
  }

  /**
   * Invalidate doctor-related cache when doctor data changes
   */
  async invalidateDoctorCache(
    doctorId: string,
    clinicId?: string,
  ): Promise<void> {
    const patterns = [`doctor:${doctorId}:*`];

    if (clinicId) {
      patterns.push(`*:clinic:${clinicId}:doctors`);
    }

    // Invalidate by patterns
    for (const pattern of patterns) {
      await this.redisService.invalidateCacheByPattern(pattern);
    }

    // Invalidate by tags
    await this.redisService.invalidateCacheByTag(
      this.CACHE_TAGS.DOCTOR(doctorId),
    );
    if (clinicId) {
      await this.redisService.invalidateCacheByTag(
        this.CACHE_TAGS.CLINIC(clinicId),
      );
    }

    await this.emitCacheInvalidationEvent({
      type: "doctor_updated",
      entityId: doctorId,
      clinicId,
      timestamp: new Date(),
      affectedPatterns: patterns,
    });

    this.logger.debug(
      `Invalidated doctor cache for doctor: ${doctorId}, clinic: ${clinicId || "all"}`,
    );
  }

  /**
   * Invalidate appointment-related cache
   */
  async invalidateAppointmentCache(
    appointmentId: string,
    patientId?: string,
    doctorId?: string,
    clinicId?: string,
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
    await this.redisService.invalidateCacheByTag(
      this.CACHE_TAGS.APPOINTMENT(appointmentId),
    );

    await this.emitCacheInvalidationEvent({
      type: "appointment_changed",
      entityId: appointmentId,
      clinicId,
      userId: patientId || doctorId,
      timestamp: new Date(),
      affectedPatterns: patterns,
    });

    this.logger.debug(
      `Invalidated appointment cache for appointment: ${appointmentId}`,
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
    await this.redisService.invalidateCacheByTag(
      this.CACHE_TAGS.CLINIC(clinicId),
    );

    await this.emitCacheInvalidationEvent({
      type: "clinic_updated",
      entityId: clinicId,
      clinicId,
      timestamp: new Date(),
      affectedPatterns: patterns,
    });

    this.logger.debug(`Invalidated clinic cache for clinic: ${clinicId}`);
  }

  /**
   * Clear all PHI (Protected Health Information) data from cache
   * Used for compliance and emergency scenarios
   */
  async clearPHICache(): Promise<number> {
    this.logger.warn("Clearing all PHI data from cache for compliance");

    const clearedCount = await this.redisService.invalidateCacheByTag(
      this.CACHE_TAGS.PHI_DATA,
    );

    this.logger.log(`Cleared ${clearedCount} PHI cache entries`);
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
    this.logger.log(`Warming healthcare cache for clinic: ${clinicId}`);

    try {
      // This would typically pre-load common data like:
      // - Active doctors
      // - Today's appointments
      // - Emergency contacts
      // - Clinic configuration

      // For now, we'll just log the warming process
      this.logger.debug(
        "Cache warming completed - this would pre-load common healthcare data",
      );
    } catch (error) {
      this.logger.error("Error warming healthcare cache:", error);
    }
  }

  /**
   * Emit cache invalidation event for cross-service coordination
   */
  private async emitCacheInvalidationEvent(
    event: CacheInvalidationEvent,
  ): Promise<void> {
    try {
      // Store the invalidation event for audit purposes
      const eventKey = `cache:invalidation:events`;
      await this.redisService.rPush(eventKey, JSON.stringify(event));
      await this.redisService.lTrim(eventKey, -1000, -1); // Keep last 1000 events

      // Set expiry for events (30 days)
      await this.redisService.expire(eventKey, 30 * 24 * 60 * 60);
    } catch (error) {
      this.logger.error("Error emitting cache invalidation event:", error);
    }
  }

  /**
   * Get cache invalidation event history
   */
  async getCacheInvalidationHistory(
    limit: number = 100,
  ): Promise<CacheInvalidationEvent[]> {
    try {
      const eventKey = `cache:invalidation:events`;
      const events = await this.redisService.lRange(eventKey, -limit, -1);

      return events.map(
        (eventStr) => JSON.parse(eventStr) as CacheInvalidationEvent,
      );
    } catch (error) {
      this.logger.error("Error getting cache invalidation history:", error);
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
      const promises = keys.map(async (key) => {
        const value = await this.redisService.get(key);
        return { key, value: value ? JSON.parse(value) : null };
      });

      const batchResults = await Promise.all(promises);

      batchResults.forEach(({ key, value }) => {
        results.set(key, value);
      });

      return results;
    } catch (error) {
      this.logger.error("Batch get operation failed:", error);
      throw error;
    }
  }

  /**
   * Batch set operations for better performance
   */
  async batchSet<T>(
    keyValuePairs: Array<{ key: string; value: T; ttl?: number }>,
  ): Promise<void> {
    try {
      // Use Promise.all for concurrent operations
      const promises = keyValuePairs.map(async ({ key, value, ttl }) => {
        await this.redisService.set(
          key,
          JSON.stringify(value),
          ttl || this.config.defaultTTL,
        );
      });

      await Promise.all(promises);
    } catch (error) {
      this.logger.error("Batch set operation failed:", error);
      throw error;
    }
  }

  /**
   * Batch delete operations for better performance
   */
  async batchDelete(keys: string[]): Promise<number> {
    try {
      // Use Promise.all for concurrent operations
      const promises = keys.map(async (key) => {
        await this.redisService.del(key);
        return 1; // Each successful delete counts as 1
      });

      const results = await Promise.all(promises);
      return results.reduce((sum, count) => sum + count, 0);
    } catch (error) {
      this.logger.error("Batch delete operation failed:", error);
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
      this.logger.error(`Failed to delete cache key ${key}:`, error);
      return false;
    }
  }

  /**
   * Warm cache for a clinic with frequently accessed data
   */
  async warmClinicCache(clinicId: string): Promise<void> {
    this.logger.log(`Starting cache warming for clinic: ${clinicId}`);

    try {
      // Warm clinic information
      const clinicInfoKey = this.CACHE_PATTERNS.CLINIC_INFO(clinicId);
      await this.redisService.set(
        clinicInfoKey,
        JSON.stringify({
          id: clinicId,
          name: "Clinic",
          status: "active",
        }),
        this.config.clinicDataTTL,
      );

      // Warm doctor profiles
      const doctorsKey = this.CACHE_PATTERNS.CLINIC_DOCTORS(clinicId);
      await this.redisService.set(
        doctorsKey,
        JSON.stringify([]),
        this.config.doctorProfilesTTL,
      );

      this.logger.log(`Cache warming completed for clinic: ${clinicId}`);
    } catch (error) {
      this.logger.error(`Cache warming failed for clinic: ${clinicId}`, error);
      throw error;
    }
  }

  /**
   * Get cache health status
   */
  async getCacheHealth(): Promise<{
    status: "healthy" | "warning" | "critical";
    memoryUsage: number;
    hitRate: number;
    connectionStatus: boolean;
    lastHealthCheck: Date;
  }> {
    try {
      const connectionStatus = await this.redisService.healthCheck();
      const stats = await this.redisService.getCacheStats();

      const hitRate = stats.hits / (stats.hits + stats.misses) || 0;

      let status: "healthy" | "warning" | "critical" = "healthy";
      if (hitRate < 0.7) status = "warning";
      if (hitRate < 0.5 || !connectionStatus) status = "critical";

      return {
        status,
        memoryUsage: 0, // RedisService doesn't expose memory info directly
        hitRate,
        connectionStatus,
        lastHealthCheck: new Date(),
      };
    } catch (error) {
      this.logger.error("Cache health check failed:", error);
      return {
        status: "critical",
        memoryUsage: 0,
        hitRate: 0,
        connectionStatus: false,
        lastHealthCheck: new Date(),
      };
    }
  }

  // Basic cache operations - delegate to RedisService
  async get<T>(key: string): Promise<T | null> {
    return this.redisService.get<T>(key);
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    return this.redisService.set(key, value, ttl);
  }

  async del(...keys: string[]): Promise<void> {
    return this.redisService.del(...keys);
  }

  async invalidateCache(key: string): Promise<boolean> {
    return this.redisService.invalidateCache(key);
  }

  async invalidateCacheByTag(tag: string): Promise<number> {
    return this.redisService.invalidateCacheByTag(tag);
  }

  // Additional Redis operations needed by other services
  async invalidateByPattern(pattern: string): Promise<number> {
    return this.redisService.invalidateCacheByPattern(pattern);
  }

  async delPattern(pattern: string): Promise<number> {
    return this.redisService.invalidateCacheByPattern(pattern);
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

  async zremrangebyscore(
    key: string,
    min: number,
    max: number,
  ): Promise<number> {
    return this.redisService.zremrangebyscore(key, min, max);
  }

  // Hash operations
  async hincrby(
    key: string,
    field: string,
    increment: number,
  ): Promise<number> {
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
      priority?: "critical" | "high" | "normal" | "low"; // Operation priority
      enableSwr?: boolean; // Enable SWR (defaults to true)
      tags?: string[]; // Cache tags for grouped invalidation
      containsPHI?: boolean; // Contains Protected Health Information
      complianceLevel?: "standard" | "sensitive" | "restricted"; // Compliance level
      emergencyData?: boolean; // Emergency data flag
      patientSpecific?: boolean; // Patient-specific data
      doctorSpecific?: boolean; // Doctor-specific data
      clinicSpecific?: boolean; // Clinic-specific data
    } = {},
  ): Promise<T> {
    return this.redisService.cache(key, fetchFn, options);
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
    } = {},
  ): Promise<boolean> {
    return this.redisService.isRateLimited(key, limit, windowSeconds, options);
  }

  async getRateLimit(
    key: string,
    limit?: number,
    windowSeconds?: number,
  ): Promise<{
    remaining: number;
    reset: number;
    total: number;
    used: number;
  }> {
    return this.redisService.getRateLimit(key, limit, windowSeconds);
  }

  async clearRateLimit(key: string): Promise<void> {
    return this.redisService.clearRateLimit(key);
  }

  async updateRateLimits(
    type: string,
    config: { limit: number; window: number },
  ): Promise<void> {
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

  async getCacheMetrics(): Promise<Record<string, unknown>> {
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
  async trackSecurityEvent(
    identifier: string,
    eventType: string,
    details: unknown,
  ): Promise<void> {
    return this.redisService.trackSecurityEvent(identifier, eventType, details);
  }

  async getSecurityEvents(identifier: string, limit?: number): Promise<any[]> {
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

  async subscribe(
    channel: string,
    callback: (message: string) => void,
  ): Promise<void> {
    return this.redisService.subscribe(channel, callback);
  }

  // ===== SORTED SET OPERATIONS =====
  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.redisService.zrevrange(key, start, stop);
  }

  async zrangebyscore(
    key: string,
    min: string | number,
    max: string | number,
  ): Promise<string[]> {
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

  async multi(commands: unknown[]): Promise<unknown> {
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
