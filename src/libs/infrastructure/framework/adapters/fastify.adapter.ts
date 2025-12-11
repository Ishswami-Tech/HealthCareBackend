/**
 * Fastify Framework Adapter
 *
 * Contains all Fastify-specific implementation details.
 * This is the only file that should import Fastify-specific packages.
 *
 * @module FastifyAdapter
 * @description Fastify implementation of the framework adapter interface
 * @implements {IFrameworkAdapter}
 *
 * @example
 * ```typescript
 * // Create and use Fastify adapter
 * const adapter = createFrameworkAdapter();
 * const app = await adapter.createApplication(AppModule, options, logger);
 * ```
 *
 * @remarks
 * - All Fastify-specific code is centralized in this file
 * - Follows SOLID principles (Dependency Inversion, Interface Segregation)
 * - Uses path aliases (@infrastructure/framework) per coding standards
 * - HTTP/2 enabled by default in production
 * - Supports horizontal scaling with instance-specific request IDs
 */

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { INestApplication, Logger, LogLevel } from '@nestjs/common';
import type { FastifyInstance } from 'fastify';
import { getEnvBoolean, getEnvWithDefault } from '@config/environment/utils';
import {
  IFrameworkAdapter,
  IFastifyFrameworkAdapter,
  FrameworkAdapterOptions,
} from '@core/types/framework.types';

// Fastify-specific imports - all Fastify code should be here
// Following AI rules: Fastify is the only allowed HTTP framework
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCompress from '@fastify/compress';
import fastifyMultipart from '@fastify/multipart';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';

// Type helpers for Fastify plugin compatibility with NestJS FastifyAdapter
// Using proper TypeScript types (no 'any') per coding standards
type FastifyPlugin = Parameters<NestFastifyApplication['register']>[0];
type FastifyPluginOptions = Parameters<NestFastifyApplication['register']>[1];

/**
 * Fastify Framework Adapter Implementation
 *
 * Handles all Fastify-specific operations including:
 * - Application creation with FastifyAdapter
 * - Plugin registration
 * - Hook/middleware registration
 * - Server instance access
 *
 * @class FastifyFrameworkAdapter
 * @implements {IFrameworkAdapter}
 * @description Enterprise-grade Fastify adapter for healthcare applications
 * following SOLID principles and AI coding standards
 */
export class FastifyFrameworkAdapter implements IFastifyFrameworkAdapter {
  /**
   * Create and configure NestJS application with Fastify adapter
   *
   * @param appModule - The root application module (AppModule)
   * @param options - Framework adapter configuration options
   * @param _logger - NestJS Logger instance (unused, kept for interface compliance)
   * @returns Promise<INestApplication> - Configured NestJS application instance
   *
   * @description
   * Creates a production-optimized Fastify application with:
   * - HTTP/2 support (enabled by default in production)
   * - Horizontal scaling support with instance-specific request IDs
   * - Performance optimizations (body limits, timeouts, keep-alive)
   * - Custom LoggingService integration (Fastify logging disabled)
   *
   * @example
   * ```typescript
   * const adapter = new FastifyFrameworkAdapter();
   * const app = await adapter.createApplication(AppModule, {
   *   environment: 'production',
   *   isHorizontalScaling: true,
   *   instanceId: 'instance-1',
   *   trustProxy: true,
   *   bodyLimit: 50 * 1024 * 1024,
   *   keepAliveTimeout: 65000,
   *   connectionTimeout: 60000,
   *   requestTimeout: 30000,
   *   enableHttp2: true
   * }, logger);
   * ```
   */
  async createApplication(
    appModule: unknown,
    options: FrameworkAdapterOptions,
    _logger: Logger
  ): Promise<INestApplication> {
    // Production optimized Fastify adapter with horizontal scaling support
    // Disable Fastify's built-in logger - we use custom LoggingService instead
    // LoggingInterceptor and HttpExceptionFilter will handle all logging through LoggingService
    const fastifyAdapterOptions: Record<string, unknown> = {
      // Omit logger option - Fastify will use default no-op logger
      // Custom LoggingService handles all logging via NestJS logger system
      disableRequestLogging: true, // Disable Fastify request logging - LoggingInterceptor handles this
      requestIdLogLabel: 'requestId',
      requestIdHeader: options.isHorizontalScaling
        ? `x-request-id-${options.instanceId}`
        : 'x-request-id',
      trustProxy: options.trustProxy,

      // Production performance optimizations
      bodyLimit: options.bodyLimit,
      keepAliveTimeout: options.keepAliveTimeout,
      connectionTimeout: options.connectionTimeout,
      requestTimeout: options.requestTimeout,

      // Router options (moved from deprecated root-level properties)
      routerOptions: {
        caseSensitive: false,
        ignoreTrailingSlash: true,
        maxParamLength: 500,
      },

      // Horizontal scaling optimizations
      ...(options.isHorizontalScaling && {
        pluginTimeout: 30000,
      }),

      // HTTP/2 support - enabled by default in production, can be disabled via ENABLE_HTTP2=false
      // Use helper function (which uses dotenv) for environment variable access
      ...(options.environment === 'production' &&
      options.enableHttp2 !== false &&
      getEnvBoolean('ENABLE_HTTP2', true)
        ? ({ http2: true } as { http2: true })
        : {}),
    };

    const app = await NestFactory.create(
      appModule as Parameters<typeof NestFactory.create>[0],
      new FastifyAdapter(
        fastifyAdapterOptions as unknown as ConstructorParameters<typeof FastifyAdapter>[0]
      ),
      {
        logger:
          options.environment === 'production'
            ? (['error', 'warn'] as LogLevel[])
            : (['error', 'warn', 'log'] as LogLevel[]),
        bufferLogs: true,
        cors: false, // Will be configured separately via SecurityConfigService
      }
    );

    return app;
  }

