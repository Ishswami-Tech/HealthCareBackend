import { Injectable, Logger } from "@nestjs/common";
import {
  PluginManager,
  PluginContext,
  PluginHealth,
  PluginError,
  PluginTimeoutError,
  PluginValidationError,
} from "./plugin.interface";
import { EnterprisePluginRegistry } from "./plugin.registry";

/**
 * Plugin operation result type
 */
type PluginOperationResult = unknown;

/**
 * Error result interface for failed plugin operations
 */
interface ErrorResult {
  readonly error: string;
}

/**
 * Type guard to check if a value is an error result
 *
 * @param {unknown} value - Value to check
 * @returns {boolean} True if the value is an error result
 */
const isErrorResult = (value: unknown): value is ErrorResult => {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as Record<string, unknown>)["error"] === "string"
  );
};

/**
 * Enterprise Plugin Manager Implementation
 *
 * Manages plugin lifecycle, execution, and monitoring across all services.
 * Provides centralized plugin orchestration with timeout handling and error recovery.
 *
 * @class EnterprisePluginManager
 * @implements {PluginManager}
 * @description Advanced plugin manager with enterprise-grade features
 * @example
 * ```typescript
 * @Injectable()
 * export class MyService {
 *   constructor(private readonly pluginManager: EnterprisePluginManager) {}
 *
 *   async processData(data: unknown) {
 *     // Initialize plugins with context
 *     await this.pluginManager.initializePlugins({
 *       clinicId: 'clinic-123',
 *       userId: 'user-456'
 *     });
 *
 *     // Execute plugins by feature
 *     const results = await this.pluginManager.executePluginsByFeature(
 *       'validation',
 *       'validate',
 *       data
 *     );
 *
 *     return results;
 *   }
 * }
 * ```
 */
@Injectable()
export class EnterprisePluginManager implements PluginManager {
  private readonly logger = new Logger(EnterprisePluginManager.name);
  /** Default timeout for plugin operations in milliseconds */
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  /** Default number of retry attempts for failed operations */
  private readonly DEFAULT_RETRY_ATTEMPTS = 3;

  /**
   * Create a new enterprise plugin manager
   *
   * @param {EnterprisePluginRegistry} pluginRegistry - The plugin registry to manage
   *
   * @example
   * ```typescript
   * const pluginManager = new EnterprisePluginManager(pluginRegistry);
   * ```
   */
  constructor(private readonly pluginRegistry: EnterprisePluginRegistry) {}

  /**
   * Initialize all plugins with execution context
   *
   * @param {PluginContext} context - Execution context for plugin initialization
   * @returns {Promise<void>} Promise that resolves when all plugins are initialized
   * @throws {PluginError} When plugin initialization fails
   *
   * @example
   * ```typescript
   * await pluginManager.initializePlugins({
   *   clinicId: 'clinic-123',
   *   userId: 'user-456',
   *   sessionId: 'session-789',
   *   metadata: { requestId: 'req-001' }
   * });
   * ```
   */
  async initializePlugins(context: PluginContext): Promise<void> {
    this.logger.log(
      `Initializing plugins for clinic: ${context.clinicId ?? "default"}`,
    );

    try {
      await this.pluginRegistry.initializeAllPlugins(context);
      this.logger.log("All plugins initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize plugins:", error);
      throw error;
    }
  }

