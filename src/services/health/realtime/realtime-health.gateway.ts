import { nowIso } from '@utils/date-time.util';
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
import { getSocketCorsOrigin } from '@communication/channels/socket/socket-cors.util';
import {
  SocketAuthMiddleware,
  type AuthenticatedUser,
} from '@communication/channels/socket/socket-auth.middleware';
import { HEALTH_DETAIL_ROLES } from '@communication/channels/socket/socket-room-policy';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import type {
  AggregatedHealthStatus,
  RealtimeHealthStatusPayload,
} from '@core/types/realtime-health.types';

/** Key under `socket.data` holding the user authenticated by the namespace middleware. */
const HEALTH_USER_KEY = 'healthUser';

/** Socket.IO namespace middleware signature (kept local: socket.io does not export it). */
type NamespaceMiddleware = (socket: Socket, next: (err?: Error) => void) => void;

/** Detailed status (services, endpoints, system) is for SUPER_ADMIN / CLINIC_ADMIN only. */
export function canSeeDetailedHealth(role: string | undefined): boolean {
  return typeof role === 'string' && HEALTH_DETAIL_ROLES.has(role);
}

/** What every other authenticated user may get, on demand only: the overall status. */
export function toMinimalHealthStatus(
  overall: RealtimeHealthStatusPayload['o'],
  timestamp: string
): RealtimeHealthStatusPayload {
  return { t: timestamp, o: overall, s: {}, u: 0 };
}

interface SubscribePayload {
  room?: string;
}

interface SubscribeResponse {
  success: boolean;
  message?: string;
  status?: RealtimeHealthStatusPayload;
}

/**
 * Realtime Health Gateway
 * Provides real-time health status via Socket.IO
 *
 * Security:
 * - Authentication required (same JWT/session check as the main namespace). Anonymous clients
 *   are rejected and should use the public HTTP GET /health instead.
 * - SUPER_ADMIN / CLINIC_ADMIN join `health:all` and get the detailed status + periodic pushes.
 * - Any other authenticated user gets only the overall status, on demand (`health:subscribe`),
 *   and no pushes.
 * - CORS restricted to CORS_ORIGIN environment variable
 */
@Injectable()
@WebSocketGateway({
  namespace: '/health',
  cors: {
    origin: getSocketCorsOrigin(),
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
    private readonly loggingService?: LoggingService,
    @Optional()
    @Inject(forwardRef(() => SocketAuthMiddleware))
    private readonly socketAuth?: SocketAuthMiddleware
  ) {}

  /**
   * Namespace middleware: authenticate before the connection is accepted. The error messages
   * match what the web client already treats as auth errors ("jwt expired" triggers a token
   * refresh + reconnect; "Authentication required" for anonymous / invalid tokens).
   */
  private readonly authenticateHealthSocket: NamespaceMiddleware = (socket, next) => {
    if (!this.socketAuth) {
      next(new Error('Authentication required'));
      return;
    }
    this.socketAuth
      .validateConnection(socket)
      .then(user => {
        (socket.data as Record<string, unknown>)[HEALTH_USER_KEY] = user;
        next();
      })
      .catch((error: unknown) => {
        const expired =
          error instanceof HealthcareError && error.code === ErrorCode.AUTH_TOKEN_EXPIRED;
        next(new Error(expired ? 'jwt expired' : 'Authentication required'));
      });
  };

  private getHealthUser(client: Socket): AuthenticatedUser | undefined {
    const value = (client.data as Record<string, unknown> | undefined)?.[HEALTH_USER_KEY];
    return value && typeof value === 'object' ? (value as AuthenticatedUser) : undefined;
  }

  onModuleInit() {
    // Socket server will be initialized in afterInit
  }

  afterInit(server: Server): void {
    try {
      // CORS is configured via WebSocketGateway decorator using getSocketCorsOrigin()
      // This ensures health namespace respects CORS_ORIGIN environment variable
      // Same security model as the main app gateway and other WebSocket gateways

      // Namespaced gateway: NestJS may pass either the root Socket.IO server (has .of())
      // or the namespace instance (no .of()). Use whichever we receive.
      const healthNamespace =
        typeof (server as Server & { of?: unknown }).of === 'function'
          ? server.of('/health')
          : server;

      if (healthNamespace) {
        // System status is not public over sockets: authenticate every connection.
        healthNamespace.use(this.authenticateHealthSocket);
      }

      // Get CORS origins for logging
      const corsOrigins = getSocketCorsOrigin();
      const allowedOrigins = Array.isArray(corsOrigins)
        ? corsOrigins.join(', ')
        : corsOrigins === '*'
          ? 'all origins'
          : String(corsOrigins);

      safeLog(
        this.loggingService,
        LogType.SYSTEM,
        LogLevel.INFO,
        'Realtime Health Gateway initialized (authenticated; detail for admins only)',
        'RealtimeHealthGateway',
        {
          namespace: '/health',
          corsOrigins: allowedOrigins,
          authentication: 'jwt-or-session',
          detailRoles: Array.from(HEALTH_DETAIL_ROLES),
        }
      );

      // Set server in broadcaster (pass namespace so broadcaster can emit without calling .of again).
      // The broadcaster only emits to `health:all`, which only admins join.
      this.broadcaster.setSocketServer(healthNamespace as Server);
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

      // The namespace middleware authenticated the socket; refuse anything that slipped past it.
      const user = this.getHealthUser(client);
      if (!user) {
        client.disconnect(true);
        return;
      }

      // Non-admins get no pushes: they may ask for the overall status via health:subscribe.
      if (!canSeeDetailedHealth(user.role)) {
        safeLog(
          this.loggingService,
          LogType.SYSTEM,
          LogLevel.DEBUG,
          `Client connected to health gateway (summary only): ${clientId}`,
          'RealtimeHealthGateway',
          { clientId, role: user.role }
        );
        return;
      }

      // Admins: join health:all (periodic pushes) and get the cached detailed status now.
      await client.join(this.ROOM_ALL);
      client.emit('health:status', await this.getStatusFor(user));

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
      const user = this.getHealthUser(client);
      if (!user) {
        return { success: false, message: 'Authentication required' };
      }

      // Only the push room is joinable, and only by admins (arbitrary room names were accepted
      // before, letting a client join any room of this namespace).
      if (canSeeDetailedHealth(user.role) && (!payload?.room || payload.room === this.ROOM_ALL)) {
        await client.join(this.ROOM_ALL);
      }

      return this.createSubscribeResponse(await this.getStatusFor(user));
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

  /** Cached status, detailed for admins and overall-only for everyone else. */
  private async getStatusFor(user: AuthenticatedUser): Promise<RealtimeHealthStatusPayload> {
    const cachedStatus: unknown = await this.cache.getCachedStatus();
    const validated = this.validateAndGetAggregatedHealthStatus(cachedStatus);
    if (!validated) {
      return toMinimalHealthStatus('healthy', nowIso());
    }
    if (!canSeeDetailedHealth(user.role)) {
      return toMinimalHealthStatus(validated.overall, validated.timestamp);
    }
    const endpointsKeys = Object.keys(validated.endpoints);
    const hasSystem = validated.system && typeof validated.system === 'object';
    return {
      t: validated.timestamp,
      o: validated.overall,
      s: validated.services,
      ...(endpointsKeys.length > 0 && { e: validated.endpoints }),
      ...(hasSystem && { sys: validated.system }),
      u: validated.uptime,
    };
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
