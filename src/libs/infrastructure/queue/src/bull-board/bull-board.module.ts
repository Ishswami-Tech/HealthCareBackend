import {
  Module,
  MiddlewareConsumer,
  RequestMethod,
  DynamicModule,
  forwardRef,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { BullBoardModule as BullBoardNestModule } from '@bull-board/nestjs';
import { FastifyAdapter } from '@bull-board/fastify';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ConfigModule } from '@config/config.module';
import { ConfigService } from '@config/config.service';
import { isCacheEnabled } from '@config/cache.config';
import { LoggingModule } from '@infrastructure/logging';
import { BullBoardService } from './bull-board.service';
import { HEALTHCARE_QUEUE } from '@queue/src/queue.constants';

/**
 * Bull Board Module for Queue Monitoring
 *
 * Provides a web-based dashboard for monitoring and managing BullMQ queues.
 * Includes authentication, middleware configuration, and integration with all
 * healthcare system queues.
 *
 * @module BullBoardModule
 * @description Enterprise-grade queue monitoring with security and performance features
 * @example
 * ```typescript
 * // Import in your app module
 * import { BullBoardModule } from './queue/bull-board/bull-board.module';
 *
 * @Module({
 *   imports: [BullBoardModule.forRoot()],
 * })
 * export class AppModule {}
 * ```
 */

@Module({})
export class BullBoardModule {
  /**
   * Dynamic module factory - only registers queues if cache is enabled
   * BullMQ requires Redis/Dragonfly to function
   */
  static forRoot(): DynamicModule {
    const cacheEnabled = isCacheEnabled();

    if (!cacheEnabled) {
      // Return minimal module without queue registrations when cache is disabled
      return {
        module: BullBoardModule,
        imports: [forwardRef(() => LoggingModule)],
        providers: [BullBoardService],
        exports: [BullBoardService],
      };
    }

    const nodeEnv = process.env['NODE_ENV'] || 'development';
    const queueDashboardUser = process.env['QUEUE_DASHBOARD_USER']?.trim();
    const queueDashboardPassword = process.env['QUEUE_DASHBOARD_PASSWORD']?.trim();
    const isDevelopment = nodeEnv === 'development';

    if ((!queueDashboardUser || !queueDashboardPassword) && !isDevelopment) {
      throw new Error(
        'QUEUE_DASHBOARD_USER and QUEUE_DASHBOARD_PASSWORD must be set when Bull Board is enabled'
      );
    }

    const resolvedDashboardUser = queueDashboardUser || 'local-dashboard';
    const resolvedDashboardPassword =
      queueDashboardPassword || randomBytes(24).toString('base64url');

    // Full module with queue registrations when cache is enabled
    return {
      module: BullBoardModule,
      providers: [BullBoardService],
      exports: [BullBoardService],
      imports: [
        forwardRef(() => LoggingModule),
        BullBoardNestModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: (config: ConfigService) => ({
            route: '/queue-dashboard',
            adapter: FastifyAdapter,
            auth: {
              user: config.get<string>('QUEUE_DASHBOARD_USER', resolvedDashboardUser),
              password: config.get<string>('QUEUE_DASHBOARD_PASSWORD', resolvedDashboardPassword),
            },
            basePath: '/queue-dashboard',
            middleware: (req: unknown, _res: unknown, next: unknown) => {
              // Only handle queue-dashboard routes
              const request = req as { url: string };
              const nextFn = next as (value?: string) => void;
              if (request.url.startsWith('/queue-dashboard')) {
                nextFn();
              } else {
                // Pass through for non-queue routes
                nextFn('route');
              }
            },
          }),
          inject: [ConfigService],
        }),
        BullBoardNestModule.forFeature({
          name: HEALTHCARE_QUEUE,
          adapter: BullMQAdapter,
        }),
      ],
    };
  }
  /**
   * Configure middleware for Bull Board routes
   *
   * @param consumer - Middleware consumer for route configuration
   * @description Applies Bull Board middleware only to queue-dashboard routes for security
   */
  configure(consumer: MiddlewareConsumer): void {
    // Only apply Bull Board middleware to queue-dashboard routes
    consumer
      .apply()
      .forRoutes(
        { path: 'queue-dashboard', method: RequestMethod.ALL },
        { path: 'queue-dashboard/*', method: RequestMethod.ALL }
      );
  }
}

// IMPORTANT: Secure Bull Board in production!
// Example: Use strong authentication and restrict by IP
// See: https://docs.nestjs.com/techniques/queues#monitoring-queues-with-bull-board
