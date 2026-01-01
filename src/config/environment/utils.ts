/**
 * Shared utility functions for environment configuration
 * @module EnvironmentUtils
 * @description Common parsing and validation utilities used across all environment configs
 */

/**
 * Parses integer from environment variable with validation
 * @param value - Environment variable value
 * @param defaultValue - Default value
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Parsed integer
 */
export function parseInteger(
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
 * Parses boolean from environment variable
 * @param value - Environment variable value
 * @param defaultValue - Default boolean value
 * @returns Parsed boolean or default
 */
export function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

/**
 * Removes trailing slashes from URL strings
 * @param url - URL string
 * @returns URL without trailing slash
 */
export function removeTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * Detects if running in Docker/Kubernetes environment
 * @returns true if running in containerized environment
 */
export function isDockerEnvironment(): boolean {
  return (
    process.env['DOCKER_ENV'] === 'true' ||
    process.env['KUBERNETES_SERVICE_HOST'] !== undefined ||
    (typeof process.platform !== 'undefined' &&
      process.platform === 'linux' &&
      typeof process.env['HOSTNAME'] !== 'undefined')
  );
}

/**
 * Gets default Redis host based on environment
 * @returns 'redis' if in Docker, 'localhost' otherwise
 */
export function getDefaultRedisHost(): string {
  return isDockerEnvironment() ? 'redis' : 'localhost';
}

/**
 * Safely gets environment variable value using ENV_VARS constant
 * This helper function satisfies TypeScript's strict type checking
 * Use in config factories where ConfigService is not yet available
 * Dotenv is already loaded by config.module.ts before factories run
 * @param envVar - Environment variable name from ENV_VARS constant
 * @returns Environment variable value or undefined
 */
export function getEnv(envVar: string): string | undefined {
  return process.env[envVar];
}

/**
 * Get environment variable with default value (mimics ConfigService.getEnv)
 * Use in config factories where ConfigService is not yet available
 * Dotenv is already loaded by config.module.ts before factories run
 * @param key - Environment variable name
 * @param defaultValue - Default value if not found
 * @returns Environment variable value or default
 */
export function getEnvWithDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * Get environment variable as number (mimics ConfigService.getEnvNumber)
 * Use in config factories where ConfigService is not yet available
 * @param key - Environment variable name
 * @param defaultValue - Default value if not found or invalid
 * @returns Parsed number or default
 */
export function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get environment variable as boolean (mimics ConfigService.getEnvBoolean)
 * Use in config factories where ConfigService is not yet available
 * @param key - Environment variable name
 * @param defaultValue - Default value if not found
 * @returns Parsed boolean or default
 */
export function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

/**
 * Check if environment variable exists (mimics ConfigService.hasEnv)
 * Use in config factories where ConfigService is not yet available
 * @param key - Environment variable name
 * @returns True if variable exists and has a value
 */
export function hasEnv(key: string): boolean {
  return process.env[key] !== undefined;
}

/**
 * Get environment name (mimics ConfigService.getEnvironment)
 * Use in config factories where ConfigService is not yet available
 * @returns Environment name (development, production, staging, test, local-prod)
 */
export function getEnvironment(): string {
  return process.env['NODE_ENV'] || 'development';
}

/**
 * Check if in production (mimics ConfigService.isProduction)
 * Use in config factories where ConfigService is not yet available
 * @returns True if NODE_ENV is production
 */
export function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

/**
 * Check if in development (mimics ConfigService.isDevelopment)
 * Use in config factories where ConfigService is not yet available
 * @returns True if NODE_ENV is development
 */
export function isDevelopment(): boolean {
  return process.env['NODE_ENV'] === 'development';
}
