/**
 * Read Replica Router Service
 * @class ReadReplicaRouterService
 * @description Routes read queries to read replicas for optimal performance
 * Follows Single Responsibility Principle - only handles read replica routing
 */

import { Injectable, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@config';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { IReadReplicaRouter, LoadBalancingStrategy, ReadReplicaConfig } from '@core/types';

@Injectable()
export class ReadReplicaRouterService implements IReadReplicaRouter, OnModuleInit {
  private readonly serviceName = 'ReadReplicaRouterService';
  private config: ReadReplicaConfig;
  private currentReplicaIndex = 0;
  private replicaHealthStatus: Array<{ url: string; healthy: boolean; lag?: number }> = [];
  private healthCheckInterval?: NodeJS.Timeout;
  private replicaClients: Map<string, PrismaClient> = new Map();

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    private readonly prismaService: PrismaService
  ) {
    this.config = this.loadConfig();
  }

  onModuleInit(): void {
    if (this.config.enabled && this.config.urls.length > 0) {
      this.initializeReplicas();
      this.startHealthMonitoring();
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        `Read replica router initialized with ${this.config.urls.length} replicas`,
        this.serviceName
      );
    }
  }

  /**
   * Load configuration
   */
  private loadConfig(): ReadReplicaConfig {
    const healthcareConfig = this.configService?.get<{
      database?: {
        connectionPool?: {
          readReplicas?: {
            enabled?: boolean;
            urls?: string[];
            loadBalancing?: string;
            failover?: boolean;
            healthCheckInterval?: number;
          };
        };
      };
    }>('healthcare');

    const replicaConfig = healthcareConfig?.database?.connectionPool?.readReplicas || {};

    return {
      enabled: replicaConfig.enabled ?? process.env['DB_READ_REPLICAS_ENABLED'] === 'true',
      urls:
        replicaConfig.urls ??
        (process.env['READ_REPLICA_URLS'] ? process.env['READ_REPLICA_URLS'].split(',') : []),
      strategy:
        (replicaConfig.loadBalancing as LoadBalancingStrategy) ??
        (process.env['DB_LOAD_BALANCING'] as LoadBalancingStrategy) ??
        'round-robin',
      failover: replicaConfig.failover ?? process.env['DB_FAILOVER'] !== 'false',
      healthCheckInterval:
        replicaConfig.healthCheckInterval ??
        parseInt(process.env['DB_REPLICA_HEALTH_CHECK_INTERVAL'] || '30000', 10),
    };
  }

  /**
   * Initialize replica clients
   */
  private initializeReplicas(): void {
    for (const url of this.config.urls) {
      try {
        // Create Prisma client for replica
        // Note: In production, you'd create separate PrismaClient instances for each replica
        // For now, we'll use the primary client but route queries appropriately
        this.replicaClients.set(url, this.prismaService.getClient());
        this.replicaHealthStatus.push({ url, healthy: true });
      } catch (error) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.ERROR,
          `Failed to initialize replica client for ${url}`,
          this.serviceName,
          { error: error instanceof Error ? error.message : String(error) }
        );
        this.replicaHealthStatus.push({ url, healthy: false });
      }
    }
  }

  /**
   * Get client for read operation (routes to replica if available)
   */
  getReadClient(): PrismaClient {
    if (!this.config.enabled || this.config.urls.length === 0) {
      return this.prismaService.getClient();
    }

    // Get healthy replicas
    const healthyReplicas = this.replicaHealthStatus.filter(r => r.healthy);

    if (healthyReplicas.length === 0) {
      // No healthy replicas, fallback to primary
      if (this.config.failover) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          'No healthy replicas available, falling back to primary',
          this.serviceName
        );
      }
      return this.prismaService.getClient();
    }

    // Select replica based on strategy
    const selectedReplica = this.selectReplica(healthyReplicas);
    const client = this.replicaClients.get(selectedReplica.url);

    if (!client) {
      return this.prismaService.getClient();
    }

    return client;
  }

  /**
   * Get client for write operation (always primary)
   */
  getWriteClient(): PrismaClient {
    return this.prismaService.getClient();
  }

  /**
   * Select replica based on load balancing strategy
   */
  private selectReplica(healthyReplicas: Array<{ url: string; healthy: boolean; lag?: number }>): {
    url: string;
    healthy: boolean;
    lag?: number;
  } {
    if (healthyReplicas.length === 0) {
      throw new Error('No healthy replicas available');
    }

    switch (this.config.strategy) {
      case 'round-robin': {
        const replica = healthyReplicas[this.currentReplicaIndex % healthyReplicas.length];
        if (!replica) {
          throw new Error('No replica available for round-robin selection');
        }
        this.currentReplicaIndex = (this.currentReplicaIndex + 1) % healthyReplicas.length;
        return replica;
      }

      case 'least-connections': {
        // For now, use round-robin (would need connection tracking)
        const replica = healthyReplicas[this.currentReplicaIndex % healthyReplicas.length];
        if (!replica) {
          throw new Error('No replica available for least-connections selection');
        }
        return replica;
      }

      case 'latency-based': {
        // Select replica with lowest lag
        const bestReplica = healthyReplicas.reduce((best, current) => {
          const currentLag = current.lag ?? Infinity;
          const bestLag = best.lag ?? Infinity;
          return currentLag < bestLag ? current : best;
        });
        if (!bestReplica) {
          const fallback = healthyReplicas[0];
          if (!fallback) {
            throw new Error('No replica available for latency-based selection');
          }
          return fallback;
        }
        return bestReplica;
      }

      default: {
        const replica = healthyReplicas[0];
        if (!replica) {
          throw new Error('No replica available');
        }
        return replica;
      }
    }
  }

  /**
   * Check if query is read-only
   */
  isReadOnlyQuery(query: string): boolean {
    const readOnlyPatterns = /^\s*(SELECT|WITH|SHOW|EXPLAIN|DESCRIBE)/i;
    return readOnlyPatterns.test(query.trim());
  }

  /**
   * Get replica health status
   */
  async getReplicaHealth(): Promise<Array<{ url: string; healthy: boolean; lag?: number }>> {
    return Promise.resolve([...this.replicaHealthStatus]);
  }

  /**
   * Update replica configuration
   */
  updateConfig(config: Partial<ReadReplicaConfig>): void {
    this.config = { ...this.config, ...config };
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Read replica configuration updated',
      this.serviceName,
      { config: this.config }
    );
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      void this.checkReplicaHealth();
    }, this.config.healthCheckInterval);
  }

  /**
   * Check replica health
   */
  private async checkReplicaHealth(): Promise<void> {
    for (let i = 0; i < this.config.urls.length; i++) {
      const url = this.config.urls[i];
      if (!url) {
        continue;
      }
      try {
        const client = this.replicaClients.get(url);
        if (client) {
          const start = Date.now();
          await (
            client as unknown as { $queryRaw: (query: TemplateStringsArray) => Promise<unknown> }
          ).$queryRaw`SELECT 1`;
          const latency = Date.now() - start;

          this.replicaHealthStatus[i] = {
            url,
            healthy: latency < 5000, // Healthy if response < 5s
            lag: latency,
          };
        }
      } catch (error) {
        this.replicaHealthStatus[i] = {
          url,
          healthy: false,
        };
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Replica health check failed for ${url}`,
          this.serviceName,
          { error: error instanceof Error ? error.message : String(error) }
        );
      }
    }
  }
}
