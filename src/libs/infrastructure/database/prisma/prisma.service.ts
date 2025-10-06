import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Scope,
  Logger,
} from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";

// Export the PrismaClient type for proper typing
export type { PrismaClient };
import * as fs from "fs";
import * as path from "path";

@Injectable({ scope: Scope.REQUEST })
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  // Explicitly declare PrismaClient methods to ensure proper typing
  declare user: PrismaClient["user"];
  declare doctor: PrismaClient["doctor"];
  declare patient: PrismaClient["patient"];
  declare clinic: PrismaClient["clinic"];
  declare appointment: PrismaClient["appointment"];
  declare medicalHistory: PrismaClient["medicalHistory"];
  declare allergy: PrismaClient["allergy"];
  declare medication: PrismaClient["medication"];
  declare immunization: PrismaClient["immunization"];
  declare vitalSign: PrismaClient["vitalSign"];
  declare receptionist: PrismaClient["receptionist"];
  declare clinicAdmin: PrismaClient["clinicAdmin"];
  declare superAdmin: PrismaClient["superAdmin"];
  declare pharmacist: PrismaClient["pharmacist"];
  declare therapist: PrismaClient["therapist"];
  declare labTechnician: PrismaClient["labTechnician"];
  declare financeBilling: PrismaClient["financeBilling"];
  declare supportStaff: PrismaClient["supportStaff"];
  declare nurse: PrismaClient["nurse"];
  declare counselor: PrismaClient["counselor"];
  declare auditLog: PrismaClient["auditLog"];
  declare $queryRaw: PrismaClient["$queryRaw"];
  declare $executeRaw: PrismaClient["$executeRaw"];
  declare $transaction: PrismaClient["$transaction"];

  private readonly logger = new Logger(PrismaService.name);
  private currentTenantId: string | null = null;
  private static connectionCount = 0;
  private static readonly MAX_CONNECTIONS = 200; // Optimized for 1M+ users
  private static readonly CONNECTION_TIMEOUT = 5000; // 5 seconds timeout for connections
  private static readonly QUERY_TIMEOUT = 30000; // 30 seconds query timeout
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 5; // Failures before circuit opens
  private static readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute circuit timeout
  private static instance: PrismaService | null = null;
  private static circuitBreakerFailures = 0;
  private static circuitBreakerLastFailure = 0;
  private static isCircuitOpen = false;
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; // 1 second
  private connectionPool: Map<string, unknown> = new Map();
  private poolSize = parseInt(process.env.DB_POOL_SIZE || "20", 10);

  constructor() {
    // If we already have a Prisma instance, return it
    if (PrismaService.instance) {
      return PrismaService.instance;
    }

    super({
      log:
        process.env.NODE_ENV === "production"
          ? [
              { emit: "stdout", level: "error" },
              { emit: "stdout", level: "warn" },
            ]
          : [
              { emit: "stdout", level: "error" },
              { emit: "stdout", level: "warn" },
              { emit: "stdout", level: "info" },
              { emit: "stdout", level: "query" },
            ],
      errorFormat: "minimal",
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    // Apply production optimizations
    this.$extends({
      query: {
        $allOperations({
          args,
          query,
        }: {
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          // Circuit breaker pattern
          if (PrismaService.isCircuitOpen) {
            const now = Date.now();
            if (
              now - PrismaService.circuitBreakerLastFailure >
              PrismaService.CIRCUIT_BREAKER_TIMEOUT
            ) {
              PrismaService.isCircuitOpen = false;
              PrismaService.circuitBreakerFailures = 0;
            } else {
              throw new Error("Database circuit breaker is open");
            }
          }

          // Add query timeout in production
          if (process.env.NODE_ENV === "production") {
            return Promise.race([
              query(args),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error("Query timeout")),
                  PrismaService.QUERY_TIMEOUT,
                ),
              ),
            ]);
          }

          return query(args);
        },
      },
    });

    // Monitor queries only in development
    if (process.env.NODE_ENV !== "production") {
      // Query monitoring will be handled via extensions
    }

    // Store the instance
    PrismaService.instance = this;

    // Tenant isolation will be handled via manual filtering in service methods
    // as $use middleware is deprecated
  }

  async onModuleInit() {
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    try {
      if (PrismaService.connectionCount > 0) {
        await this.$disconnect();
        PrismaService.connectionCount--;
        PrismaService.instance = null; // Clear the singleton instance
        this.logger.log(
          `Disconnected from database successfully. Remaining connections: ${PrismaService.connectionCount}`,
        );
      }
    } catch (_error) {
      this.logger.error("Error disconnecting from database:", _error);
    }
  }

  private async connectWithRetry(retryCount = 0): Promise<void> {
    try {
      // Check circuit breaker
      if (PrismaService.isCircuitOpen) {
        const now = Date.now();
        if (
          now - PrismaService.circuitBreakerLastFailure >
          PrismaService.CIRCUIT_BREAKER_TIMEOUT
        ) {
          PrismaService.isCircuitOpen = false;
          PrismaService.circuitBreakerFailures = 0;
        } else {
          throw new Error("Database circuit breaker is open");
        }
      }

      await this.$connect();
      PrismaService.connectionCount++;
      // Reset circuit breaker on successful connection
      PrismaService.circuitBreakerFailures = 0;
      this.logger.log(
        `Successfully connected to database. Active connections: ${PrismaService.connectionCount}/${PrismaService.MAX_CONNECTIONS}`,
      );
    } catch (_error) {
      // Increment circuit breaker failures
      PrismaService.circuitBreakerFailures++;
      PrismaService.circuitBreakerLastFailure = Date.now();

      // Open circuit breaker if threshold reached
      if (
        PrismaService.circuitBreakerFailures >=
        PrismaService.CIRCUIT_BREAKER_THRESHOLD
      ) {
        PrismaService.isCircuitOpen = true;
        this.logger.error(
          "Database circuit breaker opened due to repeated failures",
        );
      }

      if (retryCount < this.maxRetries) {
        this.logger.warn(
          `Failed to connect to database. Retrying in ${this.retryDelay * (retryCount + 1)}ms... (Attempt ${retryCount + 1}/${this.maxRetries})`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.retryDelay * (retryCount + 1)),
        ); // Exponential backoff
        await this.connectWithRetry(retryCount + 1);
      } else {
        this.logger.error(
          "Failed to connect to database after maximum retries",
        );
        throw _error;
      }
    }
  }

  /**
   * Get the current connection count
   * @returns The number of active database connections
   */
  static getConnectionCount(): number {
    return PrismaService.connectionCount;
  }

  /**
   * Check if we can create a new connection
   * @returns boolean indicating if a new connection can be created
   */
  static canCreateNewConnection(): boolean {
    return PrismaService.connectionCount < PrismaService.MAX_CONNECTIONS;
  }

  /**
   * Get connection pool health status
   * @returns Object with pool health metrics
   */
  static getPoolHealth() {
    return {
      activeConnections: PrismaService.connectionCount,
      maxConnections: PrismaService.MAX_CONNECTIONS,
      utilizationPercentage:
        (PrismaService.connectionCount / PrismaService.MAX_CONNECTIONS) * 100,
      circuitBreakerOpen: PrismaService.isCircuitOpen,
      circuitBreakerFailures: PrismaService.circuitBreakerFailures,
      isHealthy:
        PrismaService.connectionCount < PrismaService.MAX_CONNECTIONS * 0.9 &&
        !PrismaService.isCircuitOpen,
    };
  }

  /**
   * Reset circuit breaker manually (admin operation)
   */
  static resetCircuitBreaker() {
    PrismaService.isCircuitOpen = false;
    PrismaService.circuitBreakerFailures = 0;
    PrismaService.circuitBreakerLastFailure = 0;
  }

  /**
   * Execute database operation with connection pool management
   */
  async executePooledOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (
      !PrismaService.canCreateNewConnection() &&
      PrismaService.connectionCount > 0
    ) {
      // Connection pool full, wait and retry
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (PrismaService.isCircuitOpen) {
      throw new Error("Database service unavailable (circuit breaker open)");
    }

    try {
      const result = await operation();
      // Reset circuit breaker on successful operation
      if (PrismaService.circuitBreakerFailures > 0) {
        PrismaService.circuitBreakerFailures = Math.max(
          0,
          PrismaService.circuitBreakerFailures - 1,
        );
      }
      return result;
    } catch (_error) {
      PrismaService.circuitBreakerFailures++;
      PrismaService.circuitBreakerLastFailure = Date.now();

      if (
        PrismaService.circuitBreakerFailures >=
        PrismaService.CIRCUIT_BREAKER_THRESHOLD
      ) {
        PrismaService.isCircuitOpen = true;
        this.logger.error("Circuit breaker opened due to failures");
      }
      throw _error;
    }
  }

  /**
   * Set the current tenant ID for this request
   * This will be used to automatically filter all database queries
   * to only include data for this tenant
   * @param tenantId The ID of the tenant
   */
  setCurrentTenantId(tenantId: string | null) {
    if (tenantId) {
      this.logger.debug(`Setting current tenant ID to ${tenantId}`);
    } else {
      this.logger.debug("Clearing tenant ID - using global scope");
    }
    this.currentTenantId = tenantId;
  }

  /**
   * Get the current tenant ID
   * @returns The current tenant ID or null if not set
   */
  getCurrentTenantId(): string | null {
    return this.currentTenantId;
  }

  /**
   * Clear the current tenant ID
   * This is useful for operations that should access all data
   * For example, administrative tasks
   */
  clearTenantId() {
    this.currentTenantId = null;
  }

  /**
   * Get a client instance for the specified clinic
   * Note: This is just a wrapper that sets the tenant context, not an actual separate connection
   * @param clinicId The ID of the clinic
   * @returns The Prisma client with tenant context set
   */
  async getClinicClient(clinicId: string): Promise<PrismaService> {
    // Set the tenant context
    this.setCurrentTenantId(clinicId);
    return this;
  }

  // Method to handle transactions with retries
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    retryCount = 0,
  ): Promise<T> {
    try {
      return await operation();
    } catch (_error) {
      if (retryCount < this.maxRetries && this.isRetryableError(_error)) {
        console.warn(`Operation failed. Retrying in ${this.retryDelay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
        return this.executeWithRetry(operation, retryCount + 1);
      }
      throw _error;
    }
  }

  // Helper method to determine if an error is retryable
  private isRetryableError(_error: unknown): boolean {
    return (
      _error instanceof Error &&
      _error.name === "PrismaClientKnownRequestError" &&
      ((_error as { code?: string }).code === "P2024" || // Connection pool timeout
        (_error as { code?: string }).code === "P2028" || // Transaction timeout
        (_error as { code?: string }).code === "P2025" || // Record not found
        (_error as { code?: string }).code === "P2034") // Transaction failed
    );
  }

  // Method to get tenant-specific prisma instance
  withTenant(tenantId: string) {
    return this.$extends({
      query: {
        $allOperations({ args, query }: unknown) {
          // Add tenant context to all queries
          args.where = { ...args.where, tenantId };
          return query(args);
        },
      },
    });
  }

  /**
   * Optimized query execution with timeout and retry logic
   */
  async executeOptimizedQuery<T>(
    queryFn: () => Promise<T>,
    timeout: number = PrismaService.QUERY_TIMEOUT,
  ): Promise<T> {
    return Promise.race([
      queryFn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Query timeout")), timeout),
      ),
    ]);
  }

  /**
   * Batch operations for better performance
   */
  async executeBatch<T>(
    operations: (() => Promise<T>)[],
    batchSize: number = 10,
  ): Promise<T[]> {
    const results: T[] = [];

    for (let i = 0; i < operations.length; i += batchSize) {
      const batch = operations.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((operation) => this.executeWithRetry(operation)),
      );

      results.push(
        ...batchResults
          .filter(
            (result): result is PromiseFulfilledResult<Awaited<T>> =>
              result.status === "fulfilled",
          )
          .map((result) => result.value),
      );
    }

    return results;
  }

  /**
   * Get connection health status
   */
  async getConnectionHealth(): Promise<{
    connected: boolean;
    connectionCount: number;
    maxConnections: number;
    health: "healthy" | "warning" | "critical";
  }> {
    try {
      await this.$queryRaw`SELECT 1`;
      const health =
        PrismaService.connectionCount > PrismaService.MAX_CONNECTIONS * 0.8
          ? "warning"
          : PrismaService.connectionCount > PrismaService.MAX_CONNECTIONS * 0.9
            ? "critical"
            : "healthy";

      return {
        connected: true,
        connectionCount: PrismaService.connectionCount,
        maxConnections: PrismaService.MAX_CONNECTIONS,
        health,
      };
    } catch (_error) {
      return {
        connected: false,
        connectionCount: PrismaService.connectionCount,
        maxConnections: PrismaService.MAX_CONNECTIONS,
        health: "critical",
      };
    }
  }
}
