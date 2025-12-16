/**
 * Bootstrap Orchestrator
 *
 * @module BootstrapOrchestrator
 * @description High-level orchestrator for application bootstrap
 * Coordinates all framework wrappers and manages the complete bootstrap process
 *
 * @remarks
 * - Follows SOLID principles (Single Responsibility, Dependency Inversion)
 * - Coordinates all wrappers in proper sequence
 * - Manages bootstrap flow and error handling
 * - Uses LoggingService for comprehensive logging
 */

import { Logger } from '@nestjs/common';
import type { IFrameworkAdapter } from '@infrastructure/framework';
import type { BootstrapOptions, ApplicationContext } from '@core/types/framework.types';
import { BootstrapStage } from '@core/types/framework.types';
import { LogType, LogLevel } from '@core/types';
import { ApplicationLifecycleManager } from './application-lifecycle.manager';
import { ServerConfigurator } from './server-configurator';
import { ServiceContainer } from './service-container';
import { ConfigService } from '@config/config.service';
import { SecurityConfigService } from '@security/security-config.service';
import {
  GracefulShutdownService,
  ProcessErrorHandlersService,
} from '@core/resilience/graceful-shutdown.service';
import { LoggingService } from '@infrastructure/logging';
import type { ServiceToken } from '@core/types/framework.types';

/**
 * Bootstrap Orchestrator
 *
 * @class BootstrapOrchestrator
 * @description Orchestrates the complete application bootstrap process
 */
export class BootstrapOrchestrator {
  private readonly frameworkAdapter: IFrameworkAdapter;
  private readonly logger: Logger;
  private readonly loggingService: LoggingService | undefined;
  private lifecycleManager: ApplicationLifecycleManager | null = null;
  private serverConfigurator: ServerConfigurator | null = null;
  private currentStage: BootstrapStage = BootstrapStage.INITIALIZING;

  /**
   * Create a new BootstrapOrchestrator instance
   *
   * @param frameworkAdapter - Framework adapter instance
   * @param logger - NestJS Logger instance
   * @param loggingService - Optional LoggingService for structured logging
   */
  constructor(
    frameworkAdapter: IFrameworkAdapter,
    logger: Logger,
    loggingService?: LoggingService
  ) {
    this.frameworkAdapter = frameworkAdapter;
    this.logger = logger;
    this.loggingService = loggingService;
  }

  /**
   * Bootstrap the application
   *
   * @param options - Bootstrap options
   * @returns Promise<ApplicationContext> - Application context with all services
   */
  async bootstrap(options: BootstrapOptions): Promise<ApplicationContext> {
    try {
      this.currentStage = BootstrapStage.INITIALIZING;
      this.logger.log('Starting application bootstrap...');

      if (this.loggingService) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Application bootstrap started',
          'BootstrapOrchestrator',
          {
            stage: this.currentStage,
            environment: options.applicationConfig.environment,
            instanceId: options.applicationConfig.instanceId,
          }
        );
      }

      // Initialize server configurator
      this.serverConfigurator = new ServerConfigurator(
        this.logger,
        {
          environment: options.applicationConfig.environment,
          ...(options.configService && { configService: options.configService }),
        },
        this.loggingService
      );

      // Initialize lifecycle manager
      this.lifecycleManager = new ApplicationLifecycleManager(
        this.frameworkAdapter,
        this.logger,
        this.loggingService
      );

      // Stage 1: Create application
      this.currentStage = BootstrapStage.CREATING_APPLICATION;
      const app = await this.lifecycleManager.createApplication(
        options.appModule,
        options.applicationConfig
      );

      // Get service container
      const serviceContainer = this.lifecycleManager.getServiceContainer();

      // Stage 2: Get required services
      this.currentStage = BootstrapStage.SETTING_UP_SERVICES;
      const configService = await this.getService<ConfigService>(
        serviceContainer,
        ConfigService,
        options.configService
      );
      const loggingService = await this.getService<LoggingService>(
        serviceContainer,
        LoggingService as ServiceToken,
        options.loggingService
      );
      const securityConfigService = await this.getService<SecurityConfigService>(
        serviceContainer,
        SecurityConfigService as ServiceToken,
        options.securityConfigService
      );
      const gracefulShutdownService = await this.getService<GracefulShutdownService>(
        serviceContainer,
        GracefulShutdownService as ServiceToken,
        options.gracefulShutdownService
      );
      const processErrorHandlersService = await this.getService<ProcessErrorHandlersService>(
        serviceContainer,
        ProcessErrorHandlersService as ServiceToken,
        options.processErrorHandlersService
      );

      // Set framework adapter in security service
      securityConfigService.setFrameworkAdapter(this.frameworkAdapter);

      // Stage 3: Configure middleware
      this.currentStage = BootstrapStage.CONFIGURING_MIDDLEWARE;
      if (options.middlewareConfig) {
        const middlewareManager = this.lifecycleManager.getMiddlewareManager();
        middlewareManager.configure(app, options.middlewareConfig);
      }

      // Get server configuration
      const serverConfig = this.serverConfigurator.getServerConfig();

      // Stage 4: Start server
      this.currentStage = BootstrapStage.STARTING_SERVER;
      await this.lifecycleManager.startServer(serverConfig);

      this.currentStage = BootstrapStage.COMPLETED;

      if (this.loggingService) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Application bootstrap completed successfully',
          'BootstrapOrchestrator',
          {
            stage: this.currentStage,
            port: serverConfig.port,
            host: serverConfig.host,
          }
        );
      }

      this.logger.log('Application bootstrap completed successfully');

      // Return application context
      return {
        app,
        frameworkAdapter: this.frameworkAdapter,
        configService,
        loggingService,
        securityConfigService,
        gracefulShutdownService,
        processErrorHandlersService,
        serverConfig,
      };
    } catch (error) {
      this.currentStage = BootstrapStage.FAILED;
      const errorMessage = `Bootstrap failed at stage ${this.currentStage}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      this.logger.error(errorMessage);

      if (this.loggingService) {
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          errorMessage,
          'BootstrapOrchestrator',
          {
            stage: this.currentStage,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
      }

      throw error;
    }
  }

  /**
   * Get service from container or use provided service
   *
   * @template T - Service type
   * @param serviceContainer - Service container instance
   * @param token - Service token
   * @param providedService - Optional provided service (for dependency injection)
   * @returns Service instance
   */
  private async getService<T>(
    serviceContainer: ServiceContainer,
    token: ServiceToken,
    providedService?: T
  ): Promise<T> {
    if (providedService) {
      return providedService;
    }
    return await serviceContainer.getService<T>(token);
  }

  /**
   * Get current bootstrap stage
   *
   * @returns BootstrapStage - Current bootstrap stage
   */
  getCurrentStage(): BootstrapStage {
    return this.currentStage;
  }

  /**
   * Get lifecycle manager
   *
   * @returns ApplicationLifecycleManager - Lifecycle manager instance
   */
  getLifecycleManager(): ApplicationLifecycleManager {
    if (!this.lifecycleManager) {
      throw new Error('Lifecycle manager not initialized. Call bootstrap() first.');
    }
    return this.lifecycleManager;
  }

  /**
   * Get server configurator
   *
   * @returns ServerConfigurator - Server configurator instance
   */
  getServerConfigurator(): ServerConfigurator {
    if (!this.serverConfigurator) {
      throw new Error('Server configurator not initialized. Call bootstrap() first.');
    }
    return this.serverConfigurator;
  }
}