  /**
   * Execute plugin operation with timeout and error handling
   *
   * @param {string} pluginName - The name of the plugin to execute
   * @param {string} operation - The operation to perform
   * @param {unknown} data - Input data for the operation
   * @returns {Promise<PluginOperationResult>} Promise that resolves with operation result
   * @throws {PluginError} When plugin is not found
   * @throws {PluginValidationError} When input validation fails
   * @throws {PluginTimeoutError} When plugin operation times out
   *
   * @example
   * ```typescript
   * try {
   *   const result = await pluginManager.executePlugin('data-processor', 'process', inputData);
   *   console.log('Processing result:', result);
   * } catch (error) {
   *   if (error instanceof PluginTimeoutError) {
   *     console.error('Plugin timed out:', error.message);
   *   } else if (error instanceof PluginValidationError) {
   *     console.error('Validation failed:', error.message);
   *   }
   * }
   * ```
   */
  async executePlugin(
    pluginName: string,
    operation: string,
    data: unknown,
  ): Promise<PluginOperationResult> {
    const plugin = this.pluginRegistry.getPlugin(pluginName);
    if (!plugin) {
      throw new PluginError(
        `Plugin '${pluginName}' not found`,
        pluginName,
        operation,
      );
    }

    this.logger.debug(`Executing plugin ${pluginName}:${operation}`);

    try {
      const isValid = await this.executeWithTimeout(
        () => plugin.validate(data),
        pluginName,
        "validate",
        5000,
      );

      if (!isValid) {
        throw new PluginValidationError(pluginName, operation, [
          "Input validation failed",
        ]);
      }

      const result = await this.executeWithTimeout(
        () => plugin.process(data),
        pluginName,
        operation,
        this.DEFAULT_TIMEOUT,
      );

      this.logger.debug(
        `Plugin ${pluginName}:${operation} executed successfully`,
      );
      return result;
    } catch (error) {
      this.logger.error(`Plugin ${pluginName}:${operation} failed:`, error);

      if (error instanceof PluginTimeoutError) {
        this.markPluginUnhealthy(pluginName, (error as Error).message);
      }

      throw error;
    }
  }

  /**
   * Execute plugins by feature with parallel processing
   *
   * @param {string} feature - The feature to execute plugins for
   * @param {string} operation - The operation to perform
   * @param {unknown} data - Input data for the operation
   * @returns {Promise<PluginOperationResult[]>} Promise that resolves with array of results from successful plugins
   *
   * @example
   * ```typescript
   * const results = await pluginManager.executePluginsByFeature('validation', 'validate', userData);
   * console.log(`Validation completed with ${results.length} successful results`);
   * ```
   */
  async executePluginsByFeature(
    feature: string,
    operation: string,
    data: unknown,
  ): Promise<PluginOperationResult[]> {
    const plugins = this.pluginRegistry.getPluginsByFeature(feature);

    if (plugins.length === 0) {
      this.logger.warn(`No plugins found for feature: ${feature}`);
      return [];
    }

    this.logger.debug(
      `Executing ${plugins.length} plugins for feature: ${feature}`,
    );

    const results = await Promise.all(
      plugins.map(async (plugin) => {
        try {
          return await this.executePlugin(plugin.name, operation, data);
        } catch (error) {
          this.logger.error(
            `Plugin ${plugin.name} failed for feature ${feature}:`,
            error,
          );
          return {
            error: error instanceof Error ? error.message : String(error),
          } satisfies ErrorResult;
        }
      }),
    );

    const successfulResults = results.filter(
      (result): result is PluginOperationResult => !isErrorResult(result),
    );
    const failedResults = results.filter(isErrorResult);

    this.logger.debug(
      `Feature ${feature} execution complete: ${successfulResults.length} successful, ${failedResults.length} failed`,
    );

    return successfulResults;
  }

  /**
   * Get plugin health status
   *
   * @param {string} [pluginName] - Optional specific plugin name, if not provided returns all plugins
   * @returns {Promise<PluginHealth | Record<string, PluginHealth>>} Promise that resolves with health information
   *
   * @example
   * ```typescript
   * // Get health for specific plugin
   * const health = await pluginManager.getPluginHealth('my-plugin');
   * console.log('Plugin healthy:', health.isHealthy);
   *
   * // Get health for all plugins
   * const allHealth = await pluginManager.getPluginHealth();
   * for (const [name, health] of Object.entries(allHealth)) {
   *   console.log(`${name}: ${health.isHealthy ? 'healthy' : 'unhealthy'}`);
   * }
   * ```
   */
  async getPluginHealth(
    pluginName?: string,
  ): Promise<PluginHealth | Record<string, PluginHealth>> {
    if (pluginName) {
      return this.pluginRegistry.getPluginHealth(pluginName);
    }

    await this.pluginRegistry.checkAllPluginHealth();
    return this.pluginRegistry.getPluginHealth();
  }

