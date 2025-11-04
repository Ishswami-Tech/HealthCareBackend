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

export { CircuitBreakerService } from './circuit-breaker.service';
export { ResilienceModule } from './resilience.module';
export type { CircuitBreakerOptions } from './circuit-breaker.service';
