import { registerAs } from '@nestjs/config';

export interface RateLimitRule {
  limit: number;
  window: number;  // in seconds
  burst?: number;  // allow burst requests
  cost?: number;   // request cost
}

export interface RateLimitConfig {
  enabled: boolean;
  rules: {
    [key: string]: RateLimitRule;
  };
  security: {
    maxAttempts: number;
    attemptWindow: number;
    lockoutIntervals: number[];
    maxConcurrentSessions: number;
    sessionInactivityThreshold: number;
  };
}

export default registerAs('rateLimit', (): RateLimitConfig => ({
  enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
  rules: {
    // API endpoints
    api: {
      limit: parseInt(process.env.API_RATE_LIMIT) || 100,
      window: 60,  // 1 minute
      burst: 20    // Allow 20 extra requests for bursts
    },
    // Authentication endpoints
    auth: {
      limit: parseInt(process.env.AUTH_RATE_LIMIT) || 5,
      window: 60,  // 1 minute
      burst: 2     // Allow 2 extra attempts
    },
    // Heavy operations (e.g., file uploads, reports)
    heavy: {
      limit: parseInt(process.env.HEAVY_RATE_LIMIT) || 10,
      window: 300, // 5 minutes
      cost: 2      // Each request counts as 2
    },
    // User profile operations
    user: {
      limit: parseInt(process.env.USER_RATE_LIMIT) || 50,
      window: 60   // 1 minute
    },
    // Health check endpoints
    health: {
      limit: parseInt(process.env.HEALTH_RATE_LIMIT) || 200,
      window: 60   // 1 minute
    }
  },
  security: {
    maxAttempts: parseInt(process.env.MAX_AUTH_ATTEMPTS) || 5,
    attemptWindow: parseInt(process.env.AUTH_ATTEMPT_WINDOW) || 1800, // 30 minutes
    lockoutIntervals: [10, 25, 45, 60, 360], // Progressive lockout in minutes
    maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS) || 5,
    sessionInactivityThreshold: parseInt(process.env.SESSION_INACTIVITY_THRESHOLD) || 900 // 15 minutes
  }
})); 