  /**
   * Get the underlying Fastify HTTP server instance
   *
   * @param app - NestJS application instance
   * @returns FastifyInstance - The underlying Fastify HTTP server
   *
   * @description
   * Extracts the Fastify instance from NestJS application for direct access
   * to Fastify-specific features (hooks, plugins, etc.)
   *
   * @example
   * ```typescript
   * const fastifyInstance = adapter.getHttpServer(app);
   * fastifyInstance.addHook('onRequest', (request, reply, done) => {
   *   // Custom hook logic
   *   done();
   * });
   * ```
   */
  getHttpServer(app: INestApplication): FastifyInstance {
    const fastifyApp = app as NestFastifyApplication;
    // Type assertion required due to NestJS adapter abstraction
    // getInstance() returns RawServerDefault, but we know it's FastifyInstance
    const httpServer = fastifyApp.getHttpAdapter().getInstance();
    return httpServer as unknown as FastifyInstance;
  }

  /**
   * Helper function to safely register Fastify plugins with proper typing
   * Moved from @utils/fastify.utils.ts to centralize all Fastify code
   *
   * @param app - NestJS Fastify application instance
   * @param plugin - Fastify plugin to register
   * @param options - Plugin options
   *
   * @description Type-safe plugin registration that handles type incompatibilities
   * between third-party Fastify plugins and NestJS types.
   */
  private async registerFastifyPlugin<T extends FastifyPluginOptions>(
    app: NestFastifyApplication,
    plugin: unknown,
    options: T
  ): Promise<void> {
    // Type assertion is required due to third-party plugin type incompatibilities
    // We use unknown -> FastifyPlugin instead of any for better type safety
    // Ignore return value as plugins register themselves with the app
    await app.register(plugin as FastifyPlugin, options);
  }

  /**
   * Register a Fastify plugin (public interface method)
   *
   * @param app - NestJS application instance
   * @param plugin - Fastify plugin to register
   * @param options - Plugin configuration options
   * @returns Promise<void>
   *
   * @description
   * Registers a Fastify plugin with the application.
   * This method implements the IFrameworkAdapter interface and provides
   * a framework-agnostic way to register plugins.
   *
   * @example
   * ```typescript
   * await adapter.registerPlugin(app, fastifyCompress, {
   *   global: true,
   *   threshold: 1024
   * });
   * ```
   */
  async registerPlugin(
    app: INestApplication,
    plugin: unknown,
    options: Record<string, unknown>
  ): Promise<void> {
    const fastifyApp = app as NestFastifyApplication;
    await this.registerFastifyPlugin(fastifyApp, plugin, options);
  }

