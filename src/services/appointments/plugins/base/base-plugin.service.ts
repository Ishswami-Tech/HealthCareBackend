import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import type { BasePlugin, PluginContext, PluginHealth } from '@core/types';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

@Injectable()
export abstract class BaseAppointmentPlugin implements BasePlugin {
  // LoggingService is optional - child classes should inject it
  // If not available, logging calls will be no-ops
  protected loggingService?: LoggingService;

  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly features: string[];

  // Constructor to optionally inject LoggingService
  constructor(
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    loggingService?: LoggingService
  ) {
    // Handle optional loggingService with exactOptionalPropertyTypes
    if (loggingService !== undefined) {
      this.loggingService = loggingService;
    }
  }

  async initialize(_context: PluginContext): Promise<void> {
    if (this.loggingService) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `🚀 Initializing plugin: ${this.name}`,
        this.constructor.name,
        { pluginName: this.name }
      );
    }
    // Default implementation - can be overridden
    return Promise.resolve();
  }

  async validate(data: unknown): Promise<boolean> {
    const pluginData = data as Record<string, unknown>;
    if (this.loggingService) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `✅ Validating data for plugin: ${this.name}`,
        this.constructor.name,
        { pluginName: this.name }
      );
    }
    // Default implementation - can be overridden
    return Promise.resolve(Boolean(pluginData));
  }

  async process(data: unknown): Promise<unknown> {
    const _pluginData = data as Record<string, unknown>;
    if (this.loggingService) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `🔧 Processing data for plugin: ${this.name}`,
        this.constructor.name,
        { pluginName: this.name }
      );
    }
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

  async destroy(): Promise<void> {
    if (this.loggingService) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `🛑 Destroying plugin: ${this.name}`,
        this.constructor.name,
        { pluginName: this.name }
      );
    }
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

  protected async logPluginAction(action: string, data?: unknown): Promise<void> {
    if (this.loggingService) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `🔧 Plugin ${this.name} - ${action}`,
        this.constructor.name,
        {
          pluginName: this.name,
          action,
          ...(data && typeof data === 'object' ? (data as Record<string, unknown>) : { data }),
        }
      );
    }
  }

  protected async logPluginError(error: string, data?: unknown): Promise<void> {
    if (this.loggingService) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `❌ Plugin ${this.name} - ${error}`,
        this.constructor.name,
        {
          pluginName: this.name,
          error,
          ...(data && typeof data === 'object' ? (data as Record<string, unknown>) : { data }),
        }
      );
    }
  }
}
