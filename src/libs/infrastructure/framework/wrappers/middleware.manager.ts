/**
 * Middleware Manager Wrapper
 *
 * @module MiddlewareManager
 * @description Framework-agnostic middleware configuration and management
 * Handles global pipes, filters, interceptors, versioning, and prefix configuration
 *
 * @remarks
 * - Follows SOLID principles (Single Responsibility, Open/Closed)
 * - Framework-agnostic middleware API
 * - Consistent configuration patterns
 * - Uses LoggingService for error logging
 */

import {
  INestApplication,
  Logger,
  VersioningType,
  RequestMethod,
  ValidationPipe,
  PipeTransform,
  ExceptionFilter,
  NestInterceptor,
} from '@nestjs/common';
import type { ValidationPipeOptions } from '@nestjs/common';
import type {
  MiddlewareConfig,
  PipeConfig,
  FilterConfig,
  InterceptorConfig,
  VersioningConfig,
  GlobalPrefixConfig,
} from '@core/types/framework.types';
import type { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { ValidationPipeConfig } from '@config/validation-pipe.config';

/**
 * Middleware Manager for application middleware configuration
 *
 * @class MiddlewareManager
 * @description Manages all middleware configuration for the NestJS application
 */
export class MiddlewareManager {
  private readonly logger: Logger;
  private readonly loggingService: LoggingService | undefined;

  /**
   * Create a new MiddlewareManager instance
   *
   * @param logger - NestJS Logger instance
   * @param loggingService - Optional LoggingService for structured logging
   */
  constructor(logger: Logger, loggingService?: LoggingService) {
    this.logger = logger;
    this.loggingService = loggingService;
  }

  /**
   * Configure global pipes
   *
   * @param app - NestJS application instance
   * @param pipes - Array of pipe configurations
   *
   * @example
   * ```typescript
   * middlewareManager.configurePipes(app, [
   *   { pipe: ValidationPipe, options: { transform: true, whitelist: true } }
   * ]);
   * ```
   */
  configurePipes(app: INestApplication, pipes: PipeConfig[]): void {
    try {
      const pipeInstances: PipeTransform[] = pipes.map(pipeConfig => {
        if (pipeConfig.pipe === ValidationPipe) {
          // Use provided options or get default options from ValidationPipeConfig
          const providedOptions = pipeConfig.options;
          const options: ValidationPipeOptions =
            providedOptions && typeof providedOptions === 'object'
              ? providedOptions
              : ValidationPipeConfig.getOptions(this.loggingService);
          return new ValidationPipe(options);
        }
        // For other pipes, instantiate if it's a class
        if (typeof pipeConfig.pipe === 'function') {
          // Type assertion for pipe instances - NestJS accepts any PipeTransform
          return new (pipeConfig.pipe as new (...args: unknown[]) => PipeTransform)();
        }
        return pipeConfig.pipe as PipeTransform;
      });

      app.useGlobalPipes(...pipeInstances);
      this.logger.log(`Configured ${pipes.length} global pipe(s)`);
    } catch (error) {
      const errorMessage = `Failed to configure global pipes: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      this.logger.error(errorMessage);
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          errorMessage,
          'MiddlewareManager',
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
   * Configure global filters
   *
   * @param app - NestJS application instance
   * @param filters - Array of filter configurations
   *
   * @example
   * ```typescript
   * middlewareManager.configureFilters(app, [
   *   { filter: HttpExceptionFilter }
   * ]);
   * ```
   */
  configureFilters(app: INestApplication, filters: FilterConfig[]): void {
    try {
      const filterInstances: ExceptionFilter[] = filters.map(filterConfig => {
        // If filter is already an instance, use it directly
        if (!(filterConfig.filter instanceof Function)) {
          return filterConfig.filter as ExceptionFilter;
        }

        // Instantiate filter with constructor arguments if provided
        if (filterConfig.constructorArgs && filterConfig.constructorArgs.length > 0) {
          // Type assertion for filter instances - NestJS accepts any ExceptionFilter
          return new (filterConfig.filter as new (...args: unknown[]) => ExceptionFilter)(
            ...filterConfig.constructorArgs
          );
        }

        // Instantiate filter without arguments
        return new (filterConfig.filter as new (...args: unknown[]) => ExceptionFilter)();
      });

      app.useGlobalFilters(...filterInstances);
      this.logger.log(`Configured ${filters.length} global filter(s)`);
    } catch (error) {
      const errorMessage = `Failed to configure global filters: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      this.logger.error(errorMessage);
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          errorMessage,
          'MiddlewareManager',
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
   * Configure global interceptors
   *
   * @param app - NestJS application instance
   * @param interceptors - Array of interceptor configurations
   *
   * @example
   * ```typescript
   * middlewareManager.configureInterceptors(app, [
   *   { interceptor: LoggingInterceptor }
   * ]);
   * ```
   */
  configureInterceptors(app: INestApplication, interceptors: InterceptorConfig[]): void {
    try {
      const interceptorInstances: NestInterceptor[] = interceptors.map(interceptorConfig => {
        // If interceptor is already an instance, use it directly
        if (!(interceptorConfig.interceptor instanceof Function)) {
          return interceptorConfig.interceptor as NestInterceptor;
        }

        // Instantiate interceptor with constructor arguments if provided
        if (interceptorConfig.constructorArgs && interceptorConfig.constructorArgs.length > 0) {
          // Type assertion for interceptor instances - NestJS accepts any NestInterceptor
          return new (interceptorConfig.interceptor as new (...args: unknown[]) => NestInterceptor)(
            ...interceptorConfig.constructorArgs
          );
        }

        // Instantiate interceptor without arguments
        return new (interceptorConfig.interceptor as new (...args: unknown[]) => NestInterceptor)();
      });

      app.useGlobalInterceptors(...interceptorInstances);
      this.logger.log(`Configured ${interceptors.length} global interceptor(s)`);
    } catch (error) {
      const errorMessage = `Failed to configure global interceptors: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      this.logger.error(errorMessage);
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          errorMessage,
          'MiddlewareManager',
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
   * Configure API versioning
   *
   * @param app - NestJS application instance
   * @param versioning - Versioning configuration
   *
   * @example
   * ```typescript
   * middlewareManager.configureVersioning(app, {
   *   type: 'header',
   *   header: 'X-API-Version',
   *   defaultVersion: '1'
   * });
   * ```
   */
  configureVersioning(app: INestApplication, versioning: VersioningConfig): void {
    try {
      let versioningType: VersioningType;
      switch (versioning.type) {
        case 'header':
          versioningType = VersioningType.HEADER;
          break;
        case 'uri':
          versioningType = VersioningType.URI;
          break;
        case 'media-type':
          versioningType = VersioningType.MEDIA_TYPE;
          break;
        default:
          versioningType = VersioningType.HEADER;
      }

      // Build versioning options based on type
      if (versioningType === VersioningType.HEADER && versioning.header) {
        app.enableVersioning({
          type: versioningType,
          header: versioning.header,
          defaultVersion: versioning.defaultVersion || '1',
        });
      } else if (versioningType === VersioningType.URI && versioning.uriPrefix) {
        app.enableVersioning({
          type: versioningType,
          prefix: versioning.uriPrefix,
          defaultVersion: versioning.defaultVersion || '1',
        });
      } else if (versioningType === VersioningType.MEDIA_TYPE) {
        app.enableVersioning({
          type: versioningType,
          key: 'v',
          defaultVersion: versioning.defaultVersion || '1',
        });
      } else {
        // Default to header versioning
        app.enableVersioning({
          type: VersioningType.HEADER,
          header: versioning.header || 'X-API-Version',
          defaultVersion: versioning.defaultVersion || '1',
        });
      }

      this.logger.log(`API versioning configured: ${versioning.type}`);
    } catch (error) {
      const errorMessage = `Failed to configure API versioning: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      this.logger.error(errorMessage);
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          errorMessage,
          'MiddlewareManager',
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
   * Configure global prefix
   *
   * @param app - NestJS application instance
   * @param prefixConfig - Global prefix configuration
   *
   * @example
   * ```typescript
   * middlewareManager.configureGlobalPrefix(app, {
   *   prefix: 'api/v1',
   *   exclude: ['health', 'metrics', 'docs']
   * });
   * ```
   */
  configureGlobalPrefix(app: INestApplication, prefixConfig: GlobalPrefixConfig): void {
    try {
      if (!prefixConfig.prefix || prefixConfig.prefix.trim() === '') {
        this.logger.log('Global prefix not configured (empty or not provided)');
        return;
      }

      const exclude = prefixConfig.exclude?.map(item => {
        if (typeof item === 'string') {
          return item;
        }
        // Convert object to RequestMethod enum
        const methodMap: Record<string, RequestMethod> = {
          GET: RequestMethod.GET,
          POST: RequestMethod.POST,
          PUT: RequestMethod.PUT,
          DELETE: RequestMethod.DELETE,
          PATCH: RequestMethod.PATCH,
          ALL: RequestMethod.ALL,
          OPTIONS: RequestMethod.OPTIONS,
          HEAD: RequestMethod.HEAD,
        };
        return {
          path: item.path,
          method: methodMap[item.method] || RequestMethod.ALL,
        };
      });

      app.setGlobalPrefix(prefixConfig.prefix, exclude ? { exclude } : undefined);
      this.logger.log(`Global prefix configured: ${prefixConfig.prefix}`);
    } catch (error) {
      const errorMessage = `Failed to configure global prefix: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      this.logger.error(errorMessage);
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          errorMessage,
          'MiddlewareManager',
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
   * Enable shutdown hooks
   *
   * @param app - NestJS application instance
   */
  enableShutdownHooks(app: INestApplication): void {
    try {
      app.enableShutdownHooks();
      this.logger.log('Shutdown hooks enabled');
    } catch (error) {
      const errorMessage = `Failed to enable shutdown hooks: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      this.logger.error(errorMessage);
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          errorMessage,
          'MiddlewareManager',
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
   * Configure all middleware from configuration object
   *
   * @param app - NestJS application instance
   * @param config - Middleware configuration
   */
  configure(app: INestApplication, config: MiddlewareConfig): void {
    try {
      if (config.validationPipe) {
        this.configurePipes(app, [{ pipe: ValidationPipe, options: config.validationPipe }]);
      }

      if (config.enableVersioning && config.versioningType) {
        const versioningConfig: VersioningConfig = {
          type: config.versioningType,
          ...(config.versioningHeader && { header: config.versioningHeader }),
          ...(config.defaultVersion && { defaultVersion: config.defaultVersion }),
        };
        this.configureVersioning(app, versioningConfig);
      }

      if (config.globalPrefix) {
        const prefixConfig: GlobalPrefixConfig = {
          prefix: config.globalPrefix,
          ...(config.prefixExclude && { exclude: config.prefixExclude }),
        };
        this.configureGlobalPrefix(app, prefixConfig);
      }

      if (config.enableShutdownHooks) {
        this.enableShutdownHooks(app);
      }

      this.logger.log('Middleware configuration completed');
    } catch (error) {
      const errorMessage = `Failed to configure middleware: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      this.logger.error(errorMessage);
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          errorMessage,
          'MiddlewareManager',
          {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
      }
      throw error;
    }
  }
}
