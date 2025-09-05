/**
 * Enterprise Plugin Interface Library
 * 
 * Provides unified plugin system for all healthcare platform services.
 * Supports domain-specific plugins with enterprise-grade features.
 */

// Core Interfaces
export * from './plugin.interface';

// Implementations
export * from './plugin.registry';
export * from './plugin.manager';

// Re-export commonly used types for convenience
export type {
  BasePlugin,
  AppointmentPlugin,
  AuthPlugin,
  QueuePlugin,
  PluginRegistry,
  PluginManager,
  PluginContext,
  PluginHealth,
  PluginConfig,
  PluginError,
  PluginTimeoutError,
  PluginValidationError,
  PluginEvent,
  PluginMetrics,
  PluginFactory
} from './plugin.interface';

export {
  EnterprisePluginRegistry
} from './plugin.registry';

export {
  EnterprisePluginManager
} from './plugin.manager';
