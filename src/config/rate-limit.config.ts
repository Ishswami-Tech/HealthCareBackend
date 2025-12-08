import { registerAs } from '@nestjs/config';
import type { EnhancedRateLimitConfig } from '@core/types';
import { parseInteger, getEnv, getEnvBoolean } from './environment/utils';

/**
 * Validates rate limit configuration
 * @param config - Rate limit configuration
 * @throws Error if configuration is invalid
 */
function validateRateLimitConfig(config: EnhancedRateLimitConfig): void {
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
export default registerAs('rateLimit', (): EnhancedRateLimitConfig => {
  // Use helper functions (which use dotenv) for environment variable access
  const config: EnhancedRateLimitConfig = {
    enabled: getEnvBoolean('RATE_LIMIT_ENABLED', true),
    rules: {
      // API endpoints
      api: {
        limit: parseInteger(getEnv('API_RATE_LIMIT'), 100, 1, 10000),
        window: 60, // 1 minute
        burst: 20, // Allow 20 extra requests for bursts
      },
      // Authentication endpoints
      auth: {
        limit: parseInteger(getEnv('AUTH_RATE_LIMIT'), 5, 1, 100),
        window: 60, // 1 minute
        burst: 2, // Allow 2 extra attempts
      },
      // Heavy operations (e.g., file uploads, reports)
      heavy: {
        limit: parseInteger(getEnv('HEAVY_RATE_LIMIT'), 10, 1, 100),
        window: 300, // 5 minutes
        cost: 2, // Each request counts as 2
      },
      // User profile operations
      user: {
        limit: parseInteger(getEnv('USER_RATE_LIMIT'), 50, 1, 1000),
        window: 60, // 1 minute
      },
      // Health check endpoints
      health: {
        limit: parseInteger(getEnv('HEALTH_RATE_LIMIT'), 200, 1, 10000),
        window: 60, // 1 minute
      },
    },
    security: {
      maxAttempts: parseInteger(getEnv('MAX_AUTH_ATTEMPTS'), 5, 1, 20),
      attemptWindow: parseInteger(getEnv('AUTH_ATTEMPT_WINDOW'), 1800, 60, 86400), // 30 minutes
      lockoutIntervals: [10, 25, 45, 60, 360] as const, // Progressive lockout in minutes
      maxConcurrentSessions: parseInteger(getEnv('MAX_CONCURRENT_SESSIONS'), 5, 1, 50),
      sessionInactivityThreshold: parseInteger(
        getEnv('SESSION_INACTIVITY_THRESHOLD'),
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
