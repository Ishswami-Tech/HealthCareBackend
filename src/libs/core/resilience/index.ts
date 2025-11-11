/**
 * Resilience Module Exports
 * @module Resilience
 * @description Exports all resilience-related services and utilities
 * for fault tolerance and system resilience patterns.
 * @example
 * ```typescript
 * import { CircuitBreakerService } from "@core/resilience";
 *
 * const circuitBreaker = new CircuitBreakerService();
 * ```
 */

export { ResilienceModule } from './resilience.module';
export { CircuitBreakerService } from './circuit-breaker.service';
export { GracefulShutdownService, ProcessErrorHandlersService } from './graceful-shutdown.service';
export type { CircuitBreakerOptions } from './circuit-breaker.service';
