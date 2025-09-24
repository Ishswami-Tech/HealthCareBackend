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
 */
@Injectable()
export class EnterprisePluginRegistry implements PluginRegistry {
  private readonly logger = new Logger(EnterprisePluginRegistry.name);
  private plugins = new Map<string, BasePlugin>();
  private pluginsByFeature = new Map<string, BasePlugin[]>();
  private pluginHealth = new Map<string, PluginHealth>();

  /**
   * Register a plugin in the registry
   */
  async register(plugin: BasePlugin): Promise<void> {
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

      this.logger.log(
        `✅ Registered plugin: ${plugin.name} v${plugin.version}`,
      );
    } catch (error) {
      this.logger.error(`❌ Failed to register plugin ${plugin.name}:`, error);
      throw error;
    }
  }

  /**
   * Unregister a plugin from the registry
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

      this.logger.log(`🗑️ Unregistered plugin: ${pluginName}`);
    } catch (error) {
      this.logger.error(`❌ Failed to unregister plugin ${pluginName}:`, error);
      throw error;
    }
  }

  /**
   * Get plugin by name
   */
  getPlugin(name: string): BasePlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get plugins by feature
   */
  getPluginsByFeature(feature: string): BasePlugin[] {
    return this.pluginsByFeature.get(feature) || [];
  }

  /**
   * Get all registered plugins
   */
  getAllPlugins(): BasePlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugin health status
   */
  async getPluginHealth(
    pluginName?: string,
  ): Promise<PluginHealth | Record<string, PluginHealth>> {
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
    for (const [name, health] of this.pluginHealth.entries()) {
      allHealth[name] = health;
    }
    return allHealth;
  }

  /**
   * Check health of all plugins
   */
  async checkAllPluginHealth(): Promise<void> {
    this.logger.log("🔍 Checking health of all plugins...");

    for (const [name, plugin] of this.plugins.entries()) {
      try {
        const health = await plugin.getHealth();
        this.pluginHealth.set(name, {
          ...health,
          lastCheck: new Date(),
        });

        if (!health.isHealthy) {
          this.logger.warn(`⚠️ Plugin ${name} is unhealthy:`, health.errors);
        }
      } catch (error) {
        this.logger.error(
          `❌ Failed to check health for plugin ${name}:`,
          error,
        );
        this.pluginHealth.set(name, {
          isHealthy: false,
          lastCheck: new Date(),
          errors: [error instanceof Error ? error.message : String(error)],
        });
      }
    }
  }

  /**
   * Get plugin statistics
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
    for (const [feature, plugins] of this.pluginsByFeature.entries()) {
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
   */
  async initializeAllPlugins(context: PluginContext): Promise<void> {
    this.logger.log(`🚀 Initializing ${this.plugins.size} plugins...`);

    const initPromises = Array.from(this.plugins.values()).map(
      async (plugin) => {
        try {
          await plugin.initialize(context);
          this.logger.log(`✅ Initialized plugin: ${plugin.name}`);
        } catch (error) {
          this.logger.error(
            `❌ Failed to initialize plugin ${plugin.name}:`,
            error,
          );
          throw error;
        }
      },
    );

    await Promise.all(initPromises);
    this.logger.log("🎉 All plugins initialized successfully");
  }

  /**
   * Shutdown all plugins
   */
  async shutdownAllPlugins(): Promise<void> {
    this.logger.log(`🛑 Shutting down ${this.plugins.size} plugins...`);

    const shutdownPromises = Array.from(this.plugins.values()).map(
      async (plugin) => {
        try {
          await plugin.destroy();
          this.logger.log(`✅ Shutdown plugin: ${plugin.name}`);
        } catch (error) {
          this.logger.error(
            `❌ Failed to shutdown plugin ${plugin.name}:`,
            error,
          );
        }
      },
    );

    await Promise.all(shutdownPromises);
    this.logger.log("🏁 All plugins shutdown complete");
  }

  /**
   * Validate plugin before registration
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
   * Update plugin indexes
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
