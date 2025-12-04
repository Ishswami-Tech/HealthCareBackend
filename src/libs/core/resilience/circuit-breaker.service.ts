import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { CircuitBreakerState } from '@core/types';

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
 * Internal circuit breaker state
 */
interface InternalCircuitState {
  isOpen: boolean;
  failures: number;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  nextAttemptTime?: number;
  state: 'closed' | 'open' | 'half-open';
}

/**
 * Circuit Breaker Service for Healthcare Backend
 * @class CircuitBreakerService
 * @description Implements the circuit breaker pattern to prevent cascading failures
 * and improve system resilience. Provides automatic failure detection and recovery.
 * Supports both named circuit breakers (for multiple services) and a default instance
 * for simple use cases.
 * @example
 * ```typescript
 * // Execute a function with circuit breaker protection (named)
 * const result = await circuitBreakerService.execute(
 *   () => databaseService.query("SELECT * FROM users"),
 *   {
 *     name: "database-query",
 *     failureThreshold: 5,
 *     recoveryTimeout: 30000
 *   }
 * );
 *
 * // Simple usage with default instance
 * if (circuitBreakerService.canExecute()) {
 *   try {
 *     await someOperation();
 *     circuitBreakerService.recordSuccess();
 *   } catch (error) {
 *     circuitBreakerService.recordFailure();
 *   }
 * }
 * ```
 */
@Injectable()
export class CircuitBreakerService {
  private readonly defaultThreshold: number = 10;
  private readonly defaultTimeout: number = 30000;
  private readonly serviceStartTime = Date.now();
  private readonly STARTUP_GRACE_PERIOD = 90000; // 90 seconds grace period during startup

  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  private circuitStates = new Map<string, InternalCircuitState>();

  /**
   * Get or create a circuit breaker state (internal)
   */
  private getInternalState(
    name: string,
    _threshold?: number,
    _timeout?: number
  ): InternalCircuitState {
    if (!this.circuitStates.has(name)) {
      this.circuitStates.set(name, {
        isOpen: false,
        failures: 0,
        failureCount: 0,
        successCount: 0,
        state: 'closed',
      });
    }
    return this.circuitStates.get(name)!;
  }

  /**
   * Check if circuit breaker allows operation (for default instance)
   * @param name - Optional circuit breaker name (defaults to 'default')
   * @returns true if operation can proceed, false if circuit is open
   */
  canExecute(name: string = 'default'): boolean {
    const state = this.getInternalState(name);

    if (!state.isOpen) {
      return true;
    }

    // Check if timeout has passed (half-open state)
    if (state.nextAttemptTime && Date.now() >= state.nextAttemptTime) {
      state.state = 'half-open';
      return true;
    }

    return false;
  }

