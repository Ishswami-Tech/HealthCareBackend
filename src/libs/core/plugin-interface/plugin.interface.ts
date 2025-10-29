/**
 * Enterprise Plugin Interface System
 *
 * This provides a unified interface for all plugin systems across the healthcare platform.
 * Supports domain-specific plugins for appointments, auth, queue, and other services.
 *
 * @module PluginInterface
 * @description Comprehensive plugin system for healthcare applications
 * @example
 * ```typescript
 * import { BasePlugin, PluginContext } from '@libs/core/plugin-interface';
 *
 * class MyPlugin implements BasePlugin {
 *   readonly name = 'my-plugin';
 *   readonly version = '1.0.0';
 *   readonly features = ['validation', 'processing'];
 *
 *   async initialize(context: PluginContext): Promise<void> {
 *     // Initialize plugin
 *   }
 *
 *   async process(data: unknown): Promise<unknown> {
 *     // Process data
 *   }
 *
 *   async validate(data: unknown): Promise<boolean> {
 *     // Validate data
 *   }
 *
 *   async getHealth(): Promise<PluginHealth> {
 *     // Return health status
 *   }
 *
 *   async destroy(): Promise<void> {
 *     // Cleanup resources
 *   }
 * }
 * ```
 */

/**
 * Plugin execution context
 *
 * @interface PluginContext
 * @description Context information passed to plugins during execution
 * @example
 * ```typescript
 * const context: PluginContext = {
 *   clinicId: 'clinic-123',
 *   userId: 'user-456',
 *   sessionId: 'session-789',
 *   metadata: { requestId: 'req-001' }
 * };
 * ```
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
 * @example
 * ```typescript
 * const metadata: PluginMetadata = {
 *   name: 'appointment-validator',
 *   version: '1.2.0',
 *   description: 'Validates appointment data',
 *   author: 'Healthcare Team',
 *   dependencies: ['validation-core'],
 *   tags: ['validation', 'appointments']
 * };
 * ```
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
 * @example
 * ```typescript
 * const health: PluginHealth = {
 *   isHealthy: true,
 *   lastCheck: new Date(),
 *   errors: [],
 *   metrics: { responseTime: 150 }
 * };
 * ```
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
 * @example
 * ```typescript
 * const config: PluginConfig = {
 *   enabled: true,
 *   priority: 1,
 *   timeout: 30000,
 *   retryAttempts: 3,
 *   fallbackEnabled: true,
 *   customSettings: { maxRetries: 5 }
 * };
 * ```
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
 * @example
 * ```typescript
 * class MyPlugin implements BasePlugin {
 *   readonly name = 'my-plugin';
 *   readonly version = '1.0.0';
 *   readonly features = ['validation', 'processing'];
 *
 *   async initialize(context: PluginContext): Promise<void> {
 *     // Initialize plugin with context
 *   }
 *
 *   async process(data: unknown): Promise<unknown> {
 *     // Process the data
 *     return processedData;
 *   }
 *
 *   async validate(data: unknown): Promise<boolean> {
 *     // Validate input data
 *     return isValid;
 *   }
 *
 *   async getHealth(): Promise<PluginHealth> {
 *     // Return current health status
 *     return { isHealthy: true, lastCheck: new Date() };
 *   }
 *
 *   async destroy(): Promise<void> {
 *     // Cleanup resources
 *   }
 * }
 * ```
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
   *
   * @param {PluginContext} context - Execution context for the plugin
   * @returns {Promise<void>} Promise that resolves when initialization is complete
   * @throws {PluginError} When initialization fails
   *
   * @example
   * ```typescript
   * await plugin.initialize({
   *   clinicId: 'clinic-123',
   *   userId: 'user-456',
   *   metadata: { requestId: 'req-001' }
   * });
   * ```
   */
  initialize(context: PluginContext): Promise<void>;

  /**
   * Process plugin operation with input data
   *
   * @param {unknown} data - Input data to process
   * @returns {Promise<unknown>} Promise that resolves with processed data
   * @throws {PluginError} When processing fails
   *
   * @example
   * ```typescript
   * const result = await plugin.process(appointmentData);
   * ```
   */
  process(data: unknown): Promise<unknown>;

  /**
   * Validate input data before processing
   *
   * @param {unknown} data - Data to validate
   * @returns {Promise<boolean>} Promise that resolves with validation result
   * @throws {PluginValidationError} When validation fails
   *
   * @example
   * ```typescript
   * const isValid = await plugin.validate(userInput);
   * if (!isValid) {
   *   throw new Error('Invalid input data');
   * }
   * ```
   */
  validate(data: unknown): Promise<boolean>;

  /**
   * Get current plugin health status
   *
   * @returns {Promise<PluginHealth>} Promise that resolves with health information
   *
   * @example
   * ```typescript
   * const health = await plugin.getHealth();
   * if (!health.isHealthy) {
   *   console.warn('Plugin is unhealthy:', health.errors);
   * }
   * ```
   */
  getHealth(): Promise<PluginHealth>;

  /**
   * Cleanup plugin resources and perform shutdown
   *
   * @returns {Promise<void>} Promise that resolves when cleanup is complete
   *
   * @example
   * ```typescript
   * await plugin.destroy();
   * ```
   */
  destroy(): Promise<void>;
}

