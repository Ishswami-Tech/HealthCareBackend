/**
 * Database Services
 * Split services following Single Responsibility Principle
 *
 * @internal All services in this module are internal infrastructure components
 * and should not be imported directly by external services.
 * Use DatabaseService (HealthcareDatabaseClient) instead.
 */

export { RetryService } from './retry.service';
export type { RetryOptions } from './retry.service';
export { ReadReplicaRouterService } from './read-replica-router.service';
export { ConnectionLeakDetectorService } from './connection-leak-detector.service';
export type { ConnectionLeakInfo } from './connection-leak-detector.service';
export { DatabaseHealthMonitorService } from './database-health-monitor.service';
export type { DatabaseHealthMonitorStatus } from '@core/types';
export { QueryCacheService } from './query-cache.service';
export type { QueryCacheOptions } from './query-cache.service';
export { DatabaseAlertService } from './database-alert.service';
export type { Alert } from '@core/types/database.types';
export { DatabaseMetricsService } from './database-metrics.service';
export { ClinicIsolationService } from './clinic-isolation.service';
export { HealthcareQueryOptimizerService } from './query-optimizer.service';
