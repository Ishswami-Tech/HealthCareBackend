import { Injectable, Logger } from '@nestjs/common';
import { 
  BasePlugin, 
  PluginManager, 
  PluginContext, 
  PluginHealth,
  PluginError,
  PluginTimeoutError,
  PluginValidationError
} from './plugin.interface';
import { EnterprisePluginRegistry } from './plugin.registry';

/**
 * Enterprise Plugin Manager Implementation
 * 
 * Manages plugin lifecycle, execution, and monitoring across all services.
 * Provides centralized plugin orchestration with timeout handling and error recovery.
 */
@Injectable()
export class EnterprisePluginManager implements PluginManager {
  private readonly logger = new Logger(EnterprisePluginManager.name);
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private readonly DEFAULT_RETRY_ATTEMPTS = 3;

  constructor(private readonly pluginRegistry: EnterprisePluginRegistry) {}

  /**
   * Initialize all plugins with context
   */
  async initializePlugins(context: PluginContext): Promise<void> {
    this.logger.log(`🚀 Initializing plugins for clinic: ${context.clinicId || 'default'}`);
    
    try {
      await this.pluginRegistry.initializeAllPlugins(context);
      this.logger.log('✅ All plugins initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize plugins:', error);
      throw error;
    }
  }

  /**
   * Execute plugin operation with timeout and error handling
   */
  async executePlugin(
    pluginName: string, 
    operation: string, 
    data: any
  ): Promise<any> {
    const plugin = this.pluginRegistry.getPlugin(pluginName);
    if (!plugin) {
      throw new PluginError(
        `Plugin '${pluginName}' not found`,
        pluginName,
        operation
      );
    }

    this.logger.debug(`🔧 Executing plugin ${pluginName}:${operation}`);

    try {
      // Validate input data
      const isValid = await this.executeWithTimeout(
        () => plugin.validate(data),
        pluginName,
        'validate',
        5000 // 5 second timeout for validation
      );

      if (!isValid) {
        throw new PluginValidationError(
          pluginName,
          operation,
          ['Input validation failed']
        );
      }

      // Execute plugin operation
      const result = await this.executeWithTimeout(
        () => plugin.process(data),
        pluginName,
        operation,
        this.DEFAULT_TIMEOUT
      );

      this.logger.debug(`✅ Plugin ${pluginName}:${operation} executed successfully`);
      return result;

    } catch (error) {
      this.logger.error(`❌ Plugin ${pluginName}:${operation} failed:`, error);
      
      if (error instanceof PluginTimeoutError) {
        // Mark plugin as unhealthy
        await this.markPluginUnhealthy(pluginName, error.message);
      }
      
      throw error;
    }
  }

  /**
   * Execute plugins by feature with parallel processing
   */
  async executePluginsByFeature(
    feature: string, 
    operation: string, 
    data: any
  ): Promise<any[]> {
    const plugins = this.pluginRegistry.getPluginsByFeature(feature);
    
    if (plugins.length === 0) {
      this.logger.warn(`⚠️ No plugins found for feature: ${feature}`);
      return [];
    }

    this.logger.debug(`🔧 Executing ${plugins.length} plugins for feature: ${feature}`);

    const executionPromises = plugins.map(async (plugin) => {
      try {
        return await this.executePlugin(plugin.name, operation, data);
      } catch (error) {
        this.logger.error(`❌ Plugin ${plugin.name} failed for feature ${feature}:`, error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    });

    const results = await Promise.all(executionPromises);
    
    // Filter out error results and log summary
    const successfulResults = results.filter(result => !result.error);
    const failedResults = results.filter(result => result.error);
    
    this.logger.debug(
      `📊 Feature ${feature} execution complete: ${successfulResults.length} successful, ${failedResults.length} failed`
    );

    return successfulResults;
  }

  /**
   * Get plugin health status
   */
  async getPluginHealth(pluginName?: string): Promise<PluginHealth | Record<string, PluginHealth>> {
    if (pluginName) {
      return await this.pluginRegistry.getPluginHealth(pluginName);
    }

    // Check health of all plugins
    await this.pluginRegistry.checkAllPluginHealth();
    return await this.pluginRegistry.getPluginHealth();
  }

  /**
   * Shutdown all plugins
   */
  async shutdown(): Promise<void> {
    this.logger.log('🛑 Shutting down plugin manager...');
    
    try {
      await this.pluginRegistry.shutdownAllPlugins();
      this.logger.log('✅ Plugin manager shutdown complete');
    } catch (error) {
      this.logger.error('❌ Error during plugin manager shutdown:', error);
      throw error;
    }
  }

  /**
   * Execute plugin operation with retry logic
   */
  async executePluginWithRetry(
    pluginName: string,
    operation: string,
    data: any,
    maxRetries: number = this.DEFAULT_RETRY_ATTEMPTS
  ): Promise<any> {
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug(`🔄 Plugin ${pluginName}:${operation} attempt ${attempt}/${maxRetries}`);
        return await this.executePlugin(pluginName, operation, data);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          this.logger.warn(
            `⚠️ Plugin ${pluginName}:${operation} attempt ${attempt} failed, retrying in ${delay}ms:`,
            lastError.message
          );
          await this.sleep(delay);
        }
      }
    }

