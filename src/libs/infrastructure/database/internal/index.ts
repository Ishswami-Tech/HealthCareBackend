/**
 * Internal Database Services
 *
 * @internal
 * These services are for internal use only within the database module.
 * They are NOT exported publicly from the database module.
 */

export { HealthcareQueryOptimizerService } from './query-optimizer.service';
export { ClinicIsolationService } from './clinic-isolation.service';
export { DatabaseMetricsService } from './database-metrics.service';
export type { ClinicContext, ClinicIsolationResult } from './clinic-isolation.service';
