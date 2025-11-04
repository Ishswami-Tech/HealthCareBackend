import { Controller, Get, Post, Body, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { EnterprisePluginManager } from '@core/plugin-interface';
import { PluginConfigService } from './config/plugin-config.service';
import { PluginHealthService } from './health/plugin-health.service';
import type { PluginOperationResult, BasePlugin } from '@core/types';
import type { PluginConfig } from './config/plugin-config.service';

@ApiTags('Appointment Plugins')
@Controller('api/appointments/plugins')
@ApiBearerAuth()
@ApiSecurity('session-id')
export class AppointmentPluginController {
  private readonly logger = new Logger(AppointmentPluginController.name);

  constructor(
    private readonly enterprisePluginManager: EnterprisePluginManager,
    private readonly pluginConfigService: PluginConfigService,
    private readonly pluginHealthService: PluginHealthService
  ) {}

  @Get('info')
  @ApiOperation({
    summary: 'Get plugin information',
    description: 'Get information about all registered plugins',
  })
  @ApiResponse({
    status: 200,
    description: 'Plugin information retrieved successfully',
  })
  getPluginInfo() {
    const startTime = Date.now();

    try {
      const registry = this.enterprisePluginManager.getEnterpriseRegistry();
      const pluginInfo = registry.getPluginInfo();

      const duration = Date.now() - startTime;
      this.logger.log(`Plugin info retrieved successfully in ${duration}ms`);

      return {
        plugins: pluginInfo,
        total: pluginInfo.length,
        retrievedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get plugin info: ${errorMessage}`);
      throw error;
    }
  }

  @Get('domain/:domain')
  @ApiOperation({
    summary: 'Get domain plugins',
    description: 'Get all plugins for a specific domain',
  })
  @ApiResponse({
    status: 200,
    description: 'Domain plugins retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  getDomainPlugins(@Param('domain') domain: string) {
    const startTime = Date.now();

    try {
      const registry = this.enterprisePluginManager.getEnterpriseRegistry();
      const plugins = registry.getPluginsByFeature(domain);

      const duration = Date.now() - startTime;
      this.logger.log(`Domain plugins retrieved for ${domain} in ${duration}ms`);

      return {
        domain,
        plugins: plugins.map((plugin: BasePlugin) => ({
          name: plugin.name,
          version: plugin.version,
          features: plugin.features || [],
        })),
        features: plugins.map((p: BasePlugin) => p.features || []).flat(),
        total: plugins.length,
        retrievedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get domain plugins: ${errorMessage}`);
      throw error;
    }
  }

  @Get('domain/:domain/features')
  @ApiOperation({
    summary: 'Get domain features',
    description: 'Get all available features for a specific domain',
  })
  @ApiResponse({
    status: 200,
    description: 'Domain features retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  getDomainFeatures(@Param('domain') domain: string) {
    const startTime = Date.now();

    try {
      const registry = this.enterprisePluginManager.getEnterpriseRegistry();
      const features = registry.getDomainFeatures(domain);

      const duration = Date.now() - startTime;
      this.logger.log(`Domain features retrieved for ${domain} in ${duration}ms`);

      return {
        domain,
        features,
        total: features.length,
        retrievedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get domain features: ${errorMessage}`);
      throw error;
    }
  }

  @Post('execute')
  @ApiOperation({
    summary: 'Execute plugin operation',
    description: 'Execute a plugin operation for a specific domain and feature',
  })
  @ApiResponse({
    status: 200,
    description: 'Plugin operation executed successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid operation or data' })
  @ApiResponse({ status: 404, description: 'Plugin not found' })
  async executePluginOperation(
    @Body()
    body: {
      domain: string;
      feature: string;
      operation: string;
      data: unknown;
    }
  ) {
    const startTime = Date.now();

    try {
      const { domain, feature, operation, data } = body;

      const result = await this.enterprisePluginManager.executePluginOperation(
        domain,
        feature,
        operation,
        data
      );

      const duration = Date.now() - startTime;
      this.logger.log(`Plugin operation executed successfully in ${duration}ms`);

      // Update health metrics
      await this.pluginHealthService.updatePluginMetrics(
        `${domain}-${feature}-plugin`,
        operation,
        duration,
        true
      );

      return {
        success: true,
        result,
        domain,
        feature,
        operation,
        executedAt: new Date().toISOString(),
        duration,
      };
    } catch (_error) {
      const duration = Date.now() - startTime;
      const errorMessage = _error instanceof Error ? _error.message : String(_error);
      const _errorStack = _error instanceof Error ? _error.stack : '';
      this.logger.error(`Failed to execute plugin operation: ${errorMessage}`, _errorStack);

      // Update health metrics for failed operation
      await this.pluginHealthService.updatePluginMetrics(
        `${body.domain}-${body.feature}-plugin`,
        body.operation,
        duration,
        false
      );

      return {
        success: false,
        error: errorMessage,
        domain: body.domain,
        feature: body.feature,
        operation: body.operation,
        executedAt: new Date().toISOString(),
        duration,
      };
    }
  }

  @Post('execute-batch')
  @ApiOperation({
    summary: 'Execute multiple plugin operations',
    description: 'Execute multiple plugin operations in sequence',
  })
  @ApiResponse({
    status: 200,
    description: 'Plugin operations executed successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid operations or data' })
  async executePluginOperations(
    @Body()
    body: {
      operations: Array<{
        domain: string;
        feature: string;
        operation: string;
        data: unknown;
      }>;
    }
  ) {
    const startTime = Date.now();

    try {
      const results = await Promise.all(
        body.operations.map(op =>
          this.enterprisePluginManager.executePluginOperation(
            op.domain,
            op.feature,
            op.operation,
            op.data
          )
        )
      );

      const duration = Date.now() - startTime;
      this.logger.log(`Batch plugin operations executed in ${duration}ms`);

      const typedResults = results;

      return {
        success: true,
        results: typedResults,
        total: body.operations.length,
        successful: typedResults.filter((r: PluginOperationResult) => r.success).length,
        failed: typedResults.filter((r: PluginOperationResult) => !r.success).length,
        executedAt: new Date().toISOString(),
        duration,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to execute batch plugin operations: ${errorMessage}`);
      throw error;
    }
  }

  @Get('health')
  @ApiOperation({
    summary: 'Get plugin system health',
    description: 'Get health status of the plugin system',
  })
  @ApiResponse({
    status: 200,
    description: 'Plugin system health retrieved successfully',
  })
  async getPluginSystemHealth() {
    const startTime = Date.now();

    try {
      const registry = this.enterprisePluginManager.getEnterpriseRegistry();
      const pluginInfo = registry.getPluginInfo();
      const domains = [...new Set(pluginInfo.map(p => p.domain))];
      const healthSummary = await this.pluginHealthService.getPluginHealthSummary();

      const health = {
        status: healthSummary.overallStatus,
        totalPlugins: pluginInfo.length,
        domains: domains.map(domain => ({
          domain,
          plugins: pluginInfo.filter(p => p.domain === domain).length,
          features: registry.getDomainFeatures(domain),
        })),
        healthSummary,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      };

      const duration = Date.now() - startTime;
      this.logger.log(`Plugin system health retrieved in ${duration}ms`);

      return health;
    } catch (_error) {
      const duration = Date.now() - startTime;
      const errorMessage = _error instanceof Error ? _error.message : String(_error);
      const _errorStack = _error instanceof Error ? _error.stack : '';
      this.logger.error(`Failed to get plugin system health: ${errorMessage}`, _errorStack);

      return {
        status: 'unhealthy',
        _error: errorMessage,
        timestamp: new Date().toISOString(),
        duration,
      };
    }
  }

  @Get('health/metrics')
  @ApiOperation({
    summary: 'Get detailed plugin health metrics',
    description: 'Get detailed health metrics for all plugins',
  })
  @ApiResponse({
    status: 200,
    description: 'Plugin health metrics retrieved successfully',
  })
  async getPluginHealthMetrics() {
    const startTime = Date.now();

    try {
      const healthMetrics = await this.pluginHealthService.getAllPluginHealth();

      const duration = Date.now() - startTime;
      this.logger.log(`Plugin health metrics retrieved in ${duration}ms`);

      return {
        metrics: healthMetrics,
        total: healthMetrics.length,
        retrievedAt: new Date().toISOString(),
        duration,
      };
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error);
      this.logger.error(`Failed to get plugin health metrics: ${errorMessage}`);
      throw _error;
    }
  }

  @Get('health/domain/:domain')
  @ApiOperation({
    summary: 'Get domain plugin health',
    description: 'Get health metrics for plugins in a specific domain',
  })
  @ApiResponse({
    status: 200,
    description: 'Domain plugin health retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  async getDomainPluginHealth(@Param('domain') domain: string) {
    const startTime = Date.now();

    try {
      const healthMetrics = await this.pluginHealthService.getDomainPluginHealth(domain);

      const duration = Date.now() - startTime;
      this.logger.log(`Domain plugin health retrieved for ${domain} in ${duration}ms`);

      return {
        domain,
        metrics: healthMetrics,
        total: healthMetrics.length,
        retrievedAt: new Date().toISOString(),
        duration,
      };
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error);
      this.logger.error(`Failed to get domain plugin health: ${errorMessage}`);
      throw _error;
    }
  }

  @Get('health/alerts')
  @ApiOperation({
    summary: 'Get plugin performance alerts',
    description: 'Get performance alerts for plugins',
  })
  @ApiResponse({
    status: 200,
    description: 'Plugin alerts retrieved successfully',
  })
  async getPluginAlerts() {
    const startTime = Date.now();

    try {
      const alerts = await this.pluginHealthService.getPluginAlerts();

      const duration = Date.now() - startTime;
      this.logger.log(`Plugin alerts retrieved in ${duration}ms`);

      return {
        alerts,
        total: alerts.length,
        high: alerts.filter(a => a.severity === 'high').length,
        medium: alerts.filter(a => a.severity === 'medium').length,
        low: alerts.filter(a => a.severity === 'low').length,
        retrievedAt: new Date().toISOString(),
        duration,
      };
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error);
      this.logger.error(`Failed to get plugin alerts: ${errorMessage}`);
      throw _error;
    }
  }

  @Get('config')
  @ApiOperation({
    summary: 'Get plugin configurations',
    description: 'Get all plugin configurations',
  })
  @ApiResponse({
    status: 200,
    description: 'Plugin configurations retrieved successfully',
  })
  async getPluginConfigs() {
    const startTime = Date.now();

    try {
      const configs = await this.pluginConfigService.getAllPluginConfigs();

      const _duration = Date.now() - startTime;
      this.logger.log(`Plugin configurations retrieved in ${_duration}ms`);

      return {
        configs,
        total: Object.keys(configs).length,
        retrievedAt: new Date().toISOString(),
      };
    } catch (_error) {
      const _duration = Date.now() - startTime;
      const errorMessage = _error instanceof Error ? _error.message : String(_error);
      const _errorStack = _error instanceof Error ? _error.stack : '';
      this.logger.error(`Failed to get plugin configurations: ${errorMessage}`, _errorStack);
      throw _error;
    }
  }

  @Get('config/:pluginName')
  @ApiOperation({
    summary: 'Get plugin configuration',
    description: 'Get configuration for a specific plugin',
  })
  @ApiResponse({
    status: 200,
    description: 'Plugin configuration retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Plugin not found' })
  async getPluginConfig(@Param('pluginName') pluginName: string) {
    const startTime = Date.now();

    try {
      const config = await this.pluginConfigService.getPluginConfig(pluginName);

      if (!config) {
        return {
          success: false,
          _error: `Plugin ${pluginName} not found`,
          retrievedAt: new Date().toISOString(),
        };
      }

      const _duration = Date.now() - startTime;
      this.logger.log(`Plugin configuration retrieved for ${pluginName} in ${_duration}ms`);

      return {
        success: true,
        pluginName,
        config,
        retrievedAt: new Date().toISOString(),
      };
    } catch (_error) {
      const _duration = Date.now() - startTime;
      const errorMessage = _error instanceof Error ? _error.message : String(_error);
      const _errorStack = _error instanceof Error ? _error.stack : '';
      this.logger.error(`Failed to get plugin configuration: ${errorMessage}`, _errorStack);
      throw _error;
    }
  }

  @Post('config/:pluginName')
  @ApiOperation({
    summary: 'Update plugin configuration',
    description: 'Update configuration for a specific plugin',
  })
  @ApiResponse({
    status: 200,
    description: 'Plugin configuration updated successfully',
  })
  @ApiResponse({ status: 404, description: 'Plugin not found' })
  async updatePluginConfig(@Param('pluginName') pluginName: string, @Body() config: unknown) {
    const startTime = Date.now();

    try {
      const pluginConfig = this.validatePluginConfig(config);
      const success = await this.pluginConfigService.updatePluginConfig(pluginName, pluginConfig);

      const _duration = Date.now() - startTime;
      this.logger.log(`Plugin configuration updated for ${pluginName} in ${_duration}ms`);

      return {
        success,
        pluginName,
        updatedAt: new Date().toISOString(),
      };
    } catch (_error) {
      const _duration = Date.now() - startTime;
      const errorMessage = _error instanceof Error ? _error.message : String(_error);
      const _errorStack = _error instanceof Error ? _error.stack : '';
      this.logger.error(`Failed to update plugin configuration: ${errorMessage}`, _errorStack);
      throw _error;
    }
  }

  private validatePluginConfig(config: unknown): Partial<PluginConfig> {
    if (typeof config !== 'object' || config === null) {
      throw new Error('Invalid plugin config: must be an object');
    }
    const record = config as Record<string, unknown>;
    const validated: Partial<PluginConfig> = {};
    if (typeof record['enabled'] === 'boolean') {
      validated.enabled = record['enabled'];
    }
    if (typeof record['priority'] === 'number') {
      validated.priority = record['priority'];
    }
    if (typeof record['settings'] === 'object' && record['settings'] !== null) {
      validated.settings = record['settings'] as Record<string, unknown>;
    }
    if (Array.isArray(record['features'])) {
      validated.features = record['features'] as string[];
    }
    if (typeof record['domain'] === 'string') {
      validated.domain = record['domain'];
    }
    return validated;
  }
}