/**
 * Appointment Plugin Interface
 *
 * Extends base plugin for appointment-specific functionality.
 * Provides specialized methods for handling appointment operations and metrics.
 *
 * @interface AppointmentPlugin
 * @extends {BasePlugin}
 * @description Plugin interface for appointment-related operations
 * @example
 * ```typescript
 * class AppointmentValidatorPlugin implements AppointmentPlugin {
 *   readonly name = 'appointment-validator';
 *   readonly version = '1.0.0';
 *   readonly features = ['appointment', 'validation'];
 *
 *   async handleAppointmentOperation(operation: string, data: unknown): Promise<unknown> {
 *     switch (operation) {
 *       case 'validate':
 *         return this.validateAppointment(data);
 *       case 'schedule':
 *         return this.scheduleAppointment(data);
 *       default:
 *         throw new Error(`Unknown operation: ${operation}`);
 *     }
 *   }
 *
 *   async getAppointmentMetrics(): Promise<Record<string, unknown>> {
 *     return {
 *       totalAppointments: 150,
 *       scheduledToday: 25,
 *       averageDuration: 30
 *     };
 *   }
 * }
 * ```
 */
export interface AppointmentPlugin extends BasePlugin {
  /**
   * Handle appointment-specific operations
   *
   * @param {string} operation - The operation to perform (e.g., 'validate', 'schedule', 'cancel')
   * @param {unknown} data - Appointment data for the operation
   * @returns {Promise<unknown>} Promise that resolves with operation result
   * @throws {PluginError} When operation fails
   *
   * @example
   * ```typescript
   * const result = await appointmentPlugin.handleAppointmentOperation('validate', appointmentData);
   * ```
   */
  handleAppointmentOperation(
    operation: string,
    data: unknown,
  ): Promise<unknown>;

  /**
   * Get appointment-specific metrics
   *
   * @returns {Promise<Record<string, unknown>>} Promise that resolves with appointment metrics
   *
   * @example
   * ```typescript
   * const metrics = await appointmentPlugin.getAppointmentMetrics();
   * console.log('Total appointments:', metrics.totalAppointments);
   * ```
   */
  getAppointmentMetrics(): Promise<Record<string, unknown>>;
}

