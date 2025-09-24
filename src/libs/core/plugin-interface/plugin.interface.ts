/**
 * Enterprise Plugin Interface System
 *
 * This provides a unified interface for all plugin systems across the healthcare platform.
 * Supports domain-specific plugins for appointments, auth, queue, and other services.
 */

export interface PluginContext {
  clinicId?: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export interface PluginMetadata {
  name: string;
  version: string;
  description?: string;
  author?: string;
  dependencies?: string[];
  tags?: string[];
}

export interface PluginHealth {
  isHealthy: boolean;
  lastCheck: Date;
  errors?: string[];
  metrics?: Record<string, any>;
}

export interface PluginConfig {
  enabled: boolean;
  priority: number;
  timeout: number;
  retryAttempts: number;
  fallbackEnabled: boolean;
  customSettings?: Record<string, any>;
}

/**
 * Base Plugin Interface
 * All plugins must implement this interface
 */
export interface BasePlugin {
  readonly name: string;
  readonly version: string;
  readonly features: string[];

  /**
   * Initialize the plugin
   */
  initialize(context: PluginContext): Promise<void>;

  /**
   * Process plugin operation
   */
  process(data: any): Promise<any>;

  /**
   * Validate input data
   */
  validate(data: any): Promise<boolean>;

  /**
   * Get plugin health status
   */
  getHealth(): Promise<PluginHealth>;

  /**
   * Cleanup plugin resources
   */
  destroy(): Promise<void>;
}

/**
 * Appointment Plugin Interface
 * Extends base plugin for appointment-specific functionality
 */
export interface AppointmentPlugin extends BasePlugin {
  /**
   * Handle appointment-specific operations
   */
  handleAppointmentOperation(operation: string, data: any): Promise<any>;

  /**
   * Get appointment-specific metrics
   */
  getAppointmentMetrics(): Promise<Record<string, any>>;
}

/**
 * Auth Plugin Interface
 * Extends base plugin for authentication-specific functionality
 */
export interface AuthPlugin extends BasePlugin {
  /**
   * Handle authentication operations
   */
  handleAuthOperation(operation: string, data: any): Promise<any>;

  /**
   * Validate user permissions
   */
  validatePermissions(
    userId: string,
    resource: string,
    action: string,
  ): Promise<boolean>;
}

/**
 * Queue Plugin Interface
 * Extends base plugin for queue-specific functionality
 */
export interface QueuePlugin extends BasePlugin {
  /**
   * Handle queue operations
   */
  handleQueueOperation(operation: string, data: any): Promise<any>;

  /**
   * Get queue metrics
   */
  getQueueMetrics(): Promise<Record<string, any>>;
}

/**
 * Plugin Registry Interface
 * Manages plugin registration and discovery
 */
export interface PluginRegistry {
  /**
   * Register a plugin
   */
  register(plugin: BasePlugin): Promise<void>;

  /**
   * Unregister a plugin
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
 * Manages plugin lifecycle and execution
 */
export interface PluginManager {
  /**
   * Initialize all plugins
   */
  initializePlugins(context: PluginContext): Promise<void>;

  /**
   * Execute plugin operation
   */
  executePlugin(pluginName: string, operation: string, data: any): Promise<any>;

  /**
   * Execute plugins by feature
   */
  executePluginsByFeature(
    feature: string,
    operation: string,
    data: any,
  ): Promise<any[]>;

  /**
   * Get plugin health status
   */
  getPluginHealth(
    pluginName?: string,
  ): Promise<PluginHealth | Record<string, PluginHealth>>;

  /**
   * Shutdown all plugins
   */
  shutdown(): Promise<void>;
}

/**
 * Plugin Configuration Interface
 * Manages plugin configuration
 */
export interface PluginConfigManager {
  /**
   * Get plugin configuration
   */
  getConfig(pluginName: string): PluginConfig;

  /**
   * Update plugin configuration
   */
  updateConfig(
    pluginName: string,
    config: Partial<PluginConfig>,
  ): Promise<void>;

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
 * Plugin Error Types
 */
export class PluginError extends Error {
  constructor(
    message: string,
    public pluginName: string,
    public operation: string,
    public originalError?: Error,
  ) {
    super(message);
    this.name = "PluginError";
  }
}

export class PluginTimeoutError extends PluginError {
  constructor(pluginName: string, operation: string, timeout: number) {
    super(
      `Plugin ${pluginName} timed out after ${timeout}ms during ${operation}`,
      pluginName,
      operation,
    );
    this.name = "PluginTimeoutError";
  }
}

export class PluginValidationError extends PluginError {
  constructor(
    pluginName: string,
    operation: string,
    validationErrors: string[],
  ) {
    super(
      `Plugin ${pluginName} validation failed: ${validationErrors.join(", ")}`,
      pluginName,
      operation,
    );
    this.name = "PluginValidationError";
  }
}

/**
 * Plugin Event Types
 */
export interface PluginEvent {
  type:
    | "plugin.registered"
    | "plugin.unregistered"
    | "plugin.initialized"
    | "plugin.error"
    | "plugin.health.changed";
  pluginName: string;
  timestamp: Date;
  data?: any;
}

/**
 * Plugin Metrics Interface
 */
export interface PluginMetrics {
  pluginName: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  lastExecution: Date;
  errorRate: number;
  customMetrics?: Record<string, any>;
}

/**
 * Plugin Factory Interface
 * Creates plugin instances
 */
export interface PluginFactory {
  /**
   * Create plugin instance
   */
  createPlugin(pluginType: string, config: PluginConfig): BasePlugin;

  /**
   * Get supported plugin types
   */
  getSupportedTypes(): string[];

  /**
   * Validate plugin configuration
   */
  validateConfig(pluginType: string, config: PluginConfig): boolean;
}
