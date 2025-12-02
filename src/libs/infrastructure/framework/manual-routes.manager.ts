/**
 * Manual Routes Manager
 *
 * Fastify doesn't always respect NestJS global prefix exclusions,
 * so we need to manually register certain routes that should be
 * accessible without the global prefix (e.g., /health, /logger, /socket-test, /email/status).
 *
 * This manager handles the manual registration of these routes in Fastify.
 *
 * @module Framework
 * @see https://docs.nestjs.com/techniques/http-server - NestJS HTTP server documentation
 * @see https://fastify.dev/docs/latest/ - Fastify documentation
 */

import type { INestApplication } from '@nestjs/common';
import type { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { createFrameworkAdapter, FastifyFrameworkAdapter } from '@infrastructure/framework';

// Get Fastify types from the adapter (framework-agnostic approach)
// The adapter is the single source of truth for all Fastify-specific types
// FastifyReply is needed for controller method signatures but we get it via the adapter pattern
// FastifyInstance type is derived from the adapter's getHttpServer return type
type FastifyInstance = ReturnType<FastifyFrameworkAdapter['getHttpServer']>;

// FastifyReply is needed for controller method signatures
// Since controllers use FastifyReply directly, we need to import it
// However, we ensure all Fastify instance access goes through the adapter
import type { FastifyReply } from 'fastify';

// Import controller classes directly for type safety
// Using static imports ensures TypeScript can resolve types correctly
import { HealthController } from '@services/health/health.controller';
import { LoggingController } from '@infrastructure/logging/logging.controller';
import { EmailController } from '@communication/channels/email/email.controller';
// AppController is in root src/ directory - import using relative path
// From: src/libs/infrastructure/framework/manual-routes.manager.ts
// To: src/app.controller.ts (3 levels up: ../../..)
import { AppController } from '../../../app.controller';

/**
 * Controller method signatures for type safety
 * These interfaces define the expected method signatures for each controller
 *
 * @interface IAppController
 * @description AppController method signatures for dashboard and socket test routes
 */
interface IAppController {
  getDashboard?: (reply: FastifyReply) => Promise<unknown>;
  getSocketTestPage?: (reply: FastifyReply) => Promise<unknown>;
}

/**
 * @interface IHealthController
 * @description HealthController method signatures for health check routes
 */
interface IHealthController {
  getHealth?: (reply: FastifyReply) => Promise<unknown>;
}

/**
 * @interface ILoggingController
 * @description LoggingController method signatures for logging UI routes
 */
interface ILoggingController {
  getUI?: (reply: FastifyReply) => Promise<unknown>;
}

/**
 * @interface IEmailController
 * @description EmailController method signatures for email status routes
 */
interface IEmailController {
  getStatus?: () => Record<string, unknown>;
}

/**
 * Manually register routes that should be excluded from the global prefix
 * Fastify doesn't always respect NestJS global prefix exclusions
 *
 * @param app - NestJS application instance
 * @param loggingService - LoggingService instance for structured logging
 * @returns Promise<void>
 */
export async function registerManualRoutes(
  app: INestApplication,
  loggingService: LoggingService
): Promise<void> {
  try {
    // Use framework adapter to get Fastify instance (framework-agnostic approach)
    const frameworkAdapter = createFrameworkAdapter();

    // Verify we're using Fastify (required per AI rules)
    if (frameworkAdapter.getFrameworkName() !== 'fastify') {
      await loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Unsupported framework: ${frameworkAdapter.getFrameworkName()}. Only Fastify is supported.`,
        'ManualRoutesManager'
      );
      return;
    }

    // Get Fastify instance using framework adapter
    const fastifyInstance = frameworkAdapter.getHttpServer(app) as FastifyInstance;
    if (!fastifyInstance?.get) {
      await loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Fastify instance or get method is undefined, skipping manual route registration',
        'ManualRoutesManager'
      );
      return;
    }

    // Register root dashboard route
    await registerRootRoute(app, fastifyInstance, loggingService);

    // Register health route
    await registerHealthRoute(app, fastifyInstance, loggingService);

    // Register logger route
    await registerLoggerRoute(app, fastifyInstance, loggingService);

    // Register socket-test route
    await registerSocketTestRoute(app, fastifyInstance, loggingService);

    // Register email routes
    await registerEmailRoutes(app, fastifyInstance, loggingService);
  } catch (error) {
    await loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      `Failed to manually register routes: ${error instanceof Error ? error.message : String(error)}`,
      'ManualRoutesManager',
      { error: error instanceof Error ? error.stack : String(error) }
    );
    // Continue - the routes might still work via normal NestJS registration
  }
}

/**
 * Register root dashboard route (/)
 *
 * @param app - NestJS application instance
 * @param fastifyInstance - Fastify instance for route registration
 * @param loggingService - LoggingService instance for structured logging
 * @returns Promise<void>
 */
async function registerRootRoute(
  app: INestApplication,
  fastifyInstance: FastifyInstance,
  loggingService: LoggingService
): Promise<void> {
  try {
    // Use static import for AppController (imported at top of file)
    const appController = await app.resolve(AppController);
    const typedController = appController as IAppController | null;

    if (typedController && typeof typedController.getDashboard === 'function') {
      // Register GET handler
      fastifyInstance.get?.('/', async (_request: unknown, reply: FastifyReply) => {
        if (typedController.getDashboard) {
          return typedController.getDashboard(reply);
        }
        return reply.code(500).send({ error: 'Dashboard handler not available' });
      });
      // Register OPTIONS handler for CORS preflight
      fastifyInstance.options?.('/', async (_request: unknown, reply: FastifyReply) => {
        return reply
          .code(200)
          .header('Access-Control-Allow-Origin', '*')
          .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
          .header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
          .send();
      });
      await loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Root route / manually registered for dashboard (GET and OPTIONS)',
        'ManualRoutesManager'
      );
    }
  } catch (error) {
    await loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      `Failed to register root route: ${error instanceof Error ? error.message : String(error)}`,
      'ManualRoutesManager',
      { error: error instanceof Error ? error.stack : String(error) }
    );
  }
}

/**
 * Register health route (/health)
 *
 * @param app - NestJS application instance
 * @param fastifyInstance - Fastify instance for route registration
 * @param loggingService - LoggingService instance for structured logging
 * @returns Promise<void>
 */
async function registerHealthRoute(
  app: INestApplication,
  fastifyInstance: FastifyInstance,
  loggingService: LoggingService
): Promise<void> {
  try {
    const healthController = await app.resolve(HealthController);
    const typedHealthController = healthController as IHealthController | null;

    if (typedHealthController && typeof typedHealthController.getHealth === 'function') {
      // Register GET handler
      fastifyInstance.get?.('/health', async (_request: unknown, reply: FastifyReply) => {
        if (typedHealthController.getHealth) {
          return typedHealthController.getHealth(reply);
        }
        return reply.code(500).send({ error: 'Health handler not available' });
      });
      // Register OPTIONS handler for CORS preflight
      fastifyInstance.options?.('/health', async (_request: unknown, reply: FastifyReply) => {
        return reply
          .code(200)
          .header('Access-Control-Allow-Origin', '*')
          .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
          .header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
          .send();
      });
      await loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Health route /health manually registered for Fastify (GET and OPTIONS)',
        'ManualRoutesManager'
      );
    }
  } catch (error) {
    await loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      `Failed to register health route: ${error instanceof Error ? error.message : String(error)}`,
      'ManualRoutesManager',
      { error: error instanceof Error ? error.stack : String(error) }
    );
  }
}

/**
 * Register logger route (/logger)
 *
 * @param app - NestJS application instance
 * @param fastifyInstance - Fastify instance for route registration
 * @param loggingService - LoggingService instance for structured logging
 * @returns Promise<void>
 */
async function registerLoggerRoute(
  app: INestApplication,
  fastifyInstance: FastifyInstance,
  loggingService: LoggingService
): Promise<void> {
  try {
    const loggingController = await app.resolve(LoggingController);
    const typedLoggingController = loggingController as ILoggingController | null;

    if (typedLoggingController && typeof typedLoggingController.getUI === 'function') {
      // Register GET handler
      fastifyInstance.get?.('/logger', async (_request: unknown, reply: FastifyReply) => {
        if (typedLoggingController.getUI) {
          return typedLoggingController.getUI(reply);
        }
        return reply.code(500).send({ error: 'Logging UI handler not available' });
      });
      // Register OPTIONS handler for CORS preflight
      fastifyInstance.options?.('/logger', async (_request: unknown, reply: FastifyReply) => {
        return reply
          .code(200)
          .header('Access-Control-Allow-Origin', '*')
          .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
          .header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
          .send();
      });
      await loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Logger route /logger manually registered for Fastify (GET and OPTIONS)',
        'ManualRoutesManager'
      );
    }
  } catch (error) {
    await loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      `Failed to register logger route: ${error instanceof Error ? error.message : String(error)}`,
      'ManualRoutesManager',
      { error: error instanceof Error ? error.stack : String(error) }
    );
  }
}

/**
 * Register socket-test route (/socket-test)
 *
 * @param app - NestJS application instance
 * @param fastifyInstance - Fastify instance for route registration
 * @param loggingService - LoggingService instance for structured logging
 * @returns Promise<void>
 */
async function registerSocketTestRoute(
  app: INestApplication,
  fastifyInstance: FastifyInstance,
  loggingService: LoggingService
): Promise<void> {
  try {
    // Use static import for AppController (imported at top of file)
    const appController = await app.resolve(AppController);
    const typedSocketController = appController as IAppController | null;

    if (typedSocketController && typeof typedSocketController.getSocketTestPage === 'function') {
      // Register GET handler
      fastifyInstance.get?.('/socket-test', async (_request: unknown, reply: FastifyReply) => {
        if (typedSocketController.getSocketTestPage) {
          return typedSocketController.getSocketTestPage(reply);
        }
        return reply.code(500).send({ error: 'Socket test handler not available' });
      });
      // Register OPTIONS handler for CORS preflight
      fastifyInstance.options?.('/socket-test', async (_request: unknown, reply: FastifyReply) => {
        return reply
          .code(200)
          .header('Access-Control-Allow-Origin', '*')
          .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
          .header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
          .send();
      });
      await loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Socket-test route /socket-test manually registered for Fastify (GET and OPTIONS)',
        'ManualRoutesManager'
      );
    }
  } catch (error) {
    await loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      `Failed to register socket-test route: ${error instanceof Error ? error.message : String(error)}`,
      'ManualRoutesManager',
      { error: error instanceof Error ? error.stack : String(error) }
    );
  }
}

/**
 * Register email routes (/email/status, etc.)
 *
 * @param app - NestJS application instance
 * @param fastifyInstance - Fastify instance for route registration
 * @param loggingService - LoggingService instance for structured logging
 * @returns Promise<void>
 */
async function registerEmailRoutes(
  app: INestApplication,
  fastifyInstance: FastifyInstance,
  loggingService: LoggingService
): Promise<void> {
  try {
    const emailController = await app.resolve(EmailController);
    const typedEmailController = emailController as IEmailController | null;

    if (typedEmailController && typeof typedEmailController.getStatus === 'function') {
      // Register GET handler for /email/status (excluded from prefix)
      fastifyInstance.get?.('/email/status', async (_request: unknown, _reply: FastifyReply) => {
        if (typedEmailController.getStatus) {
          return typedEmailController.getStatus();
        }
        return { error: 'Email status handler not available' };
      });
      // Register OPTIONS handler for CORS preflight
      fastifyInstance.options?.('/email/status', async (_request: unknown, reply: FastifyReply) => {
        return reply
          .code(200)
          .header('Access-Control-Allow-Origin', '*')
          .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
          .header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
          .send();
      });
      await loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Email status route /email/status manually registered for Fastify (GET and OPTIONS)',
        'ManualRoutesManager'
      );
    }
  } catch (error) {
    await loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      `Failed to register email routes: ${error instanceof Error ? error.message : String(error)}`,
      'ManualRoutesManager',
      { error: error instanceof Error ? error.stack : String(error) }
    );
  }
}
