import { registerAs } from '@nestjs/config';
import { ENV_VARS, DEFAULT_CONFIG } from './constants';
import type { RedisConfig } from '@core/types';

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
 * Redis configuration factory
 */
export default registerAs('redis', (): RedisConfig => {
  const config: RedisConfig = {
    host: process.env[ENV_VARS.REDIS_HOST] ?? 'localhost',
    port: parseRedisInteger(process.env[ENV_VARS.REDIS_PORT], 6379, 1, 65535),
    ttl: parseRedisInteger(process.env['REDIS_TTL'], DEFAULT_CONFIG.REDIS_TTL, 1),
    prefix: process.env['REDIS_PREFIX'] ?? 'healthcare:',
    // Respect REDIS_ENABLED explicitly - if set to 'false', disable it
    // Otherwise, enable it (default to true in all environments)
    enabled: process.env['REDIS_ENABLED'] !== 'false',
    development: process.env[ENV_VARS.NODE_ENV] === 'development',
  };

  // Validate configuration
  validateRedisConfig(config);

  return config;
});
