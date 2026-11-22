import { Injectable, Logger, INestApplication, Inject, forwardRef } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { DatabaseService } from '@infrastructure/database/database.service';
import type { RedisClient } from '@core/types/common.types';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createFrameworkAdapter } from '@infrastructure/framework/adapters/fastify.adapter';
import { describeProcessWarning } from '@core/resilience/process-warning.util';

/** Whole API shutdown budget; Temps SIGKILLs a container 10 s after SIGTERM. */
export const SHUTDOWN_TIMEOUT_MS = 9_000;
/** How long running HTTP requests may take to finish after SIGTERM. */
export const IN_FLIGHT_WAIT_MS = 6_000;
/** How often connections that went idle during the drain are closed. */
const IDLE_SWEEP_MS = 100;

/** The parts of Node's http.Server the drain uses (closeIdle/All exist since Node 18.2). */
export interface ClosableHttpServer {
  close: (callback?: (err?: Error) => void) => void;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

/**
 * Stops accepting connections, closes idle keep-alive connections at once, and waits up to
 * `waitMs` for the requests still running to finish; whatever is left open then is closed.
 */
export async function drainHttpServer(
  server: ClosableHttpServer,
  waitMs: number,
  log: (message: string) => void = () => undefined
): Promise<'drained' | 'timed-out'> {
  const outcome = await new Promise<'drained' | 'timed-out'>(resolve => {
    // A keep-alive connection whose request finishes after close() stays open (idle) and would
    // hold close() until the wait is over: keep closing connections as they go idle.
    const idleSweep = setInterval(() => server.closeIdleConnections?.(), IDLE_SWEEP_MS);
    const timer = setTimeout(() => {
      clearInterval(idleSweep);
      resolve('timed-out');
    }, waitMs);
    server.close(() => {
      clearTimeout(timer);
      clearInterval(idleSweep);
      resolve('drained');
    });
    server.closeIdleConnections?.();
  });
  if (outcome === 'timed-out') {
    log(`Requests still running after ${waitMs}ms; closing their connections`);
    server.closeAllConnections?.();
  } else {
    log('HTTP server drained');
  }
  return outcome;
}

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
   * Handle graceful shutdown: the ONE SIGTERM/SIGINT path of the API (main.ts turns Nest's own
   * shutdown hooks off when this service is available, so they no longer tear the database and
   * cache down at the same moment while requests are still running).
   *
   * Temps stops a container with a 10 s grace before SIGKILL, so everything below fits in
   * SHUTDOWN_TIMEOUT_MS:
   *   1. stop accepting connections, close idle keep-alive ones (the proxy holds them open for
   *      up to 65 s), and wait up to IN_FLIGHT_WAIT_MS for running requests to finish;
   *   2. close what is still open, then database, Redis pub/sub and the Nest app.
   */
  private shuttingDown = false;

  private async handleShutdown(
    signal: string,
    app: INestApplication,
    customWebSocketAdapter: IoAdapter | null,
    pubClient: RedisClient | null,
    subClient: RedisClient | null
  ): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.logger.log(`Received ${signal}, starting graceful shutdown...`);

    const shutdownTimeout = setTimeout(() => {
      this.logger.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      if (app) {
        try {
          // Use framework adapter to get HTTP server (framework-agnostic approach)
          const frameworkAdapter = createFrameworkAdapter();
          const httpServer = frameworkAdapter.getHttpServer(app) as ClosableHttpServer | null;
          if (httpServer && typeof httpServer.close === 'function') {
            await drainHttpServer(httpServer, IN_FLIGHT_WAIT_MS, message =>
              this.logger.log(message)
            );
          }
        } catch (httpError) {
          this.logger.warn('Error while draining the HTTP server:', httpError);
        }
      }
      if (customWebSocketAdapter) {
        this.logger.log('HTTP server and WebSocket connections closed');
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
            await this.loggingService
              .log(
                LogType.ERROR,
                LogLevel.ERROR,
                `Uncaught Exception: ${error.message}`,
                'Process',
                { error: error.stack }
              )
              .catch(() => {
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

    // Node prints warnings without a stack or request; log both so their source can be found.
    process.on('warning', (warning: Error) => {
      try {
        const { message, metadata } = describeProcessWarning(warning);
        void this.loggingService
          ?.log(LogType.SYSTEM, LogLevel.WARN, message, 'Process', metadata)
          .catch(() => undefined);
      } catch {
        // Never let warning logging itself fail the process.
      }
    });

    // Enhanced error handling for unhandled rejections
    process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
      void (async () => {
        try {
          if (this.loggingService) {
            await this.loggingService
              .log(LogType.ERROR, LogLevel.ERROR, 'Unhandled Rejection', 'Process', {
                reason: reason instanceof Error ? reason.stack : String(reason),
                // Promise object cannot be meaningfully stringified, so we just note its presence
                hasPromise: true,
              })
              .catch(() => {
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
