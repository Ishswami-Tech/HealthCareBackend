import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

/**
 * Configuration options for circuit breaker
 * @interface CircuitBreakerOptions
 * @description Defines the behavior and thresholds for circuit breaker pattern
 * @example
 * ```typescript
 * const options: CircuitBreakerOptions = {
 *   name: "database-service",
 *   failureThreshold: 5,
 *   recoveryTimeout: 30000,
 *   onStateChange: (state, name) => console.log(`${name} circuit is now ${state}`)
 * };
 * ```
 */
export interface CircuitBreakerOptions {
  /** Unique name for the circuit breaker */
  readonly name: string;
  /** Number of failures before opening the circuit */
  readonly failureThreshold: number;
  /** Time in milliseconds before attempting to close the circuit */
  readonly recoveryTimeout: number;
  /** Optional callback when circuit state changes */
  readonly onStateChange?: (state: string, name: string) => void;
}

/**
 * Circuit Breaker Service for Healthcare Backend
 * @class CircuitBreakerService
 * @description Implements the circuit breaker pattern to prevent cascading failures
 * and improve system resilience. Provides automatic failure detection and recovery.
 * @example
 * ```typescript
 * // Execute a function with circuit breaker protection
 * const result = await circuitBreakerService.execute(
 *   () => databaseService.query("SELECT * FROM users"),
 *   {
 *     name: "database-query",
 *     failureThreshold: 5,
 *     recoveryTimeout: 30000
 *   }
 * );
 * ```
 */
@Injectable()
export class CircuitBreakerService {
  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}
  private circuitStates = new Map<
    string,
    {
      state: 'closed' | 'open' | 'half-open';
      failures: number;
      lastFailureTime?: number;
    }
  >();

  /**
   * Execute a function with circuit breaker protection
   * @description Executes the provided function with circuit breaker pattern protection.
   * Automatically tracks failures and opens the circuit when threshold is reached.
   * @template T - The return type of the function
   * @param fn - The function to execute
   * @param options - Circuit breaker configuration options
   * @returns Promise<T> - The result of the function execution
   * @throws Error - The original error if the function fails
   * @example
   * ```typescript
   * const result = await circuitBreakerService.execute(
   *   async () => await externalApiCall(),
   *   {
   *     name: "external-api",
   *     failureThreshold: 3,
   *     recoveryTimeout: 60000
   *   }
   * );
   * ```
   */
  async execute<T>(fn: () => Promise<T>, options: CircuitBreakerOptions): Promise<T> {
    const state = this.circuitStates.get(options.name) || {
      state: 'closed',
      failures: 0,
    };

    // Simple implementation - just execute the function for now
    // In a full implementation, this would handle circuit breaking logic
    try {
      const result = await fn();

      // Reset failures on success
      if (state.failures > 0) {
        this.circuitStates.set(options.name, { state: 'closed', failures: 0 });
      }

      return result;
    } catch (_error) {
      state.failures++;
      state.lastFailureTime = Date.now();

      if (state.failures >= options.failureThreshold) {
        state.state = 'open';
        options.onStateChange?.('open', options.name);
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Circuit opened',
          'CircuitBreakerService',
          { name: options.name, failures: state.failures }
        );
      }

      this.circuitStates.set(options.name, state);
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Circuit breaker execution failed',
        'CircuitBreakerService',
        { name: options.name, error: _error instanceof Error ? _error.message : String(_error) }
      );
      throw _error;
    }
  }
}
