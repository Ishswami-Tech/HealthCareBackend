import { Injectable, Logger } from '@nestjs/common';
import { BasePlugin, PluginContext, PluginHealth } from '../../../../libs/core/plugin-interface';

@Injectable()
export abstract class BaseAppointmentPlugin implements BasePlugin {
  protected readonly logger = new Logger(this.constructor.name);
  
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly features: string[];
  

  async initialize(context: PluginContext): Promise<void> {
    this.logger.log(`🚀 Initializing plugin: ${this.name}`);
    // Default implementation - can be overridden
  }

  async validate(data: any): Promise<boolean> {
    this.logger.log(`✅ Validating data for plugin: ${this.name}`);
    // Default implementation - can be overridden
    return true;
  }

  async process(data: any): Promise<any> {
    this.logger.log(`🔧 Processing data for plugin: ${this.name}`);
    // Default implementation - can be overridden
    return data;
  }

  async getHealth(): Promise<PluginHealth> {
    return {
      isHealthy: true,
      lastCheck: new Date(),
      errors: [],
      metrics: {
        pluginName: this.name,
        features: this.features,
        uptime: process.uptime()
      }
    };
  }

  async destroy(): Promise<void> {
    this.logger.log(`🛑 Destroying plugin: ${this.name}`);
    // Default implementation - can be overridden
  }

  protected createContext(config: any, metadata: Record<string, any> = {}): PluginContext {
    return {
      clinicId: metadata.clinicId,
      userId: metadata.userId,
      sessionId: metadata.sessionId,
      metadata: {
        config: {
          enabled: true,
          priority: 1,
          settings: config || {}
        },
        ...metadata
      }
    };
  }

  protected logPluginAction(action: string, data?: any): void {
    this.logger.log(`🔧 Plugin ${this.name} - ${action}`, data);
  }

  protected logPluginError(error: string, data?: any): void {
    this.logger.error(`❌ Plugin ${this.name} - ${error}`, data);
  }
}
