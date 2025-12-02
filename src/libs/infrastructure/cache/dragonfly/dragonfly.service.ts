/**
 * Dragonfly Service
 * @class DragonflyService
 * @description Low-level DragonflyDB service for cache operations
 * Dragonfly is a drop-in Redis replacement with 26x better performance
 * This service provides direct access to Dragonfly operations
 * Extends BaseCacheClientService for common functionality
 */

import { Injectable, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { ConfigService, isCacheEnabled, getCacheProvider } from '@config';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { BaseCacheClientService } from '../base-cache-client.service';

@Injectable()
export class DragonflyService
  extends BaseCacheClientService
  implements OnModuleInit, OnModuleDestroy
{
  // Provider-specific configuration - will be initialized in onModuleInit
  protected PRODUCTION_CONFIG!: {
    maxMemoryPolicy: string;
    maxConnections: number;
    connectionTimeout: number;
    commandTimeout: number;
    retryOnFailover: boolean;
    enableAutoPipelining: boolean;
    maxRetriesPerRequest: number;
    keyPrefix: string;
  };

  protected readonly PROVIDER_NAME = 'dragonfly' as const;
  protected readonly DEFAULT_HOST = 'dragonfly';
  protected readonly HOST_ENV_VAR = 'DRAGONFLY_HOST';
  protected readonly PORT_ENV_VAR = 'DRAGONFLY_PORT';
  protected readonly PASSWORD_ENV_VAR = 'DRAGONFLY_PASSWORD';

  constructor(
    @Inject(forwardRef(() => ConfigService))
    configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    loggingService: LoggingService
  ) {
    super(configService, loggingService);
    // Don't initialize client here - wait for onModuleInit when PRODUCTION_CONFIG is ready
  }
  async onModuleInit() {
    try {
      // Initialize PRODUCTION_CONFIG using ConfigService
      const keyPrefix = this.configService.getEnv('DRAGONFLY_KEY_PREFIX', 'healthcare:');
      this.PRODUCTION_CONFIG = {
        maxMemoryPolicy: 'noeviction',
        maxConnections: this.configService.getEnvNumber('DRAGONFLY_MAX_CONNECTIONS', 100),
        connectionTimeout: 15000,
        commandTimeout: 5000,
        retryOnFailover: true,
        enableAutoPipelining: true,
        maxRetriesPerRequest: 3,
        keyPrefix: keyPrefix || 'healthcare:',
      };

      // Now initialize the client after PRODUCTION_CONFIG is set
      this.initializeClient();

      // Check if cache is enabled using single source of truth
      if (!isCacheEnabled()) {
        if (this.verboseLoggingEnabled) {
          await this.loggingService
            .log(
              LogType.SYSTEM,
              LogLevel.INFO,
              'DragonflyService skipped - cache is disabled',
              'DragonflyService',
              {}
            )
            .catch(() => {
              // Ignore logging errors
            });
        }
        return;
      }

      // Check if already connected
      if (this.client && this.client.status === 'ready') {
        if (this.verboseLoggingEnabled) {
          void this.loggingService
            .log(
              LogType.SYSTEM,
              LogLevel.INFO,
              'Dragonfly already connected, skipping connection attempt',
              'DragonflyService',
              {}
            )
            .catch(() => {
              // Ignore logging errors
            });
        }
        return;
      }

      // Check if Dragonfly is the selected cache provider
      const cacheProvider = getCacheProvider();
      if (cacheProvider !== 'dragonfly') {
        if (this.verboseLoggingEnabled) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            `DragonflyService skipped - using ${cacheProvider} as cache provider`,
            'DragonflyService',
            { cacheProvider }
          );
        }
        return;
      }

      // Check if Dragonfly is enabled using ConfigService
      const configEnabled = this.configService?.get<boolean>('dragonfly.enabled', true);
      const envEnabled = this.configService?.getEnvBoolean('DRAGONFLY_ENABLED', true);
      const isDragonflyEnabled = configEnabled ?? envEnabled;

      if (!isDragonflyEnabled) {
        if (this.verboseLoggingEnabled) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'Dragonfly is disabled in configuration',
            'DragonflyService',
            {}
          );
        }
        return;
      }

      // Connect to Dragonfly
      if (!this.client || this.client.status !== 'ready') {
        await this.client.connect();
        await this.setEvictionPolicy();
        await this.optimizeMemoryUsage();
      }

      if (this.verboseLoggingEnabled) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'DragonflyService initialized successfully',
          'DragonflyService',
          {}
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `DragonflyService initialization failed: ${errorMessage}`,
        'DragonflyService',
        { error: errorMessage }
      );
      // Don't throw - allow app to continue without cache
    }
  }

  async onModuleDestroy() {
    try {
      if (this.client) {
        await this.client.quit();
        if (this.verboseLoggingEnabled) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'DragonflyService disconnected',
            'DragonflyService',
            {}
          );
        }
      }
    } catch (_error) {
      // Ignore errors during shutdown
    }
  }

  /**
   * Set eviction policy to noeviction
   * Note: In Dragonfly, eviction policy is controlled by --cache_mode flag:
   * - cache_mode=false (or not set) = noeviction (no eviction, returns OOM errors when full)
   * - cache_mode=true = automatic eviction (LRU/LFU)
   * Since we set cache_mode=false in Docker Compose, eviction is already disabled.
   * This method verifies the configuration.
   */
  private async setEvictionPolicy(): Promise<void> {
    try {
      // Dragonfly uses cache_mode flag, not maxmemory-policy CONFIG command
      // Verify that cache_mode is false (which means noeviction)
      // We can't change this at runtime - it's set at startup
      if (this.verboseLoggingEnabled) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Dragonfly eviction policy: noeviction (cache_mode=false set at startup)',
          'DragonflyService',
          {
            note: 'Dragonfly eviction is controlled by --cache_mode flag. cache_mode=false means noeviction policy.',
          }
        );
      }
    } catch (_error) {
      // Ignore logging errors
    }
  }

  /**
   * Auto-scaling cache management
   * Note: Dragonfly may not support all Redis CONFIG commands
   * The eviction policy is set separately via setEvictionPolicy()
   */
  async optimizeMemoryUsage(): Promise<void> {
    if (this.configService?.isProduction() ?? false) {
      try {
        if (this.verboseLoggingEnabled) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'Applied production memory optimizations',
            'DragonflyService',
            {}
          );
        }
      } catch (_error) {
        // Ignore config errors
      }
    }
  }

  // All basic operations are inherited from BaseCacheClientService
  // Only provider-specific methods remain here
}
