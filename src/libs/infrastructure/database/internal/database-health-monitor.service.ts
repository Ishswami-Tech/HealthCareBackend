/**
 * Database Health Monitor Service
 * @class DatabaseHealthMonitorService
 * @description Monitors database health and availability
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@config';
import { PrismaService as PrismaServiceClass } from '@database/prisma/prisma.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

export interface DatabaseHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  lastCheck: Date;
  connectionCount: number;
  errorRate: number;
  details?: Record<string, unknown>;
}

/**
 * Database health monitor service
 * @internal
 */
@Injectable()
export class DatabaseHealthMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly serviceName = 'DatabaseHealthMonitorService';
  private healthCheckInterval!: NodeJS.Timeout;
  private readonly checkIntervalMs = 30000; // 30 seconds
  private currentHealth: DatabaseHealthStatus = {
    status: 'healthy',
    latency: 0,
    lastCheck: new Date(),
    connectionCount: 0,
    errorRate: 0,
  };
  private readonly healthCheckTimeout = 5000; // 5 seconds
  private lastSuccessLogTime = 0; // Track last success log time for periodic logging
  private isShuttingDown = false;
  private readonly serviceStartTime = Date.now(); // Track when service started
  private readonly STARTUP_GRACE_PERIOD = 60000; // 60 seconds grace period during startup

  constructor(
    @Inject(forwardRef(() => PrismaServiceClass))
    private readonly prismaService: PrismaServiceClass,
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  async onModuleInit(): Promise<void> {
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Database health monitor service initialized',
      this.serviceName
    );

    // Wait for Prisma to be ready before starting health monitoring
    if (this.prismaService) {
      const isReady = await this.prismaService.waitUntilReady(10000); // Wait up to 10 seconds
      if (isReady) {
        this.startHealthMonitoring();
      } else {
        // Start with delay - Prisma will be ready soon
        setTimeout(() => {
          void (async () => {
            if (this.prismaService) {
              const ready = await this.prismaService.waitUntilReady(5000);
              if (ready) {
                this.startHealthMonitoring();
              }
            }
          })();
        }, 5000);
      }
    } else {
      // PrismaService not available yet, try again after a delay
      setTimeout(() => {
        void (async () => {
          if (this.prismaService) {
            const ready = await this.prismaService.waitUntilReady(5000);
            if (ready) {
              this.startHealthMonitoring();
            }
          }
        })();
      }, 5000);
    }
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    // Perform initial health check
    void this.performHealthCheck();

    // Schedule periodic health checks
    this.healthCheckInterval = setInterval(() => {
      void this.performHealthCheck();
    }, this.checkIntervalMs);
  }

  /**
   * Perform health check using dedicated health check client
   * Uses the same dedicated connection pool as ConnectionPoolManager
   * This ensures only ONE health check connection is used across the application
   */
  private async performHealthCheck(): Promise<void> {
    // Skip health check if shutting down
    if (this.isShuttingDown) {
      return;
    }

    // Check if we're in startup grace period
    const timeSinceStart = Date.now() - this.serviceStartTime;
    const isInStartupGracePeriod = timeSinceStart < this.STARTUP_GRACE_PERIOD;

    // CRITICAL: Check if Prisma is ready BEFORE accessing any Prisma methods
    // This prevents Prisma's internal error logging
    if (!this.prismaService || !this.prismaService.isReady()) {
      // During startup grace period, silently skip (don't log warnings)
      if (!isInStartupGracePeriod) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.DEBUG,
          'Database health check skipped: Prisma client not ready',
          this.serviceName,
          {}
        );
      }
      return;
    }

    const startTime = Date.now();

    try {
      // CRITICAL: Use the main PrismaService instance instead of separate health check client
      // The health check client might not be initialized, causing Prisma errors
      // Use the main service which has proper readiness checks
      // Use $queryRaw on the main PrismaService which has proper readiness checks
      // During startup grace period, $queryRaw will return empty result instead of throwing
      await Promise.race([
        this.prismaService.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), this.healthCheckTimeout)
        ),
      ]);

      const latency = Date.now() - startTime;
      const status: DatabaseHealthStatus['status'] = latency < 1000 ? 'healthy' : 'degraded';

      this.currentHealth = {
        status,
        latency,
        lastCheck: new Date(),
        connectionCount: 1, // Dedicated health check connection
        errorRate: 0,
      };

      // Log success periodically (every 5 minutes) to confirm database is connected
      // Use DEBUG level for routine checks to reduce log noise
      const now = Date.now();
      const shouldLogInfo = !this.lastSuccessLogTime || now - this.lastSuccessLogTime > 300000; // 5 minutes

      if (shouldLogInfo) {
        this.lastSuccessLogTime = now;
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.INFO,
          `Database health check: Connected (latency: ${latency}ms)`,
          this.serviceName,
          {
            status,
            latency,
            connectionType: 'dedicated-health-check-pool',
          }
        );
      } else {
        // Log routine checks at DEBUG level to reduce log noise
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.DEBUG,
          `Database health check: Connected (latency: ${latency}ms)`,
          this.serviceName
        );
      }
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Check if this is a Prisma initialization error or invalid invocation
      const isPrismaInitError =
        errorMessage.includes('Invalid `prisma') ||
        errorMessage.includes('did not initialize yet') ||
        errorMessage.includes('prisma generate') ||
        errorMessage.includes('Cannot find module') ||
        errorMessage.includes('MODULE_NOT_FOUND') ||
        errorMessage.includes('PrismaClient') ||
        errorMessage.includes('$queryRaw');

      // If Prisma isn't ready yet, mark as degraded but don't log as error
      if (isPrismaInitError) {
        this.currentHealth = {
          status: 'degraded',
          latency,
          lastCheck: new Date(),
          connectionCount: 0,
          errorRate: 0.5,
          details: {
            error: errorMessage,
            reason: 'Prisma client not fully initialized',
          },
        };

        // Log as warning instead of error - this is expected during startup
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Database health check skipped: Prisma client not ready. This is expected during application startup.`,
          this.serviceName,
          { error: errorMessage, stack: errorStack }
        );
        return;
      }

      // For other errors, mark as unhealthy
      this.currentHealth = {
        status: 'unhealthy',
        latency,
        lastCheck: new Date(),
        connectionCount: 0,
        errorRate: 1.0,
        details: {
          error: errorMessage,
        },
      };

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Database health check failed: ${errorMessage}`,
        this.serviceName,
        { error: errorStack || errorMessage }
      );
    }
  }

  /**
   * Get current health status
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  getHealthStatus(): DatabaseHealthStatus {
    return { ...this.currentHealth };
  }

  /**
   * Check if database is healthy
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  isHealthy(): boolean {
    return this.currentHealth.status === 'healthy';
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy(): void {
    // Set shutdown flag to prevent new health checks
    this.isShuttingDown = true;

    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }
}
