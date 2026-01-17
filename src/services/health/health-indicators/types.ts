/**
 * Custom Health Indicator Types
 * Replaces @nestjs/terminus types to use only LoggingService
 * Follows .ai-rules/ coding standards
 */

/**
 * Health indicator result format
 * Replaces HealthIndicatorResult from @nestjs/terminus
 */
export interface HealthIndicatorResult {
  [key: string]: {
    status: 'up' | 'down';
    message?: string;
    [key: string]: unknown;
  };
}

/**
 * Health check error
 * Replaces HealthCheckError from @nestjs/terminus
 */
export class HealthCheckError extends Error {
  public readonly causes: Record<string, unknown>;

  constructor(message: string, causes: Record<string, unknown>) {
    super(message);
    this.name = 'HealthCheckError';
    this.causes = causes;
    Error.captureStackTrace(this, this.constructor);
  }
}
