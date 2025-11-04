import { Injectable, Logger } from '@nestjs/common';
import type { BasePlugin, PluginContext, PluginHealth } from '@core/types';

@Injectable()
export abstract class BaseAppointmentPlugin implements BasePlugin {
  protected readonly logger = new Logger(this.constructor.name);

  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly features: string[];

  initialize(_context: PluginContext): Promise<void> {
    this.logger.log(`🚀 Initializing plugin: ${this.name}`);
    // Default implementation - can be overridden
    return Promise.resolve();
  }

  validate(data: unknown): Promise<boolean> {
    const pluginData = data as Record<string, unknown>;
    this.logger.log(`✅ Validating data for plugin: ${this.name}`);
    // Default implementation - can be overridden
    return Promise.resolve(Boolean(pluginData));
  }

  async process(data: unknown): Promise<unknown> {
    const _pluginData = data as Record<string, unknown>;
    this.logger.log(`🔧 Processing data for plugin: ${this.name}`);
    // Default implementation - can be overridden
    return Promise.resolve(data);
  }

  getHealth(): Promise<PluginHealth> {
    return Promise.resolve({
      isHealthy: true,
      lastCheck: new Date(),
      errors: [],
      metrics: {
        pluginName: this.name,
        features: this.features,
        uptime: process.uptime(),
      },
    });
  }

  destroy(): Promise<void> {
    this.logger.log(`🛑 Destroying plugin: ${this.name}`);
    // Default implementation - can be overridden
    return Promise.resolve();
  }

  protected createContext(config: unknown, metadata: Record<string, unknown> = {}): PluginContext {
    return {
      clinicId: metadata['clinicId'] as string,
      userId: metadata['userId'] as string,
      sessionId: metadata['sessionId'] as string,
      metadata: {
        config: {
          enabled: true,
          priority: 1,
          settings: config || {},
        },
        ...(metadata || {}),
      },
    };
  }

  protected logPluginAction(action: string, data?: unknown): void {
    this.logger.log(`🔧 Plugin ${this.name} - ${action}`, data);
  }

  protected logPluginError(error: string, data?: unknown): void {
    this.logger.error(`❌ Plugin ${this.name} - ${error}`, data);
  }
}
