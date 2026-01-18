/**
 * Logging Infrastructure - Unified Service
 *
 * Main public interfaces for logging functionality.
 * Following SOLID/KISS/DRY principles while maintaining backward compatibility.
 *
 * Usage:
 * ```typescript
 * // Main services and utilities
 * import { LoggingService, safeLog, safeLogError } from "@infrastructure/logging";
 * ```
 */

// MAIN EXPORTS: Service and Module
export { LoggingModule } from './logging.module';
export { LoggingService } from './logging.service';

// UTILITY EXPORTS: Helper functions for safe logging (commonly used)
export { safeLog, safeLogError } from './logging.helper';

// NOTE: Other components (interceptor, controller, health monitor) can be imported directly:
// import { LoggingInterceptor } from "@infrastructure/logging/logging.interceptor";
// import { LoggingHealthMonitorService } from "@infrastructure/logging/logging-health-monitor.service";
