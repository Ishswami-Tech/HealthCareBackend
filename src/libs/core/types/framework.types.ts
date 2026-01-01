/**
 * Framework Types - Consolidated
 *
 * @module FrameworkTypes
 * @description Type definitions for framework abstraction layer wrappers
 * Centralized types for application lifecycle, middleware, services, bootstrap, and framework adapters
 *
 * This file consolidates:
 * - Framework wrapper types (application lifecycle, middleware, services, bootstrap)
 * - Framework adapter interfaces (IFrameworkAdapter, IFastifyFrameworkAdapter)
 * - Framework adapter options (FrameworkAdapterOptions)
 */

import { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { ValidationPipeOptions } from '@nestjs/common';
import type { LoggingService } from '@infrastructure/logging';
import type { ConfigService } from '@config';
import type { SecurityConfigService } from '@security/security-config.service';
import type { GracefulShutdownService } from '@core/resilience/graceful-shutdown.service';
import type { ProcessErrorHandlersService } from '@core/resilience/graceful-shutdown.service';
import type { IoAdapter } from '@nestjs/platform-socket.io';
import type { RedisClient } from './common.types';

// ============================================================================
// FRAMEWORK ADAPTER TYPES (consolidated from framework.adapter.interface.ts)
// ============================================================================

/**
 * Framework adapter options for server configuration
 *
 * @interface FrameworkAdapterOptions
 * @description Configuration options for framework adapter initialization
 *
 * @property {('development' | 'production')} environment - Application environment
 * @property {boolean} isHorizontalScaling - Whether horizontal scaling is enabled
 * @property {string} instanceId - Unique instance identifier for horizontal scaling
 * @property {boolean} trustProxy - Whether to trust proxy headers
 * @property {number} bodyLimit - Maximum request body size in bytes
 * @property {number} keepAliveTimeout - Keep-alive timeout in milliseconds
 * @property {number} connectionTimeout - Connection timeout in milliseconds
 * @property {number} requestTimeout - Request timeout in milliseconds
 * @property {boolean} [enableHttp2] - Enable HTTP/2 support (default: true in production)
 *
 * @example
 * ```typescript
 * const options: FrameworkAdapterOptions = {
 *   environment: 'production',
 *   isHorizontalScaling: true,
 *   instanceId: 'instance-1',
 *   trustProxy: true,
 *   bodyLimit: 50 * 1024 * 1024, // 50MB
 *   keepAliveTimeout: 65000,
 *   connectionTimeout: 60000,
 *   requestTimeout: 30000,
 *   enableHttp2: true
 * };
 * ```
 */
export interface FrameworkAdapterOptions {
  readonly environment: 'development' | 'production' | 'staging' | 'test' | 'local-prod';
  readonly isHorizontalScaling: boolean;
  readonly instanceId: string;
  readonly trustProxy: boolean;
  readonly bodyLimit: number;
  readonly keepAliveTimeout: number;
  readonly connectionTimeout: number;
  readonly requestTimeout: number;
  readonly enableHttp2?: boolean;
}

/**
 * Framework adapter interface
 *
 * Implementations should handle all framework-specific operations.
 * This interface enables framework abstraction and follows the
 * Dependency Inversion Principle (SOLID).
 *
 * @interface IFrameworkAdapter
 * @description Framework-agnostic interface for HTTP server operations
 *
 * @remarks
 * - Follows Interface Segregation Principle (SOLID)
 * - Enables Dependency Inversion (depend on abstractions, not concretions)
 * - Currently only Fastify implementation exists (per AI rules: Fastify is mandatory)
 * - Future Express support can be added by implementing this interface
 *
 * @example
 * ```typescript
 * class FastifyFrameworkAdapter implements IFrameworkAdapter {
 *   async createApplication(...) {
 *     // Fastify-specific implementation
 *   }
 *   getHttpServer(...) {
 *     // Fastify-specific implementation
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface IFrameworkAdapter {
  /**
   * Create and configure the NestJS application with framework-specific adapter
   *
   * @param appModule - The root application module
   * @param options - Framework adapter configuration options
   * @param logger - NestJS Logger instance
   * @returns Promise<INestApplication> - Configured NestJS application
   */
  createApplication(
    appModule: unknown,
    options: FrameworkAdapterOptions,
    logger: Logger
  ): Promise<INestApplication>;

  /**
   * Get the underlying HTTP server instance
   *
   * @param app - NestJS application instance
   * @returns unknown - The underlying HTTP server instance (framework-specific)
   */
  getHttpServer(app: INestApplication): unknown;

  /**
   * Register a plugin/middleware with the framework
   *
   * @param app - NestJS application instance
   * @param plugin - Plugin/middleware to register
   * @param options - Plugin configuration options
   * @returns Promise<void>
   */
  registerPlugin(
    app: INestApplication,
    plugin: unknown,
    options: Record<string, unknown>
  ): Promise<void>;

  /**
   * Add a hook/middleware to the request lifecycle
   *
   * @param app - NestJS application instance
   * @param hookName - Name of the lifecycle hook
   * @param handler - Hook handler function
   * @returns void
   */
  addHook(
    app: INestApplication,
    hookName: string,
    handler: (request: unknown, reply: unknown, done?: () => void) => void | Promise<void>
  ): void;

  /**
   * Get the framework name
   *
   * @returns string - Framework identifier (e.g., 'fastify', 'express')
   */
  getFrameworkName(): string;
}