/**
 * Auth Plugin Interface
 *
 * Extends base plugin for authentication-specific functionality.
 * Provides specialized methods for handling authentication operations and permission validation.
 *
 * @interface AuthPlugin
 * @extends {BasePlugin}
 * @description Plugin interface for authentication-related operations
 * @example
 * ```typescript
 * class JwtAuthPlugin implements AuthPlugin {
 *   readonly name = 'jwt-auth';
 *   readonly version = '1.0.0';
 *   readonly features = ['auth', 'jwt', 'permissions'];
 *
 *   async handleAuthOperation(operation: string, data: unknown): Promise<unknown> {
 *     switch (operation) {
 *       case 'login':
 *         return this.authenticateUser(data);
 *       case 'logout':
 *         return this.logoutUser(data);
 *       default:
 *         throw new Error(`Unknown auth operation: ${operation}`);
 *     }
 *   }
 *
 *   async validatePermissions(userId: string, resource: string, action: string): Promise<boolean> {
 *     return this.checkUserPermissions(userId, resource, action);
 *   }
 * }
 * ```
 */
export interface AuthPlugin extends BasePlugin {
  /**
   * Handle authentication operations
   *
   * @param {string} operation - The auth operation to perform (e.g., 'login', 'logout', 'refresh')
   * @param {unknown} data - Authentication data for the operation
   * @returns {Promise<unknown>} Promise that resolves with authentication result
   * @throws {PluginError} When authentication operation fails
   *
   * @example
   * ```typescript
   * const result = await authPlugin.handleAuthOperation('login', { username, password });
   * ```
   */
  handleAuthOperation(operation: string, data: unknown): Promise<unknown>;

  /**
   * Validate user permissions for a specific resource and action
   *
   * @param {string} userId - The user identifier
   * @param {string} resource - The resource being accessed
   * @param {string} action - The action being performed
   * @returns {Promise<boolean>} Promise that resolves with permission validation result
   *
   * @example
   * ```typescript
   * const hasPermission = await authPlugin.validatePermissions('user-123', 'appointments', 'create');
   * ```
   */
  validatePermissions(
    userId: string,
    resource: string,
    action: string,
  ): Promise<boolean>;
}

/**
 * Queue Plugin Interface
 *
 * Extends base plugin for queue-specific functionality.
 * Provides specialized methods for handling queue operations and monitoring.
 *
 * @interface QueuePlugin
 * @extends {BasePlugin}
 * @description Plugin interface for queue-related operations
 * @example
 * ```typescript
 * class EmailQueuePlugin implements QueuePlugin {
 *   readonly name = 'email-queue';
 *   readonly version = '1.0.0';
 *   readonly features = ['queue', 'email', 'messaging'];
 *
 *   async handleQueueOperation(operation: string, data: unknown): Promise<unknown> {
 *     switch (operation) {
 *       case 'enqueue':
 *         return this.addToQueue(data);
 *       case 'process':
 *         return this.processQueue();
 *       default:
 *         throw new Error(`Unknown queue operation: ${operation}`);
 *     }
 *   }
 *
 *   async getQueueMetrics(): Promise<Record<string, unknown>> {
 *     return {
 *       queueSize: 45,
 *       processedToday: 120,
 *       averageProcessingTime: 250
 *     };
 *   }
 * }
 * ```
 */
export interface QueuePlugin extends BasePlugin {
  /**
   * Handle queue operations
   *
   * @param {string} operation - The queue operation to perform (e.g., 'enqueue', 'dequeue', 'process')
   * @param {unknown} data - Queue data for the operation
   * @returns {Promise<unknown>} Promise that resolves with queue operation result
   * @throws {PluginError} When queue operation fails
   *
   * @example
   * ```typescript
   * const result = await queuePlugin.handleQueueOperation('enqueue', emailData);
   * ```
   */
  handleQueueOperation(operation: string, data: unknown): Promise<unknown>;

  /**
   * Get queue-specific metrics
   *
   * @returns {Promise<Record<string, unknown>>} Promise that resolves with queue metrics
   *
   * @example
   * ```typescript
   * const metrics = await queuePlugin.getQueueMetrics();
   * console.log('Queue size:', metrics.queueSize);
   * ```
   */
  getQueueMetrics(): Promise<Record<string, unknown>>;
}

