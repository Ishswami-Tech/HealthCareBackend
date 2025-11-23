/**
 * Cache Configuration - Single Source of Truth
 * @file cache.config.ts
 * @description Centralized cache configuration that determines if cache is enabled
 * This is the ONLY place where CACHE_ENABLED should be checked
 * All cache services must use this configuration
 *
 * Also includes Redis configuration (merged from redis.config.ts)
 * for backward compatibility and unified cache management
 */

import { registerAs } from '@nestjs/config';
import type { CacheConfig, RedisConfig } from '@core/types';
import { ENV_VARS, DEFAULT_CONFIG } from './constants';

/**
 * Check if cache is enabled
 * This is the SINGLE SOURCE OF TRUTH for cache enabled status
 * @returns true if cache is enabled, false otherwise
 */
export function isCacheEnabled(): boolean {
  const cacheEnabledEnv = process.env['CACHE_ENABLED'];
  // Only enable cache if explicitly set to 'true'
  return cacheEnabledEnv === 'true';
}

/**
 * Get cache provider type
 * @returns 'redis' | 'dragonfly' | 'memory'
 */
export function getCacheProvider(): 'redis' | 'dragonfly' | 'memory' {
  if (!isCacheEnabled()) {
    return 'memory'; // Return memory when cache is disabled
  }

  const provider = (process.env['CACHE_PROVIDER'] || 'dragonfly').toLowerCase();
  if (provider === 'redis' || provider === 'dragonfly' || provider === 'memory') {
    return provider;
  }

  return 'dragonfly'; // Default to Dragonfly
}

/**
 * Validates Redis configuration
 * @param config - Redis configuration object
 * @throws Error if configuration is invalid
 */
function validateRedisConfig(config: RedisConfig): void {
  if (config.port < 1 || config.port > 65535) {
    throw new Error('Redis port must be between 1 and 65535');
  }

  if (config.ttl < 1) {
    throw new Error('Redis TTL must be a positive number');
  }

  if (!config.prefix || config.prefix.length === 0) {
    throw new Error('Redis prefix cannot be empty');
  }

  if (!config.host || config.host.length === 0) {
    throw new Error('Redis host cannot be empty');
  }
}

/**
 * Parses integer from environment variable with validation
 * @param value - Environment variable value
 * @param defaultValue - Default value
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Parsed integer
 */
function parseRedisInteger(
  value: string | undefined,
  defaultValue: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER
): number {
  const parsed = value ? parseInt(value, 10) : defaultValue;

  if (isNaN(parsed) || parsed < min || parsed > max) {
    return defaultValue;
  }

  return parsed;
}

/**
 * Cache configuration factory
 * This is registered with NestJS ConfigModule as 'cache'
 */
export const cacheConfig = registerAs('cache', (): CacheConfig => {
  const enabled = isCacheEnabled();
  const provider = getCacheProvider();

  const redisPassword = process.env['REDIS_PASSWORD'];
  const dragonflyPassword = process.env['DRAGONFLY_PASSWORD'];

  return {
    enabled,
    provider,
    // Only include provider-specific config if cache is enabled
    ...(enabled && {
      redis: {
        host: process.env['REDIS_HOST'] || 'localhost',
        port: parseInt(process.env['REDIS_PORT'] || '6379', 10),
        ...(redisPassword && { password: redisPassword }),
        enabled: provider === 'redis',
      },
      dragonfly: {
        host: process.env['DRAGONFLY_HOST'] || 'dragonfly',
        port: parseInt(process.env['DRAGONFLY_PORT'] || '6379', 10),
        ...(dragonflyPassword && { password: dragonflyPassword }),
        enabled: provider === 'dragonfly',
      },
    }),
  };
});

/**
 * Redis configuration factory (for backward compatibility)
 * This is registered with NestJS ConfigModule as 'redis'
 * Merged from redis.config.ts - now part of unified cache configuration
 */
export const redisConfig = registerAs('redis', (): RedisConfig => {
  const config: RedisConfig = {
    host: process.env[ENV_VARS.REDIS_HOST] ?? 'localhost',
    port: parseRedisInteger(process.env[ENV_VARS.REDIS_PORT], 6379, 1, 65535),
    ttl: parseRedisInteger(process.env['REDIS_TTL'], DEFAULT_CONFIG.REDIS_TTL, 1),
    prefix: process.env['REDIS_PREFIX'] ?? 'healthcare:',
    // Respect cache enabled status - Redis is only enabled if cache is enabled and Redis is the provider
    enabled: isCacheEnabled() && getCacheProvider() === 'redis',
    development: process.env[ENV_VARS.NODE_ENV] === 'development',
  };

  // Validate configuration
  validateRedisConfig(config);

  return config;
});

/**
 * Default export - cache config (primary)
 */
export default cacheConfig;

/**
 * Export utility functions for direct use (without ConfigService)
 * These can be used in module initialization before ConfigService is available
 */
export const CacheConfigUtils = {
  isEnabled: isCacheEnabled,
  getProvider: getCacheProvider,
};
