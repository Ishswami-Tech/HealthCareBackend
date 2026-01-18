/**
 * Logging Infrastructure - Single Unified Service
 *
 * SINGLE ENTRY POINT: Only LoggingService and LoggingModule are public interfaces.
 * All other components are internal and should be imported directly if needed.
 *
 * SOLID Principles:
 * - Single Responsibility: Each export has one clear purpose
 * - Dependency Inversion: Depend on abstractions (LoggingService interface)
 *
 * KISS Principle: Simple, explicit exports - no hidden circular dependencies
 * DRY Principle: Reuse existing service, don't duplicate functionality
 *
 * Usage:
 * ```typescript
 * // ✅ CORRECT: Use LoggingService (main public interface)
 * import { LoggingService } from "@infrastructure/logging";
 *
 * // ✅ CORRECT: Import other components directly if needed
 * import { LoggingInterceptor } from "@infrastructure/logging/logging.interceptor";
 * import { LoggingHelper } from "@infrastructure/logging/logging.helper";
 * ```
 */

// ONLY PUBLIC EXPORTS: Main service and module
export { LoggingModule } from './logging.module';
export { LoggingService } from './logging.service';

// NOTE: Other components (interceptor, helper, controller, health monitor) are INTERNAL
// Import them directly from their files if needed to avoid circular dependencies