/**
 * Plugin Registry Interface
 *
 * Manages plugin registration, discovery, and lifecycle management.
 * Provides centralized plugin management with health monitoring and error handling.
 *
 * @interface PluginRegistry
 * @description Registry interface for managing plugin registration and discovery
 * @example
 * ```typescript
 * class MyPluginRegistry implements PluginRegistry {
 *   async register(plugin: BasePlugin): Promise<void> {
 *     // Register plugin in internal storage
 *   }
 *
 *   async unregister(pluginName: string): Promise<void> {
 *     // Remove plugin from registry
 *   }
 *
 *   getPlugin(name: string): BasePlugin | undefined {
 *     // Return plugin by name
 *   }
 *
 *   getPluginsByFeature(feature: string): BasePlugin[] {
 *     // Return plugins that provide specific feature
 *   }
 *
 *   getAllPlugins(): BasePlugin[] {
 *     // Return all registered plugins
 *   }
 * }
 * ```
 */
export interface PluginRegistry {
  /**
   * Register a plugin in the registry
   *
   * @param {BasePlugin} plugin - The plugin to register
   * @returns {Promise<void>} Promise that resolves when registration is complete
   * @throws {PluginError} When registration fails (e.g., duplicate name)
   *
   * @example
   * ```typescript
   * await registry.register(new MyPlugin());
   * ```
   */
  register(plugin: BasePlugin): Promise<void>;

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
   * ```
   */
  unregister(pluginName: string): Promise<void>;

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
  getPlugin(name: string): BasePlugin | undefined;

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
  getPluginsByFeature(feature: string): BasePlugin[];

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
  getAllPlugins(): BasePlugin[];
}

/**
 * Plugin Manager Interface
 *
 * Manages plugin lifecycle, execution, and monitoring across all services.
 * Provides centralized plugin orchestration with timeout handling and error recovery.
 *
 * @interface PluginManager
 * @description Manager interface for plugin lifecycle and execution
 * @example
 * ```typescript
 * class MyPluginManager implements PluginManager {
 *   async initializePlugins(context: PluginContext): Promise<void> {
 *     // Initialize all registered plugins
 *   }
 *
 *   async executePlugin(pluginName: string, operation: string, data: unknown): Promise<unknown> {
 *     // Execute specific plugin operation
 *   }
 *
 *   async executePluginsByFeature(feature: string, operation: string, data: unknown): Promise<unknown[]> {
 *     // Execute all plugins with specific feature
 *   }
 *
 *   async getPluginHealth(pluginName?: string): Promise<PluginHealth | Record<string, PluginHealth>> {
 *     // Get health status of plugins
 *   }
 *
 *   async shutdown(): Promise<void> {
 *     // Shutdown all plugins
 *   }
 * }
 * ```
 */
export interface PluginManager {
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
   *   metadata: { requestId: 'req-001' }
   * });
   * ```
   */
  initializePlugins(context: PluginContext): Promise<void>;

  /**
   * Execute plugin operation with timeout and error handling
   *
   * @param {string} pluginName - The name of the plugin to execute
   * @param {string} operation - The operation to perform
   * @param {unknown} data - Input data for the operation
   * @returns {Promise<unknown>} Promise that resolves with operation result
   * @throws {PluginError} When plugin execution fails
   * @throws {PluginTimeoutError} When plugin operation times out
   *
   * @example
   * ```typescript
   * const result = await pluginManager.executePlugin('my-plugin', 'process', inputData);
   * ```
   */
  executePlugin(
    pluginName: string,
    operation: string,
    data: unknown,
  ): Promise<unknown>;

