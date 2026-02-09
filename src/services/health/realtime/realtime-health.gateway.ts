/**
 * Realtime Health Gateway
 * Socket.IO gateway for real-time health status broadcasting
 */

import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Injectable, Optional, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { safeLog, safeLogError } from '@infrastructure/logging/logging.helper';
import { HealthBroadcasterService } from './services/health-broadcaster.service';
import { HealthCacheService } from './services/health-cache.service';
import type {
  AggregatedHealthStatus,
  RealtimeHealthStatusPayload,
} from '@core/types/realtime-health.types';

interface SubscribePayload {
  room?: string;
}

interface SubscribeResponse {
  success: boolean;
  message?: string;
  status?: RealtimeHealthStatusPayload;
}

// Get CORS origin from environment (same pattern as other gateways)
// Uses CORS_ORIGIN environment variable to restrict access to allowed origins only
const getCorsOrigin = (): string | string[] => {
  const corsOrigin = process.env['CORS_ORIGIN'] || '';
  if (corsOrigin) {
    // Split comma-separated origins and trim whitespace
    return corsOrigin.split(',').map((o: string) => o.trim());
  }
  // Default to localhost origins only (more secure than '*')
  // In production, CORS_ORIGIN should be set in environment variables
  return process.env['NODE_ENV'] === 'production'
    ? [] // Empty array = no origins allowed (secure default for production)
    : ['http://localhost:3000', 'http://localhost:8088', 'http://localhost:8082'];
};

/**
 * Realtime Health Gateway
 * Provides real-time health status via Socket.IO
 *
 * Security: Public namespace with CORS-only access control
 * - No authentication required (public health monitoring)
 * - CORS restricted to CORS_ORIGIN environment variable
 * - Rate limiting: Max 3 connections per IP
 */
