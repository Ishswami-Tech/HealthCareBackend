import { Injectable, Logger } from "@nestjs/common";
import {
  BasePlugin,
  PluginRegistry,
  PluginContext,
  PluginHealth,
  PluginError,
} from "./plugin.interface";

/**
 * Enterprise Plugin Registry Implementation
 *
 * Manages plugin registration, discovery, and lifecycle across all services.
 * Provides centralized plugin management with health monitoring and error handling.
 *
 * @class EnterprisePluginRegistry
 * @implements {PluginRegistry}
 * @description Advanced plugin registry with enterprise-grade features
 * @example
 * ```typescript
 * @Injectable()
 * export class MyService {
 *   constructor(private readonly pluginRegistry: EnterprisePluginRegistry) {}
 *
 *   async registerMyPlugin() {
 *     const plugin = new MyPlugin();
 *     await this.pluginRegistry.register(plugin);
 *     console.log('Plugin registered successfully');
 *   }
 *
 *   async getValidationPlugins() {
 *     return this.pluginRegistry.getPluginsByFeature('validation');
 *   }
 * }
 * ```
 */
@Injectable()
export class EnterprisePluginRegistry implements PluginRegistry {
  private readonly logger = new Logger(EnterprisePluginRegistry.name);
  /** Map of plugin names to plugin instances */
  private plugins = new Map<string, BasePlugin>();
  /** Map of features to arrays of plugins that provide those features */
  private pluginsByFeature = new Map<string, BasePlugin[]>();
  /** Map of plugin names to their health status */
  private pluginHealth = new Map<string, PluginHealth>();

  /**
   * Register a plugin in the registry
   *
   * @param {BasePlugin} plugin - The plugin to register
   * @returns {Promise<void>} Promise that resolves when registration is complete
   * @throws {PluginError} When registration fails (e.g., duplicate name, validation failure)
   *
   * @example
   * ```typescript
   * const plugin = new MyPlugin();
   * await registry.register(plugin);
   * console.log('Plugin registered successfully');
   * ```
   */
  register(plugin: BasePlugin): Promise<void> {
    try {
      // Validate plugin
      this.validatePlugin(plugin);

      // Check for conflicts
      if (this.plugins.has(plugin.name)) {
        throw new PluginError(
          `Plugin with name '${plugin.name}' is already registered`,
          plugin.name,
          "register",
        );
      }

      // Register plugin
      this.plugins.set(plugin.name, plugin);
      this.updateIndexes(plugin);

      // Initialize health status
      this.pluginHealth.set(plugin.name, {
        isHealthy: true,
        lastCheck: new Date(),
        errors: [],
      });

      this.logger.log(` Registered plugin: ${plugin.name} v${plugin.version}`);
    } catch (error) {
      this.logger.error(` Failed to register plugin ${plugin.name}:`, error);
      throw error;
    }

    return Promise.resolve();
  }

  /**
   * Unregister a plugin from the registry
   *
   * @param {string} pluginName - The name of the plugin to unregister
   * @returns {Promise<void>} Promise that resolves when unregistration is complete
   * @throws {PluginError} When plugin is not found
   *
   * @example
   * ```typescript
   * await registry.unregister('my-plugin');
   * console.log('Plugin unregistered successfully');
   * ```
   */
  async unregister(pluginName: string): Promise<void> {
    try {
      const plugin = this.plugins.get(pluginName);
      if (!plugin) {
        throw new PluginError(
          `Plugin '${pluginName}' not found`,
          pluginName,
          "unregister",
        );
      }

      // Cleanup plugin resources
      await plugin.destroy();

      // Remove from registry
      this.plugins.delete(pluginName);
      this.pluginHealth.delete(pluginName);
      this.removeFromIndexes(plugin);

      this.logger.log(` Unregistered plugin: ${pluginName}`);
    } catch (error) {
      this.logger.error(` Failed to unregister plugin ${pluginName}:`, error);
      throw error;
    }
  }

