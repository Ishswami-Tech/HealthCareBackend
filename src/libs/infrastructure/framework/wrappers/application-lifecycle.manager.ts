/**
 * Application Lifecycle Manager
 *
 * @module ApplicationLifecycleManager
 * @description Manages NestJS application lifecycle operations
 * Handles application creation, configuration, startup, and shutdown
 *
 * @remarks
 * - Follows SOLID principles (Single Responsibility, Dependency Inversion)
 * - Centralizes all application lifecycle operations
 * - Uses framework adapter for framework-agnostic operations
 * - Comprehensive error handling and logging
 */

import { INestApplication, Logger } from '@nestjs/common';
import type { IFrameworkAdapter, FrameworkAdapterOptions } from '@infrastructure/framework';
import type { ApplicationConfig, ServerConfig } from '@core/types/framework.types';
import type { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { ServiceContainer } from './service-container';
import { MiddlewareManager } from './middleware.manager';

/**
 * Application Lifecycle Manager
 *
 * @class ApplicationLifecycleManager
 * @description Manages the complete lifecycle of a NestJS application
 */
export class ApplicationLifecycleManager {
  private readonly frameworkAdapter: IFrameworkAdapter;
  private readonly logger: Logger;
  private readonly loggingService: LoggingService | undefined;
  private app: INestApplication | null = null;
  private serviceContainer: ServiceContainer | null = null;
  private middlewareManager: MiddlewareManager | null = null;

  /**
   * Create a new ApplicationLifecycleManager instance
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
   * Create and configure the NestJS application
   *
   * @param appModule - Root application module
   * @param config - Application configuration
   * @returns Promise<INestApplication> - Configured application instance
   */
  async createApplication(
    appModule: unknown,
    config: ApplicationConfig
  ): Promise<INestApplication> {
    try {
      this.logger.log(
        `Creating application with ${this.frameworkAdapter.getFrameworkName()} adapter`
      );

      const adapterOptions: FrameworkAdapterOptions = {
        environment: config.environment,
        isHorizontalScaling: config.isHorizontalScaling,
        instanceId: config.instanceId,
        trustProxy: config.trustProxy,
        bodyLimit: config.bodyLimit,
        keepAliveTimeout: config.keepAliveTimeout,
        connectionTimeout: config.connectionTimeout,
        requestTimeout: config.requestTimeout,
        ...(config.enableHttp2 !== undefined && { enableHttp2: config.enableHttp2 }),
      };

      this.app = await this.frameworkAdapter.createApplication(
        appModule,
        adapterOptions,
        this.logger
      );

      if (!this.app) {
        throw new Error('Application creation failed - returned null');
      }

      // Initialize service container and middleware manager
      this.serviceContainer = new ServiceContainer(this.app, this.logger, this.loggingService);
      this.middlewareManager = new MiddlewareManager(this.logger, this.loggingService);

      if (this.loggingService) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Application created successfully',
          'ApplicationLifecycleManager',
          {
            framework: this.frameworkAdapter.getFrameworkName(),
            environment: config.environment,
            instanceId: config.instanceId,
          }
        );
      }

      this.logger.log('Application created successfully');
      return this.app;
    } catch (error) {
      const errorMessage = `Failed to create application: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      this.logger.error(errorMessage);
      if (this.loggingService) {
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          errorMessage,
          'ApplicationLifecycleManager',
          {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
      }
      throw error;
    }
  }

  /**
   * Get the application instance
   *
   * @returns INestApplication - Application instance
   * @throws Error if application is not created
   */
  getApplication(): INestApplication {
    if (!this.app) {
      throw new Error('Application not created. Call createApplication() first.');
    }
    return this.app;
  }

  /**
   * Get the service container
   *
   * @returns ServiceContainer - Service container instance
   * @throws Error if application is not created
   */
  getServiceContainer(): ServiceContainer {
    if (!this.serviceContainer) {
      throw new Error('Service container not initialized. Call createApplication() first.');
    }
    return this.serviceContainer;
  }

  /**
   * Get the middleware manager
   *
   * @returns MiddlewareManager - Middleware manager instance
   * @throws Error if application is not created
   */
  getMiddlewareManager(): MiddlewareManager {
    if (!this.middlewareManager) {
      throw new Error('Middleware manager not initialized. Call createApplication() first.');
    }
    return this.middlewareManager;
  }

  /**
   * Start the application server
   *
   * @param serverConfig - Server configuration (port, host)
   * @returns Promise<void>
   */
  async startServer(serverConfig: ServerConfig): Promise<void> {
    if (!this.app) {
      throw new Error('Application not created. Call createApplication() first.');
    }

    try {
      const port = serverConfig.port;
      const host = serverConfig.bindAddress || serverConfig.host;

      this.logger.log(`Starting server on ${host}:${port}`);

      await this.app.listen(port, host);

      if (this.loggingService) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Server started successfully',
          'ApplicationLifecycleManager',
          {
            port,
            host,
            framework: this.frameworkAdapter.getFrameworkName(),
          }
        );
      }

      this.logger.log(`Server started successfully on ${host}:${port}`);
    } catch (error) {
      const errorMessage = `Failed to start server: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      this.logger.error(errorMessage);
      if (this.loggingService) {
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          errorMessage,
          'ApplicationLifecycleManager',
          {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            port: serverConfig.port,
            host: serverConfig.host,
          }
        );
      }
      throw error;
    }
  }

  /**
   * Shutdown the application gracefully
   *
   * @returns Promise<void>
   */
  async shutdown(): Promise<void> {
    if (!this.app) {
      this.logger.warn('Application not created, nothing to shutdown');
      return;
    }

    try {
      this.logger.log('Shutting down application...');

      if (this.loggingService) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Application shutdown initiated',
          'ApplicationLifecycleManager'
        );
      }

      await this.app.close();

      if (this.loggingService) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Application shutdown completed',
          'ApplicationLifecycleManager'
        );
      }

      this.logger.log('Application shutdown completed');
      this.app = null;
      this.serviceContainer = null;
      this.middlewareManager = null;
    } catch (error) {
      const errorMessage = `Failed to shutdown application: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      this.logger.error(errorMessage);
      if (this.loggingService) {
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          errorMessage,
          'ApplicationLifecycleManager',
          {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
      }
      throw error;
    }
  }

  /**
   * Get the framework adapter
   *
   * @returns IFrameworkAdapter - Framework adapter instance
   */
  getFrameworkAdapter(): IFrameworkAdapter {
    return this.frameworkAdapter;
  }
}
