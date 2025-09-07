import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../../libs/infrastructure/cache';

export interface PluginConfig {
  enabled: boolean;
  priority: number;
  settings: Record<string, any>;
  features: string[];
  domain: string;
}

export interface PluginConfigMap {
  [pluginName: string]: PluginConfig;
}

@Injectable()
export class PluginConfigService {
  private readonly logger = new Logger(PluginConfigService.name);
  private readonly CONFIG_CACHE_KEY = 'plugin:config';
  private readonly CONFIG_CACHE_TTL = 3600; // 1 hour

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService
  ) {}

  /**
   * Get plugin configuration for a specific plugin
   */
  async getPluginConfig(pluginName: string): Promise<PluginConfig | null> {
    try {
      const allConfigs = await this.getAllPluginConfigs();
      return allConfigs[pluginName] || null;
    } catch (error) {
      this.logger.error(`Failed to get plugin config for ${pluginName}:`, error);
      return null;
    }
  }

  /**
   * Get all plugin configurations
   */
  async getAllPluginConfigs(): Promise<PluginConfigMap> {
    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(this.CONFIG_CACHE_KEY);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Generate configurations from environment
      const configs: PluginConfigMap = {
        'clinic-queue-plugin': {
          enabled: this.configService.get('CLINIC_QUEUE_PLUGIN_ENABLED', true),
          priority: this.configService.get('CLINIC_QUEUE_PLUGIN_PRIORITY', 1),
          settings: {
            maxQueueSize: this.configService.get('CLINIC_MAX_QUEUE_SIZE', 50),
            defaultWaitTime: this.configService.get('CLINIC_DEFAULT_WAIT_TIME', 15),
            emergencyPriority: this.configService.get('CLINIC_EMERGENCY_PRIORITY', 10),
            autoConfirmation: this.configService.get('CLINIC_AUTO_CONFIRMATION', true)
          },
          features: ['queue-management', 'priority-queues', 'emergency-handling'],
          domain: 'healthcare'
        },
        // Fashion queue plugin removed - healthcare application only
        'clinic-location-plugin': {
          enabled: this.configService.get('CLINIC_LOCATION_PLUGIN_ENABLED', true),
          priority: this.configService.get('CLINIC_LOCATION_PLUGIN_PRIORITY', 1),
          settings: {
            cacheEnabled: this.configService.get('CLINIC_LOCATION_CACHE_ENABLED', true),
            cacheTTL: this.configService.get('CLINIC_LOCATION_CACHE_TTL', 3600),
            qrEnabled: this.configService.get('CLINIC_QR_ENABLED', true),
            qrExpiration: this.configService.get('CLINIC_QR_EXPIRATION', 300)
          },
          features: ['location-management', 'qr-codes', 'multi-location'],
          domain: 'healthcare'
        },
        // Fashion location plugin removed - healthcare application only
        'clinic-confirmation-plugin': {
          enabled: this.configService.get('CLINIC_CONFIRMATION_PLUGIN_ENABLED', true),
          priority: this.configService.get('CLINIC_CONFIRMATION_PLUGIN_PRIORITY', 1),
          settings: {
            qrEnabled: this.configService.get('CLINIC_CONFIRMATION_QR_ENABLED', true),
            qrExpiration: this.configService.get('CLINIC_CONFIRMATION_QR_EXPIRATION', 300),
            autoCheckIn: this.configService.get('CLINIC_AUTO_CHECKIN', false),
            checkInWindow: this.configService.get('CLINIC_CHECKIN_WINDOW', 15)
          },
          features: ['qr-generation', 'check-in', 'confirmation', 'completion'],
          domain: 'healthcare'
        },
        // Fashion confirmation plugin removed - healthcare application only
        'clinic-checkin-plugin': {
          enabled: this.configService.get('CLINIC_CHECKIN_PLUGIN_ENABLED', true),
          priority: this.configService.get('CLINIC_CHECKIN_PLUGIN_PRIORITY', 1),
          settings: {
            biometricEnabled: this.configService.get('CLINIC_BIOMETRIC_ENABLED', false),
            autoQueue: this.configService.get('CLINIC_AUTO_QUEUE', true),
            priorityCheckIn: this.configService.get('CLINIC_PRIORITY_CHECKIN', true)
          },
          features: ['check-in', 'queue-management', 'consultation-start'],
          domain: 'healthcare'
        },
        // Fashion checkin plugin removed - healthcare application only
        'clinic-socket-plugin': {
          enabled: this.configService.get('CLINIC_SOCKET_PLUGIN_ENABLED', true),
          priority: this.configService.get('CLINIC_SOCKET_PLUGIN_PRIORITY', 1),
          settings: {
            realTimeUpdates: this.configService.get('CLINIC_REALTIME_UPDATES', true),
            queueNotifications: this.configService.get('CLINIC_QUEUE_NOTIFICATIONS', true),
            emergencyAlerts: this.configService.get('CLINIC_EMERGENCY_ALERTS', true)
          },
          features: ['real-time-updates', 'queue-notifications', 'appointment-status'],
          domain: 'healthcare'
        },
        // Fashion socket plugin removed - healthcare application only
        'clinic-payment-plugin': {
          enabled: this.configService.get('CLINIC_PAYMENT_PLUGIN_ENABLED', true),
          priority: this.configService.get('CLINIC_PAYMENT_PLUGIN_PRIORITY', 1),
          settings: {
            insuranceEnabled: this.configService.get('CLINIC_INSURANCE_ENABLED', true),
            copayEnabled: this.configService.get('CLINIC_COPAY_ENABLED', true),
            refundEnabled: this.configService.get('CLINIC_REFUND_ENABLED', true),
            autoBilling: this.configService.get('CLINIC_AUTO_BILLING', false)
          },
          features: ['payment-processing', 'insurance-claims', 'refunds', 'billing'],
          domain: 'healthcare'
        },
        // Fashion payment plugin removed - healthcare application only
        'clinic-video-plugin': {
          enabled: this.configService.get('CLINIC_VIDEO_PLUGIN_ENABLED', true),
          priority: this.configService.get('CLINIC_VIDEO_PLUGIN_PRIORITY', 1),
          settings: {
            recordingEnabled: this.configService.get('CLINIC_VIDEO_RECORDING', true),
            screenSharing: this.configService.get('CLINIC_SCREEN_SHARING', true),
            medicalImageSharing: this.configService.get('CLINIC_MEDICAL_IMAGE_SHARING', true),
            emergencyMode: this.configService.get('CLINIC_EMERGENCY_MODE', true)
          },
          features: ['video-calls', 'screen-sharing', 'recording', 'medical-images'],
          domain: 'healthcare'
        },
        // Fashion video plugin removed - healthcare application only
      };

      // Cache the configurations
      await this.cacheService.set(this.CONFIG_CACHE_KEY, JSON.stringify(configs), this.CONFIG_CACHE_TTL);

      return configs;
    } catch (error) {
      this.logger.error('Failed to get all plugin configs:', error);
      return {};
    }
  }

  /**
   * Update plugin configuration
   */
  async updatePluginConfig(pluginName: string, config: Partial<PluginConfig>): Promise<boolean> {
    try {
      const allConfigs = await this.getAllPluginConfigs();
      allConfigs[pluginName] = { ...allConfigs[pluginName], ...config };
      
      // Update cache
      await this.cacheService.set(this.CONFIG_CACHE_KEY, JSON.stringify(allConfigs), this.CONFIG_CACHE_TTL);
      
      this.logger.log(`Updated plugin config for ${pluginName}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to update plugin config for ${pluginName}:`, error);
      return false;
    }
  }

  /**
   * Get configurations for a specific domain
   */
  async getDomainPluginConfigs(domain: string): Promise<PluginConfigMap> {
    try {
      const allConfigs = await this.getAllPluginConfigs();
      const domainConfigs: PluginConfigMap = {};
      
      Object.entries(allConfigs).forEach(([name, config]) => {
        if (config.domain === domain) {
          domainConfigs[name] = config;
        }
      });
      
      return domainConfigs;
    } catch (error) {
      this.logger.error(`Failed to get domain plugin configs for ${domain}:`, error);
      return {};
    }
  }

  /**
   * Check if a plugin is enabled
   */
  async isPluginEnabled(pluginName: string): Promise<boolean> {
    try {
      const config = await this.getPluginConfig(pluginName);
      return config?.enabled || false;
    } catch (error) {
      this.logger.error(`Failed to check if plugin ${pluginName} is enabled:`, error);
      return false;
    }
  }

  /**
   * Get plugin priority
   */
  async getPluginPriority(pluginName: string): Promise<number> {
    try {
      const config = await this.getPluginConfig(pluginName);
      return config?.priority || 1;
    } catch (error) {
      this.logger.error(`Failed to get plugin priority for ${pluginName}:`, error);
      return 1;
    }
  }

  /**
   * Invalidate configuration cache
   */
  async invalidateConfigCache(): Promise<void> {
    try {
      await this.cacheService.del(this.CONFIG_CACHE_KEY);
      this.logger.log('Plugin configuration cache invalidated');
    } catch (error) {
      this.logger.error('Failed to invalidate plugin configuration cache:', error);
    }
  }
}
