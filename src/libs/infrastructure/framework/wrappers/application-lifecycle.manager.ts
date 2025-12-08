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

      // Log before listen to help debug
      this.logger.log(`About to call app.listen(${port}, ${host})...`);

      // Check if app and listen method exist
      if (!this.app) {
        throw new Error('Application instance is undefined');
      }
      if (typeof this.app.listen !== 'function') {
        throw new Error('Application.listen is not a function');
      }

      // Check if app has getHttpAdapter method (for Fastify)
      let _httpAdapter: unknown = null;
      try {
        if (typeof this.app.getHttpAdapter === 'function') {
          _httpAdapter = this.app.getHttpAdapter();
          this.logger.log('HTTP adapter retrieved successfully');
        }
      } catch (adapterError) {
        this.logger.warn(
          `Failed to get HTTP adapter (non-critical): ${adapterError instanceof Error ? adapterError.message : String(adapterError)}`
        );
      }

      // Explicitly initialize the app before listening
      // This triggers all OnModuleInit hooks and allows us to catch errors early
      this.logger.log('Initializing application (triggers OnModuleInit hooks)...');
      this.logger.log('This will trigger all OnModuleInit hooks in all modules');
      try {
        if (typeof this.app.init === 'function') {
          this.logger.log('Calling app.init()...');
          await this.app.init();
          this.logger.log('Application initialized successfully');
        } else {
          this.logger.warn(
            'Application does not have init() method, will be initialized by listen()'
          );
        }
      } catch (initError) {
        const initErrorMessage = initError instanceof Error ? initError.message : 'Unknown error';
        const initErrorStack = initError instanceof Error ? initError.stack : 'No stack trace';
        this.logger.error(`Application initialization failed: ${initErrorMessage}`);
        this.logger.error(`Full error stack trace (first 50 lines):`);
        if (initErrorStack) {
          const stackLines = initErrorStack.split('\n');
          for (let i = 0; i < Math.min(stackLines.length, 50); i++) {
            this.logger.error(`[${i}] ${stackLines[i]}`);
          }
        } else {
          this.logger.error('No stack trace available');
        }
        // Also log to console for immediate visibility
        console.error('=== FULL ERROR STACK TRACE ===');
        console.error(initErrorStack);
        console.error('=== END STACK TRACE ===');
        throw initError;
      }

      this.logger.log('Calling app.listen()...');
      this.logger.log(`App type: ${typeof this.app}`);
      this.logger.log(`App value: ${this.app ? 'defined' : 'undefined'}`);
      this.logger.log(`App.listen type: ${typeof this.app.listen}`);

      try {
        // app.listen() internally calls app.init() if not already initialized
        // This triggers all OnModuleInit hooks, which might cause errors
        await this.app.listen(port, host);
        this.logger.log('app.listen() completed successfully');
      } catch (listenError) {
        const errorMessage = listenError instanceof Error ? listenError.message : 'Unknown error';
        const errorStack = listenError instanceof Error ? listenError.stack : 'No stack trace';

        this.logger.error(`app.listen() failed: ${errorMessage}`);
        this.logger.error(`Error stack: ${errorStack}`);

        // Log additional error details for debugging
        if (listenError instanceof Error) {
          this.logger.error(`Error name: ${listenError.name}`);
          this.logger.error(`Error constructor: ${listenError.constructor.name}`);
          if ('code' in listenError) {
            this.logger.error(`Error code: ${String(listenError.code)}`);
          }
        }

        // Log error context for troubleshooting
        if (errorMessage.includes("Cannot read properties of undefined (reading 'set')")) {
          this.logger.error('Error: Attempting to call .set() on undefined object');
          this.logger.error('Common causes: app.set(), app.getHttpAdapter().set(), or similar');
          this.logger.error('This might be happening in a service OnModuleInit hook');
        }

        throw listenError;
      }

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
      const errorStack = error instanceof Error ? error.stack : 'No stack trace';

      // Log full error details for debugging
      this.logger.error(`${errorMessage}\nStack: ${errorStack}`);

      if (this.loggingService) {
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          errorMessage,
          'ApplicationLifecycleManager',
          {
            error: error instanceof Error ? error.message : String(error),
            stack: errorStack,
            port: serverConfig.port,
            host: serverConfig.host,
            fullError: error,
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
