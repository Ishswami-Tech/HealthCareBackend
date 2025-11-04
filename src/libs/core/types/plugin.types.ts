/**
 * Plugin System Types
 * @module PluginTypes
 * @description Type definitions for the enterprise plugin system
 *
 * All plugin types and interfaces are centralized here for consistency
 * and easier maintenance across the healthcare platform.
 */

/**
 * Plugin execution context
 *
 * @interface PluginContext
 * @description Context information passed to plugins during execution
 */
export interface PluginContext {
  /** Optional clinic identifier for multi-tenant operations */
  readonly clinicId?: string;
  /** Optional user identifier for user-specific operations */
  readonly userId?: string;
  /** Optional session identifier for session-based operations */
  readonly sessionId?: string;
  /** Optional metadata for additional context */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Plugin metadata information
 *
 * @interface PluginMetadata
 * @description Metadata describing a plugin's properties and dependencies
 */
export interface PluginMetadata {
  /** Plugin name identifier */
  readonly name: string;
  /** Plugin version */
  readonly version: string;
  /** Optional description of plugin functionality */
  readonly description?: string;
  /** Optional plugin author */
  readonly author?: string;
  /** Optional list of plugin dependencies */
  readonly dependencies?: readonly string[];
  /** Optional tags for categorization */
  readonly tags?: readonly string[];
}

/**
 * Plugin health status
 *
 * @interface PluginHealth
 * @description Health information for plugin monitoring
 */
export interface PluginHealth {
  /** Whether the plugin is currently healthy */
  readonly isHealthy: boolean;
  /** Timestamp of last health check */
  readonly lastCheck: Date;
  /** Optional list of error messages */
  readonly errors?: readonly string[];
  /** Optional health metrics */
  readonly metrics?: Record<string, unknown>;
}

/**
 * Plugin configuration settings
 *
 * @interface PluginConfig
 * @description Configuration options for plugin behavior
 */
export interface PluginConfig {
  /** Whether the plugin is enabled */
  readonly enabled: boolean;
  /** Plugin execution priority (lower numbers = higher priority) */
  readonly priority: number;
  /** Timeout in milliseconds for plugin operations */
  readonly timeout: number;
  /** Number of retry attempts for failed operations */
  readonly retryAttempts: number;
  /** Whether fallback mechanisms are enabled */
  readonly fallbackEnabled: boolean;
  /** Optional custom configuration settings */
  readonly customSettings?: Record<string, unknown>;
}

/**
 * Base Plugin Interface
 *
 * All plugins must implement this interface to be compatible with the plugin system.
 * Provides the core functionality required for plugin lifecycle management.
 *
 * @interface BasePlugin
 * @description Core interface that all plugins must implement
 */
export interface BasePlugin {
  /** Unique plugin name identifier */
  readonly name: string;
  /** Plugin version string */
  readonly version: string;
  /** List of features this plugin provides */
  readonly features: readonly string[];

  /**
   * Initialize the plugin with execution context
   */
  initialize(context: PluginContext): Promise<void>;

  /**
   * Process plugin operation with input data
   */
  process(data: unknown): Promise<unknown>;

  /**
   * Validate input data before processing
   */
  validate(data: unknown): Promise<boolean>;

  /**
   * Get current plugin health status
   */
  getHealth(): Promise<PluginHealth>;

  /**
   * Cleanup plugin resources and perform shutdown
   */
  destroy(): Promise<void>;
}

/**
 * Appointment Plugin Interface
 *
 * Extends base plugin for appointment-specific functionality.
 *
 * @interface AppointmentPlugin
 * @extends {BasePlugin}
 * @description Plugin interface for appointment-related operations
 */
export interface AppointmentPlugin extends BasePlugin {
  /**
   * Handle appointment-specific operations
   */
  handleAppointmentOperation(operation: string, data: unknown): Promise<unknown>;

  /**
   * Get appointment-specific metrics
   */
  getAppointmentMetrics(): Promise<Record<string, unknown>>;
}

/**
 * Auth Plugin Interface
 *
 * Extends base plugin for authentication-specific functionality.
 *
 * @interface AuthPlugin
 * @extends {BasePlugin}
 * @description Plugin interface for authentication-related operations
 */
export interface AuthPlugin extends BasePlugin {
  /**
   * Handle authentication operations
   */
  handleAuthOperation(operation: string, data: unknown): Promise<unknown>;

  /**
   * Validate user permissions for a specific resource and action
   */
  validatePermissions(userId: string, resource: string, action: string): Promise<boolean>;
}

/**
 * Queue Plugin Interface
 *
 * Extends base plugin for queue-specific functionality.
 *
 * @interface QueuePlugin
 * @extends {BasePlugin}
 * @description Plugin interface for queue-related operations
 */
export interface QueuePlugin extends BasePlugin {
  /**
   * Handle queue operations
   */
  handleQueueOperation(operation: string, data: unknown): Promise<unknown>;

  /**
   * Get queue-specific metrics
   */
  getQueueMetrics(): Promise<Record<string, unknown>>;
}

/**
 * Plugin Registry Interface
 *
 * Manages plugin registration, discovery, and lifecycle management.
 *
 * @interface PluginRegistry
 * @description Registry interface for managing plugin registration and discovery
 */
export interface PluginRegistry {
  /**
   * Register a plugin in the registry
   */
  register(plugin: BasePlugin): Promise<void>;

  /**
   * Unregister a plugin from the registry
   */
  unregister(pluginName: string): Promise<void>;

