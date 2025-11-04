import { registerAs } from '@nestjs/config';
// import { ENV_VARS } from "./constants"; // Not used in this file

/**
 * Rate limit rule configuration
 * @interface RateLimitRule
 */
export interface RateLimitRule {
  /** Maximum number of requests allowed */
  readonly limit: number;
  /** Time window in seconds */
  readonly window: number;
  /** Allow burst requests (optional) */
  readonly burst?: number;
  /** Request cost multiplier (optional) */
  readonly cost?: number;
}

/**
 * Rate limit configuration interface
 * @interface RateLimitConfig
 */
export interface RateLimitConfig {
  /** Whether rate limiting is enabled */
  readonly enabled: boolean;
  /** Rate limit rules for different endpoints */
  readonly rules: {
    readonly [key: string]: RateLimitRule;
  };
  /** Security-related rate limiting settings */
  readonly security: {
    /** Maximum authentication attempts */
    readonly maxAttempts: number;
    /** Authentication attempt window in seconds */
    readonly attemptWindow: number;
    /** Progressive lockout intervals in minutes */
    readonly lockoutIntervals: readonly number[];
    /** Maximum concurrent sessions per user */
    readonly maxConcurrentSessions: number;
    /** Session inactivity threshold in seconds */
    readonly sessionInactivityThreshold: number;
  };
}

/**
 * Parses integer from environment variable with validation
 * @param value - Environment variable value
 * @param defaultValue - Default value
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Parsed integer
 */
function parseRateLimitInteger(
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
 * Validates rate limit configuration
 * @param config - Rate limit configuration
 * @throws Error if configuration is invalid
 */
function validateRateLimitConfig(config: RateLimitConfig): void {
  if (config.security.maxAttempts < 1) {
    throw new Error('maxAttempts must be at least 1');
  }

  if (config.security.attemptWindow < 60) {
    throw new Error('attemptWindow must be at least 60 seconds');
  }

  if (config.security.lockoutIntervals.some(interval => interval < 1)) {
    throw new Error('lockoutIntervals must be positive numbers');
  }

  if (config.security.maxConcurrentSessions < 1) {
    throw new Error('maxConcurrentSessions must be at least 1');
  }

  if (config.security.sessionInactivityThreshold < 60) {
    throw new Error('sessionInactivityThreshold must be at least 60 seconds');
  }
}

/**
 * Rate limit configuration factory
 */
export default registerAs('rateLimit', (): RateLimitConfig => {
  const config: RateLimitConfig = {
    enabled: process.env['RATE_LIMIT_ENABLED'] !== 'false',
    rules: {
      // API endpoints
      api: {
        limit: parseRateLimitInteger(process.env['API_RATE_LIMIT'], 100, 1, 10000),
        window: 60, // 1 minute
        burst: 20, // Allow 20 extra requests for bursts
      },
      // Authentication endpoints
      auth: {
        limit: parseRateLimitInteger(process.env['AUTH_RATE_LIMIT'], 5, 1, 100),
        window: 60, // 1 minute
        burst: 2, // Allow 2 extra attempts
      },
      // Heavy operations (e.g., file uploads, reports)
      heavy: {
        limit: parseRateLimitInteger(process.env['HEAVY_RATE_LIMIT'], 10, 1, 100),
        window: 300, // 5 minutes
        cost: 2, // Each request counts as 2
      },
      // User profile operations
      user: {
        limit: parseRateLimitInteger(process.env['USER_RATE_LIMIT'], 50, 1, 1000),
        window: 60, // 1 minute
      },
      // Health check endpoints
      health: {
        limit: parseRateLimitInteger(process.env['HEALTH_RATE_LIMIT'], 200, 1, 10000),
        window: 60, // 1 minute
      },
    },
    security: {
      maxAttempts: parseRateLimitInteger(process.env['MAX_AUTH_ATTEMPTS'], 5, 1, 20),
      attemptWindow: parseRateLimitInteger(process.env['AUTH_ATTEMPT_WINDOW'], 1800, 60, 86400), // 30 minutes
      lockoutIntervals: [10, 25, 45, 60, 360] as const, // Progressive lockout in minutes
      maxConcurrentSessions: parseRateLimitInteger(
        process.env['MAX_CONCURRENT_SESSIONS'],
        5,
        1,
        50
      ),
      sessionInactivityThreshold: parseRateLimitInteger(
        process.env['SESSION_INACTIVITY_THRESHOLD'],
        900,
        60,
        86400
      ), // 15 minutes
    },
  };

  // Validate configuration
  validateRateLimitConfig(config);

  return config;
});