  /**
   * Add a Fastify hook to the request lifecycle
   *
   * @param app - NestJS application instance
   * @param hookName - Name of the hook ('onRequest', 'onResponse', etc.)
   * @param handler - Hook handler function
   * @returns void
   *
   * @description
   * Adds a lifecycle hook to the Fastify application.
   * Supports 'onRequest' and 'onResponse' hooks with proper error handling.
   *
   * @example
   * ```typescript
   * adapter.addHook(app, 'onRequest', (request, reply, done) => {
   *   // Add custom request processing
   *   request['customProperty'] = 'value';
   *   done();
   * });
   * ```
   */
  addHook(
    app: INestApplication,
    hookName: string,
    handler: (request: unknown, reply: unknown, done?: () => void) => void | Promise<void>
  ): void {
    const fastifyInstance = this.getHttpServer(app);

    // Fastify hooks use specific names like 'onRequest', 'onResponse', etc.
    if (hookName === 'onRequest') {
      fastifyInstance.addHook('onRequest', (request, reply, done) => {
        const result = handler(request, reply, done);
        if (result instanceof Promise) {
          void result.catch(err => {
            if (done) {
              done(err as Error);
            }
          });
        }
      });
    } else if (hookName === 'onResponse') {
      fastifyInstance.addHook('onResponse', (request, reply, done) => {
        const result = handler(request, reply, done);
        if (result instanceof Promise) {
          void result.catch(err => {
            if (done) {
              done(err as Error);
            }
          });
        }
      });
    } else {
      // For other hooks, try to add them directly
      // This is a simplified implementation - extend as needed
      fastifyInstance.addHook(hookName as never, handler as never);
    }
  }

  /**
   * Get the framework name
   *
   * @returns string - The framework name ('fastify')
   *
   * @description
   * Returns the framework identifier. Used for framework-specific logic
   * and conditional behavior in framework-agnostic code.
   */
  getFrameworkName(): string {
    return 'fastify';
  }

  /**
   * Register Fastify Helmet plugin (Fastify-specific helper)
   *
   * @param app - NestJS application instance
   * @param options - Helmet security headers configuration
   * @returns Promise<void>
   *
   * @description
   * Convenience method to register the Helmet security plugin.
   * Provides security headers (CSP, HSTS, etc.) for the application.
   *
   * @example
   * ```typescript
   * await adapter.registerHelmet(app, {
   *   contentSecurityPolicy: {
   *     directives: {
   *       defaultSrc: ["'self'"]
   *     }
   *   }
   * });
   * ```
   */
  async registerHelmet(app: INestApplication, options: Record<string, unknown>): Promise<void> {
    await this.registerPlugin(app, fastifyHelmet, options);
  }

  /**
   * Register Fastify Compression plugin (Fastify-specific helper)
   *
   * @param app - NestJS application instance
   * @param options - Compression configuration options
   * @returns Promise<void>
   *
   * @description
   * Registers the compression plugin for response compression (gzip, deflate, brotli).
   */
  async registerCompression(
    app: INestApplication,
    options: Record<string, unknown>
  ): Promise<void> {
    await this.registerPlugin(app, fastifyCompress, options);
  }

  /**
   * Register Fastify Rate Limit plugin (Fastify-specific helper)
   *
   * @param app - NestJS application instance
   * @param options - Rate limiting configuration options
   * @returns Promise<void>
   *
   * @description
   * Registers the rate limiting plugin to prevent abuse and DDoS attacks.
   */
  async registerRateLimit(app: INestApplication, options: Record<string, unknown>): Promise<void> {
    await this.registerPlugin(app, fastifyRateLimit, options);
  }

  /**
   * Register Fastify Multipart plugin (Fastify-specific helper)
   *
   * @param app - NestJS application instance
   * @param options - Multipart form data configuration options
   * @returns Promise<void>
   *
   * @description
   * Registers the multipart plugin for handling file uploads and form data.
   */
  async registerMultipart(app: INestApplication, options: Record<string, unknown>): Promise<void> {
    await this.registerPlugin(app, fastifyMultipart, options);
  }

  /**
   * Register Fastify Cookie plugin (Fastify-specific helper)
   *
   * @param app - NestJS application instance
   * @param options - Cookie configuration options
   * @returns Promise<void>
   *
   * @description
   * Registers the cookie plugin for handling HTTP cookies.
   * Must be registered before @fastify/session.
   */
  async registerCookie(app: INestApplication, options: Record<string, unknown>): Promise<void> {
    await this.registerPlugin(app, fastifyCookie, options);
  }

