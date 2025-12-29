/**
 * Health Indicators Index
 * @description Central export point for all health indicators
 * Follows SOLID, DRY, and KISS principles
 *
 * Note: Communication and email health checks are clinic-specific
 * and should be handled at the clinic level, not in system health checks
 */

export { BaseHealthIndicator } from './base-health.indicator';
export { DatabaseHealthIndicator } from './database-health.indicator';
export { CacheHealthIndicator } from './cache-health.indicator';
export { QueueHealthIndicator } from './queue-health.indicator';
export { LoggingHealthIndicator } from './logging-health.indicator';
export { VideoHealthIndicator } from './video-health.indicator';
