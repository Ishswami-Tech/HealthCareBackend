/**
 * Enterprise Plugin Manager Implementation
 *
 * Centralized plugin manager for executing plugins with timeout, retry, health monitoring,
 * and metrics collection across all healthcare platform services.
 *
 * @module PluginManager
 * @description Generic plugin manager implementation following enterprise patterns
 */

// External imports
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@config';

// Internal imports - Infrastructure
import { LoggingService } from '@infrastructure/logging';

// Internal imports - Core
import { PluginError, PluginTimeoutError } from './plugin.interface';
import { EnterprisePluginRegistry } from './plugin.registry';
import type {
  PluginManager,
  PluginOperationResult,
  EnterprisePluginMetrics,
  PluginHealthStatus,
  PluginContext,
  PluginHealth,
} from '@core/types';
import { LogType, LogLevel } from '@core/types';

/**
 * Enterprise Plugin Manager
 *
 * Provides centralized plugin execution, lifecycle management, health monitoring,
 * and metrics collection. Supports timeout, retry logic, parallel execution, and fallback strategies.
 *
 * @class EnterprisePluginManager
 * @implements {PluginManager}
 * @description Generic plugin manager for all services
 */
/**
 * Mutable internal types for metrics and health status
 */
interface MutablePluginMetrics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
  lastOperation: Date | null;
}

interface MutablePluginHealthStatus {
  pluginName: string;
  healthy: boolean;
  lastCheck: Date;
  error?: string;
  metrics?: {
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    averageExecutionTime: number;
  };
}

@Injectable()
export class EnterprisePluginManager implements PluginManager, OnModuleInit, OnModuleDestroy {
  private readonly pluginMetrics = new Map<string, MutablePluginMetrics>();
  private readonly pluginHealthStatus = new Map<string, MutablePluginHealthStatus>();
  private readonly defaultTimeout: number;
  private readonly defaultRetryAttempts: number;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(
    private readonly registry: EnterprisePluginRegistry,
    private readonly loggingService: LoggingService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService
  ) {
    // Use ConfigService (which uses dotenv) for all environment variable access
    this.defaultTimeout = this.configService.getEnvNumber('PLUGIN_TIMEOUT', 30000);
    this.defaultRetryAttempts = this.configService.getEnvNumber('PLUGIN_RETRY_ATTEMPTS', 3);
  }

  /**
   * Initialize manager on module init
   */
  async onModuleInit(): Promise<void> {
    try {
      // Start health monitoring
      this.startHealthMonitoring();

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Enterprise Plugin Manager initialized',
        'EnterprisePluginManager',
        {
          defaultTimeout: this.defaultTimeout,
          defaultRetryAttempts: this.defaultRetryAttempts,
        }
      );
    } catch (error) {
      // Logging failure in initialization - use void to mark as intentionally ignored
      // This is a bootstrap scenario where LoggingService might not be fully available
      const errorMessage = error instanceof Error ? error.message : String(error);
      void this.loggingService
        .log(
          LogType.ERROR,
          LogLevel.ERROR,
          `Failed to initialize plugin manager: ${errorMessage}`,
          'EnterprisePluginManager',
          { error: errorMessage }
        )
        .catch(() => {
          // Silent fail - LoggingService unavailable during bootstrap
        });
    }
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    try {
      // Stop health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Enterprise Plugin Manager destroyed',
        'EnterprisePluginManager',
        {}
      );

