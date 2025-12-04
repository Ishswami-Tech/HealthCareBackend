import { Injectable, Logger, INestApplication, Inject, forwardRef } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { DatabaseService } from '@infrastructure/database';
import type { RedisClient } from '@core/types/common.types';
import { IoAdapter } from '@nestjs/platform-socket.io';

/**
 * Graceful Shutdown Service
 *
 * Handles graceful shutdown of the application including:
 * - WebSocket connections
 * - Database connections
 * - Redis connections
 * - Application cleanup
 *
 * @class GracefulShutdownService
 * @description Enterprise-grade graceful shutdown for healthcare applications
 */
@Injectable()
export class GracefulShutdownService {
  private readonly logger = new Logger(GracefulShutdownService.name);

  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Setup graceful shutdown handlers
   *
   * @param app - NestJS application instance
   * @param customWebSocketAdapter - WebSocket adapter instance
   * @param pubClient - Redis pub client
   * @param subClient - Redis sub client
   *
   * @example
   * ```typescript
   * gracefulShutdownService.setupShutdownHandlers(
   *   app,
   *   customWebSocketAdapter,
   *   pubClient,
   *   subClient
   * );
   * ```
   */
  setupShutdownHandlers(
    app: INestApplication,
    customWebSocketAdapter: IoAdapter | null,
    pubClient: RedisClient | null,
    subClient: RedisClient | null
  ): void {
    const signals = ['SIGTERM', 'SIGINT'];

    signals.forEach(signal => {
      process.on(signal, () => {
        void this.handleShutdown(signal, app, customWebSocketAdapter, pubClient, subClient);
      });
    });
  }

  /**
   * Handle graceful shutdown
   */
  private async handleShutdown(
    signal: string,
    app: INestApplication,
    customWebSocketAdapter: IoAdapter | null,
    pubClient: RedisClient | null,
    subClient: RedisClient | null
  ): Promise<void> {
    this.logger.log(`Received ${signal}, starting graceful shutdown...`);

    const shutdownTimeout = setTimeout(() => {
      this.logger.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, 10000);

    try {
      // Close WebSocket connections gracefully
      if (customWebSocketAdapter && app) {
        this.logger.log('Closing WebSocket connections...');
        try {
          const httpServer = app.getHttpServer() as {
            close: (callback?: (err?: Error) => void) => void;
          } | null;
          if (httpServer && typeof httpServer.close === 'function') {
            await new Promise<void>(resolve => {
              const timeout = setTimeout(() => {
                this.logger.warn('WebSocket server close timeout, continuing...');
                resolve();
              }, 3000);

              httpServer.close((err?: Error) => {
                clearTimeout(timeout);
                if (err) {
                  this.logger.warn('Error closing WebSocket server:', err);
                } else {
                  this.logger.log('WebSocket server closed successfully');
                }
                resolve();
              });
            });
          }
        } catch (wsError) {
          this.logger.warn('Error during WebSocket cleanup:', wsError);
        }
      }

      // Close database connections
      try {
        if (app) {
          const databaseService = await app.resolve(DatabaseService);
          if (databaseService) {
            this.logger.log('Closing database connections...');
            await databaseService.disconnect();
          }
        }
      } catch (databaseError) {
        this.logger.warn('Error closing database connections:', databaseError);
      }

      // Close Redis connections
      if (pubClient) {
        this.logger.log('Closing Redis pub connection...');
        await pubClient.quit();
      }
      if (subClient) {
        this.logger.log('Closing Redis sub connection...');
        await subClient.quit();
      }

      // Close the app
      if (app) {
        await app.close();
      }

      clearTimeout(shutdownTimeout);
      this.logger.log('Application shut down successfully');
      process.exit(0);
    } catch (error) {
      clearTimeout(shutdownTimeout);
      this.logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
}

/**
 * Process Error Handlers Service
 *
 * Handles uncaught exceptions and unhandled promise rejections
 * with proper logging and error reporting.
 *
 * @class ProcessErrorHandlersService
 * @description Enterprise-grade process error handling for healthcare applications
 */
@Injectable()
export class ProcessErrorHandlersService {
  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Setup process error handlers
   *
   * @example
   * ```typescript
   * processErrorHandlersService.setupErrorHandlers();
   * ```
   */
  setupErrorHandlers(): void {
    // Enhanced error handling for uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      void (async () => {
        try {
          if (this.loggingService) {
            await this.loggingService.log(
              LogType.ERROR,
              LogLevel.ERROR,
              `Uncaught Exception: ${error.message}`,
              'Process',
              { error: error.stack }
            ).catch(() => {
              // If logging fails, fall back to console
              console.error('Uncaught Exception:', error);
            });
          } else {
            console.error('Uncaught Exception (LoggingService not available):', error);
          }
        } catch (logError) {
          console.error('Failed to log uncaught exception:', logError);
          console.error('Original error:', error);
        }
        process.exit(1);
      })();
    });

    // Enhanced error handling for unhandled rejections
    process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
      void (async () => {
        try {
          if (this.loggingService) {
            await this.loggingService.log(
              LogType.ERROR,
              LogLevel.ERROR,
              'Unhandled Rejection',
              'Process',
              {
                reason: reason instanceof Error ? reason.stack : String(reason),
                promise: String(promise),
              }
            ).catch(() => {
              // If logging fails, fall back to console
              console.error('Unhandled Rejection:', reason);
            });
          } else {
            console.error('Unhandled Rejection (LoggingService not available):', reason);
          }
        } catch (logError) {
          console.error('Failed to log unhandled rejection:', logError);
          console.error('Original rejection:', reason);
        }
      })();
    });
  }
}
