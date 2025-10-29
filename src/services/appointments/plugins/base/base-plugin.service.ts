/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
import { Injectable, Logger } from "@nestjs/common";
import {
  BasePlugin,
  PluginContext,
  PluginHealth,
} from "../../../../libs/core/plugin-interface";

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

  async validate(data: unknown): Promise<boolean> {
    const pluginData = data as any;
    this.logger.log(`✅ Validating data for plugin: ${this.name}`);
    // Default implementation - can be overridden
    return true;
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as any;
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
        uptime: process.uptime(),
      },
    };
  }

  async destroy(): Promise<void> {
    this.logger.log(`🛑 Destroying plugin: ${this.name}`);
    // Default implementation - can be overridden
  }

  protected createContext(
    config: unknown,
    metadata: Record<string, unknown> = {},
  ): PluginContext {
    return {
      clinicId: metadata["clinicId"] as string,
      userId: metadata["userId"] as string,
      sessionId: metadata["sessionId"] as string,
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
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
