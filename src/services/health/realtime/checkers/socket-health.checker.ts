/**
 * Socket.IO Health Checker
 * Checks Socket.IO server status
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { Server } from 'socket.io';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { RealtimeHealthCheckResult } from '@core/types';
import { SocketService } from '@communication/channels/socket/socket.service';

@Injectable()
export class SocketHealthChecker {
  private readonly TIMEOUT_MS = 2000; // 2 seconds

  constructor(
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService,
    @Optional()
    @Inject(forwardRef(() => SocketService))
    private readonly socketService?: SocketService
  ) {}

  /**
   * Check Socket.IO server health
   * Uses SocketService to get the main Socket.IO server instance
   * Falls back to passed server if SocketService is not available
   */
  async check(server?: Server): Promise<RealtimeHealthCheckResult> {
    const startTime = Date.now();

    // Add minimal async operation to satisfy require-await rule
    await Promise.resolve();

    // Try to get main Socket.IO server from SocketService first
    let mainServer: Server | undefined;
    if (this.socketService) {
      try {
        const isInitialized = this.socketService.getInitializationState();
        if (isInitialized) {
          mainServer = this.socketService.getServer();
        }
      } catch (_error) {
        // SocketService not initialized or error getting server
        // Fall back to passed server
        mainServer = server;
      }
    } else {
      // SocketService not available, use passed server
      mainServer = server;
    }

    if (!mainServer) {
      return {
        service: 'socket',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: 'Socket.IO server not available',
      };
    }

    try {
      // Lightweight check: Verify server is initialized and ready
      const isInitialized = mainServer !== null && mainServer !== undefined;
      const engine = mainServer.engine;
      const isEngineReady = engine !== null && engine !== undefined;

      // Additional check: Verify server engine has transports configured (indicates server is ready)
      // This is more robust than just checking engine existence
      const hasTransports =
        engine?.opts?.transports &&
        Array.isArray(engine.opts.transports) &&
        engine.opts.transports.length > 0;

      const responseTime = Date.now() - startTime;

      if (!isInitialized || !isEngineReady || !hasTransports) {
        return {
          service: 'socket',
          status: 'unhealthy',
          responseTime,
          error: 'Socket.IO server not properly initialized or not ready',
        };
      }

      return {
        service: 'socket',
        status: 'healthy',
        responseTime,
        details: {
          initialized: isInitialized,
          engineReady: isEngineReady,
          hasTransports: hasTransports,
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Socket health check failed: ${errorMessage}`,
        'SocketHealthChecker',
        { error: errorMessage, responseTime }
      );

      return {
        service: 'socket',
        status: 'unhealthy',
        responseTime,
        error: errorMessage,
      };
    }
  }
}
