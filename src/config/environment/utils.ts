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
