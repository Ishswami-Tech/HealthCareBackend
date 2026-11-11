import { Injectable, Inject, Optional, forwardRef, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
// Type-only + alias token (like EventService): avoids SWC TDZ import cycles.
import type { CacheService } from '@infrastructure/cache/cache.service';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { randomUUID } from 'crypto';
import { SlowRetryScheduler } from '@utils/slow-retry-scheduler.util';
import {
  SOCKET_RELAY_CHANNEL,
  SOCKET_RELAY_PING_EVENT,
  parseSocketRelayMessage,
  type SocketEventData,
  type SocketRelayMessage,
} from '@communication/channels/socket/socket-relay.util';

const RELAY_SUBSCRIBE_MAX_ATTEMPTS = 30;
const RELAY_SUBSCRIBE_RETRY_MS = 2000;
const RELAY_SUBSCRIBE_RETRY_MAX_MS = 30000;
const RELAY_SEEN_IDS_MAX = 2000;
// Once the fast retry burst above is exhausted, don't give up forever: the cache client may
// simply not have reached "ready" within that ~11-12 minute bootstrap window (it's a one-shot
// sequence with nothing else re-arming it). Settle into a slow, indefinite retry instead, same
// self-heal pattern already used for the client-side websocket reconnection in the frontends.
const RELAY_SLOW_RETRY_MS = 60000;

export {
  SOCKET_RELAY_CHANNEL,
  parseSocketRelayMessage,
  type SocketEventData,
  type SocketEventPrimitive,
  type SocketRelayMessage,
} from '@communication/channels/socket/socket-relay.util';

/**
 * Socket service for managing WebSocket connections and broadcasting
 *
 * @class SocketService
 */
@Injectable()
export class SocketService implements OnModuleDestroy {
  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Optional()
    @Inject('CACHE_SERVICE')
    private readonly cacheService?: CacheService
  ) {}
  private server!: Server;
  private isServerInitialized = false;
  private relayConfirmed = false;
  private pendingRelayPingId: string | null = null;
  private readonly seenRelayIds = new Set<string>();
  private readonly relaySlowRetry = new SlowRetryScheduler(
    RELAY_SLOW_RETRY_MS,
    () => this.attemptRelaySubscribe(0),
    () => this.relayConfirmed
  );
  private healthCheckInterval!: NodeJS.Timeout;
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

  /**
   * Sets the Socket.IO server instance
   * @param server - Socket.IO server instance
   */
  setServer(server: Server): void {
    try {
      if (!server) {
        throw new HealthcareError(
          ErrorCode.SERVICE_UNAVAILABLE,
          'Cannot initialize SocketService with null server',
          undefined,
          {},
          'SocketService.setServer'
        );
      }

      this.server = server;
      this.isServerInitialized = true;

      // Add error handlers
      this.server.on('error', (error: Error) => {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          `Socket.IO server error: ${error?.message ?? 'Unknown error'}`,
          'SocketService',
          { stack: error?.stack }
        );
        this.handleServerError();
      });

      this.server.on('connection_error', (error: Error) => {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          `Socket.IO connection error: ${error?.message ?? 'Unknown error'}`,
          'SocketService',
          { stack: error?.stack }
        );
        this.handleConnectionError();
      });

      // Start health check
      this.startHealthCheck();
      void this.subscribeToRelay();
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'SocketService initialized successfully',
        'SocketService'
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to initialize SocketService: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SocketService',
        { stack: (error as Error)?.stack }
      );
      this.isServerInitialized = false;
      throw error;
    }
  }

  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.checkServerHealth().catch(error => {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'SocketService',
          { stack: (error as Error)?.stack }
        );
      });
    }, this.HEALTH_CHECK_INTERVAL);
  }

  private async checkServerHealth(): Promise<boolean> {
    try {
      if (!this.server || !this.isServerInitialized) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Server health check failed: Server not initialized',
          'SocketService'
        );
        return false;
      }

      // Check if server is responding
      const connectedClients = await this.server.allSockets();
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `Server health check: ${connectedClients.size} clients connected`,
        'SocketService'
      );
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Server health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SocketService',
        { stack: (error as Error)?.stack }
      );
      return false;
    }
  }

  private handleServerError() {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.ERROR,
      'Server error occurred, attempting recovery...',
      'SocketService'
    );
    // Implement recovery logic here
    // For example, try to reinitialize the server or notify administrators
  }

  private handleConnectionError() {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.ERROR,
      'Connection error occurred, attempting recovery...',
      'SocketService'
    );
    // Implement recovery logic here
    // For example, try to reconnect or notify administrators
  }

  /**
   * Gets the initialization state of the socket service
   * @returns True if the service is initialized
   */
  getInitializationState(): boolean {
    return this.isServerInitialized;
  }

  private ensureInitialized(): void {
    if (!this.isServerInitialized || !this.server) {
      throw new HealthcareError(
        ErrorCode.SERVICE_UNAVAILABLE,
        'SocketService is not initialized',
        undefined,
        {},
        'SocketService.ensureInitialized'
      );
    }
  }

  /**
   * Send an event to a specific room
   * @param room - Room name
   * @param event - Event name
   * @param data - Event data
   */
  sendToRoom(room: string, event: string, data: SocketEventData): void {
    if (!room || !event) {
      throw new HealthcareError(
        ErrorCode.VALIDATION_REQUIRED_FIELD,
        'Room and event must be provided',
        undefined,
        { room, event },
        'SocketService.sendToRoom'
      );
    }
    this.sendToRooms([room], event, data);
  }

  /**
   * Send one event to the UNION of rooms in a single emit, so a socket that is in several of
   * them (staff in `clinic:x` and `user:y`) receives it once.
   *
   * A process without a Socket.IO server (the worker) relays the emit over pub/sub to the API
   * processes instead of throwing, so worker-originated events still reach clients.
   */
  sendToRooms(rooms: readonly string[], event: string, data: SocketEventData): void {
    const targets = Array.from(new Set(rooms.filter(room => typeof room === 'string' && room)));
    if (targets.length === 0 || !event) {
      return;
    }

    if (!this.isServerInitialized || !this.server) {
      this.relay({ rooms: targets, event, data });
      return;
    }

    try {
      this.server.to(targets).emit(event, data);
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `Event ${event} sent to ${targets.length} room(s)`,
        'SocketService',
        { rooms: targets, event }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Error sending event to rooms: ${errorMessage}`,
        'SocketService',
        { stack: (error as Error)?.stack, rooms: targets, event }
      );
      throw error; // Re-throw to let the caller handle it
    }
  }

  /** Publish an emit for the API processes (used where no Socket.IO server exists). */
  private relay(message: SocketRelayMessage): void {
    if (!this.cacheService) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Socket server and relay unavailable, dropped ${message.event}`,
        'SocketService',
        { event: message.event }
      );
      return;
    }
    const withId: SocketRelayMessage = { ...message, id: message.id ?? randomUUID() };
    this.cacheService.publish(SOCKET_RELAY_CHANNEL, JSON.stringify(withId)).catch(error => {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Failed to relay socket event ${message.event}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SocketService',
        { event: message.event }
      );
    });
  }

  /**
   * API side of the relay. Every API process receives each message, so each emits to its LOCAL
   * sockets only (`server.local`); emitting through the cluster adapter would duplicate it.
   *
   * The cache client's subscribe() silently does nothing while its connection is not ready yet
   * (setServer runs early in bootstrap), so the subscription is confirmed with a self-addressed
   * ping and retried until the ping round-trips. Messages carry ids and are deduped, so a retry
   * that leaves a second subscriber cannot double-deliver.
   */
  private async subscribeToRelay(attempt = 1): Promise<void> {
    if (this.relayConfirmed || !this.cacheService) {
      return;
    }
    await this.attemptRelaySubscribe(attempt);

    const retry = setTimeout(
      () => {
        if (this.relayConfirmed) return;
        if (attempt >= RELAY_SUBSCRIBE_MAX_ATTEMPTS) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.ERROR,
            'Socket relay not confirmed after fast retries: worker-originated socket events will not reach clients until it self-heals',
            'SocketService',
            { attempts: attempt }
          );
          this.relaySlowRetry.start();
          return;
        }
        void this.subscribeToRelay(attempt + 1);
      },
      Math.min(RELAY_SUBSCRIBE_RETRY_MS * attempt, RELAY_SUBSCRIBE_RETRY_MAX_MS)
    );
    retry.unref?.();
  }

  /** The actual subscribe-then-self-ping attempt, with no retry scheduling of its own. */
  private async attemptRelaySubscribe(attempt: number): Promise<void> {
    try {
      await this.cacheService?.subscribe(SOCKET_RELAY_CHANNEL, raw => {
        this.deliverRelayedMessage(raw);
      });
      const pingId = randomUUID();
      this.pendingRelayPingId = pingId;
      await this.cacheService?.publish(
        SOCKET_RELAY_CHANNEL,
        JSON.stringify({ id: pingId, rooms: null, event: SOCKET_RELAY_PING_EVENT, data: {} })
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Socket relay subscribe attempt ${attempt} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SocketService'
      );
    }
  }

  /** True the first time an id is seen; remembers a bounded window of ids. */
  private markRelayIdSeen(id: string | undefined): boolean {
    if (!id) return true;
    if (this.seenRelayIds.has(id)) return false;
    this.seenRelayIds.add(id);
    if (this.seenRelayIds.size > RELAY_SEEN_IDS_MAX) {
      const oldest = this.seenRelayIds.values().next().value;
      if (oldest !== undefined) this.seenRelayIds.delete(oldest);
    }
    return true;
  }

  private deliverRelayedMessage(raw: string): void {
    const message = parseSocketRelayMessage(raw);
    if (!message || !this.markRelayIdSeen(message.id)) {
      return;
    }
    if (message.event === SOCKET_RELAY_PING_EVENT) {
      if (message.id && message.id === this.pendingRelayPingId && !this.relayConfirmed) {
        this.relayConfirmed = true;
        this.relaySlowRetry.stop();
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Socket relay subscription confirmed',
          'SocketService'
        );
      }
      return;
    }
    if (!this.isServerInitialized || !this.server) {
      return;
    }
    try {
      if (message.rooms === null) {
        this.server.local.emit(message.event, message.data);
      } else {
        this.server.local.to(message.rooms).emit(message.event, message.data);
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Failed to deliver relayed socket event: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SocketService',
        { event: message.event }
      );
    }
  }

  /**
   * Send an event to a user
   * @param userId - User ID
   * @param event - Event name
   * @param data - Event data
   */
  sendToUser(userId: string, event: string, data: SocketEventData): void {
    try {
      if (!userId) {
        throw new HealthcareError(
          ErrorCode.VALIDATION_REQUIRED_FIELD,
          'User ID must be provided',
          undefined,
          { userId },
          'SocketService.sendToUser'
        );
      }
      this.sendToRoom(`user:${userId}`, event, data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Error sending event to user: ${errorMessage}`,
        'SocketService',
        { stack: (error as Error)?.stack, userId, event }
      );
      throw error;
    }
  }

  /**
   * Send an event to a specific resource
   * @param resourceType - Resource type (e.g., 'appointment', 'doctor')
   * @param resourceId - Resource ID
   * @param event - Event name
   * @param data - Event data
   */
  sendToResource(
    resourceType: string,
    resourceId: string,
    event: string,
    data: SocketEventData
  ): void {
    try {
      if (!resourceType || !resourceId) {
        throw new HealthcareError(
          ErrorCode.VALIDATION_REQUIRED_FIELD,
          'Resource type and ID must be provided',
          undefined,
          { resourceType, resourceId },
          'SocketService.sendToResource'
        );
      }
      this.sendToRoom(`${resourceType}:${resourceId}`, event, data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Error sending event to resource: ${errorMessage}`,
        'SocketService',
        { stack: (error as Error)?.stack, resourceType, resourceId, event }
      );
      throw error;
    }
  }

  /**
   * Send an event to a location
   * @param locationId - Location ID
   * @param event - Event name
   * @param data - Event data
   */
  sendToLocation(locationId: string, event: string, data: SocketEventData): void {
    try {
      if (!locationId) {
        throw new HealthcareError(
          ErrorCode.VALIDATION_REQUIRED_FIELD,
          'Location ID must be provided',
          undefined,
          { locationId },
          'SocketService.sendToLocation'
        );
      }
      this.sendToRoom(`location:${locationId}`, event, data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Error sending event to location: ${errorMessage}`,
        'SocketService',
        { stack: (error as Error)?.stack, locationId, event }
      );
      throw error;
    }
  }

  /**
   * Send an event to all connected clients
   * @param event - Event name
   * @param data - Event data
   */
  broadcast(event: string, data: SocketEventData): void {
    try {
      if (event && (!this.isServerInitialized || !this.server)) {
        this.relay({ rooms: null, event, data });
        return;
      }

      if (!event) {
        throw new HealthcareError(
          ErrorCode.VALIDATION_REQUIRED_FIELD,
          'Event name must be provided',
          undefined,
          { event },
          'SocketService.broadcast'
        );
      }

      this.server.emit(event, data);
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `Event ${event} broadcasted to all clients`,
        'SocketService',
        { event }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Error broadcasting event: ${errorMessage}`,
        'SocketService',
        { stack: (error as Error)?.stack, event }
      );
      throw error;
    }
  }

  /**
   * Get the underlying Socket.IO server instance
   * @returns The Socket.IO server instance
   */
  getServer(): Server {
    this.ensureInitialized();
    return this.server;
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.relaySlowRetry.stop();
    if (this.server) {
      this.server.close().catch(error => {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          `Error closing server: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'SocketService',
          { stack: (error as Error)?.stack }
        );
      });
    }
  }
}