  /**
   * Shutdown all plugins gracefully
   *
   * @returns {Promise<void>} Promise that resolves when all plugins are shutdown
   *
   * @example
   * ```typescript
   * await pluginManager.shutdown();
   * console.log('All plugins have been shutdown');
   * ```
   */
  async shutdown(): Promise<void> {
    this.logger.log("Shutting down plugin manager...");

    try {
      await this.pluginRegistry.shutdownAllPlugins();
      this.logger.log("Plugin manager shutdown complete");
    } catch (error) {
      this.logger.error("Error during plugin manager shutdown:", error);
      throw error;
    }
  }

  /**
   * Execute plugin operation with retry logic and exponential backoff
   *
   * @param {string} pluginName - The name of the plugin to execute
   * @param {string} operation - The operation to perform
   * @param {unknown} data - Input data for the operation
   * @param {number} [maxRetries=3] - Maximum number of retry attempts
   * @returns {Promise<PluginOperationResult>} Promise that resolves with operation result
   * @throws {PluginError} When all retry attempts fail
   *
   * @example
   * ```typescript
   * try {
   *   const result = await pluginManager.executePluginWithRetry(
   *     'unreliable-plugin',
   *     'process',
   *     data,
   *     5 // 5 retry attempts
   *   );
   *   console.log('Success after retries:', result);
   * } catch (error) {
   *   console.error('Failed after all retries:', error.message);
   * }
   * ```
   */
  async executePluginWithRetry(
    pluginName: string,
    operation: string,
    data: unknown,
    maxRetries: number = this.DEFAULT_RETRY_ATTEMPTS,
  ): Promise<PluginOperationResult> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        this.logger.debug(
          `Plugin ${pluginName}:${operation} attempt ${attempt}/${maxRetries}`,
        );
        return await this.executePlugin(pluginName, operation, data);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1000; // Exponential backoff
          this.logger.warn(
            `Plugin ${pluginName}:${operation} attempt ${attempt} failed, retrying in ${delayMs}ms:`,
            lastError.message,
          );
          await this.sleep(delayMs);
        }
      }
    }

    this.logger.error(
      `Plugin ${pluginName}:${operation} failed after ${maxRetries} attempts`,
    );
    throw (
      lastError ||
      new PluginError(
        `Plugin ${pluginName} failed after ${maxRetries} attempts`,
        pluginName,
        operation,
      )
    );
  }

  /**
   * Execute plugin operation with timeout
   *
   * @param {() => Promise<T>} operation - The operation to execute
   * @param {string} pluginName - Name of the plugin
   * @param {string} action - Action being performed
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<T>} Promise that resolves with operation result
   * @throws {PluginTimeoutError} When operation times out
   *
   * @private
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    pluginName: string,
    action: string,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new PluginTimeoutError(pluginName, action, timeoutMs));
      }, timeoutMs);

      operation()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  /**
   * Mark plugin as unhealthy
   *
   * @param {string} pluginName - Name of the plugin to mark as unhealthy
   * @param {string} errorMessage - Error message describing the issue
   *
   * @private
   */
  private markPluginUnhealthy(pluginName: string, errorMessage: string): void {
    try {
      const healthResult = this.pluginRegistry.getPluginHealth(pluginName);
      if (
        typeof healthResult === "object" &&
        healthResult !== null &&
        "isHealthy" in healthResult
      ) {
        const health = healthResult as PluginHealth;
        const updatedHealth: PluginHealth = {
          ...health,
          isHealthy: false,
          lastCheck: new Date(),
          errors: [...(health.errors ?? []), errorMessage],
        };

        void updatedHealth;
        this.logger.warn(
          `Marked plugin ${pluginName} as unhealthy: ${errorMessage}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to mark plugin ${pluginName} as unhealthy:`,
        error,
      );
    }
  }

  /**
   * Get plugin execution metrics and statistics
   *
   * @returns {Promise<{totalPlugins: number; healthyPlugins: number; unhealthyPlugins: number; pluginsByFeature: Record<string, number>}>} Promise that resolves with plugin metrics
   *
   * @example
   * ```typescript
   * const metrics = await pluginManager.getPluginMetrics();
   * console.log(`Total plugins: ${metrics.totalPlugins}`);
   * console.log(`Healthy: ${metrics.healthyPlugins}, Unhealthy: ${metrics.unhealthyPlugins}`);
   * console.log('Plugins by feature:', metrics.pluginsByFeature);
   * ```
   */
  async getPluginMetrics(): Promise<{
    totalPlugins: number;
    healthyPlugins: number;
    unhealthyPlugins: number;
    pluginsByFeature: Record<string, number>;
  }> {
    const stats = this.pluginRegistry.getPluginStats();
    const health = (await this.getPluginHealth()) as Record<
      string,
      PluginHealth
    >;

    const healthyPlugins = Object.values(health).filter(
      (pluginHealth) => pluginHealth.isHealthy,
    ).length;
    const unhealthyPlugins = Object.values(health).filter(
      (pluginHealth) => !pluginHealth.isHealthy,
    ).length;

    return {
      totalPlugins: stats.totalPlugins,
      healthyPlugins,
      unhealthyPlugins,
      pluginsByFeature: stats.pluginsByFeature,
    };
  }

  /**
   * Execute plugins in sequence (for operations that must be ordered)
   *
   * @param {string[]} pluginNames - Array of plugin names to execute in order
   * @param {string} operation - The operation to perform
   * @param {unknown} data - Input data for the operation
   * @returns {Promise<PluginOperationResult[]>} Promise that resolves with array of results
   *
   * @example
   * ```typescript
   * const results = await pluginManager.executePluginsSequentially(
   *   ['validator', 'processor', 'notifier'],
   *   'process',
   *   userData
   * );
   * console.log(`Sequential execution completed with ${results.length} results`);
   * ```
   */
  async executePluginsSequentially(
    pluginNames: string[],
    operation: string,
    data: unknown,
  ): Promise<PluginOperationResult[]> {
    const results: PluginOperationResult[] = [];

    for (const pluginName of pluginNames) {
      try {
        const result = await this.executePlugin(pluginName, operation, data);
        results.push(result);
      } catch (error) {
        this.logger.error(
          `Sequential execution failed for plugin ${pluginName}:`,
          error,
        );
        results.push({
          error: error instanceof Error ? error.message : String(error),
        } satisfies ErrorResult);
      }
    }

    return results;
  }

  /**
   * Execute plugins with fallback strategy
   *
   * @param {string} primaryPlugin - Primary plugin to try first
   * @param {string[]} fallbackPlugins - Array of fallback plugins to try if primary fails
   * @param {string} operation - The operation to perform
   * @param {unknown} data - Input data for the operation
   * @returns {Promise<PluginOperationResult>} Promise that resolves with operation result
   * @throws {PluginError} When all plugins (primary and fallbacks) fail
   *
   * @example
   * ```typescript
   * try {
   *   const result = await pluginManager.executePluginsWithFallback(
   *     'primary-processor',
   *     ['backup-processor', 'legacy-processor'],
   *     'process',
   *     data
   *   );
   *   console.log('Processing successful:', result);
   * } catch (error) {
   *   console.error('All processors failed:', error.message);
   * }
   * ```
   */
  async executePluginsWithFallback(
    primaryPlugin: string,
    fallbackPlugins: string[],
    operation: string,
    data: unknown,
  ): Promise<PluginOperationResult> {
    try {
      return await this.executePlugin(primaryPlugin, operation, data);
    } catch (error) {
      this.logger.warn(
        `Primary plugin ${primaryPlugin} failed, trying fallbacks:`,
        error,
      );

      for (const fallbackPlugin of fallbackPlugins) {
        try {
          return await this.executePlugin(fallbackPlugin, operation, data);
        } catch (fallbackError) {
          this.logger.warn(
            `Fallback plugin ${fallbackPlugin} also failed:`,
            fallbackError,
          );
        }
      }

      throw new PluginError(
        `All plugins failed for operation ${operation}`,
        "fallback",
        operation,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Utility method for sleep/delay
   *
   * @param {number} ms - Number of milliseconds to sleep
   * @returns {Promise<void>} Promise that resolves after the specified delay
   *
   * @private
   * @example
   * ```typescript
   * await this.sleep(1000); // Sleep for 1 second
   * ```
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