/**
 * Extended framework adapter interface for Fastify-specific features
 * This interface can be extended by framework adapters that support
 * security plugins and advanced features.
 *
 * @interface IFastifyFrameworkAdapter
 * @extends {IFrameworkAdapter}
 * @description Extended interface for Fastify-specific security plugins
 */
export interface IFastifyFrameworkAdapter extends IFrameworkAdapter {
  /**
   * Register Helmet security plugin
   */
  registerHelmet(app: INestApplication, options: Record<string, unknown>): Promise<void>;

  /**
   * Register Compression plugin
   */
  registerCompression(app: INestApplication, options: Record<string, unknown>): Promise<void>;

  /**
   * Register Rate Limit plugin
   */
  registerRateLimit(app: INestApplication, options: Record<string, unknown>): Promise<void>;

  /**
   * Register Multipart plugin
   */
  registerMultipart(app: INestApplication, options: Record<string, unknown>): Promise<void>;

  /**
   * Register Cookie plugin
   */
  registerCookie(app: INestApplication, options: Record<string, unknown>): Promise<void>;

  /**
   * Register Session plugin
   */
  registerSession(app: INestApplication, options: Record<string, unknown>): Promise<void>;
}

// ============================================================================
// FRAMEWORK WRAPPER TYPES
// ============================================================================

/**
 * Service token type for NestJS dependency injection
 */
export type ServiceToken = string | symbol | (new (...args: never[]) => unknown);

/**
 * Application configuration options
 */
export interface ApplicationConfig {
  readonly environment: 'development' | 'production' | 'staging' | 'test' | 'local-prod';
  readonly isHorizontalScaling: boolean;
  readonly instanceId: string;
  readonly trustProxy: boolean;
  readonly bodyLimit: number;
  readonly keepAliveTimeout: number;
  readonly connectionTimeout: number;
  readonly requestTimeout: number;
  readonly enableHttp2?: boolean;
}

/**
 * Middleware configuration options
 */
export interface MiddlewareConfig {
  readonly validationPipe?: ValidationPipeOptions;
  readonly enableVersioning?: boolean;
  readonly versioningType?: 'header' | 'uri' | 'media-type';
  readonly versioningHeader?: string;
  readonly defaultVersion?: string;
  readonly globalPrefix?: string;
  readonly prefixExclude?: Array<string | { path: string; method: string }>;
  readonly enableShutdownHooks?: boolean;
}

/**
 * Server configuration options
 */
export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly bindAddress?: string;
}

/**
 * Service container configuration
 */
export interface ServiceContainerConfig {
  readonly app: INestApplication;
  readonly logger: Logger;
}

/**
 * Bootstrap options
 */
export interface BootstrapOptions {
  readonly appModule: unknown;
  readonly applicationConfig: ApplicationConfig;
  readonly middlewareConfig?: MiddlewareConfig;
  readonly serverConfig: ServerConfig;
  readonly logger: Logger;
  readonly configService?: ConfigService;
  readonly loggingService?: LoggingService;
  readonly securityConfigService?: SecurityConfigService;
  readonly gracefulShutdownService?: GracefulShutdownService;
  readonly processErrorHandlersService?: ProcessErrorHandlersService;
  readonly customWebSocketAdapter?: IoAdapter | null;
  readonly redisPubClient?: RedisClient | null;
  readonly redisSubClient?: RedisClient | null;
}

/**
 * Application context returned after bootstrap
 */
export interface ApplicationContext {
  readonly app: INestApplication;
  readonly frameworkAdapter: IFrameworkAdapter;
  readonly configService: ConfigService;
  readonly loggingService: LoggingService;
  readonly securityConfigService: SecurityConfigService;
  readonly gracefulShutdownService: GracefulShutdownService;
  readonly processErrorHandlersService: ProcessErrorHandlersService;
  readonly serverConfig: ServerConfig;
}

/**
 * Pipe configuration
 */
export interface PipeConfig {
  readonly pipe: unknown;
  readonly options?: ValidationPipeOptions;
}

/**
 * Filter configuration
 */
export interface FilterConfig {
  readonly filter: unknown;
  readonly options?: Record<string, unknown>;
  readonly constructorArgs?: readonly unknown[]; // Constructor arguments for filters that require dependencies
}

/**
 * Interceptor configuration
 */
export interface InterceptorConfig {
  readonly interceptor: unknown;
  readonly options?: Record<string, unknown>;
  readonly constructorArgs?: readonly unknown[]; // Constructor arguments for interceptors that require dependencies
}

/**
 * Versioning configuration
 */
export interface VersioningConfig {
  readonly type: 'header' | 'uri' | 'media-type';
  readonly header?: string;
  readonly uriPrefix?: string;
  readonly defaultVersion?: string;
}

/**
 * Global prefix configuration
 */
export interface GlobalPrefixConfig {
  readonly prefix: string;
  readonly exclude?: Array<string | { path: string; method: string }>;
}

/**
 * Application lifecycle events
 */
export enum ApplicationLifecycleEvent {
  CREATED = 'application.created',
  CONFIGURED = 'application.configured',
  STARTED = 'application.started',
  SHUTTING_DOWN = 'application.shutting_down',
  SHUTDOWN = 'application.shutdown',
}

/**
 * Bootstrap stage
 */
export enum BootstrapStage {
  INITIALIZING = 'initializing',
  CREATING_APPLICATION = 'creating_application',
  CONFIGURING_MIDDLEWARE = 'configuring_middleware',
  SETTING_UP_SERVICES = 'setting_up_services',
  STARTING_SERVER = 'starting_server',
  COMPLETED = 'completed',
  FAILED = 'failed',
}
