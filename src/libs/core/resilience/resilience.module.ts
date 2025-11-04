import { Module } from '@nestjs/common';
import { LoggingModule } from '@infrastructure/logging';
import { CircuitBreakerService } from './circuit-breaker.service';

/**
 * Resilience Module for Healthcare Backend
 * @module ResilienceModule
 * @description Provides resilience patterns and fault tolerance mechanisms
 * including circuit breakers, retry logic, and failure handling.
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
  imports: [LoggingModule],
  providers: [CircuitBreakerService],
  exports: [CircuitBreakerService],
})
export class ResilienceModule {}
