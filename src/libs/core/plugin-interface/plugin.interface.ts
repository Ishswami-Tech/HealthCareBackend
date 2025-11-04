/**
 * Enterprise Plugin Interface System
 *
 * This provides a unified interface for all plugin systems across the healthcare platform.
 * Supports domain-specific plugins for appointments, auth, queue, and other services.
 *
 * @module PluginInterface
 * @description Comprehensive plugin system for healthcare applications
 *
 * NOTE: All types and interfaces have been moved to @core/types/plugin.types.ts
 * Import types directly from @core/types instead of this file.
 * This file now only contains error class implementations.
 */

/**
 * Plugin Error Types
 *
 * Custom error classes for plugin-related errors with detailed context information.
 * Provides structured error handling for plugin operations and debugging.
 *
 * NOTE: Error classes remain here as they are actual implementations, not just type definitions.
 */

/**
 * Base plugin error class
 *
 * @class PluginError
 * @extends {Error}
 * @description Base error class for all plugin-related errors
 */
export class PluginError extends Error {
  /**
   * Create a new plugin error
   *
   * @param {string} message - Error message
   * @param {string} pluginName - Name of the plugin that caused the error
   * @param {string} operation - Operation that was being performed
   * @param {Error} [originalError] - Optional original error that caused this error
   *
   * @example
   * ```typescript
   * const error = new PluginError(
   *   'Failed to process data',
   *   'data-processor',
   *   'process',
   *   new Error('Database connection failed')
   * );
   * ```
   */
  constructor(
    message: string,
    public readonly pluginName: string,
    public readonly operation: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'PluginError';

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, PluginError);
  }
}

/**
 * Plugin timeout error class
 *
 * @class PluginTimeoutError
 * @extends {PluginError}
 * @description Error thrown when a plugin operation times out
 * @example
 * ```typescript
 * throw new PluginTimeoutError('my-plugin', 'process', 30000);
 * ```
 */
export class PluginTimeoutError extends PluginError {
  /**
   * Create a new plugin timeout error
   *
   * @param {string} pluginName - Name of the plugin that timed out
   * @param {string} operation - Operation that timed out
   * @param {number} timeout - Timeout duration in milliseconds
   *
   * @example
   * ```typescript
   * const error = new PluginTimeoutError('data-processor', 'validate', 5000);
   * console.log(error.message); // "Plugin data-processor timed out after 5000ms during validate"
   * ```
   */
  constructor(pluginName: string, operation: string, timeout: number) {
    super(
      `Plugin ${pluginName} timed out after ${timeout}ms during ${operation}`,
      pluginName,
      operation
    );
    this.name = 'PluginTimeoutError';
  }
}

/**
 * Plugin validation error class
 *
 * @class PluginValidationError
 * @extends {PluginError}
 * @description Error thrown when plugin validation fails
 * @example
 * ```typescript
 * throw new PluginValidationError('validator', 'validate', ['Invalid email format', 'Missing required field']);
 * ```
 */
export class PluginValidationError extends PluginError {
  /**
   * Create a new plugin validation error
   *
   * @param {string} pluginName - Name of the plugin that failed validation
   * @param {string} operation - Operation that failed validation
   * @param {string[]} validationErrors - Array of validation error messages
   *
   * @example
   * ```typescript
   * const error = new PluginValidationError(
   *   'user-validator',
   *   'validate',
   *   ['Email is required', 'Password must be at least 8 characters']
   * );
   * console.log(error.message); // "Plugin user-validator validation failed: Email is required, Password must be at least 8 characters"
   * ```
   */
  constructor(pluginName: string, operation: string, validationErrors: readonly string[]) {
    super(
      `Plugin ${pluginName} validation failed: ${validationErrors.join(', ')}`,
      pluginName,
      operation
    );
    this.name = 'PluginValidationError';
  }
}
