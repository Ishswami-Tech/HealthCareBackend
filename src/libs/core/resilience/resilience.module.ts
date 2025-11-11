import { Module } from '@nestjs/common';
// LoggingModule is @Global() - no need to import it
import { CircuitBreakerService } from './circuit-breaker.service';
import { GracefulShutdownService, ProcessErrorHandlersService } from './graceful-shutdown.service';

/**
 * Resilience Module for Healthcare Backend
 * @module ResilienceModule
 * @description Provides resilience patterns and fault tolerance mechanisms
 * including circuit breakers, retry logic, graceful shutdown, and failure handling.
 * @example
 * ```typescript
 * @Module({
 *   imports: [ResilienceModule],
 *   // ... other module configuration
 * })
 * export class AppModule {}
 * ```
 */
@Module({
  imports: [
    // LoggingModule is @Global() - available for injection without explicit import
  ],
  providers: [CircuitBreakerService, GracefulShutdownService, ProcessErrorHandlersService],
  exports: [CircuitBreakerService, GracefulShutdownService, ProcessErrorHandlersService],
})
export class ResilienceModule {}
