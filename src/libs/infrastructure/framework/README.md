/**
 * Framework Abstraction Layer - Complete Documentation
 *
 * @module Framework
 * @description Comprehensive framework abstraction layer for NestJS and Fastify
 * Provides wrappers, orchestrators, and extensions for complete application lifecycle management
 *
 * @remarks
 * - All NestJS and Fastify code is centralized in this module
 * - Framework-agnostic API for easy framework switching
 * - Type-safe service retrieval and configuration
 * - Follows SOLID principles and AI rules
 */

/**
 * # Framework Abstraction Layer
 *
 * This module provides a complete abstraction layer for NestJS and Fastify, centralizing
 * all framework-specific code and providing a clean, type-safe API for application bootstrap.
 *
 * ## Architecture Overview
 *
 * ```
 * @infrastructure/framework/
 * ├── adapters/              # Framework adapters (Fastify, future Express)
 * │   ├── fastify.adapter.ts
 * │   └── framework.adapter.interface.ts
 * ├── wrappers/              # High-level wrappers
 * │   ├── service-container.ts          # Type-safe DI service retrieval
 * │   ├── middleware.manager.ts         # Middleware configuration
 * │   ├── application-lifecycle.manager.ts  # Application lifecycle
 * │   ├── server-configurator.ts        # Server configuration
 * │   └── bootstrap-orchestrator.ts     # Bootstrap coordination
 * ├── extensions/            # Framework-specific extensions
 * │   └── fastify.extensions.ts         # Fastify-specific helpers
 * └── index.ts               # Module exports
 * ```
 *
 * ## Components
 *
 * ### 1. Service Container (`ServiceContainer`)
 *
 * Type-safe service retrieval from NestJS DI container.
 *
 * ```typescript
 * const container = new ServiceContainer(app, logger, loggingService);
 * const configService = container.getService<ConfigService>(ConfigService);
 * const loggingService = container.getService<LoggingService>(LoggingService);
 * ```
 *
 * ### 2. Middleware Manager (`MiddlewareManager`)
 *
 * Framework-agnostic middleware configuration.
 *
 * ```typescript
 * const middlewareManager = new MiddlewareManager(logger, loggingService);
 * middlewareManager.configurePipes(app, [
 *   { pipe: ValidationPipe, options: { transform: true, whitelist: true } }
 * ]);
 * middlewareManager.configureFilters(app, [
 *   { filter: HttpExceptionFilter }
 * ]);
 * middlewareManager.configureVersioning(app, {
 *   type: 'header',
 *   header: 'X-API-Version',
 *   defaultVersion: '1'
 * });
 * ```
 *
 * ### 3. Application Lifecycle Manager (`ApplicationLifecycleManager`)
 *
 * Manages complete application lifecycle.
 *
 * ```typescript
 * const lifecycleManager = new ApplicationLifecycleManager(
 *   frameworkAdapter,
 *   logger,
 *   loggingService
 * );
 *
 * const app = await lifecycleManager.createApplication(AppModule, config);
 * await lifecycleManager.startServer({ port: 8088, host: '0.0.0.0' });
 * ```
 *
 * ### 4. Server Configurator (`ServerConfigurator`)
 *
 * Centralizes server configuration.
 *
 * ```typescript
 * const serverConfigurator = new ServerConfigurator(logger, {
 *   environment: 'production',
 *   configService
 * }, loggingService);
 *
 * const serverConfig = serverConfigurator.getServerConfig();
 * const appConfig = serverConfigurator.getApplicationConfig(instanceId, isHorizontalScaling);
 * ```
 *
 * ### 5. Bootstrap Orchestrator (`BootstrapOrchestrator`)
 *
 * High-level orchestrator for complete bootstrap process.
 *
 * ```typescript
 * const orchestrator = new BootstrapOrchestrator(
 *   frameworkAdapter,
 *   logger,
 *   loggingService
 * );
 *
 * const context = await orchestrator.bootstrap({
 *   appModule: AppModule,
 *   applicationConfig: { /* ... */ },
 *   middlewareConfig: { /* ... */ },
 *   serverConfig: { port: 8088, host: '0.0.0.0' },
 *   logger
 * });
 * ```
 *
 * ### 6. Fastify Extensions
 *
 * **Note**: FastifyExtensions was removed. All security middleware (including Helmet)
 * is now centralized in `SecurityConfigService` to follow DRY principles.
 *
 * For getting Fastify instance, use adapter directly:
 * ```typescript
 * const fastifyInstance = fastifyAdapter.getHttpServer(app);
 * ```
 *
 * ## Usage Example
 *
 * ```typescript
 * import {
 *   createFrameworkAdapter,
 *   BootstrapOrchestrator
 * } from '@infrastructure/framework';
 * import { AppModule } from './app.module';
 *
 * async function bootstrap() {
 *   const logger = new Logger('Bootstrap');
 *   const frameworkAdapter = createFrameworkAdapter();
 *
 *   const orchestrator = new BootstrapOrchestrator(
 *     frameworkAdapter,
 *     logger
 *   );
 *
 *   const context = await orchestrator.bootstrap({
 *     appModule: AppModule,
 *     applicationConfig: {
 *       environment: 'production',
 *       isHorizontalScaling: false,
 *       instanceId: '1',
 *       trustProxy: true,
 *       bodyLimit: 50 * 1024 * 1024,
 *       keepAliveTimeout: 65000,
 *       connectionTimeout: 60000,
 *       requestTimeout: 30000,
 *       enableHttp2: true
 *     },
 *     middlewareConfig: {
 *       validationPipe: { transform: true, whitelist: true },
 *       enableVersioning: true,
 *       versioningType: 'header',
 *       versioningHeader: 'X-API-Version',
 *       defaultVersion: '1',
 *       globalPrefix: 'api/v1',
 *       enableShutdownHooks: true
 *     },
 *     serverConfig: {
 *       port: 8088,
 *       host: '0.0.0.0'
 *     },
 *     logger
 *   });
 *
 *   // Use context.services for further configuration
 *   // Setup Swagger, WebSocket, etc.
 * }
 * ```
 *
 * ## Benefits
 *
 * 1. **Framework Abstraction**: Easy to switch between Fastify and Express
 * 2. **Type Safety**: Full TypeScript support with no `any` types
 * 3. **Centralized Code**: All framework code in one place
 * 4. **SOLID Principles**: Single responsibility, dependency inversion
 * 5. **Error Handling**: Comprehensive error handling and logging
 * 6. **Testability**: Each component can be tested independently
 *
 * ## Migration from main.ts
 *
 * The wrappers can be gradually integrated into `main.ts`:
 *
 * 1. Replace service retrieval with `ServiceContainer`
 * 2. Replace middleware configuration with `MiddlewareManager`
 * 3. Replace application creation with `ApplicationLifecycleManager`
 * 4. Use `BootstrapOrchestrator` for complete bootstrap
 *
 * ## Compliance
 *
 * - ✅ Zero `any` types
 * - ✅ Path aliases only (`@infrastructure/framework`, `@core/types`)
 * - ✅ LoggingService for all logging
 * - ✅ SOLID principles
 * - ✅ Fastify-only (per AI rules)
 * - ✅ Comprehensive error handling
 * - ✅ Type-safe service retrieval
 */