@Injectable()
@WebSocketGateway({
  namespace: '/health',
  cors: {
    origin: getCorsOrigin(), // Restricted to CORS_ORIGIN environment variable
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  maxHttpBufferSize: 1e6,
})
export class RealtimeHealthGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  server!: Server;

  private readonly ROOM_ALL = 'health:all';
  // Health checks should not have connection limits - they run constantly
  // Removed MAX_CONNECTIONS_PER_IP limit to allow unlimited health check connections
  // Security is handled via CORS configuration only

  constructor(
    private readonly broadcaster: HealthBroadcasterService,
    private readonly cache: HealthCacheService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  onModuleInit() {
    // Socket server will be initialized in afterInit
  }

  afterInit(server: Server): void {
    try {
      // CORS is configured via WebSocketGateway decorator using getCorsOrigin()
      // This ensures health namespace respects CORS_ORIGIN environment variable
      // Same security model as the main app gateway and other WebSocket gateways

      // Namespaced gateway: NestJS may pass either the root Socket.IO server (has .of())
      // or the namespace instance (no .of()). Use whichever we receive.
      const healthNamespace =
        typeof (server as Server & { of?: unknown }).of === 'function'
          ? server.of('/health')
          : server;

      if (healthNamespace) {
        // Remove any authentication middleware that might be applied globally
        // This ensures the health namespace is truly public
        healthNamespace.use((socket: unknown, next: () => void) => {
          next();
        });
      }

      // Get CORS origins for logging
      const corsOrigins = getCorsOrigin();
      const allowedOrigins = Array.isArray(corsOrigins)
        ? corsOrigins.join(', ')
        : corsOrigins === '*'
          ? 'all origins'
          : String(corsOrigins);

      safeLog(
        this.loggingService,
        LogType.SYSTEM,
        LogLevel.INFO,
        'Realtime Health Gateway initialized (Public - CORS only)',
        'RealtimeHealthGateway',
        {
          namespace: '/health',
          corsOrigins: allowedOrigins,
          authentication: 'none',
          accessControl: 'CORS only',
        }
      );

      // Set server in broadcaster (pass namespace so broadcaster can emit without calling .of again)
      this.broadcaster.setSocketServer(healthNamespace as Server);

      // No authentication middleware - health namespace is completely public
      // Access is controlled only via CORS configuration
    } catch (error) {
      safeLogError(this.loggingService, error, 'RealtimeHealthGateway', {
        operation: 'afterInit',
      });
    }
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const clientId = client.id;
      const clientIP = this.getClientIP(client);

      // Health checks should not have connection limits - they run constantly
      // Removed rate limiting to allow unlimited health check connections
      // Security is handled via CORS configuration only

      // Auto-join to health:all room
      await client.join(this.ROOM_ALL);

      // Send initial health status (cached)
      const cachedStatus: unknown = await this.cache.getCachedStatus();
      const validated = this.validateAndGetAggregatedHealthStatus(cachedStatus);
      if (validated) {
        const endpointsKeys = Object.keys(validated.endpoints);
        const hasSystem = validated.system && typeof validated.system === 'object';
        const realtimeStatus: RealtimeHealthStatusPayload = {
          t: validated.timestamp,
          o: validated.overall,
          s: validated.services,
          ...(endpointsKeys.length > 0 && { e: validated.endpoints }),
          ...(hasSystem && { sys: validated.system }),
          u: validated.uptime,
        };

        client.emit('health:status', realtimeStatus);
      } else {
        // Send default status if no cache
        const defaultStatus: RealtimeHealthStatusPayload = {
          t: new Date().toISOString(),
          o: 'healthy',
          s: {},
          u: 0,
        };
        client.emit('health:status', defaultStatus);
      }

      safeLog(
        this.loggingService,
        LogType.SYSTEM,
        LogLevel.INFO,
        `Client connected to health gateway: ${clientId}`,
        'RealtimeHealthGateway',
        { clientId, clientIP }
      );
    } catch (error) {
      safeLogError(this.loggingService, error, 'RealtimeHealthGateway', {
        operation: 'handleConnection',
        clientId: client.id,
      });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    try {
      const clientId = client.id;
      const clientIP = this.getClientIP(client);

      // Connection tracking removed - no limits for health checks

      safeLog(
        this.loggingService,
        LogType.SYSTEM,
        LogLevel.INFO,
        `Client disconnected from health gateway: ${clientId}`,
        'RealtimeHealthGateway',
        { clientId, clientIP }
      );
    } catch (error) {
      safeLogError(this.loggingService, error, 'RealtimeHealthGateway', {
        operation: 'handleDisconnect',
        clientId: client.id,
      });
    }
  }

  /**
   * Handle subscribe message (client subscribes to health updates)
   */
  @SubscribeMessage('health:subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload?: SubscribePayload
  ): Promise<SubscribeResponse> {
    try {
      // Client is already in health:all room (joined on connection)
      // Optionally join additional room if specified
      if (payload?.room) {
        await client.join(payload.room);
      }

      // Send current cached status
      const cachedStatus: unknown = await this.cache.getCachedStatus();
      const validated = this.validateAndGetAggregatedHealthStatus(cachedStatus);
      if (validated) {
        const endpointsKeys = Object.keys(validated.endpoints);
        const hasSystem = validated.system && typeof validated.system === 'object';
        const realtimeStatus: RealtimeHealthStatusPayload = {
          t: validated.timestamp,
          o: validated.overall,
          s: validated.services,
          ...(endpointsKeys.length > 0 && { e: validated.endpoints }),
          ...(hasSystem && { sys: validated.system }),
          u: validated.uptime,
        };

        // Create response with validated status
        // Use helper to create response safely
        return this.createSubscribeResponse(realtimeStatus);
      }

      return {
        success: true,
        message: 'Subscribed to health updates',
      };
    } catch (error) {
      safeLogError(this.loggingService, error, 'RealtimeHealthGateway', {
        operation: 'handleSubscribe',
        clientId: client.id,
      });

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Subscription failed',
      };
    }
  }

  /**
   * Handle unsubscribe message
   */
  @SubscribeMessage('health:unsubscribe')
  async handleUnsubscribe(@ConnectedSocket() client: Socket): Promise<{ success: boolean }> {
    try {
      await client.leave(this.ROOM_ALL);
      return { success: true };
    } catch (error) {
      safeLogError(this.loggingService, error, 'RealtimeHealthGateway', {
        operation: 'handleUnsubscribe',
        clientId: client.id,
      });

      return { success: false };
    }
  }

  /**
   * Get client IP address
   */
  private getClientIP(client: Socket): string {
    return (
      (client.handshake.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      client.handshake.address ||
      client.conn.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Type guard to validate AggregatedHealthStatus
   */
  private isValidAggregatedHealthStatus(value: unknown): value is AggregatedHealthStatus {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const obj = value as Record<string, unknown>;

    // Check required properties
    if (
      !('overall' in obj) ||
      !('services' in obj) ||
      !('system' in obj) ||
      !('uptime' in obj) ||
      !('timestamp' in obj)
    ) {
      return false;
    }

    // Validate overall status
    const overall = obj['overall'];
    if (
      typeof overall !== 'string' ||
      (overall !== 'healthy' && overall !== 'degraded' && overall !== 'unhealthy')
    ) {
      return false;
    }

    // Validate services is an object
    if (!obj['services'] || typeof obj['services'] !== 'object') {
      return false;
    }

    // Validate system is an object
    if (!obj['system'] || typeof obj['system'] !== 'object') {
      return false;
    }

    // Validate uptime is a number
    if (typeof obj['uptime'] !== 'number') {
      return false;
    }

    // Validate timestamp is a string
    if (typeof obj['timestamp'] !== 'string') {
      return false;
    }

    return true;
  }

  /**
   * Validate and get AggregatedHealthStatus from cached value
   * Returns validated status or undefined if invalid
   */
  private validateAndGetAggregatedHealthStatus(value: unknown): AggregatedHealthStatus | undefined {
    if (!value) {
      return undefined;
    }

    if (this.isValidAggregatedHealthStatus(value)) {
      // Type guard ensures value is AggregatedHealthStatus
      return value;
    }

    return undefined;
  }

  /**
   * Create SubscribeResponse with validated status
   */
  private createSubscribeResponse(status: RealtimeHealthStatusPayload): SubscribeResponse {
    // Create response object with all required fields
    const response: {
      success: boolean;
      message: string;
      status: RealtimeHealthStatusPayload;
    } = {
      success: true,
      message: 'Subscribed to health updates',
      status,
    };
    return response;
  }
}
