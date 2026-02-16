import type { INestApplication } from '@nestjs/common';
import type { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { createFrameworkAdapter, FastifyFrameworkAdapter } from '@infrastructure/framework';

type FastifyInstance = ReturnType<FastifyFrameworkAdapter['getHttpServer']>;

import type { FastifyReply } from 'fastify';

import { HealthController } from '@services/health/health.controller';
import { AppController } from '../../../app.controller';

interface IAppController {
  getDashboard?: (reply: FastifyReply) => Promise<unknown>;
  getSocketTestPage?: (reply: FastifyReply) => Promise<unknown>;
}

interface IHealthController {
  getHealth?: (reply: FastifyReply) => Promise<unknown>;
}

export async function registerManualRoutes(
  app: INestApplication,
  loggingService: LoggingService
): Promise<void> {
  try {
    const frameworkAdapter = createFrameworkAdapter();

    if (frameworkAdapter.getFrameworkName() !== 'fastify') {
      await loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Unsupported framework: ${frameworkAdapter.getFrameworkName()}. Only Fastify is supported.`,
        'ManualRoutesManager'
      );
      return;
    }

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

    await registerRootRoute(app, fastifyInstance, loggingService);
    await registerHealthRoute(app, fastifyInstance, loggingService);
    await registerSocketTestRoute(app, fastifyInstance, loggingService);
  } catch (error) {
    await loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      `Failed to manually register routes: ${error instanceof Error ? error.message : String(error)}`,
      'ManualRoutesManager',
      { error: error instanceof Error ? error.stack : String(error) }
    );
  }
}

async function registerRootRoute(
  app: INestApplication,
  fastifyInstance: FastifyInstance,
  loggingService: LoggingService
): Promise<void> {
  try {
    const appController = await app.resolve(AppController);
    const typedController = appController as IAppController | null;

    if (typedController && typeof typedController.getDashboard === 'function') {
      fastifyInstance.get?.('/', async (_request: unknown, reply: FastifyReply) => {
        if (typedController.getDashboard) {
          return typedController.getDashboard(reply);
        }
        return reply.code(500).send({ error: 'Dashboard handler not available' });
      });
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

async function registerHealthRoute(
  app: INestApplication,
  fastifyInstance: FastifyInstance,
  loggingService: LoggingService
): Promise<void> {
  try {
    const healthController = await app.resolve(HealthController);
    const typedHealthController = healthController as IHealthController | null;

    if (typedHealthController && typeof typedHealthController.getHealth === 'function') {
      fastifyInstance.get?.('/health', async (_request: unknown, reply: FastifyReply) => {
        if (typedHealthController.getHealth) {
          return typedHealthController.getHealth(reply);
        }
        return reply.code(500).send({ error: 'Health handler not available' });
      });
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

async function registerSocketTestRoute(
  app: INestApplication,
  fastifyInstance: FastifyInstance,
  loggingService: LoggingService
): Promise<void> {
  try {
    const appController = await app.resolve(AppController);
    const typedSocketController = appController as IAppController | null;

    if (typedSocketController && typeof typedSocketController.getSocketTestPage === 'function') {
      fastifyInstance.get?.('/socket-test', async (_request: unknown, reply: FastifyReply) => {
        if (typedSocketController.getSocketTestPage) {
          return typedSocketController.getSocketTestPage(reply);
        }
        return reply.code(500).send({ error: 'Socket test handler not available' });
      });
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