  /**
   * Get plugin by name
   *
   * @param {string} name - The name of the plugin to retrieve
   * @returns {BasePlugin | undefined} The plugin if found, undefined otherwise
   *
   * @example
   * ```typescript
   * const plugin = registry.getPlugin('my-plugin');
   * if (plugin) {
   *   await plugin.process(data);
   * }
   * ```
   */
  getPlugin(name: string): BasePlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get plugins by feature
   *
   * @param {string} feature - The feature to search for
   * @returns {BasePlugin[]} Array of plugins that provide the specified feature
   *
   * @example
   * ```typescript
   * const validationPlugins = registry.getPluginsByFeature('validation');
   * for (const plugin of validationPlugins) {
   *   await plugin.validate(data);
   * }
   * ```
   */
  getPluginsByFeature(feature: string): BasePlugin[] {
    return this.pluginsByFeature.get(feature) || [];
  }

  /**
   * Get all registered plugins
   *
   * @returns {BasePlugin[]} Array of all registered plugins
   *
   * @example
   * ```typescript
   * const allPlugins = registry.getAllPlugins();
   * console.log(`Total plugins: ${allPlugins.length}`);
   * ```
   */
  getAllPlugins(): BasePlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugin health status
   *
   * @param {string} [pluginName] - Optional specific plugin name, if not provided returns all plugins
   * @returns {PluginHealth | Record<string, PluginHealth>} Health information for the plugin(s)
   *
   * @example
   * ```typescript
   * // Get health for specific plugin
   * const health = registry.getPluginHealth('my-plugin');
   * console.log('Plugin healthy:', health.isHealthy);
   *
   * // Get health for all plugins
   * const allHealth = registry.getPluginHealth();
   * for (const [name, health] of Object.entries(allHealth)) {
   *   console.log(`${name}: ${health.isHealthy ? 'healthy' : 'unhealthy'}`);
   * }
   * ```
   */
  getPluginHealth(
    pluginName?: string,
  ): PluginHealth | Record<string, PluginHealth> {
    if (pluginName) {
      return (
        this.pluginHealth.get(pluginName) || {
          isHealthy: false,
          lastCheck: new Date(),
          errors: ["Plugin not found"],
        }
      );
    }

    // Return health for all plugins
    const allHealth: Record<string, PluginHealth> = {};
    for (const [name, health] of Array.from(this.pluginHealth.entries())) {
      allHealth[name] = health;
    }
    return allHealth;
  }

  /**
   * Check health of all plugins
   *
   * @returns {Promise<void>} Promise that resolves when health check is complete
   *
   * @example
   * ```typescript
   * await registry.checkAllPluginHealth();
   * console.log('Health check completed for all plugins');
   * ```
   */
  async checkAllPluginHealth(): Promise<void> {
    this.logger.log(" Checking health of all plugins...");

    for (const [name, plugin] of Array.from(this.plugins.entries())) {
      try {
        const health = await plugin.getHealth();
        this.pluginHealth.set(name, {
          ...health,
          lastCheck: new Date(),
        });

        if (!health.isHealthy) {
          this.logger.warn(` Plugin ${name} is unhealthy:`, health.errors);
        }
      } catch (_error) {
        this.logger.error(
          ` Failed to check health for plugin ${name}:`,
          _error,
        );
        this.pluginHealth.set(name, {
          isHealthy: false,
          lastCheck: new Date(),
          errors: [_error instanceof Error ? _error.message : String(_error)],
        });
      }
    }
  }

  /**
   * Get plugin statistics
   *
   * @returns {{totalPlugins: number; pluginsByFeature: Record<string, number>; healthyPlugins: number; unhealthyPlugins: number}} Plugin statistics
   *
   * @example
   * ```typescript
   * const stats = registry.getPluginStats();
   * console.log(`Total plugins: ${stats.totalPlugins}`);
   * console.log(`Healthy: ${stats.healthyPlugins}, Unhealthy: ${stats.unhealthyPlugins}`);
   * console.log('Plugins by feature:', stats.pluginsByFeature);
   * ```
   */
  getPluginStats(): {
    totalPlugins: number;
    pluginsByFeature: Record<string, number>;
    healthyPlugins: number;
    unhealthyPlugins: number;
  } {
    const totalPlugins = this.plugins.size;
    const healthyPlugins = Array.from(this.pluginHealth.values()).filter(
      (health) => health.isHealthy,
    ).length;
    const unhealthyPlugins = totalPlugins - healthyPlugins;

    const pluginsByFeature: Record<string, number> = {};
    for (const [feature, plugins] of Array.from(
      this.pluginsByFeature.entries(),
    )) {
      pluginsByFeature[feature] = plugins.length;
    }

    return {
      totalPlugins,
      pluginsByFeature,
      healthyPlugins,
      unhealthyPlugins,
    };
  }

