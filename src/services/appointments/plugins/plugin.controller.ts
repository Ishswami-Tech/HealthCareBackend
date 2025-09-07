import { Controller, Get, Post, Body, Param, Logger, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { UseInterceptors } from '@nestjs/common';
import { AppointmentEnterprisePluginManager } from './enterprise-plugin-manager';
import { PluginConfigService } from './config/plugin-config.service';
import { PluginHealthService } from './health/plugin-health.service';

@ApiTags('Appointment Plugins')
@Controller('api/appointments/plugins')
@ApiBearerAuth()
@ApiSecurity('session-id')
export class AppointmentPluginController {
  private readonly logger = new Logger(AppointmentPluginController.name);

  constructor(
    private readonly enterprisePluginManager: AppointmentEnterprisePluginManager,
    private readonly pluginConfigService: PluginConfigService,
    private readonly pluginHealthService: PluginHealthService
  ) {}

  @Get('info')
  @ApiOperation({
    summary: 'Get plugin information',
    description: 'Get information about all registered plugins'
  })
  @ApiResponse({ status: 200, description: 'Plugin information retrieved successfully' })
  async getPluginInfo() {
    const startTime = Date.now();

    try {
      const pluginInfo = this.enterprisePluginManager.getEnterpriseRegistry().getPluginInfo();
      
      const duration = Date.now() - startTime;
      this.logger.log(`Plugin info retrieved successfully in ${duration}ms`);

      return {
        plugins: pluginInfo,
        total: pluginInfo.length,
        retrievedAt: new Date().toISOString(),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? (error as Error).message : String(error);
      const errorStack = error instanceof Error ? (error as Error).stack : '';
      this.logger.error(`Failed to get plugin info: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  @Get('domain/:domain')
  @ApiOperation({
    summary: 'Get domain plugins',
    description: 'Get all plugins for a specific domain'
  })
  @ApiResponse({ status: 200, description: 'Domain plugins retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  async getDomainPlugins(@Param('domain') domain: string) {
    const startTime = Date.now();

    try {
      const plugins = this.enterprisePluginManager.getEnterpriseRegistry().getPluginsByFeature(domain);
      
      const duration = Date.now() - startTime;
      this.logger.log(`Domain plugins retrieved for ${domain} in ${duration}ms`);

      return {
        domain,
        plugins: plugins.map((plugin: any) => ({
          name: plugin.name,
          version: plugin.version,
          features: plugin.features || []
        })),
        features: plugins.map((p: any) => p.features || []).flat(),
        total: plugins.length,
        retrievedAt: new Date().toISOString(),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? (error as Error).message : String(error);
      const errorStack = error instanceof Error ? (error as Error).stack : '';
      this.logger.error(`Failed to get domain plugins: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  @Get('domain/:domain/features')
  @ApiOperation({
    summary: 'Get domain features',
    description: 'Get all available features for a specific domain'
  })
  @ApiResponse({ status: 200, description: 'Domain features retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  async getDomainFeatures(@Param('domain') domain: string) {
    const startTime = Date.now();

    try {
      const features = this.enterprisePluginManager.getEnterpriseRegistry().getPluginsByFeature(domain);
      
      const duration = Date.now() - startTime;
      this.logger.log(`Domain features retrieved for ${domain} in ${duration}ms`);

      return {
        domain,
        features,
        total: features.length,
        retrievedAt: new Date().toISOString(),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? (error as Error).message : String(error);
      const errorStack = error instanceof Error ? (error as Error).stack : '';
      this.logger.error(`Failed to get domain features: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  @Post('execute')
  @ApiOperation({
    summary: 'Execute plugin operation',
    description: 'Execute a plugin operation for a specific domain and feature'
  })
  @ApiResponse({ status: 200, description: 'Plugin operation executed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid operation or data' })
  @ApiResponse({ status: 404, description: 'Plugin not found' })
  async executePluginOperation(
    @Body() body: {
      domain: string;
      feature: string;
      operation: string;
      data: any;
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
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? (error as Error).message : String(error);
      const errorStack = error instanceof Error ? (error as Error).stack : '';
      this.logger.error(`Failed to execute plugin operation: ${errorMessage}`, errorStack);
      
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
    description: 'Execute multiple plugin operations in sequence'
  })
  @ApiResponse({ status: 200, description: 'Plugin operations executed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid operations or data' })
  async executePluginOperations(
    @Body() body: {
      operations: Array<{
        domain: string;
        feature: string;
        operation: string;
        data: any;
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

      return {
        success: true,
        results,
        total: body.operations.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        executedAt: new Date().toISOString(),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? (error as Error).message : String(error);
      const errorStack = error instanceof Error ? (error as Error).stack : '';
      this.logger.error(`Failed to execute batch plugin operations: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  @Get('health')
  @ApiOperation({
    summary: 'Get plugin system health',
    description: 'Get health status of the plugin system'
  })
  @ApiResponse({ status: 200, description: 'Plugin system health retrieved successfully' })
  async getPluginSystemHealth() {
    const startTime = Date.now();

    try {
      const pluginInfo = this.enterprisePluginManager.getEnterpriseRegistry().getPluginInfo();
      const domains = [...new Set(pluginInfo.map((p: any) => p.domain))];
      const healthSummary = await this.pluginHealthService.getPluginHealthSummary();
      
      const health = {
        status: healthSummary.overallStatus,
        totalPlugins: pluginInfo.length,
        domains: domains.map(domain => ({
          domain,
          plugins: pluginInfo.filter((p: any) => p.domain === domain).length,
          features: this.enterprisePluginManager.getEnterpriseRegistry().getPluginsByFeature(domain)
        })),
        healthSummary,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      };
      
      const duration = Date.now() - startTime;
      this.logger.log(`Plugin system health retrieved in ${duration}ms`);

      return health;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? (error as Error).message : String(error);
      const errorStack = error instanceof Error ? (error as Error).stack : '';
      this.logger.error(`Failed to get plugin system health: ${errorMessage}`, errorStack);
      
      return {
        status: 'unhealthy',
        error: errorMessage,
        timestamp: new Date().toISOString(),
        duration,
      };
    }
  }

  @Get('health/metrics')
  @ApiOperation({
    summary: 'Get detailed plugin health metrics',
    description: 'Get detailed health metrics for all plugins'
  })
  @ApiResponse({ status: 200, description: 'Plugin health metrics retrieved successfully' })
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
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? (error as Error).message : String(error);
      const errorStack = error instanceof Error ? (error as Error).stack : '';
      this.logger.error(`Failed to get plugin health metrics: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  @Get('health/domain/:domain')
  @ApiOperation({
    summary: 'Get domain plugin health',
    description: 'Get health metrics for plugins in a specific domain'
  })
  @ApiResponse({ status: 200, description: 'Domain plugin health retrieved successfully' })
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
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? (error as Error).message : String(error);
      const errorStack = error instanceof Error ? (error as Error).stack : '';
      this.logger.error(`Failed to get domain plugin health: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  @Get('health/alerts')
  @ApiOperation({
    summary: 'Get plugin performance alerts',
    description: 'Get performance alerts for plugins'
  })
  @ApiResponse({ status: 200, description: 'Plugin alerts retrieved successfully' })
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
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? (error as Error).message : String(error);
      const errorStack = error instanceof Error ? (error as Error).stack : '';
      this.logger.error(`Failed to get plugin alerts: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  @Get('config')
  @ApiOperation({
    summary: 'Get plugin configurations',
    description: 'Get all plugin configurations'
  })
  @ApiResponse({ status: 200, description: 'Plugin configurations retrieved successfully' })
  async getPluginConfigs() {
    const startTime = Date.now();

    try {
      const configs = await this.pluginConfigService.getAllPluginConfigs();
      
      const duration = Date.now() - startTime;
      this.logger.log(`Plugin configurations retrieved in ${duration}ms`);

      return {
        configs,
        total: Object.keys(configs).length,
        retrievedAt: new Date().toISOString(),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? (error as Error).message : String(error);
      const errorStack = error instanceof Error ? (error as Error).stack : '';
      this.logger.error(`Failed to get plugin configurations: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  @Get('config/:pluginName')
  @ApiOperation({
    summary: 'Get plugin configuration',
    description: 'Get configuration for a specific plugin'
  })
  @ApiResponse({ status: 200, description: 'Plugin configuration retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Plugin not found' })
  async getPluginConfig(@Param('pluginName') pluginName: string) {
    const startTime = Date.now();

    try {
      const config = await this.pluginConfigService.getPluginConfig(pluginName);
      
      if (!config) {
        return {
          success: false,
          error: `Plugin ${pluginName} not found`,
          retrievedAt: new Date().toISOString(),
        };
      }
      
      const duration = Date.now() - startTime;
      this.logger.log(`Plugin configuration retrieved for ${pluginName} in ${duration}ms`);

      return {
        success: true,
        pluginName,
        config,
        retrievedAt: new Date().toISOString(),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? (error as Error).message : String(error);
      const errorStack = error instanceof Error ? (error as Error).stack : '';
      this.logger.error(`Failed to get plugin configuration: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  @Post('config/:pluginName')
  @ApiOperation({
    summary: 'Update plugin configuration',
    description: 'Update configuration for a specific plugin'
  })
  @ApiResponse({ status: 200, description: 'Plugin configuration updated successfully' })
  @ApiResponse({ status: 404, description: 'Plugin not found' })
  async updatePluginConfig(
    @Param('pluginName') pluginName: string,
    @Body() config: any
  ) {
    const startTime = Date.now();

    try {
      const success = await this.pluginConfigService.updatePluginConfig(pluginName, config);
      
      const duration = Date.now() - startTime;
      this.logger.log(`Plugin configuration updated for ${pluginName} in ${duration}ms`);

      return {
        success,
        pluginName,
        updatedAt: new Date().toISOString(),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? (error as Error).message : String(error);
      const errorStack = error instanceof Error ? (error as Error).stack : '';
      this.logger.error(`Failed to update plugin configuration: ${errorMessage}`, errorStack);
      throw error;
    }
  }
}
