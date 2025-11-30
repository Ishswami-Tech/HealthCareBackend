/**
 * Database Health Monitor Service
 * @class DatabaseHealthMonitorService
 * @description Monitors database health and availability
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@config';
import { PrismaService as PrismaServiceClass } from '../prisma/prisma.service';
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
export class DatabaseHealthMonitorService implements OnModuleInit {
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

  constructor(
    @Inject(forwardRef(() => PrismaServiceClass))
    private readonly prismaService: PrismaServiceClass,
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  onModuleInit(): void {
    this.startHealthMonitoring();
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Database health monitor service initialized',
      this.serviceName
    );
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
    const startTime = Date.now();

    try {
      // Use dedicated health check client (same as ConnectionPoolManager)
      // This ensures only ONE health check connection pool is used
      const prismaClient = PrismaServiceClass.getHealthCheckClient();
      const typedClient = prismaClient as unknown as {
        $queryRaw: (query: TemplateStringsArray) => Promise<unknown>;
      };

      // Simple health check query using dedicated connection
      await Promise.race([
        typedClient.$queryRaw`SELECT 1`,
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
      const now = Date.now();
      if (!this.lastSuccessLogTime || now - this.lastSuccessLogTime > 300000) {
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
      }
    } catch (error) {
      const latency = Date.now() - startTime;

      this.currentHealth = {
        status: 'unhealthy',
        latency,
        lastCheck: new Date(),
        connectionCount: 0,
        errorRate: 1.0,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      };

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Database health check failed: ${error instanceof Error ? error.message : String(error)}`,
        this.serviceName,
        { error: error instanceof Error ? error.stack : String(error) }
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
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }
}