  /**
   * Get plugin by name
   */
  getPlugin(name: string): BasePlugin | undefined;

  /**
   * Get plugins by feature
   */
  getPluginsByFeature(feature: string): BasePlugin[];

  /**
   * Get all registered plugins
   */
  getAllPlugins(): BasePlugin[];
}

/**
 * Plugin Manager Interface
 *
 * Manages plugin lifecycle, execution, and monitoring across all services.
 *
 * @interface PluginManager
 * @description Manager interface for plugin lifecycle and execution
 */
export interface PluginManager {
  /**
   * Initialize all plugins with execution context
   */
  initializePlugins(context: PluginContext): Promise<void>;

  /**
   * Execute plugin operation with timeout and error handling
   */
  executePlugin(pluginName: string, operation: string, data: unknown): Promise<unknown>;

  /**
   * Execute plugins by feature with parallel processing
   */
  executePluginsByFeature(feature: string, operation: string, data: unknown): Promise<unknown[]>;

  /**
   * Get plugin health status
   */
  getPluginHealth(pluginName?: string): Promise<PluginHealth | Record<string, PluginHealth>>;

  /**
   * Shutdown all plugins gracefully
   */
  shutdown(): Promise<void>;
}

/**
 * Plugin Configuration Manager Interface
 *
 * Manages plugin configuration settings and provides centralized configuration management.
 *
 * @interface PluginConfigManager
 * @description Configuration manager interface for plugin settings
 */
export interface PluginConfigManager {
  /**
   * Get plugin configuration
   */
  getConfig(pluginName: string): PluginConfig;

  /**
   * Update plugin configuration
   */
  updateConfig(pluginName: string, config: Partial<PluginConfig>): Promise<void>;

  /**
   * Reset plugin configuration to defaults
   */
  resetConfig(pluginName: string): Promise<void>;

  /**
   * Get all plugin configurations
   */
  getAllConfigs(): Record<string, PluginConfig>;
}

/**
 * Plugin event interface
 *
 * @interface PluginEvent
 * @description Event information for plugin lifecycle and status changes
 */
export interface PluginEvent {
  /** Type of plugin event */
  readonly type:
    | 'plugin.registered'
    | 'plugin.unregistered'
    | 'plugin.initialized'
    | 'plugin.error'
    | 'plugin.health.changed';
  /** Name of the plugin that generated the event */
  readonly pluginName: string;
  /** Timestamp when the event occurred */
  readonly timestamp: Date;
  /** Optional additional event data */
  readonly data?: unknown;
}

/**
 * Plugin Metrics Interface
 *
 * Performance and usage metrics for plugin monitoring and analytics.
 *
 * @interface PluginMetrics
 * @description Metrics information for plugin performance monitoring
 */
export interface PluginMetrics {
  /** Name of the plugin */
  readonly pluginName: string;
  /** Total number of executions */
  readonly totalExecutions: number;
  /** Number of successful executions */
  readonly successfulExecutions: number;
  /** Number of failed executions */
  readonly failedExecutions: number;
  /** Average execution time in milliseconds */
  readonly averageExecutionTime: number;
  /** Timestamp of last execution */
  readonly lastExecution: Date;
  /** Error rate (failed / total) */
  readonly errorRate: number;
  /** Optional custom metrics */
  readonly customMetrics?: Record<string, unknown>;
}

/**
 * Plugin Factory Interface
 *
 * Creates plugin instances and manages plugin type registration.
 *
 * @interface PluginFactory
 * @description Factory interface for creating plugin instances
 */
export interface PluginFactory {
  /**
   * Create plugin instance
   */
  createPlugin(pluginType: string, config: PluginConfig): BasePlugin;

  /**
   * Get supported plugin types
   */
  getSupportedTypes(): readonly string[];

  /**
   * Validate plugin configuration
   */
  validateConfig(pluginType: string, config: PluginConfig): boolean;
}

/**
 * Plugin information structure (for enterprise plugin manager)
 */
export interface PluginInfo {
  readonly name: string;
  readonly version: string;
  readonly domain: string;
  readonly feature: string;
  readonly isActive: boolean;
}

/**
 * Enterprise plugin registry interface
 */
export interface EnterprisePluginRegistry {
  getPluginInfo(): PluginInfo[];
  getDomainFeatures(domain: string): string[];
  hasPlugin(domain: string, feature: string): boolean;
  getPluginsByFeature(feature: string): BasePlugin[];
}

/**
 * Plugin health status (for enterprise plugin manager)
 */
export interface PluginHealthStatus {
  readonly pluginName: string;
  readonly healthy: boolean;
  readonly lastCheck: Date;
  readonly error?: string;
  readonly metrics?: {
    readonly totalOperations: number;
    readonly successfulOperations: number;
    readonly failedOperations: number;
    readonly averageExecutionTime: number;
  };
}

/**
 * Enterprise plugin metrics
 */
export interface EnterprisePluginMetrics {
  readonly totalOperations: number;
  readonly successfulOperations: number;
  readonly failedOperations: number;
  readonly totalExecutionTime: number;
  readonly averageExecutionTime: number;
  readonly lastOperation: Date | null;
}

/**
 * Plugin operation result
 */
export interface PluginOperationResult {
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string;
  readonly executionTime?: number;
  readonly pluginName?: string;
}

/**
 * Domain health information
 */
export interface DomainHealthInfo {
  readonly domain: string;
  readonly plugins: number;
  readonly features: BasePlugin[];
}