      this.pluginMetrics.clear();
      this.pluginHealthStatus.clear();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Logging failure in destruction - use void to mark as intentionally ignored
      void this.loggingService
        .log(
          LogType.ERROR,
          LogLevel.ERROR,
          `Failed to destroy plugin manager: ${errorMessage}`,
          'EnterprisePluginManager',
          { error: errorMessage }
        )
        .catch(() => {
          // Silent fail - LoggingService unavailable during shutdown
        });
    }
  }

  /**
   * Initialize all plugins with execution context
   *
   * @param context - Plugin execution context
   */
  async initializePlugins(context: PluginContext): Promise<void> {
    const startTime = Date.now();

    try {
      const plugins = this.registry.getAllPlugins();
      // Capture context in const to ensure type safety
      const pluginContext: PluginContext = context;
      const initPromises = plugins.map(async plugin => {
        try {
          await plugin.initialize(pluginContext);
          this.initializePluginMetrics(plugin.name);

          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            `Plugin ${plugin.name} initialized`,
            'EnterprisePluginManager',
            { pluginName: plugin.name }
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            `Failed to initialize plugin: ${plugin.name}`,
            'EnterprisePluginManager',
            { pluginName: plugin.name, error: errorMessage }
          );
        }
      });

      await Promise.allSettled(initPromises);

      const duration = Date.now() - startTime;
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'All plugins initialized',
        'EnterprisePluginManager',
        {
          pluginCount: plugins.length,
          duration,
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const duration = Date.now() - startTime;

      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to initialize plugins',
        'EnterprisePluginManager',
        {
          error: errorMessage,
          duration,
        }
      );

      throw new PluginError(
        `Failed to initialize plugins: ${errorMessage}`,
        'system',
        'initializePlugins',
        error instanceof Error ? error : new Error(errorMessage)
      );
    }
  }

  /**
   * Execute plugin operation with timeout and error handling
   *
   * @param pluginName - Name of the plugin to execute
   * @param operation - Operation to perform (will be passed to plugin.process)
   * @param data - Data to pass to the plugin
   * @returns Result of plugin execution
   */
  async executePlugin(pluginName: string, operation: string, data: unknown): Promise<unknown> {
    const startTime = Date.now();
    const plugin = this.registry.getPlugin(pluginName);

    if (!plugin) {
      throw new PluginError(
        `Plugin ${pluginName} not found`,
        pluginName,
        operation,
        new Error('Plugin not registered')
      );
    }

    try {
      // Execute with timeout
      const timeout = this.defaultTimeout;
      const result = await Promise.race([
        plugin.process(data),
        this.createTimeoutPromise(pluginName, operation, timeout),
      ]);

      const duration = Date.now() - startTime;
      this.updatePluginMetrics(pluginName, true, duration);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `Plugin ${pluginName} executed successfully`,
        'EnterprisePluginManager',
        {
          pluginName,
          operation,
          duration,
        }
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updatePluginMetrics(pluginName, false, duration);

      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Plugin ${pluginName} execution failed`,
        'EnterprisePluginManager',
        {
          pluginName,
          operation,
          error: errorMessage,
          duration,
        }
      );

      if (error instanceof PluginTimeoutError) {
        throw error;
      }

      throw new PluginError(
        `Plugin execution failed: ${errorMessage}`,
        pluginName,
        operation,
        error instanceof Error ? error : new Error(errorMessage)
      );
    }
  }

  /**
   * Execute plugins by feature with parallel processing
   *
   * @param feature - Feature name
   * @param operation - Operation to perform
   * @param data - Data to pass to plugins
   * @returns Array of results from all plugins
   */
  async executePluginsByFeature(
    feature: string,
    operation: string,
    data: unknown
  ): Promise<unknown[]> {
    const startTime = Date.now();
    const plugins = this.registry.getPluginsByFeature(feature);

    if (plugins.length === 0) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `No plugins found for feature: ${feature}`,
        'EnterprisePluginManager',
        { feature }
      );
      return [];
    }

    try {
      // Execute all plugins in parallel
      const executionPromises = plugins.map(plugin =>
        this.executePlugin(plugin.name, operation, data).catch(error => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            error: errorMessage,
            pluginName: plugin.name,
          };
        })
      );

      const results = await Promise.allSettled(executionPromises);

      const duration = Date.now() - startTime;
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `Executed ${plugins.length} plugins for feature: ${feature}`,
        'EnterprisePluginManager',
        {
          feature,
          pluginCount: plugins.length,
          duration,
        }
      );

      return results.map(result => {
        if (result.status === 'fulfilled') {
          return result.value;
        }
        return {
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const duration = Date.now() - startTime;

      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to execute plugins for feature: ${feature}`,
        'EnterprisePluginManager',
        {
          feature,
          error: errorMessage,
          duration,
        }
      );

      throw new PluginError(
        `Failed to execute plugins for feature: ${errorMessage}`,
        feature,
        operation,
        error instanceof Error ? error : new Error(errorMessage)
      );
    }
  }

  /**
   * Get plugin health status
   *
   * @param pluginName - Optional plugin name, if not provided returns all plugin health statuses
   * @returns Plugin health status or map of all plugin health statuses
   */
  async getPluginHealth(pluginName?: string): Promise<PluginHealth | Record<string, PluginHealth>> {
    if (pluginName) {
      const plugin = this.registry.getPlugin(pluginName);
      if (!plugin) {
        throw new PluginError(
          `Plugin ${pluginName} not found`,
          pluginName,
          'getPluginHealth',
          new Error('Plugin not registered')
        );
      }

      const health: PluginHealth = await plugin.getHealth();
      return health;
    }

    // Return all plugin health statuses
    const plugins = this.registry.getAllPlugins();
    const healthMap: Record<string, PluginHealth> = {};

    const healthPromises = plugins.map(async plugin => {
      try {
        const health: PluginHealth = await plugin.getHealth();
        healthMap[plugin.name] = health;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorHealth: PluginHealth = {
          isHealthy: false,
          lastCheck: new Date(),
          errors: [errorMessage],
        };
        healthMap[plugin.name] = errorHealth;
      }
    });

    await Promise.allSettled(healthPromises);

    return healthMap;
  }

  /**
   * Shutdown all plugins gracefully
   */
  async shutdown(): Promise<void> {
    const startTime = Date.now();

    try {
      const plugins = this.registry.getAllPlugins();
      const destroyPromises = plugins.map(plugin =>
        plugin.destroy().catch(error => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            `Failed to destroy plugin: ${plugin.name}`,
            'EnterprisePluginManager',
            { pluginName: plugin.name, error: errorMessage }
          );
        })
      );

      await Promise.allSettled(destroyPromises);

      const duration = Date.now() - startTime;
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'All plugins shut down',
        'EnterprisePluginManager',
        {
          pluginCount: plugins.length,
          duration,
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to shutdown plugins',
        'EnterprisePluginManager',
        { error: errorMessage }
      );
    }
  }

  /**
   * Execute plugin operation with result tracking (for enterprise plugin manager compatibility)
   *
   * @param domain - Domain name
   * @param feature - Feature name
   * @param operation - Operation name
   * @param data - Operation data
   * @param context - Optional plugin context
   * @returns Plugin operation result
   */
  async executePluginOperation(
    domain: string,
    feature: string,
    operation: string,
    data: unknown,
    _context?: unknown
  ): Promise<PluginOperationResult> {
    const startTime = Date.now();
    const pluginName = `${domain}.${feature}`;

    try {
      const plugins = this.registry.getPluginsByFeature(feature);
      if (plugins.length === 0) {
        return {
          success: false,
          error: `No plugins found for feature: ${feature}`,
          executionTime: Date.now() - startTime,
          pluginName,
        };
      }

      // Use first plugin that matches (can be extended to support multiple)
      const plugin = plugins[0];
      if (!plugin) {
        return {
          success: false,
          error: `No plugin available for feature: ${feature}`,
          executionTime: Date.now() - startTime,
          pluginName,
        };
      }
      const result = await this.executePlugin(plugin.name, operation, data);

      return {
        success: true,
        data: result,
        executionTime: Date.now() - startTime,
        pluginName,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
        executionTime: Date.now() - startTime,
        pluginName,
      };
    }
  }

  /**
   * Get plugin metrics
   *
   * @param pluginName - Optional plugin name
   * @returns Plugin metrics or map of all plugin metrics
   */
  getPluginMetrics(
    pluginName?: string
  ): EnterprisePluginMetrics | Record<string, EnterprisePluginMetrics> {
    if (pluginName) {
      const metrics = this.pluginMetrics.get(pluginName);
      return metrics
        ? { ...metrics }
        : {
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
            totalExecutionTime: 0,
            averageExecutionTime: 0,
            lastOperation: null,
          };
    }

    // Convert mutable to readonly for return
    const result: Record<string, EnterprisePluginMetrics> = {};
    for (const [name, metrics] of this.pluginMetrics.entries()) {
      result[name] = { ...metrics };
    }
    return result;
  }

  /**
   * Get plugin health status (enterprise plugin manager compatibility)
   *
   * @returns Array of plugin health statuses
   */
  getPluginHealthStatus(): PluginHealthStatus[] {
    // Convert mutable to readonly for return
    return Array.from(this.pluginHealthStatus.values()).map(status => ({ ...status }));
  }

  /**
   * Get enterprise registry (for backward compatibility)
   *
   * @returns Enterprise plugin registry instance
   */
  getEnterpriseRegistry(): EnterprisePluginRegistry {
    return this.registry;
  }

  /**
   * Create timeout promise for plugin execution
   *
   * @private
   */
  private createTimeoutPromise(
    pluginName: string,
    operation: string,
    timeout: number
  ): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new PluginTimeoutError(pluginName, operation, timeout));
      }, timeout);
    });
  }

  /**
   * Initialize plugin metrics
   *
   * @private
   */
  private initializePluginMetrics(pluginName: string): void {
    this.pluginMetrics.set(pluginName, {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      lastOperation: null,
    });

    this.pluginHealthStatus.set(pluginName, {
      pluginName,
      healthy: true,
      lastCheck: new Date(),
      metrics: {
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
        averageExecutionTime: 0,
      },
    });
  }

  /**
   * Update plugin metrics
   *
   * @private
   */
  private updatePluginMetrics(pluginName: string, success: boolean, executionTime: number): void {
    const metrics = this.pluginMetrics.get(pluginName);
    if (!metrics) {
      this.initializePluginMetrics(pluginName);
      return;
    }

    metrics.totalOperations++;
    metrics.totalExecutionTime += executionTime;
    metrics.averageExecutionTime = metrics.totalExecutionTime / metrics.totalOperations;
    metrics.lastOperation = new Date();

    if (success) {
      metrics.successfulOperations++;
    } else {
      metrics.failedOperations++;
    }

    // Update health status
    const healthStatus = this.pluginHealthStatus.get(pluginName);
    if (healthStatus) {
      healthStatus.metrics = {
        totalOperations: metrics.totalOperations,
        successfulOperations: metrics.successfulOperations,
        failedOperations: metrics.failedOperations,
        averageExecutionTime: metrics.averageExecutionTime,
      };
      // Consider plugin healthy if failure rate is less than 10%
      healthStatus.healthy = metrics.failedOperations / metrics.totalOperations < 0.1;
      healthStatus.lastCheck = new Date();
    }
  }

  /**
   * Start health monitoring
   *
   * @private
   */
  private startHealthMonitoring(): void {
    // Use ConfigService (which uses dotenv) for environment variable access
    const interval = this.configService.getEnvNumber('PLUGIN_HEALTH_CHECK_INTERVAL', 30000); // 30 seconds

    this.healthCheckInterval = setInterval(() => {
      void this.performHealthCheck();
    }, interval);
  }

  /**
   * Perform health check on all plugins
   *
   * @private
   */
  private async performHealthCheck(): Promise<void> {
    const plugins = this.registry.getAllPlugins();

    for (const plugin of plugins) {
      try {
        const health = await plugin.getHealth();
        const healthStatus = this.pluginHealthStatus.get(plugin.name);

        if (healthStatus) {
          healthStatus.healthy = health.isHealthy;
          healthStatus.lastCheck = health.lastCheck;
          if (health.errors && health.errors.length > 0) {
            healthStatus.error = health.errors.join(', ');
          } else {
            // Remove error property by creating new object without it
            const { error: _removed, ...rest } = healthStatus;
            this.pluginHealthStatus.set(plugin.name, { ...rest });
          }
        } else {
          const newStatus: MutablePluginHealthStatus = {
            pluginName: plugin.name,
            healthy: health.isHealthy,
            lastCheck: health.lastCheck,
            metrics: {
              totalOperations: 0,
              successfulOperations: 0,
              failedOperations: 0,
              averageExecutionTime: 0,
            },
          };
          if (health.errors && health.errors.length > 0) {
            newStatus.error = health.errors.join(', ');
          }
          this.pluginHealthStatus.set(plugin.name, newStatus);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const healthStatus = this.pluginHealthStatus.get(plugin.name);
        if (healthStatus) {
          healthStatus.healthy = false;
          healthStatus.lastCheck = new Date();
          healthStatus.error = errorMessage;
        }

        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.WARN,
          `Health check failed for plugin: ${plugin.name}`,
          'EnterprisePluginManager',
          { pluginName: plugin.name, error: errorMessage }
        );
      }
    }
  }
}