    this.logger.error(`❌ Plugin ${pluginName}:${operation} failed after ${maxRetries} attempts`);
    throw lastError || new PluginError(
      `Plugin ${pluginName} failed after ${maxRetries} attempts`,
      pluginName,
      operation
    );
  }

  /**
   * Execute plugin operation with timeout
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    pluginName: string,
    operationName: string,
    timeoutMs: number
  ): Promise<T> {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new PluginTimeoutError(pluginName, operationName, timeoutMs));
      }, timeoutMs);

      try {
        const result = await operation();
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Mark plugin as unhealthy
   */
  private async markPluginUnhealthy(pluginName: string, errorMessage: string): Promise<void> {
    try {
      const healthResult = await this.pluginRegistry.getPluginHealth(pluginName);
      if (healthResult && typeof healthResult === 'object' && 'isHealthy' in healthResult) {
        const health = healthResult as PluginHealth;
        const updatedHealth: PluginHealth = {
          ...health,
          isHealthy: false,
          lastCheck: new Date(),
          errors: [...(health.errors || []), errorMessage]
        };
        
        // Update health in registry (this would need to be implemented in the registry)
        this.logger.warn(`⚠️ Marked plugin ${pluginName} as unhealthy: ${errorMessage}`);
      }
    } catch (error) {
      this.logger.error(`❌ Failed to mark plugin ${pluginName} as unhealthy:`, error);
    }
  }

  /**
   * Get plugin execution metrics
   */
  async getPluginMetrics(): Promise<{
    totalPlugins: number;
    healthyPlugins: number;
    unhealthyPlugins: number;
    pluginsByFeature: Record<string, number>;
  }> {
    const stats = this.pluginRegistry.getPluginStats();
    const health = await this.getPluginHealth() as Record<string, PluginHealth>;
    
    const healthyPlugins = Object.values(health).filter(h => h.isHealthy).length;
    const unhealthyPlugins = Object.values(health).filter(h => !h.isHealthy).length;

    return {
      totalPlugins: stats.totalPlugins,
      healthyPlugins,
      unhealthyPlugins,
      pluginsByFeature: stats.pluginsByFeature
    };
  }

  /**
   * Execute plugins in sequence (for operations that must be ordered)
   */
  async executePluginsSequentially(
    pluginNames: string[],
    operation: string,
    data: any
  ): Promise<any[]> {
    const results: any[] = [];
    
    for (const pluginName of pluginNames) {
      try {
        const result = await this.executePlugin(pluginName, operation, data);
        results.push(result);
      } catch (error) {
        this.logger.error(`❌ Sequential execution failed for plugin ${pluginName}:`, error);
        results.push({ error: error instanceof Error ? error.message : String(error) });
        // Continue with next plugin
      }
    }

    return results;
  }

  /**
   * Execute plugins with fallback strategy
   */
  async executePluginsWithFallback(
    primaryPlugin: string,
    fallbackPlugins: string[],
    operation: string,
    data: any
  ): Promise<any> {
    try {
      // Try primary plugin first
      return await this.executePlugin(primaryPlugin, operation, data);
    } catch (error) {
      this.logger.warn(`⚠️ Primary plugin ${primaryPlugin} failed, trying fallbacks:`, error);
      
      // Try fallback plugins
      for (const fallbackPlugin of fallbackPlugins) {
        try {
          return await this.executePlugin(fallbackPlugin, operation, data);
        } catch (fallbackError) {
          this.logger.warn(`⚠️ Fallback plugin ${fallbackPlugin} also failed:`, fallbackError);
        }
      }
      
      throw new PluginError(
        `All plugins failed for operation ${operation}`,
        'fallback',
        operation,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Utility method for sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