  /**
   * Record success (for default instance)
   * @param name - Optional circuit breaker name (defaults to 'default')
   */
  recordSuccess(name: string = 'default'): void {
    const state = this.getInternalState(name);
    state.successCount++;

    if (state.isOpen || state.state === 'half-open') {
      // Reset on success in half-open or open state
      this.reset(name);
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Circuit breaker closed after successful operation',
        'CircuitBreakerService',
        { name, failures: state.failures }
      );
    } else {
      // Reset failure count on consecutive successes
      if (state.successCount >= 5) {
        state.failureCount = 0;
        state.successCount = 0;
      }
    }
  }

  /**
   * Record failure (for default instance)
   * @param name - Optional circuit breaker name (defaults to 'default')
   */
  recordFailure(name: string = 'default'): void {
    // Don't count failures during startup grace period (first 90 seconds)
    // This prevents circuit breaker from opening during application initialization
    const timeSinceStart = Date.now() - this.serviceStartTime;
    const isDuringStartup = timeSinceStart < this.STARTUP_GRACE_PERIOD;

    if (isDuringStartup) {
      // During startup, don't count failures to avoid false circuit breaker openings
      return;
    }

    const state = this.getInternalState(name);
    state.failureCount++;
    state.failures++;
    state.lastFailureTime = Date.now();

    const threshold = name === 'default' ? this.defaultThreshold : 10;
    const timeout = name === 'default' ? this.defaultTimeout : 30000;

    if (state.failureCount >= threshold) {
      this.open(name, timeout);
    }
  }

  /**
   * Open circuit breaker
   */
  private open(name: string, timeout: number): void {
    const state = this.getInternalState(name);
    state.isOpen = true;
    state.state = 'open';
    state.nextAttemptTime = Date.now() + timeout;

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Circuit breaker opened (expected behavior - protecting system from failures)',
      'CircuitBreakerService',
      { name, failures: state.failureCount, nextAttemptTime: new Date(state.nextAttemptTime) }
    );
  }

  /**
   * Reset circuit breaker
   * @param name - Optional circuit breaker name (defaults to 'default')
   */
  reset(name: string = 'default'): void {
    const state = this.getInternalState(name);
    state.isOpen = false;
    state.state = 'closed';
    state.failureCount = 0;
    state.successCount = 0;
    delete state.nextAttemptTime;
  }

  /**
   * Get current state (for default instance)
   * @param name - Optional circuit breaker name (defaults to 'default')
   * @returns Readonly circuit breaker state
   */
  getState(name: string = 'default'): Readonly<CircuitBreakerState> {
    const state = this.getInternalState(name);
    const result: CircuitBreakerState = {
      isOpen: state.isOpen,
      failures: state.failures,
      failureCount: state.failureCount,
      successCount: state.successCount,
    };

    if (state.lastFailureTime !== undefined) {
      result.lastFailure = new Date(state.lastFailureTime);
    }

    if (state.nextAttemptTime !== undefined) {
      result.nextAttempt = new Date(state.nextAttemptTime);
    }

    if (state.state === 'half-open' && state.nextAttemptTime !== undefined) {
      result.halfOpenTime = new Date(state.nextAttemptTime);
    }

    return result;
  }

  /**
   * Execute a function with circuit breaker protection (named circuit breakers)
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
    const state = this.getInternalState(options.name);

    // Check if circuit is open
    if (state.isOpen) {
      // Check if recovery timeout has passed
      if (state.nextAttemptTime && Date.now() >= state.nextAttemptTime) {
        state.state = 'half-open';
      } else {
        // Circuit is still open, reject immediately
        const error = new Error(`Circuit breaker is open for ${options.name}`);
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Circuit breaker rejected execution (expected behavior - circuit is open)',
          'CircuitBreakerService',
          { name: options.name, state: state.state }
        );
        throw error;
      }
    }

    try {
      const result = await fn();

      // Reset failures on success
      if (state.failures > 0 || state.state === 'half-open') {
        this.reset(options.name);
        options.onStateChange?.('closed', options.name);
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Circuit breaker closed after successful execution',
          'CircuitBreakerService',
          { name: options.name }
        );
      } else {
        // Record success for statistics
        state.successCount++;
        if (state.successCount >= 5) {
          state.failureCount = 0;
          state.successCount = 0;
        }
      }

      return result;
    } catch (error) {
      state.failures++;
      state.failureCount++;
      state.lastFailureTime = Date.now();

      if (state.failureCount >= options.failureThreshold) {
        this.open(options.name, options.recoveryTimeout);
        options.onStateChange?.('open', options.name);
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Circuit opened (expected behavior - protecting system from failures)',
          'CircuitBreakerService',
          { name: options.name, failures: state.failureCount }
        );
      }

      this.circuitStates.set(options.name, state);
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Circuit breaker execution failed',
        'CircuitBreakerService',
        {
          name: options.name,
          error: error instanceof Error ? error.message : String(error),
          failureCount: state.failureCount,
        }
      );
      throw error;
    }
  }

  /**
   * Get all circuit breaker states (for monitoring/debugging)
   */
  getAllStates(): Map<string, Readonly<CircuitBreakerState>> {
    const states = new Map<string, Readonly<CircuitBreakerState>>();
    for (const [name] of this.circuitStates) {
      states.set(name, this.getState(name));
    }
    return states;
  }
}
