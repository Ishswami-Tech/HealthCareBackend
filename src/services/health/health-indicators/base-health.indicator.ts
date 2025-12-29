/**
 * Base Health Indicator
 * Abstract base class for all health indicators following SOLID, DRY, and KISS principles
 *
 * @description
 * Provides common functionality for health indicators:
 * - Standardized error handling (DRY)
 * - Service availability checking (DRY)
 * - Result formatting (DRY)
 *
 * Each concrete indicator only needs to implement:
 * - getHealthStatus(): Promise<T> - Fetch health status from service
 * - formatResult(key: string, status: T): HealthIndicatorResult - Format status to result
 * - getServiceName(): string - Return service name for error messages
 */

import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

/**
 * Base class for all health indicators
 * Follows SOLID principles:
 * - Single Responsibility: Each indicator only checks one service
 * - Open/Closed: Open for extension via abstract methods, closed for modification
 * - Dependency Inversion: Depends on abstractions (service interfaces)
 */
export abstract class BaseHealthIndicator<T = unknown> extends HealthIndicator {
  /**
   * Get health status from the service
   * Must be implemented by concrete indicators
   */
  protected abstract getHealthStatus(): Promise<T>;

  /**
   * Format health status to HealthIndicatorResult
   * Must be implemented by concrete indicators
   */
  protected abstract formatResult(key: string, status: T): HealthIndicatorResult;

  /**
   * Get service name for error messages
   * Must be implemented by concrete indicators
   */
  protected abstract getServiceName(): string;

  /**
   * Check if service is available
   * Override in concrete indicators if custom availability check is needed
   */
  protected isServiceAvailable(): boolean {
    return true; // Default: assume available if service is injected
  }

  /**
   * Get unavailable status message
   * Override in concrete indicators for custom messages
   */
  protected getUnavailableMessage(): string {
    return `${this.getServiceName()} not available`;
  }

  /**
   * Main check method - standardized across all indicators (DRY)
   * Follows KISS principle: simple, straightforward flow
   */
  async check(key: string): Promise<HealthIndicatorResult> {
    // Check service availability
    if (!this.isServiceAvailable()) {
      return this.getStatus(key, true, {
        message: this.getUnavailableMessage(),
      });
    }

    try {
      // Get health status from service
      const healthStatus = await this.getHealthStatus();

      // Format result
      const result = this.formatResult(key, healthStatus);

      // Validate and throw if unhealthy
      this.validateHealthStatus(result, healthStatus);

      return result;
    } catch (error) {
      // Standardized error handling (DRY)
      return this.handleError(key, error);
    }
  }

  /**
   * Validate health status and throw if unhealthy
   * Override in concrete indicators for custom validation logic
   */
  protected validateHealthStatus(result: HealthIndicatorResult, status: T): void {
    // Default: check if status property indicates unhealthy
    // Concrete indicators can override for custom validation
    const isHealthy = this.extractIsHealthy(status);
    if (!isHealthy) {
      throw new HealthCheckError(`${this.getServiceName()} service is unhealthy`, result);
    }
  }

  /**
   * Extract isHealthy boolean from status
   * Override in concrete indicators if status structure differs
   */
  protected extractIsHealthy(status: T): boolean {
    // Default implementation: check for common property names
    if (typeof status === 'object' && status !== null) {
      const statusObj = status as Record<string, unknown>;
      return (
        statusObj['isHealthy'] === true ||
        statusObj['healthy'] === true ||
        statusObj['status'] === 'up' ||
        statusObj['status'] === 'healthy'
      );
    }
    return true; // Default to healthy if can't determine
  }

  /**
   * Handle errors in standardized way (DRY)
   * Follows KISS principle: simple error handling
   */
  protected handleError(key: string, error: unknown): HealthIndicatorResult {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const result = this.getStatus(key, false, {
      error: errorMessage,
    });

    // Re-throw HealthCheckError (already formatted)
    if (error instanceof HealthCheckError) {
      throw error;
    }

    // Throw new HealthCheckError for other errors
    throw new HealthCheckError(`${this.getServiceName()} health check failed`, result);
  }
}
