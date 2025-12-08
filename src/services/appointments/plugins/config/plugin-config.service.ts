import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@config';
import { CacheService } from '@infrastructure/cache';

export interface PluginConfig {
  enabled: boolean;
  priority: number;
  settings: Record<string, unknown>;
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
    } catch (_error) {
      this.logger.error(`Failed to get plugin config for ${pluginName}:`, _error);
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
        return JSON.parse(cached as string) as PluginConfigMap;
      }

      // Generate configurations from environment
      // Helper function to safely get config values via ConfigService (uses dotenv)
      // Use ConfigService methods for type-safe access
      const getConfig = <T>(key: string, defaultValue: T): T => {
        try {
          if (typeof defaultValue === 'number') {
            return this.configService.getEnvNumber(key, defaultValue as number) as unknown as T;
          }
          if (typeof defaultValue === 'boolean') {
            return this.configService.getEnvBoolean(key, defaultValue as boolean) as unknown as T;
          }
          return this.configService.getEnv(key, defaultValue as string) as unknown as T;
        } catch {
          // Defensive fallback - should rarely be needed
          return defaultValue;
        }
      };

      const configs: PluginConfigMap = {
        'clinic-queue-plugin': {
          enabled: getConfig('CLINIC_QUEUE_PLUGIN_ENABLED', true),
          priority: getConfig('CLINIC_QUEUE_PLUGIN_PRIORITY', 1),
          settings: {
            maxQueueSize: getConfig('CLINIC_MAX_QUEUE_SIZE', 50),
            defaultWaitTime: getConfig('CLINIC_DEFAULT_WAIT_TIME', 15),
            emergencyPriority: getConfig('CLINIC_EMERGENCY_PRIORITY', 10),
            autoConfirmation: getConfig('CLINIC_AUTO_CONFIRMATION', true),
          },
          features: ['queue-management', 'priority-queues', 'emergency-handling'],
          domain: 'healthcare',
        },
        // Fashion queue plugin removed - healthcare application only
        'clinic-location-plugin': {
          enabled: getConfig('CLINIC_LOCATION_PLUGIN_ENABLED', true),
          priority: getConfig('CLINIC_LOCATION_PLUGIN_PRIORITY', 1),
          settings: {
            cacheEnabled: getConfig('CLINIC_LOCATION_CACHE_ENABLED', true),
            cacheTTL: getConfig('CLINIC_LOCATION_CACHE_TTL', 3600),
            qrEnabled: getConfig('CLINIC_QR_ENABLED', true),
            qrExpiration: getConfig('CLINIC_QR_EXPIRATION', 300),
          },
          features: ['location-management', 'qr-codes', 'multi-location'],
          domain: 'healthcare',
        },
        // Fashion location plugin removed - healthcare application only
        'clinic-confirmation-plugin': {
          enabled: getConfig('CLINIC_CONFIRMATION_PLUGIN_ENABLED', true),
          priority: getConfig('CLINIC_CONFIRMATION_PLUGIN_PRIORITY', 1),
          settings: {
            qrEnabled: getConfig('CLINIC_CONFIRMATION_QR_ENABLED', true),
            qrExpiration: getConfig('CLINIC_CONFIRMATION_QR_EXPIRATION', 300),
            autoCheckIn: getConfig('CLINIC_AUTO_CHECKIN', false),
            checkInWindow: getConfig('CLINIC_CHECKIN_WINDOW', 15),
          },
          features: ['qr-generation', 'check-in', 'confirmation', 'completion'],
          domain: 'healthcare',
        },
        // Fashion confirmation plugin removed - healthcare application only
        'clinic-checkin-plugin': {
          enabled: getConfig('CLINIC_CHECKIN_PLUGIN_ENABLED', true),
          priority: getConfig('CLINIC_CHECKIN_PLUGIN_PRIORITY', 1),
          settings: {
            biometricEnabled: getConfig('CLINIC_BIOMETRIC_ENABLED', false),
            autoQueue: getConfig('CLINIC_AUTO_QUEUE', true),
            priorityCheckIn: getConfig('CLINIC_PRIORITY_CHECKIN', true),
          },
          features: ['check-in', 'queue-management', 'consultation-start'],
          domain: 'healthcare',
        },
        // Fashion checkin plugin removed - healthcare application only
        'clinic-socket-plugin': {
          enabled: getConfig('CLINIC_SOCKET_PLUGIN_ENABLED', true),
          priority: getConfig('CLINIC_SOCKET_PLUGIN_PRIORITY', 1),
          settings: {
            realTimeUpdates: getConfig('CLINIC_REALTIME_UPDATES', true),
            queueNotifications: getConfig('CLINIC_QUEUE_NOTIFICATIONS', true),
            emergencyAlerts: getConfig('CLINIC_EMERGENCY_ALERTS', true),
          },
          features: ['real-time-updates', 'queue-notifications', 'appointment-status'],
          domain: 'healthcare',
        },
        // Fashion socket plugin removed - healthcare application only
        'clinic-payment-plugin': {
          enabled: getConfig('CLINIC_PAYMENT_PLUGIN_ENABLED', true),
          priority: getConfig('CLINIC_PAYMENT_PLUGIN_PRIORITY', 1),
          settings: {
            insuranceEnabled: getConfig('CLINIC_INSURANCE_ENABLED', true),
            copayEnabled: getConfig('CLINIC_COPAY_ENABLED', true),
            refundEnabled: getConfig('CLINIC_REFUND_ENABLED', true),
            autoBilling: getConfig('CLINIC_AUTO_BILLING', false),
          },
          features: ['payment-processing', 'insurance-claims', 'refunds', 'billing'],
          domain: 'healthcare',
        },
        // Fashion payment plugin removed - healthcare application only
        'clinic-video-plugin': {
          enabled: getConfig('CLINIC_VIDEO_PLUGIN_ENABLED', true),
          priority: getConfig('CLINIC_VIDEO_PLUGIN_PRIORITY', 1),
          settings: {
            recordingEnabled: getConfig('CLINIC_VIDEO_RECORDING', true),
            screenSharing: getConfig('CLINIC_SCREEN_SHARING', true),
            medicalImageSharing: getConfig('CLINIC_MEDICAL_IMAGE_SHARING', true),
            emergencyMode: getConfig('CLINIC_EMERGENCY_MODE', true),
          },
          features: ['video-calls', 'screen-sharing', 'recording', 'medical-images'],
          domain: 'healthcare',
        },
        // Fashion video plugin removed - healthcare application only
      };

      // Cache the configurations
      await this.cacheService.set(
        this.CONFIG_CACHE_KEY,
        JSON.stringify(configs),
        this.CONFIG_CACHE_TTL
      );

      return configs;
    } catch (_error) {
      this.logger.error('Failed to get all plugin configs:', _error);
      return {};
    }
  }

  /**
   * Update plugin configuration
   */
  async updatePluginConfig(pluginName: string, config: Partial<PluginConfig>): Promise<boolean> {
    try {
      const allConfigs = await this.getAllPluginConfigs();
      allConfigs[pluginName] = {
        ...allConfigs[pluginName],
        ...config,
        enabled: config.enabled ?? allConfigs[pluginName]?.enabled ?? true,
        priority: config.priority ?? allConfigs[pluginName]?.priority ?? 0,
        settings: config.settings ?? allConfigs[pluginName]?.settings ?? {},
        features: config.features ?? allConfigs[pluginName]?.features ?? [],
        domain: config.domain ?? allConfigs[pluginName]?.domain ?? '',
      };

      // Update cache
      await this.cacheService.set(
        this.CONFIG_CACHE_KEY,
        JSON.stringify(allConfigs),
        this.CONFIG_CACHE_TTL
      );

      this.logger.log(`Updated plugin config for ${pluginName}`);
      return true;
    } catch (_error) {
      this.logger.error(`Failed to update plugin config for ${pluginName}:`, _error);
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
    } catch (_error) {
      this.logger.error(`Failed to get domain plugin configs for ${domain}:`, _error);
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
    } catch (_error) {
      this.logger.error(`Failed to check if plugin ${pluginName} is enabled:`, _error);
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
    } catch (_error) {
      this.logger.error(`Failed to get plugin priority for ${pluginName}:`, _error);
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
    } catch (_error) {
      this.logger.error('Failed to invalidate plugin configuration cache:', _error);
    }
  }
}
