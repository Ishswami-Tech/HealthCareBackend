/**
 * Framework Adapter Interface
 *
 * Provides a framework-agnostic interface for HTTP server operations.
 * This allows easy switching between Fastify, Express, or other frameworks.
 *
 * @module FrameworkAdapter
 * @description Framework abstraction layer for healthcare applications
 * @interface IFrameworkAdapter
 *
 * @remarks
 * - Follows Interface Segregation Principle (SOLID)
 * - Enables Dependency Inversion (depend on abstractions, not concretions)
 * - Currently only Fastify implementation exists (per AI rules: Fastify is mandatory)
 * - Future Express support can be added by implementing this interface
 *
 * @example
 * ```typescript
 * // Use framework adapter in framework-agnostic code
 * const adapter: IFrameworkAdapter = createFrameworkAdapter();
 * const app = await adapter.createApplication(AppModule, options, logger);
 * await adapter.registerPlugin(app, somePlugin, pluginOptions);
 * ```
 */

import { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';

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
  readonly environment: 'development' | 'production';
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
}