  /**
   * Register Fastify Session plugin (Fastify-specific helper)
   *
   * @param app - NestJS application instance
   * @param options - Session configuration options
   * @returns Promise<void>
   *
   * @description
   * Registers the session plugin for managing user sessions.
   * Requires @fastify/cookie to be registered first.
   * This method ensures @fastify/cookie is registered before session.
   */
  async registerSession(app: INestApplication, options: Record<string, unknown>): Promise<void> {
    const fastifyApp = app as NestFastifyApplication;
    const fastifyInstance = fastifyApp.getHttpAdapter().getInstance();

    // CRITICAL: Ensure @fastify/cookie is registered before @fastify/session
    // Check if cookie plugin is already registered before attempting to register it
    // @fastify/cookie adds a 'serializeCookie' decorator, so we check for that
    const isCookiePluginRegistered = fastifyInstance.hasDecorator('serializeCookie');

    if (!isCookiePluginRegistered) {
      // Get cookie secret from options or use default
      const cookieSecret =
        (options['cookieSecret'] as string) ||
        (options['cookie'] as { secret?: string })?.secret ||
        'default-cookie-secret-change-in-production-min-32-chars';

      try {
        // Register cookie plugin only if not already registered
        await fastifyInstance.register(fastifyCookie, {
          secret: cookieSecret,
        });
      } catch (cookieError) {
        // If cookie registration fails, check if it's because it's already registered
        // Fastify may throw various errors for duplicate registrations
        const errorMessage =
          cookieError instanceof Error ? cookieError.message : String(cookieError);
        const isDuplicateError =
          errorMessage.includes('already registered') ||
          errorMessage.includes('already exists') ||
          errorMessage.includes('decorator') ||
          errorMessage.includes('has already been added');

        if (!isDuplicateError) {
          // Re-throw if it's a different error (not a duplicate registration)
          throw cookieError;
        }
        // Otherwise, cookie is already registered (or registration failed for duplicate) - proceed
      }
    }

    // Now register session plugin (cookie dependency is satisfied)
    await this.registerPlugin(app, fastifySession, options);
  }

  /**
   * Check if application is Fastify-based
   *
   * @param app - NestJS application instance
   * @returns app is NestFastifyApplication - Type guard
   *
   * @description
   * Type guard to check if the application instance is Fastify-based.
   * Useful for conditional logic when working with framework-agnostic code.
   */
  isFastifyApp(app: INestApplication): app is NestFastifyApplication {
    return 'getHttpAdapter' in app && typeof app.getHttpAdapter === 'function';
  }
}

/**
 * Factory function to create the appropriate framework adapter
 *
 * @returns IFrameworkAdapter - Framework adapter instance
 *
 * @description
 * Creates a framework adapter based on the HTTP_FRAMEWORK environment variable.
 * Currently only supports Fastify (per AI rules: Fastify is mandatory, Express is forbidden).
 * Defaults to Fastify if HTTP_FRAMEWORK is not set or invalid.
 *
 * @example
 * ```typescript
 * // In main.ts
 * const adapter = createFrameworkAdapter();
 * const app = await adapter.createApplication(AppModule, options, logger);
 * ```
 *
 * @remarks
 * - Follows Factory Pattern from architecture guidelines
 * - Uses environment variable for configuration (HTTP_FRAMEWORK)
 * - Per AI rules: Only Fastify is supported (Express is forbidden)
 * - Future Express support can be added by implementing ExpressFrameworkAdapter
 *   and updating this factory, but Express usage is currently prohibited
 */
export function createFrameworkAdapter(): IFrameworkAdapter {
  // Check environment variable to determine framework
  // Per AI rules: Fastify is mandatory, Express is forbidden
  // Use helper function (which uses dotenv) for environment variable access
  const framework = getEnvWithDefault('HTTP_FRAMEWORK', 'fastify');

  switch (framework.toLowerCase()) {
    case 'fastify':
      return new FastifyFrameworkAdapter();
    // Express support is currently forbidden per AI rules
    // case 'express':
    //   return new ExpressFrameworkAdapter();
    default:
      // Default to Fastify (mandatory framework per AI rules)
      return new FastifyFrameworkAdapter();
  }
}
