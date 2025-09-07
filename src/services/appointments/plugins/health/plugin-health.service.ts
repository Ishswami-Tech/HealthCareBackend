import { Injectable, Logger } from '@nestjs/common';
import { PluginConfigService } from '../config/plugin-config.service';
import { CacheService } from '../../../../libs/infrastructure/cache';

export interface PluginHealthMetrics {
  pluginName: string;
  domain: string;
  status: 'healthy' | 'warning' | 'unhealthy';
  uptime: number;
  lastOperation: Date;
  operationCount: number;
  errorCount: number;
  averageResponseTime: number;
  memoryUsage: number;
  cpuUsage: number;
  features: string[];
  enabled: boolean;
}

export interface PluginHealthSummary {
  totalPlugins: number;
  healthyPlugins: number;
  warningPlugins: number;
  unhealthyPlugins: number;
  overallStatus: 'healthy' | 'warning' | 'unhealthy';
  domains: {
    [domain: string]: {
      total: number;
      healthy: number;
      warning: number;
      unhealthy: number;
    };
  };
  timestamp: Date;
}

@Injectable()
export class PluginHealthService {
  private readonly logger = new Logger(PluginHealthService.name);
  private readonly HEALTH_CACHE_KEY = 'plugin:health';
  private readonly HEALTH_CACHE_TTL = 300; // 5 minutes
  private readonly METRICS_CACHE_PREFIX = 'plugin:metrics:';

  constructor(
    // private readonly pluginRegistry: AppointmentPluginRegistry, // Type not defined
    private readonly pluginConfigService: PluginConfigService,
    private readonly cacheService: CacheService
  ) {}

  /**
   * Get health metrics for all plugins
   */
  async getAllPluginHealth(): Promise<PluginHealthMetrics[]> {
    try {
      const cached = await this.cacheService.get(this.HEALTH_CACHE_KEY);
      if (cached) {
        return JSON.parse(cached as string);
      }

      const pluginInfo: any[] = []; // Mock plugin info array since registry is not available
      const healthMetrics: PluginHealthMetrics[] = [];

      for (const plugin of pluginInfo) {
        const metrics = await this.getPluginHealthMetrics(plugin.name);
        healthMetrics.push(metrics);
      }

      // Cache the health metrics
      await this.cacheService.set(this.HEALTH_CACHE_KEY, JSON.stringify(healthMetrics), this.HEALTH_CACHE_TTL);

      return healthMetrics;
    } catch (error) {
      this.logger.error('Failed to get all plugin health:', error);
      return [];
    }
  }

  /**
   * Get health metrics for a specific plugin
   */
  async getPluginHealthMetrics(pluginName: string): Promise<PluginHealthMetrics> {
    try {
      const cacheKey = `${this.METRICS_CACHE_PREFIX}${pluginName}`;
      const cached = await this.cacheService.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached as string);
      }

      const pluginInfo: any[] = []; // Mock plugin info array since registry is not available
      const plugin = pluginInfo.find(p => p.name === pluginName);
      
      if (!plugin) {
        throw new Error(`Plugin ${pluginName} not found`);
      }

      const config = await this.pluginConfigService.getPluginConfig(pluginName);
      
      // Calculate health metrics (simplified for now)
      const metrics: PluginHealthMetrics = {
        pluginName,
        domain: plugin.domain,
        status: 'healthy', // Default status
        uptime: process.uptime(),
        lastOperation: new Date(),
        operationCount: 0,
        errorCount: 0,
        averageResponseTime: 0,
        memoryUsage: process.memoryUsage().heapUsed,
        cpuUsage: 0,
        features: plugin.features,
        enabled: config?.enabled || false
      };

      // Cache the metrics
      await this.cacheService.set(cacheKey, JSON.stringify(metrics), this.HEALTH_CACHE_TTL);

