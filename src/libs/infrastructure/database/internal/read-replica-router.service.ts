/**
 * Read Replica Router Service
 * @class ReadReplicaRouterService
 * @description Routes read queries to read replicas for improved performance
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config';
import { PrismaService } from '../prisma/prisma.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

export type ReadReplicaStrategy = 'round-robin' | 'least-connections' | 'random';

export interface ReplicaHealth {
  replicaId: string;
  healthy: boolean;
  latency: number;
  lastCheck: Date;
}

/**
 * Read replica router service
 * @internal
 */
@Injectable()
export class ReadReplicaRouterService {
  private readonly serviceName = 'ReadReplicaRouterService';
  private readonly enabled: boolean;
  private readonly strategy: ReadReplicaStrategy;
  private readonly replicas: string[] = [];
  private currentReplicaIndex = 0;
  private readonly replicaHealth = new Map<string, ReplicaHealth>();

  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prismaService: PrismaService,
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    this.enabled = this.configService.get<boolean>('database.readReplicas.enabled') ?? false;
    this.strategy =
      this.configService.get<ReadReplicaStrategy>('database.readReplicas.strategy') ??
      'round-robin';
    this.replicas = this.configService.get<string[]>('database.readReplicas.urls') ?? [];
  }

  /**
   * Check if read replica routing is enabled
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  isEnabled(): boolean {
    return this.enabled && this.replicas.length > 0;
  }

  /**
   * Select read replica for query
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  selectReplica(): PrismaService | null {
    if (!this.isEnabled()) {
      return null;
    }

    // For now, return primary PrismaService
    // In production, this would route to actual read replica connections
    return this.prismaService;
  }

  /**
   * Check replica health
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  checkReplicaHealth(replicaId: string): ReplicaHealth {
    const startTime = Date.now();
    let healthy = false;
    let latency = 0;

    try {
      // Simple health check - in production, this would ping the replica
      healthy = true;
      latency = Date.now() - startTime;
    } catch (error) {
      healthy = false;
      latency = Date.now() - startTime;

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Replica health check failed for ${replicaId}: ${error instanceof Error ? error.message : String(error)}`,
        this.serviceName,
        { error: error instanceof Error ? error.stack : String(error) }
      );
    }

    const health: ReplicaHealth = {
      replicaId,
      healthy,
      latency,
      lastCheck: new Date(),
    };

    this.replicaHealth.set(replicaId, health);
    return health;
  }

  /**
   * Get replica health status
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  getReplicaHealth(): ReplicaHealth[] {
    return Array.from(this.replicaHealth.values());
  }
}
