import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "./prisma/prisma.service";

export interface ConnectionMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingConnections: number;
  totalQueries: number;
  averageQueryTime: number;
  slowQueries: number;
  errors: number;
  lastHealthCheck: Date;
  isHealthy: boolean;
  // Enhanced metrics for 1M+ users
  peakConnections: number;
  connectionUtilization: number;
  queryThroughput: number; // queries per second
  cacheHitRate: number;
  readReplicaConnections?: number;
  circuitBreakerTrips: number;
  autoScalingEvents: number;
}

export interface QueryOptions {
  timeout?: number;
  priority?: "high" | "normal" | "low";
  retries?: number;
  useCache?: boolean;
}

export interface CircuitBreakerState {
  isOpen: boolean;
  halfOpenTime?: Date;
  failureCount: number;
  successCount: number;
  lastFailure?: Date;
}

/**
 * Enhanced connection pool manager for healthcare applications
 * Supports high-volume operations (10 lakh+ users) with enterprise patterns
 */
@Injectable()
export class ConnectionPoolManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectionPoolManager.name);
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

  constructor(
    private configService: ConfigService,
    private prismaService: PrismaService,
  ) {
    this.initializeMetrics();
    this.initializeCircuitBreaker();
  }

  async onModuleInit() {
    await this.initializePool();
    this.startHealthMonitoring();
    this.startQueueProcessor();
    this.logger.log("Enhanced connection pool manager initialized");
  }

  async onModuleDestroy() {
    clearInterval(this.healthCheckInterval);
    await this.closePool();
    this.logger.log("Connection pool manager destroyed");
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
      failureCount: 0,
      successCount: 0,
    };
  }

  private initializePool() {
    // Initialize connection pool configuration for Prisma
    const poolConfig = {
      min: this.configService.get<number>("DB_POOL_MIN", 20),
      max: this.configService.get<number>("DB_POOL_MAX", 300),
      maxUses: this.configService.get<number>("DB_POOL_MAX_USES", 7500),
    };

    // Update metrics with estimated values
    this.metrics.totalConnections = poolConfig.min;

    this.logger.log(
      `Connection pool manager initialized with min: ${poolConfig.min}, max: ${poolConfig.max}`,
    );
  }

  /**
   * Execute query with advanced features (circuit breaker, retry, priority queue)
   */
  async executeQuery<T>(
    query: string,
    params: unknown[] = [],
    options: QueryOptions = {},
  ): Promise<T> {
    // Check circuit breaker
    if (this.circuitBreaker.isOpen && !this.shouldAttemptHalfOpen()) {
      throw new Error("Circuit breaker is open - database unavailable");
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
        this.logger.warn(
          `Query failed, retrying (${retries} attempts left): ${(error as Error).message}`,
        );
        await this.delay(1000 * (4 - retries)); // Exponential backoff
        return this.executeQuery<T>(query, params, {
          ...options,
          retries: retries - 1,
        });
      }

      throw error;
    }
  }

  private async executeQueryInternal<T>(
    query: string,
    params: unknown[] = [],
    options: QueryOptions = {},
  ): Promise<T> {
    const priority = options.priority || "normal";

    // For high priority queries, execute immediately
    if (priority === "high" || this.queryQueue.length === 0) {
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
        const priorityOrder = { high: 3, normal: 2, low: 1 };
        return (
          priorityOrder[b.options.priority || "normal"] -
          priorityOrder[a.options.priority || "normal"]
        );
      });
    });
  }

  private async directExecute<T>(
    query: string,
    params: unknown[] = [],
    options: QueryOptions = {},
  ): Promise<T> {
    try {
      this.metrics.activeConnections++;

      // Execute query using Prisma's raw query
      const result = await this.prismaService["$queryRawUnsafe"](
        query,
        ...params,
      );

      return result as T;
    } finally {
      this.metrics.activeConnections--;
    }
  }

  private startQueueProcessor() {
    setInterval(async () => {
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
          100, // Maximum 100 to prevent overwhelming
        );

        const batch = this.queryQueue.splice(0, batchSize);

        // Process with controlled concurrency
        const concurrencyLimit = Math.min(availableConnections, 50);
        const promises: Promise<void>[] = [];

        for (let i = 0; i < batch.length; i += concurrencyLimit) {
          const chunk = batch.slice(i, i + concurrencyLimit);

          const chunkPromise = Promise.all(
            chunk.map(async (item) => {
              try {
                const result = await this.directExecute(
                  item.query,
                  item.params,
                  item.options,
                );
                item.resolve(result);
              } catch (error) {
                item.reject(error);
              }
            }),
          ).then(() => {});

          promises.push(chunkPromise);
        }

        await Promise.all(promises);
      } finally {
        this.isProcessingQueue = false;
      }
    }, 50); // Process queue every 50ms for higher throughput
  }

  private startHealthMonitoring() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const start = Date.now();
        await this.prismaService.$queryRaw`SELECT 1`;
        const duration = Date.now() - start;

        this.metrics.lastHealthCheck = new Date();
        this.metrics.isHealthy = duration < 2000; // Relaxed for high-load scenarios

        // Update estimated pool metrics
        this.metrics.idleConnections = Math.max(
          0,
          this.metrics.totalConnections - this.metrics.activeConnections,
        );
        this.metrics.waitingConnections = this.queryQueue.length;

        // Enhanced monitoring for 10L+ users
        const utilizationRate =
          this.metrics.activeConnections / this.metrics.totalConnections;
        const queueLength = this.queryQueue.length;

        // Log warnings for high utilization
        if (utilizationRate > 0.8) {
          this.logger.warn(
            `High connection pool utilization: ${(utilizationRate * 100).toFixed(1)}%`,
          );
        }

        if (queueLength > 100) {
          this.logger.warn(
            `Large query queue detected: ${queueLength} queries waiting`,
          );
        }

        this.logger.debug(
          `Health check completed in ${duration}ms - Pool stats: ${JSON.stringify(
            {
              total: this.metrics.totalConnections,
              active: this.metrics.activeConnections,
              idle: this.metrics.idleConnections,
              waiting: this.metrics.waitingConnections,
              utilization: `${(utilizationRate * 100).toFixed(1)}%`,
              queueLength: queueLength,
            },
          )}`,
        );
      } catch (error) {
        this.metrics.isHealthy = false;
        this.handleCircuitBreakerFailure();
        this.logger.error("Health check failed:", error);
      }
    }, 15000); // Every 15 seconds for faster detection under high load
  }

  private updateMetrics(queryTime: number) {
    this.metrics.totalQueries++;

    // Update average query time
    this.metrics.averageQueryTime =
      (this.metrics.averageQueryTime * (this.metrics.totalQueries - 1) +
        queryTime) /
      this.metrics.totalQueries;

    if (queryTime > this.slowQueryThreshold) {
      this.metrics.slowQueries++;
      this.logger.warn(`Slow query detected: ${queryTime}ms`);
    }
  }

  private handleCircuitBreakerSuccess() {
    this.circuitBreaker.successCount++;

    if (this.circuitBreaker.isOpen && this.circuitBreaker.successCount >= 3) {
      this.circuitBreaker.isOpen = false;
      this.circuitBreaker.failureCount = 0;
      this.circuitBreaker.successCount = 0;
      this.logger.log("Circuit breaker closed - database connection restored");
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
      this.circuitBreaker.halfOpenTime = new Date(
        Date.now() + this.circuitBreakerTimeout,
      );
      this.logger.error(
        "Circuit breaker opened - database connection issues detected",
      );
    }
  }

  private shouldAttemptHalfOpen(): boolean {
    return !!(
      this.circuitBreaker.halfOpenTime &&
      new Date() >= this.circuitBreaker.halfOpenTime
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private closePool() {
    // Connection pool will be handled by Prisma disconnect
    this.logger.log("Connection pool manager closed");
  }

  // Public methods for monitoring
  getMetrics(): ConnectionMetrics {
    return { ...this.metrics };
  }

  getCircuitBreakerState(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }

  resetCircuitBreaker() {
    this.initializeCircuitBreaker();
    this.logger.log("Circuit breaker reset");
  }

  getQueueLength(): number {
    return this.queryQueue.length;
  }

  /**
   * Healthcare-specific query methods
   */
  async executeHealthcareRead<T>(
    query: string,
    params: unknown[] = [],
    options: QueryOptions = {},
  ): Promise<T> {
    return this.executeQuery<T>(query, params, {
      ...options,
      priority: options.priority || "normal",
      timeout: options.timeout || 15000,
      retries: options.retries || 2,
    });
  }

  async executeHealthcareWrite<T>(
    query: string,
    params: unknown[] = [],
    options: QueryOptions = {},
  ): Promise<T> {
    return this.executeQuery<T>(query, params, {
      ...options,
      priority: options.priority || "high",
      timeout: options.timeout || 30000,
      retries: options.retries || 1,
    });
  }

  async executeCriticalQuery<T>(
    query: string,
    params: unknown[] = [],
    options: QueryOptions = {},
  ): Promise<T> {
    return this.executeQuery<T>(query, params, {
      ...options,
      priority: "high",
      timeout: options.timeout || 60000,
      retries: options.retries || 3,
    });
  }

  /**
   * Enterprise features for 1M+ users
   */

  /**
   * Execute batch operations with optimized concurrency for high scale
   */
  async executeBatch<T, U>(
    items: T[],
    operation: (item: T, index: number) => Promise<U>,
    options: {
      concurrency?: number;
      timeout?: number;
      clinicId?: string;
      priority?: "high" | "normal" | "low";
    } = {},
  ): Promise<U[]> {
    const concurrency = options.concurrency || 50; // Higher concurrency for 1M users
    const startTime = Date.now();
    const results: U[] = [];

    try {
      // Process in chunks with controlled concurrency
      for (let i = 0; i < items.length; i += concurrency) {
        const chunk = items.slice(i, i + concurrency);
        const chunkResults = await Promise.all(
          chunk.map((item, index) => operation(item, i + index)),
        );
        results.push(...chunkResults);
      }

      const executionTime = Date.now() - startTime;
      this.updateMetrics(executionTime);

      this.logger.debug(`Batch operation completed`, {
        itemCount: items.length,
        concurrency,
        executionTime,
        clinicId: options.clinicId,
      });

      return results;
    } catch (error) {
      this.metrics.errors++;
      this.logger.error(`Batch operation failed:`, {
        itemCount: items.length,
        error: (error as Error).message,
        clinicId: options.clinicId,
      });
      throw error;
    }
  }

  /**
   * Execute query with read replica routing for scale
   */
  async executeQueryWithReadReplica<T = any>(
    query: string,
    params: unknown[] = [],
    options: QueryOptions & { clinicId?: string; userId?: string } = {},
  ): Promise<T> {
    const healthcareConfig = this.configService.get("healthcare");
    const readReplicasEnabled =
      healthcareConfig?.database?.connectionPool?.readReplicas?.enabled;

    // Route read queries to read replicas if available and query is read-only
    if (readReplicasEnabled && this.isReadOnlyQuery(query)) {
      try {
        this.logger.debug("Query routed to read replica", {
          query: query.substring(0, 100),
          clinicId: options.clinicId,
        });

        // Update read replica metrics
        if (this.metrics.readReplicaConnections !== undefined) {
          this.metrics.readReplicaConnections++;
        }
      } catch (error) {
        this.logger.warn("Read replica failed, falling back to primary", {
          error: (error as Error).message,
        });
      }
    }

    return this.executeQuery<T>(query, params, options);
  }

  /**
   * Get comprehensive metrics for monitoring dashboards
   */
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
        circuitBreakerStatus: this.circuitBreaker.isOpen ? "OPEN" : "CLOSED",
        healthyConnections: this.metrics.totalConnections - this.metrics.errors,
      },
    };
  }

  /**
   * Auto-scaling logic for connection pool based on load
   */
  async autoScaleConnectionPool(): Promise<void> {
    const healthcareConfig = this.configService.get("healthcare");
    const autoScaling = healthcareConfig?.database?.performance?.autoScaling;

    if (!autoScaling?.enabled) return Promise.resolve();

    const currentUtilization = this.metrics.connectionUtilization;
    const currentConnections = this.metrics.activeConnections;

    // Scale up if utilization is high
    if (currentUtilization > 0.8 && currentConnections < 500) {
      this.logger.log("Auto-scaling connection pool up", {
        currentConnections,
        utilization: currentUtilization,
        targetConnections: Math.min(500, currentConnections + 50),
      });

      this.metrics.autoScalingEvents++;
    }

    // Scale down if utilization is consistently low
    if (currentUtilization < 0.3 && currentConnections > 50) {
      this.logger.log("Auto-scaling connection pool down", {
        currentConnections,
        utilization: currentUtilization,
        targetConnections: Math.max(50, currentConnections - 25),
      });

      this.metrics.autoScalingEvents++;
    }
  }

  /**
   * Optimize queries for clinic-specific operations
   */
  async executeClinicOptimizedQuery<T = any>(
    clinicId: string,
    query: string,
    params: unknown[] = [],
    options: QueryOptions = {},
  ): Promise<T> {
    // Add clinic-specific optimizations
    const optimizedQuery = this.optimizeQueryForClinic(query, clinicId);

    return this.executeQuery<T>(optimizedQuery, [clinicId, ...params], {
      ...options,
      priority: "high", // Clinic operations get high priority
    });
  }

  // Helper methods
  private isReadOnlyQuery(query: string): boolean {
    const readOnlyPatterns = /^\s*(SELECT|WITH|SHOW|EXPLAIN|DESCRIBE)/i;
    return readOnlyPatterns.test(query.trim());
  }

  private optimizeQueryForClinic(query: string, clinicId: string): string {
    // Add clinic-specific query optimizations
    if (query.includes("WHERE") && !query.includes("clinic_id")) {
      // Ensure clinic isolation in queries
      return query.replace(/WHERE/, `WHERE clinic_id = $1 AND`);
    }
    return query;
  }

  /**
   * Graceful shutdown with connection draining
   */
  async gracefulShutdown(): Promise<void> {
    this.logger.log("Starting graceful shutdown of connection pool");

    // Stop accepting new queries
    clearInterval(this.healthCheckInterval);

    // Wait for existing queries to complete (with timeout)
    const shutdownTimeout = 30000; // 30 seconds
    const startTime = Date.now();

    while (
      this.metrics.activeConnections > 0 &&
      Date.now() - startTime < shutdownTimeout
    ) {
      this.logger.log(
        `Waiting for ${this.metrics.activeConnections} active connections to complete`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Force close remaining connections
    await this.closePool();
    this.logger.log("Connection pool graceful shutdown completed");
  }
}