      return metrics;
    } catch (error) {
      this.logger.error(`Failed to get plugin health metrics for ${pluginName}:`, error);
      
      return {
        pluginName,
        domain: 'unknown',
        status: 'unhealthy',
        uptime: 0,
        lastOperation: new Date(),
        operationCount: 0,
        errorCount: 1,
        averageResponseTime: 0,
        memoryUsage: 0,
        cpuUsage: 0,
        features: [],
        enabled: false
      };
    }
  }

  /**
   * Get health summary for all plugins
   */
  async getPluginHealthSummary(): Promise<PluginHealthSummary> {
    try {
      const healthMetrics = await this.getAllPluginHealth();
      
      const summary: PluginHealthSummary = {
        totalPlugins: healthMetrics.length,
        healthyPlugins: healthMetrics.filter(p => p.status === 'healthy').length,
        warningPlugins: healthMetrics.filter(p => p.status === 'warning').length,
        unhealthyPlugins: healthMetrics.filter(p => p.status === 'unhealthy').length,
        overallStatus: 'healthy',
        domains: {},
        timestamp: new Date()
      };

      // Calculate overall status
      if (summary.unhealthyPlugins > 0) {
        summary.overallStatus = 'unhealthy';
      } else if (summary.warningPlugins > 0) {
        summary.overallStatus = 'warning';
      }

      // Calculate domain-specific metrics
      const domains = [...new Set(healthMetrics.map(p => p.domain))];
      for (const domain of domains) {
        const domainPlugins = healthMetrics.filter(p => p.domain === domain);
        summary.domains[domain] = {
          total: domainPlugins.length,
          healthy: domainPlugins.filter(p => p.status === 'healthy').length,
          warning: domainPlugins.filter(p => p.status === 'warning').length,
          unhealthy: domainPlugins.filter(p => p.status === 'unhealthy').length
        };
      }

      return summary;
    } catch (error) {
      this.logger.error('Failed to get plugin health summary:', error);
      
      return {
        totalPlugins: 0,
        healthyPlugins: 0,
        warningPlugins: 0,
        unhealthyPlugins: 0,
        overallStatus: 'unhealthy',
        domains: {},
        timestamp: new Date()
      };
    }
  }

  /**
   * Get health metrics for a specific domain
   */
  async getDomainPluginHealth(domain: string): Promise<PluginHealthMetrics[]> {
    try {
      const allHealth = await this.getAllPluginHealth();
      return allHealth.filter(plugin => plugin.domain === domain);
    } catch (error) {
      this.logger.error(`Failed to get domain plugin health for ${domain}:`, error);
      return [];
    }
  }

  /**
   * Update plugin operation metrics
   */
  async updatePluginMetrics(pluginName: string, operation: string, duration: number, success: boolean): Promise<void> {
    try {
      const cacheKey = `${this.METRICS_CACHE_PREFIX}${pluginName}`;
      const cached = await this.cacheService.get(cacheKey);
      
      if (cached) {
        const metrics: PluginHealthMetrics = JSON.parse(cached as string);
        
        // Update metrics
        metrics.lastOperation = new Date();
        metrics.operationCount += 1;
        if (!success) {
          metrics.errorCount += 1;
        }
        
        // Update average response time (simplified calculation)
        metrics.averageResponseTime = (metrics.averageResponseTime + duration) / 2;
        
        // Update status based on error rate
        const errorRate = metrics.errorCount / metrics.operationCount;
        if (errorRate > 0.1) {
          metrics.status = 'unhealthy';
        } else if (errorRate > 0.05) {
          metrics.status = 'warning';
        } else {
          metrics.status = 'healthy';
        }
        
        // Cache updated metrics
        await this.cacheService.set(cacheKey, JSON.stringify(metrics), this.HEALTH_CACHE_TTL);
      }
    } catch (error) {
      this.logger.error(`Failed to update plugin metrics for ${pluginName}:`, error);
    }
  }

  /**
   * Invalidate health cache
   */
  async invalidateHealthCache(): Promise<void> {
    try {
      await this.cacheService.del(this.HEALTH_CACHE_KEY);
      
      // Invalidate individual plugin metrics
      const pluginInfo: any[] = []; // Mock plugin info array since registry is not available
      for (const plugin of pluginInfo) {
        const cacheKey = `${this.METRICS_CACHE_PREFIX}${plugin.name}`;
        await this.cacheService.del(cacheKey);
      }
      
      this.logger.log('Plugin health cache invalidated');
    } catch (error) {
      this.logger.error('Failed to invalidate plugin health cache:', error);
    }
  }

  /**
   * Get plugin performance alerts
   */
  async getPluginAlerts(): Promise<Array<{
    pluginName: string;
    domain: string;
    alert: string;
    severity: 'low' | 'medium' | 'high';
    timestamp: Date;
  }>> {
    try {
      const healthMetrics = await this.getAllPluginHealth();
      const alerts = [];

      for (const metrics of healthMetrics) {
        // Check for high error rate
        if (metrics.operationCount > 0) {
          const errorRate = metrics.errorCount / metrics.operationCount;
          if (errorRate > 0.1) {
            alerts.push({
              pluginName: metrics.pluginName,
              domain: metrics.domain,
              alert: `High error rate: ${(errorRate * 100).toFixed(2)}%`,
              severity: 'high' as const,
              timestamp: new Date()
            });
          } else if (errorRate > 0.05) {
            alerts.push({
              pluginName: metrics.pluginName,
              domain: metrics.domain,
              alert: `Elevated error rate: ${(errorRate * 100).toFixed(2)}%`,
              severity: 'medium' as const,
              timestamp: new Date()
            });
          }
        }

        // Check for high response time
        if (metrics.averageResponseTime > 5000) {
          alerts.push({
            pluginName: metrics.pluginName,
            domain: metrics.domain,
            alert: `High response time: ${metrics.averageResponseTime.toFixed(2)}ms`,
            severity: 'medium' as const,
            timestamp: new Date()
          });
        }

        // Check for high memory usage
        const memoryUsageMB = metrics.memoryUsage / (1024 * 1024);
        if (memoryUsageMB > 100) {
          alerts.push({
            pluginName: metrics.pluginName,
            domain: metrics.domain,
            alert: `High memory usage: ${memoryUsageMB.toFixed(2)}MB`,
            severity: 'low' as const,
            timestamp: new Date()
          });
        }
      }

      return alerts;
    } catch (error) {
      this.logger.error('Failed to get plugin alerts:', error);
      return [];
    }
  }
}