  /**
   * Initialize all plugins with context
   *
   * @param {PluginContext} context - Execution context for plugin initialization
   * @returns {Promise<void>} Promise that resolves when all plugins are initialized
   * @throws {PluginError} When plugin initialization fails
   *
   * @example
   * ```typescript
   * await registry.initializeAllPlugins({
   *   clinicId: 'clinic-123',
   *   userId: 'user-456',
   *   metadata: { requestId: 'req-001' }
   * });
   * console.log('All plugins initialized');
   * ```
   */
  async initializeAllPlugins(context: PluginContext): Promise<void> {
    this.logger.log(` Initializing ${this.plugins.size} plugins...`);

    const initPromises = Array.from(this.plugins.values()).map(
      async (plugin) => {
        try {
          await plugin.initialize(context);
          this.logger.log(` Initialized plugin: ${plugin.name}`);
        } catch (error) {
          this.logger.error(
            ` Failed to initialize plugin ${plugin.name}:`,
            error,
          );
          throw error;
        }
      },
    );

    await Promise.all(initPromises);
    this.logger.log(" All plugins initialized successfully");
  }

  /**
   * Shutdown all plugins gracefully
   *
   * @returns {Promise<void>} Promise that resolves when all plugins are shutdown
   *
   * @example
   * ```typescript
   * await registry.shutdownAllPlugins();
   * console.log('All plugins shutdown');
   * ```
   */
  async shutdownAllPlugins(): Promise<void> {
    this.logger.log(` Shutting down ${this.plugins.size} plugins...`);

    const shutdownPromises = Array.from(this.plugins.values()).map(
      async (plugin) => {
        try {
          await plugin.destroy();
          this.logger.log(` Shutdown plugin: ${plugin.name}`);
        } catch (error) {
          this.logger.error(
            ` Failed to shutdown plugin ${plugin.name}:`,
            error,
          );
        }
      },
    );

    await Promise.all(shutdownPromises);
    this.logger.log(" All plugins shutdown complete");
  }

  /**
   * Validate plugin before registration
   *
   * @param {BasePlugin} plugin - The plugin to validate
   * @throws {PluginError} When plugin validation fails
   *
   * @private
   */
  private validatePlugin(plugin: BasePlugin): void {
    if (!plugin.name || !plugin.version) {
      throw new PluginError(
        "Plugin must have name and version",
        plugin.name || "unknown",
        "validate",
      );
    }

    if (!plugin.initialize || !plugin.process || !plugin.validate) {
      throw new PluginError(
        "Plugin must implement required methods: initialize, process, validate",
        plugin.name,
        "validate",
      );
    }
  }

  /**
   * Update plugin indexes for feature-based lookup
   *
   * @param {BasePlugin} plugin - The plugin to index
   *
   * @private
   */
  private updateIndexes(plugin: BasePlugin): void {
    // Feature index
    for (const feature of plugin.features) {
      if (!this.pluginsByFeature.has(feature)) {
        this.pluginsByFeature.set(feature, []);
      }
      this.pluginsByFeature.get(feature)!.push(plugin);
    }
  }

  /**
   * Remove plugin from indexes
   *
   * @param {BasePlugin} plugin - The plugin to remove from indexes
   *
   * @private
   */
  private removeFromIndexes(plugin: BasePlugin): void {
    // Remove from feature indexes
    for (const feature of plugin.features) {
      const featurePlugins = this.pluginsByFeature.get(feature);
      if (featurePlugins) {
        const index = featurePlugins.findIndex((p) => p.name === plugin.name);
        if (index !== -1) {
          featurePlugins.splice(index, 1);
        }
        if (featurePlugins.length === 0) {
          this.pluginsByFeature.delete(feature);
        }
      }
    }
  }
}
