import { Module, DynamicModule, forwardRef } from '@nestjs/common';
import { BullBoardModule as BullBoardNestModule } from '@bull-board/nestjs';
import { FastifyAdapter } from '@bull-board/fastify';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
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
    const nodeEnv = process.env['NODE_ENV'] || 'development';
    const isDevelopment = nodeEnv === 'development';
    const enableBullBoardEnv = process.env['ENABLE_BULL_BOARD']?.trim().toLowerCase();
    const bullBoardEnabled =
      enableBullBoardEnv !== undefined
        ? ['true', '1', 'yes', 'on'].includes(enableBullBoardEnv)
        : isDevelopment;

    if (!cacheEnabled || !bullBoardEnabled) {
      // Return minimal module without queue registrations when cache is disabled
      // or Bull Board is intentionally turned off for the current environment.
      return {
        module: BullBoardModule,
        imports: [forwardRef(() => LoggingModule)],
        providers: [BullBoardService],
        exports: [BullBoardService],
      };
    }

    // Full module with queue registrations when cache is enabled
    return {
      module: BullBoardModule,
      providers: [BullBoardService],
      exports: [BullBoardService],
      imports: [
        forwardRef(() => LoggingModule),
        BullBoardNestModule.forRootAsync({
          useFactory: () => ({
            route: '/queue-dashboard',
            adapter: FastifyAdapter,
            boardOptions: {
              uiConfig: {
                boardTitle: 'Healthcare Queue Dashboard',
              },
            },
          }),
        }),
        BullBoardNestModule.forFeature({
          name: HEALTHCARE_QUEUE,
          adapter: BullMQAdapter,
        }),
      ],
    };
  }
}

// IMPORTANT: Secure Bull Board in production!
// Example: Use strong authentication and restrict by IP
// See: https://docs.nestjs.com/techniques/queues#monitoring-queues-with-bull-board