  /**
   * Execute plugins by feature with parallel processing
   *
   * @param {string} feature - The feature to execute plugins for
   * @param {string} operation - The operation to perform
   * @param {unknown} data - Input data for the operation
   * @returns {Promise<unknown[]>} Promise that resolves with array of results from successful plugins
   *
   * @example
   * ```typescript
   * const results = await pluginManager.executePluginsByFeature('validation', 'validate', userData);
   * ```
   */
  executePluginsByFeature(
    feature: string,
    operation: string,
    data: unknown,
  ): Promise<unknown[]>;

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
   *
   * // Get health for all plugins
   * const allHealth = await pluginManager.getPluginHealth();
   * ```
   */
  getPluginHealth(
    pluginName?: string,
  ): Promise<PluginHealth | Record<string, PluginHealth>>;

  /**
   * Shutdown all plugins gracefully
   *
   * @returns {Promise<void>} Promise that resolves when all plugins are shutdown
   *
   * @example
   * ```typescript
   * await pluginManager.shutdown();
   * ```
   */
  shutdown(): Promise<void>;
}

/**
 * Plugin Configuration Manager Interface
 *
 * Manages plugin configuration settings and provides centralized configuration management.
 * Supports dynamic configuration updates and validation.
 *
 * @interface PluginConfigManager
 * @description Configuration manager interface for plugin settings
 * @example
 * ```typescript
 * class MyPluginConfigManager implements PluginConfigManager {
 *   getConfig(pluginName: string): PluginConfig {
 *     // Return plugin configuration
 *   }
 *
 *   async updateConfig(pluginName: string, config: Partial<PluginConfig>): Promise<void> {
 *     // Update plugin configuration
 *   }
 *
 *   async resetConfig(pluginName: string): Promise<void> {
 *     // Reset to default configuration
 *   }
 *
 *   getAllConfigs(): Record<string, PluginConfig> {
 *     // Return all plugin configurations
 *   }
 * }
 * ```
 */
export interface PluginConfigManager {
  /**
   * Get plugin configuration
   *
   * @param {string} pluginName - The name of the plugin
   * @returns {PluginConfig} The plugin configuration
   * @throws {PluginError} When plugin is not found
   *
   * @example
   * ```typescript
   * const config = configManager.getConfig('my-plugin');
   * console.log('Plugin enabled:', config.enabled);
   * ```
   */
  getConfig(pluginName: string): PluginConfig;

  /**
   * Update plugin configuration
   *
   * @param {string} pluginName - The name of the plugin
   * @param {Partial<PluginConfig>} config - Partial configuration to update
   * @returns {Promise<void>} Promise that resolves when configuration is updated
   * @throws {PluginError} When plugin is not found or configuration is invalid
   *
   * @example
   * ```typescript
   * await configManager.updateConfig('my-plugin', {
   *   enabled: false,
   *   timeout: 60000
   * });
   * ```
   */
  updateConfig(
    pluginName: string,
    config: Partial<PluginConfig>,
  ): Promise<void>;

  /**
   * Reset plugin configuration to defaults
   *
   * @param {string} pluginName - The name of the plugin
   * @returns {Promise<void>} Promise that resolves when configuration is reset
   * @throws {PluginError} When plugin is not found
   *
   * @example
   * ```typescript
   * await configManager.resetConfig('my-plugin');
   * ```
   */
  resetConfig(pluginName: string): Promise<void>;

  /**
   * Get all plugin configurations
   *
   * @returns {Record<string, PluginConfig>} Object mapping plugin names to their configurations
   *
   * @example
   * ```typescript
   * const allConfigs = configManager.getAllConfigs();
   * for (const [name, config] of Object.entries(allConfigs)) {
   *   console.log(`${name}: ${config.enabled ? 'enabled' : 'disabled'}`);
   * }
   * ```
   */
  getAllConfigs(): Record<string, PluginConfig>;
}

/**
 * Plugin Error Types
 *
 * Custom error classes for plugin-related errors with detailed context information.
 * Provides structured error handling for plugin operations and debugging.
 */

/**
 * Base plugin error class
 *
 * @class PluginError
 * @extends {Error}
 * @description Base error class for all plugin-related errors
 * @example
 * ```typescript
 * throw new PluginError(
 *   'Plugin initialization failed',
 *   'my-plugin',
 *   'initialize',
 *   originalError
 * );
 * ```
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
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = "PluginError";

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
      operation,
    );
    this.name = "PluginTimeoutError";
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
  constructor(
    pluginName: string,
    operation: string,
    validationErrors: readonly string[],
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
 *
 * Event system for plugin lifecycle and status changes.
 * Provides structured event information for monitoring and debugging.
 */

/**
 * Plugin event interface
 *
 * @interface PluginEvent
 * @description Event information for plugin lifecycle and status changes
 * @example
 * ```typescript
 * const event: PluginEvent = {
 *   type: 'plugin.registered',
 *   pluginName: 'my-plugin',
 *   timestamp: new Date(),
 *   data: { version: '1.0.0' }
 * };
 * ```
 */
export interface PluginEvent {
  /** Type of plugin event */
  readonly type:
    | "plugin.registered"
    | "plugin.unregistered"
    | "plugin.initialized"
    | "plugin.error"
    | "plugin.health.changed";
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
 * Provides detailed statistics about plugin execution and health.
 *
 * @interface PluginMetrics
 * @description Metrics information for plugin performance monitoring
 * @example
 * ```typescript
 * const metrics: PluginMetrics = {
 *   pluginName: 'data-processor',
 *   totalExecutions: 1000,
 *   successfulExecutions: 950,
 *   failedExecutions: 50,
 *   averageExecutionTime: 150,
 *   lastExecution: new Date(),
 *   errorRate: 0.05,
 *   customMetrics: { memoryUsage: '50MB' }
 * };
 * ```
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
 * Provides factory pattern for plugin instantiation with configuration validation.
 *
 * @interface PluginFactory
 * @description Factory interface for creating plugin instances
 * @example
 * ```typescript
 * class MyPluginFactory implements PluginFactory {
 *   createPlugin(pluginType: string, config: PluginConfig): BasePlugin {
 *     switch (pluginType) {
 *       case 'validator':
 *         return new ValidatorPlugin(config);
 *       case 'processor':
 *         return new ProcessorPlugin(config);
 *       default:
 *         throw new Error(`Unknown plugin type: ${pluginType}`);
 *     }
 *   }
 *
 *   getSupportedTypes(): string[] {
 *     return ['validator', 'processor'];
 *   }
 *
 *   validateConfig(pluginType: string, config: PluginConfig): boolean {
 *     // Validate configuration for specific plugin type
 *     return true;
 *   }
 * }
 * ```
 */
export interface PluginFactory {
  /**
   * Create plugin instance
   *
   * @param {string} pluginType - Type of plugin to create
   * @param {PluginConfig} config - Configuration for the plugin
   * @returns {BasePlugin} The created plugin instance
   * @throws {PluginError} When plugin type is not supported or creation fails
   *
   * @example
   * ```typescript
   * const plugin = factory.createPlugin('validator', {
   *   enabled: true,
   *   priority: 1,
   *   timeout: 30000,
   *   retryAttempts: 3,
   *   fallbackEnabled: true
   * });
   * ```
   */
  createPlugin(pluginType: string, config: PluginConfig): BasePlugin;

  /**
   * Get supported plugin types
   *
   * @returns {string[]} Array of supported plugin type names
   *
   * @example
   * ```typescript
   * const types = factory.getSupportedTypes();
   * console.log('Supported types:', types); // ['validator', 'processor', 'auth']
   * ```
   */
  getSupportedTypes(): readonly string[];

  /**
   * Validate plugin configuration
   *
   * @param {string} pluginType - Type of plugin to validate configuration for
   * @param {PluginConfig} config - Configuration to validate
   * @returns {boolean} True if configuration is valid, false otherwise
   *
   * @example
   * ```typescript
   * const isValid = factory.validateConfig('validator', config);
   * if (!isValid) {
   *   throw new Error('Invalid plugin configuration');
   * }
   * ```
   */
  validateConfig(pluginType: string, config: PluginConfig): boolean;
}
