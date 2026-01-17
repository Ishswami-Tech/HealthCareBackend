/**
 * Enterprise Plugin Registry Implementation
 *
 * Centralized plugin registry for managing plugin registration, discovery, and lifecycle
 * across all healthcare platform services.
 *
 * @module PluginRegistry
 * @description Generic plugin registry implementation following enterprise patterns
 */

// External imports
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';

// Internal imports - Infrastructure
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';

// Internal imports - Core
import { PluginError, PluginValidationError } from './plugin.interface';
import type {
  BasePlugin,
  PluginRegistry,
  PluginInfo,
  EnterprisePluginRegistry as IEnterprisePluginRegistry,
} from '@core/types';
import { LogType, LogLevel } from '@core/types';

/**
 * Enterprise Plugin Registry
 *
 * Provides centralized plugin registration, discovery, and lifecycle management.
 * Supports multi-service plugin architecture with health monitoring and event-driven updates.
 *
 * @class EnterprisePluginRegistry
 * @implements {PluginRegistry}
 * @implements {IEnterprisePluginRegistry}
 * @description Generic plugin registry for all services
 */
@Injectable()
export class EnterprisePluginRegistry
  implements PluginRegistry, IEnterprisePluginRegistry, OnModuleInit, OnModuleDestroy
{
  private readonly plugins = new Map<string, BasePlugin>();
  private readonly pluginInfo = new Map<string, PluginInfo>();
  private readonly featureIndex = new Map<string, Set<string>>(); // feature -> Set<pluginName>
  private readonly domainIndex = new Map<string, Set<string>>(); // domain -> Set<pluginName>

  constructor(
    private readonly loggingService: LoggingService,
    @Optional()
    @Inject(forwardRef(() => EventService))
    private readonly eventService?: EventService
  ) {}

  /**
   * Initialize registry on module init
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Enterprise Plugin Registry initialized',
        'EnterprisePluginRegistry',
        { pluginCount: this.plugins.size }
      );
    } catch (error) {
      // Logging failure should not prevent initialization
      console.error('Failed to log registry initialization:', error);
    }
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    try {
      // Destroy all plugins gracefully
      const destroyPromises = Array.from(this.plugins.values()).map(plugin => {
        return plugin.destroy().catch(error => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            `Failed to destroy plugin: ${plugin.name}`,
            'EnterprisePluginRegistry',
            { pluginName: plugin.name, error: errorMessage }
          );
        });
      });

      await Promise.allSettled(destroyPromises);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Enterprise Plugin Registry destroyed',
        'EnterprisePluginRegistry',
        { pluginCount: this.plugins.size }
      );

      this.plugins.clear();
      this.pluginInfo.clear();
      this.featureIndex.clear();
      this.domainIndex.clear();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Failed to destroy plugin registry:', errorMessage);
    }
  }

  /**
   * Register a plugin in the registry
   *
   * @param plugin - Plugin instance to register
   * @throws {PluginValidationError} - When plugin validation fails
   * @throws {PluginError} - When plugin registration fails
   */
  async register(plugin: BasePlugin): Promise<void> {
    const startTime = Date.now();

    try {
      // Validate plugin
      if (!plugin.name || !plugin.version || !plugin.features) {
        throw new PluginValidationError(plugin.name || 'unknown', 'register', [
          'Plugin must have name, version, and features',
        ]);
      }

      // Check if plugin already exists
      if (this.plugins.has(plugin.name)) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Plugin ${plugin.name} is already registered, replacing...`,
          'EnterprisePluginRegistry',
          { pluginName: plugin.name }
        );
      }

      // Register plugin
      this.plugins.set(plugin.name, plugin);

      // Index by features
      for (const feature of plugin.features) {
        if (!this.featureIndex.has(feature)) {
          this.featureIndex.set(feature, new Set());
        }
        this.featureIndex.get(feature)?.add(plugin.name);
      }

      // Emit registration event via EventService (centralized event hub)
      if (this.eventService) {
        await this.eventService.emit('plugin.registered', {
          type: 'plugin.registered',
          pluginName: plugin.name,
          timestamp: new Date(),
          data: { version: plugin.version, features: plugin.features },
        });
      }

      const duration = Date.now() - startTime;
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Plugin ${plugin.name} registered successfully`,
        'EnterprisePluginRegistry',
        {
          pluginName: plugin.name,
          version: plugin.version,
          features: plugin.features,
          duration,
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const duration = Date.now() - startTime;

      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to register plugin: ${plugin.name}`,
        'EnterprisePluginRegistry',
        {
          pluginName: plugin.name,
          error: errorMessage,
          duration,
        }
      );

      if (error instanceof PluginError) {
        throw error;
      }

      throw new PluginError(
        `Failed to register plugin: ${errorMessage}`,
        plugin.name,
        'register',
        error instanceof Error ? error : new Error(errorMessage)
      );
    }
  }

  /**
   * Unregister a plugin from the registry
   *
   * @param pluginName - Name of the plugin to unregister
   */
  async unregister(pluginName: string): Promise<void> {
    const startTime = Date.now();

    try {
      const plugin = this.plugins.get(pluginName);
      if (!plugin) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Plugin ${pluginName} not found for unregistration`,
          'EnterprisePluginRegistry',
          { pluginName }
        );
        return;
      }

      // Destroy plugin before unregistering
      await plugin.destroy();

      // Remove from maps
      this.plugins.delete(pluginName);
      this.pluginInfo.delete(pluginName);

      // Remove from feature index
      for (const [feature, pluginSet] of this.featureIndex.entries()) {
        pluginSet.delete(pluginName);
        if (pluginSet.size === 0) {
          this.featureIndex.delete(feature);
        }
      }

      // Remove from domain index
      for (const [domain, pluginSet] of this.domainIndex.entries()) {
        pluginSet.delete(pluginName);
        if (pluginSet.size === 0) {
          this.domainIndex.delete(domain);
        }
      }

      // Emit unregistration event via EventService (centralized event hub)
      if (this.eventService) {
        await this.eventService.emit('plugin.unregistered', {
          type: 'plugin.unregistered',
          pluginName,
          timestamp: new Date(),
        });
      }

      const duration = Date.now() - startTime;
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Plugin ${pluginName} unregistered successfully`,
        'EnterprisePluginRegistry',
        { pluginName, duration }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const duration = Date.now() - startTime;

      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to unregister plugin: ${pluginName}`,
        'EnterprisePluginRegistry',
        {
          pluginName,
          error: errorMessage,
          duration,
        }
      );

      throw new PluginError(
        `Failed to unregister plugin: ${errorMessage}`,
        pluginName,
        'unregister',
        error instanceof Error ? error : new Error(errorMessage)
      );
    }
  }

  /**
   * Get plugin by name
   *
   * @param name - Plugin name
   * @returns Plugin instance or undefined if not found
   */
  getPlugin(name: string): BasePlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get plugins by feature
   *
   * @param feature - Feature name
   * @returns Array of plugins that provide the feature
   */
  getPluginsByFeature(feature: string): BasePlugin[] {
    const pluginNames = this.featureIndex.get(feature);
    if (!pluginNames || pluginNames.size === 0) {
      return [];
    }

    const plugins: BasePlugin[] = [];
    for (const pluginName of pluginNames) {
      const plugin = this.plugins.get(pluginName);
      if (plugin) {
        plugins.push(plugin);
      }
    }

    return plugins;
  }

  /**
   * Get all registered plugins
   *
   * @returns Array of all registered plugins
   */
  getAllPlugins(): BasePlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Register plugin info (for enterprise plugin manager compatibility)
   *
   * @param info - Plugin information
   */
  registerPluginInfo(info: PluginInfo): void {
    this.pluginInfo.set(info.name, info);

    // Index by domain
    if (!this.domainIndex.has(info.domain)) {
      this.domainIndex.set(info.domain, new Set());
    }
    this.domainIndex.get(info.domain)?.add(info.name);
  }

  /**
   * Get plugin info (EnterprisePluginRegistry interface)
   *
   * @returns Array of plugin information
   */
  getPluginInfo(): PluginInfo[] {
    return Array.from(this.pluginInfo.values());
  }

  /**
   * Get domain features (EnterprisePluginRegistry interface)
   *
   * @param domain - Domain name
   * @returns Array of feature names for the domain
   */
  getDomainFeatures(domain: string): string[] {
    const pluginNames = this.domainIndex.get(domain);
    if (!pluginNames || pluginNames.size === 0) {
      return [];
    }

    const features = new Set<string>();
    for (const pluginName of pluginNames) {
      const info = this.pluginInfo.get(pluginName);
      if (info) {
        features.add(info.feature);
      }
    }

    return Array.from(features);
  }

  /**
   * Check if plugin exists (EnterprisePluginRegistry interface)
   *
   * @param domain - Domain name
   * @param feature - Feature name
   * @returns True if plugin exists
   */
  hasPlugin(domain: string, feature: string): boolean {
    const pluginNames = this.domainIndex.get(domain);
    if (!pluginNames || pluginNames.size === 0) {
      return false;
    }

    for (const pluginName of pluginNames) {
      const info = this.pluginInfo.get(pluginName);
      if (info && info.feature === feature) {
        return true;
      }
    }

    return false;
  }
}
