import { Injectable, Logger } from "@nestjs/common";

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;
  recoveryTimeout: number;
  onStateChange?: (state: string, name: string) => void;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private circuitStates = new Map<
    string,
    {
      state: "closed" | "open" | "half-open";
      failures: number;
      lastFailureTime?: number;
    }
  >();

  async execute<T>(
    fn: () => Promise<T>,
    options: CircuitBreakerOptions,
  ): Promise<T> {
    const state = this.circuitStates.get(options.name) || {
      state: "closed",
      failures: 0,
    };

    // Simple implementation - just execute the function for now
    // In a full implementation, this would handle circuit breaking logic
    try {
      const result = await fn();

      // Reset failures on success
      if (state.failures > 0) {
        this.circuitStates.set(options.name, { state: "closed", failures: 0 });
      }

      return result;
    } catch (_error) {
      state.failures++;
      state.lastFailureTime = Date.now();

      if (state.failures >= options.failureThreshold) {
        state.state = "open";
        options.onStateChange?.("open", options.name);
      }

      this.circuitStates.set(options.name, state);
      throw _error;
    }
  }
}
