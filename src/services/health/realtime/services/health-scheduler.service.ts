/**
 * Health Scheduler Service
 * Schedules periodic health checks with leader election
 */

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthAggregatorService } from './health-aggregator.service';
import { HealthCacheService } from './health-cache.service';
import { ChangeDetectorService } from './change-detector.service';
import { HealthBroadcasterService } from './health-broadcaster.service';

@Injectable()
export class HealthSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly CHECK_INTERVAL_MS = 15000; // 15 seconds
  private readonly LOCK_TTL_MS = 30000; // 30 seconds (2x interval)
  private readonly LOCK_KEY = 'health:check:lock';
  private readonly INSTANCE_ID = `${process.pid}-${Date.now()}`;

  private healthCheckInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isLeader = false;

  constructor(
    private readonly aggregator: HealthAggregatorService,
    private readonly cache: HealthCacheService,
    private readonly changeDetector: ChangeDetectorService,
    private readonly broadcaster: HealthBroadcasterService,
    @Optional()
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService?: CacheService,
    @Optional()
    @Inject(forwardRef(() => ConfigService))
    private readonly configService?: ConfigService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  onModuleInit() {
    // Start leader election and health checks
    this.startHealthChecks();
    // Start heartbeat (lightweight ping every 60s)
    this.startHeartbeat();
  }

  onModuleDestroy() {
    this.stopHealthChecks();
    this.stopHeartbeat();
    // Release lock if we're the leader
    if (this.isLeader) {
      void this.releaseLock();
    }
  }

  /**
   * Start health check scheduler
   */
  private startHealthChecks(): void {
    // Try to acquire lock immediately
    void this.tryAcquireLock();

    // Check for lock every interval
    this.healthCheckInterval = setInterval(() => {
      void this.tryAcquireLock();
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop health check scheduler
   */
  private stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Start heartbeat (lightweight ping every 60s)
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      void this.sendHeartbeat();
    }, 60000); // 60 seconds
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Try to acquire lock (leader election)
   */
  private async tryAcquireLock(): Promise<void> {
    if (!this.cacheService) {
      // No cache service - run as single instance
      if (!this.isLeader) {
        this.isLeader = true;
        void this.runHealthCheck();
      }
      return;
    }

    try {
      // Try to acquire lock: Check if lock exists, if not, set it
      const existingLock = await this.cacheService.get<string>(this.LOCK_KEY);

      if (!existingLock) {
        // No lock exists - try to acquire it
        await this.cacheService.set(
          this.LOCK_KEY,
          this.INSTANCE_ID,
          Math.floor(this.LOCK_TTL_MS / 1000)
        );

        // Double-check we got the lock (race condition protection)
        const lockOwner = await this.cacheService.get<string>(this.LOCK_KEY);
        const acquired = lockOwner === this.INSTANCE_ID;

        if (acquired && !this.isLeader) {
          // We acquired the lock - become leader
          this.isLeader = true;

          void this.loggingService?.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            `Health check leader acquired: ${this.INSTANCE_ID}`,
            'HealthSchedulerService',
            { instanceId: this.INSTANCE_ID }
          );

          // Run initial health check
          void this.runHealthCheck();

          // Refresh lock periodically (before TTL expires)
          setInterval(() => {
            if (this.isLeader) {
              void this.refreshLock();
            }
          }, this.LOCK_TTL_MS / 2);
        }
      } else if (existingLock && existingLock !== this.INSTANCE_ID && this.isLeader) {
        // Another instance owns the lock - we lost it
        this.isLeader = false;

        void this.loggingService?.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Health check leader lost: ${this.INSTANCE_ID}`,
          'HealthSchedulerService',
          { instanceId: this.INSTANCE_ID }
        );
      } else if (existingLock === this.INSTANCE_ID && this.isLeader) {
        // We're still the leader - run health check
        void this.runHealthCheck();
      } else if (existingLock === this.INSTANCE_ID && !this.isLeader) {
        // We own the lock but weren't leader (recovered)
        this.isLeader = true;
        void this.runHealthCheck();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to acquire health check lock: ${errorMessage}`,
        'HealthSchedulerService',
        { error: errorMessage, instanceId: this.INSTANCE_ID }
      );

      // If we were leader and lost connection, continue as single instance
      if (this.isLeader) {
        void this.runHealthCheck();
      }
    }
  }

  /**
   * Refresh lock (extend TTL)
   */
  private async refreshLock(): Promise<void> {
    if (!this.cacheService || !this.isLeader) {
      return;
    }

    try {
      // Check if we still own the lock
      const currentOwner = await this.cacheService.get<string>(this.LOCK_KEY);

      if (currentOwner === this.INSTANCE_ID) {
        // Extend lock TTL
        await this.cacheService.set(
          this.LOCK_KEY,
          this.INSTANCE_ID,
          Math.floor(this.LOCK_TTL_MS / 1000)
        );
      } else {
        // Someone else owns the lock
        this.isLeader = false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to refresh health check lock: ${errorMessage}`,
        'HealthSchedulerService',
        { error: errorMessage }
      );
    }
  }

  /**
   * Release lock
   */
  private async releaseLock(): Promise<void> {
    if (!this.cacheService) {
      return;
    }

    try {
      // Only release if we own it
      const currentOwner = await this.cacheService.get<string>(this.LOCK_KEY);

      if (currentOwner === this.INSTANCE_ID) {
        await this.cacheService.delete(this.LOCK_KEY);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to release health check lock: ${errorMessage}`,
        'HealthSchedulerService',
        { error: errorMessage }
      );
    }
  }

  /**
   * Run health check (only if leader)
   */
  private async runHealthCheck(): Promise<void> {
    if (!this.isLeader) {
      return;
    }

    try {
      // Get Socket.IO server from broadcaster (if available)
      const socketServer = this.broadcaster.getSocketServer();

      // Aggregate health
      const healthStatus = await this.aggregator.aggregateHealth(socketServer);

      // Cache status
      await this.cache.cacheStatus(healthStatus);

      // Detect changes
      const changes = this.changeDetector.detectChanges(healthStatus);

      // Broadcast if changes detected
      if (changes.length > 0) {
        this.broadcaster.broadcastChanges(changes, healthStatus);
      }

      // Always broadcast full status update (for new connections)
      this.broadcaster.broadcastStatus(healthStatus);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Health check failed: ${errorMessage}`,
        'HealthSchedulerService',
        { error: errorMessage }
      );
    }
  }

  /**
   * Send heartbeat (lightweight ping)
   */
  private async sendHeartbeat(): Promise<void> {
    try {
      // Get cached status for overall status
      const cachedStatus = await this.cache.getCachedStatus();

      if (cachedStatus) {
        this.broadcaster.broadcastHeartbeat(cachedStatus.overall);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Heartbeat failed: ${errorMessage}`,
        'HealthSchedulerService',
        { error: errorMessage }
      );
    }
  }

  /**
   * Get current leader status
   */
  isCurrentLeader(): boolean {
    return this.isLeader;
  }
}
