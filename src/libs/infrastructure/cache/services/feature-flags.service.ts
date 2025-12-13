/**
 * Feature Flags Service
 * @class FeatureFlagsService
 * @description Manages feature flags for cache features
 */

import { Injectable, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
// IMPORTANT: avoid importing from the @config barrel in infra boot code (SWC TDZ/cycles).
import { ConfigService } from '@config/config.service';
import type { LoggerLike } from '@core/types';

/**
 * Feature flags for cache system
 */
export interface CacheFeatureFlags {
  readonly swrEnabled: boolean;
  readonly adaptiveCachingEnabled: boolean;
  readonly predictiveCachingEnabled: boolean;
  readonly compressionEnabled: boolean;
  readonly encryptionEnabled: boolean;
  readonly shardingEnabled: boolean;
  readonly circuitBreakerEnabled: boolean;
  readonly metricsEnabled: boolean;
  readonly auditLoggingEnabled: boolean;
}

/**
 * Feature flags service for cache
 */
@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private flags!: CacheFeatureFlags;

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    // Use string token to avoid importing LoggingService (prevents SWC TDZ circular-import issues)
    @Inject('LOGGING_SERVICE')
    private readonly loggingService: LoggerLike
  ) {
    // Don't load flags in constructor - wait for onModuleInit
    // ConfigService might not be fully initialized yet
    // Initialize with defaults
    this.flags = {
      swrEnabled: true,
      adaptiveCachingEnabled: true,
      predictiveCachingEnabled: false,
      compressionEnabled: true,
      encryptionEnabled: true,
      shardingEnabled: false,
      circuitBreakerEnabled: true,
      metricsEnabled: true,
      auditLoggingEnabled: true,
    };
  }

  onModuleInit(): void {
    // Load flags after module initialization when ConfigService is ready
    this.loadFlags();
  }

  /**
   * Load feature flags from configuration
   */
  private loadFlags(): void {
    // Use ConfigService (which uses dotenv) for environment variable access
    const getFlag = (key: string, defaultValue: boolean): boolean => {
      try {
        return this.configService.getEnvBoolean(key, defaultValue);
      } catch {
        // Defensive fallback - should rarely be needed
        return defaultValue;
      }
    };

    this.flags = {
      swrEnabled: getFlag('CACHE_SWR_ENABLED', true),
      adaptiveCachingEnabled: getFlag('CACHE_ADAPTIVE_ENABLED', true),
      predictiveCachingEnabled: getFlag('CACHE_PREDICTIVE_ENABLED', false),
      compressionEnabled: getFlag('CACHE_ENABLE_COMPRESSION', true),
      encryptionEnabled: getFlag('CACHE_ENCRYPTION_ENABLED', true),
      shardingEnabled: getFlag('CACHE_SHARDING_ENABLED', false),
      circuitBreakerEnabled: getFlag('CACHE_CIRCUIT_BREAKER_ENABLED', true),
      metricsEnabled: getFlag('CACHE_ENABLE_METRICS', true),
      auditLoggingEnabled: getFlag('CACHE_AUDIT_LOGGING_ENABLED', true),
    };
  }

  /**
   * Get all feature flags
   */
  getFlags(): CacheFeatureFlags {
    return { ...this.flags };
  }

  /**
   * Check if feature is enabled
   */
  isEnabled(feature: keyof CacheFeatureFlags): boolean {
    return this.flags[feature];
  }

  /**
   * Reload feature flags
   */
  reload(): void {
    this.loadFlags();
  }
}
