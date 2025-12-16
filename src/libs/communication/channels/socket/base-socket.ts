import {
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WsResponse,
} from '@nestjs/websockets';
import { Inject, Optional, OnModuleInit, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SocketService, type SocketEventData } from '@communication/channels/socket/socket.service';
import {
  SocketAuthMiddleware,
  type AuthenticatedUser,
} from '@communication/channels/socket/socket-auth.middleware';
// Use direct imports to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { safeLog, safeLogError } from '@infrastructure/logging/logging.helper';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

interface ConnectionSuccessData {
  clientId: string;
  authenticated: boolean;
  user: { userId: string; role?: string } | null;
}

interface ErrorEventData {
  message: string;
}

type ConnectionEventData = ConnectionSuccessData | ErrorEventData;

interface RoomPayload {
  room: string;
}

interface RoomSuccessData {
  success: true;
  room: string;
}

interface RoomErrorData {
  success: false;
  error: string;
}

type RoomEventData = RoomSuccessData | RoomErrorData;

/**
 * BaseSocket - Base class for WebSocket gateways
 *
 * This is a concrete base class that provides common WebSocket functionality.
 * Concrete implementations like AppGateway should extend this and add @WebSocketGateway() decorator.
 *
 * Note: BaseSocket should NOT have @Injectable() decorator as it's not a provider itself.
 * Only concrete implementations like AppGateway should be @Injectable().
 */
export class BaseSocket
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleInit
{
  @WebSocketServer()
  protected server!: Server;

  protected readonly serviceName: string;
  protected readonly roomsByClient: Map<string, Set<string>> = new Map<string, Set<string>>();
  protected readonly clientsByRoom: Map<string, Set<string>> = new Map<string, Set<string>>();
  private readonly reconnectAttempts: Map<string, number> = new Map();
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_INTERVAL = 5000; // 5 seconds
  private readonly clientMetadata: Map<string, AuthenticatedUser> = new Map();
  private initializationAttempts = 0;
  private readonly MAX_INITIALIZATION_ATTEMPTS = 3;
  private isInitialized = false;

  constructor(
    protected readonly socketService: SocketService | undefined,
    protected readonly providedServiceName: string,
    protected readonly authMiddleware: SocketAuthMiddleware | undefined,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    protected readonly loggingService?: LoggingService
  ) {
    this.serviceName = providedServiceName || 'BaseSocket';
  }

  // OnModuleInit ensures LoggingService is available before WebSocket initialization
  onModuleInit() {
    // LoggingService is optional - if not available, we'll continue without logging
    // This handles cases where LoggingService might not be initialized yet due to circular dependencies
    if (this.loggingService) {
      this.isInitialized = true;
    } else {
      // LoggingService not available yet - will retry in afterInit
      this.isInitialized = false;
    }
  }

  async afterInit(server: Server): Promise<void> {
    // Ensure module initialization completed before proceeding
    // With forwardRef, LoggingService might not be available immediately
    if (!this.isInitialized || !this.loggingService) {
      // Wait a bit for onModuleInit to complete
      // This handles the case where WebSocket initialization happens before OnModuleInit
      await new Promise(resolve => setTimeout(resolve, 100));

      // If still not initialized after delay, log warning but continue
      if (!this.isInitialized || !this.loggingService) {
        console.warn('[BaseSocket] LoggingService not available, initializing without logging');
        // Continue initialization without logging
        this.server = server;
        if (this.socketService) {
          try {
            await this.initializeSocketService();
          } catch (err) {
            console.error('[BaseSocket] Socket service initialization failed:', err);
          }
        }
        return;
      }
    }

    try {
      safeLog(
        this.loggingService,
        LogType.SYSTEM,
        LogLevel.INFO,
        'Initializing WebSocket server...',
        this.serviceName
      );

      if (!server) {
        safeLog(
          this.loggingService,
          LogType.SYSTEM,
          LogLevel.ERROR,
          'WebSocket server instance not provided',
          this.serviceName
        );
        throw new HealthcareError(
          ErrorCode.SERVICE_UNAVAILABLE,
          'WebSocket server instance not provided',
          undefined,
          {},
          'BaseSocket.afterInit'
        );
      }

      this.server = server;

      // Configure Socket.IO server options
      if (this.server.engine?.opts) {
        this.server.engine.opts.pingTimeout = 60000;
        this.server.engine.opts.pingInterval = 25000;
        this.server.engine.opts.maxHttpBufferSize = 1e8;
        this.server.engine.opts.transports = ['websocket', 'polling'];
      }

      // Set up error handling for the server
      this.server.on('error', (error: Error) => {
        safeLogError(this.loggingService, error, this.serviceName, {
          event: 'server_error',
        });
      });

      this.server.on('connection_error', (error: Error) => {
        safeLogError(this.loggingService, error, this.serviceName, {
          event: 'connection_error',
        });
      });

      // Initialize SocketService if available
      if (this.socketService) {
        await this.initializeSocketService();
      } else {
        safeLog(
          this.loggingService,
          LogType.SYSTEM,
          LogLevel.WARN,
          'SocketService is not available, continuing with limited functionality',
          this.serviceName
        );
      }

      safeLog(
        this.loggingService,
        LogType.SYSTEM,
        LogLevel.INFO,
        'WebSocket server initialized successfully',
        this.serviceName
      );
    } catch (error: unknown) {
      safeLogError(this.loggingService, error, this.serviceName, {
        operation: 'afterInit',
      });
      throw error; // Re-throw to fail fast
    }
  }

  private async initializeSocketService(): Promise<void> {
    while (this.initializationAttempts < this.MAX_INITIALIZATION_ATTEMPTS) {
      try {
        if (!this.socketService) {
          throw new Error('SocketService is undefined');
        }
        if (!this.server) {
          throw new Error('WebSocket server is undefined');
        }
        // TypeScript guard: socketService is guaranteed to be defined here
        const socketService = this.socketService;
        // Check if setServer method exists before calling
        if (typeof socketService.setServer !== 'function') {
          throw new Error('SocketService.setServer method is not available');
        }
        socketService.setServer(this.server);
        safeLog(
          this.loggingService,
          LogType.SYSTEM,
          LogLevel.INFO,
          'SocketService initialized successfully',
          this.serviceName
        );
        return;
      } catch (error: unknown) {
        this.initializationAttempts++;
        safeLog(
          this.loggingService,
          LogType.SYSTEM,
          LogLevel.WARN,
          `Failed to initialize SocketService (attempt ${this.initializationAttempts}/${this.MAX_INITIALIZATION_ATTEMPTS}): ${error instanceof Error ? error.message : 'Unknown error'}`,
          this.serviceName
        );

        if (this.initializationAttempts < this.MAX_INITIALIZATION_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, 1000 * this.initializationAttempts));
        }
      }
    }

    safeLog(
      this.loggingService,
      LogType.SYSTEM,
      LogLevel.WARN,
      'Continuing with limited functionality after failed SocketService initialization attempts',
      this.serviceName
    );
  }

  async handleConnection(client: Socket): Promise<WsResponse<ConnectionEventData>> {
    try {
      if (!this.server) {
        safeLog(
          this.loggingService,
          LogType.SYSTEM,
          LogLevel.ERROR,
          'WebSocket server not initialized',
          this.serviceName
        );
        return { event: 'error', data: { message: 'Server not initialized' } };
      }

      const clientId = client.id;

      // Authenticate client if middleware is available
      let user: AuthenticatedUser | null = null;
      if (this.authMiddleware) {
        try {
          user = await this.authMiddleware.validateConnection(client);

          // Store user metadata
          this.clientMetadata.set(clientId, user);

          // Auto-join user to appropriate rooms
          await this.autoJoinRooms(client, user);

          safeLog(
            this.loggingService,
            LogType.SYSTEM,
            LogLevel.INFO,
            `Client ${clientId} authenticated and joined rooms (User: ${user.userId}, Role: ${user.role})`,
            this.serviceName
          );
        } catch (authError) {
          safeLogError(this.loggingService, authError, this.serviceName, {
            clientId,
            operation: 'authentication',
          });
          client.disconnect();
          return {
            event: 'error',
            data: { message: 'Authentication failed' },
          };
        }
      } else {
        safeLog(
          this.loggingService,
          LogType.SYSTEM,
          LogLevel.INFO,
          `Client connected (no auth): ${clientId}`,
          this.serviceName
        );
      }

      // Send connection confirmation
      if (this.socketService?.getInitializationState()) {
        this.socketService.sendToUser(clientId, 'connection_confirmed', {
          status: 'connected',
          authenticated: !!user,
          ...(user
            ? {
                user: {
                  userId: user.userId,
                  ...(user.role ? { role: user.role } : {}),
                },
              }
            : {}),
        });
      }

      return {
        event: 'connected',
        data: {
          clientId,
          authenticated: !!user,
          user: user
            ? {
                userId: user.userId,
                ...(user.role && { role: user.role }),
              }
            : null,
        },
      };
    } catch (error: unknown) {
      safeLogError(this.loggingService, error, this.serviceName, {
        operation: 'handleConnection',
      });
      return { event: 'error', data: { message: 'Connection error' } };
    }
  }

  /**
   * Automatically join user to appropriate rooms based on their data
   */
  protected async autoJoinRooms(client: Socket, user: AuthenticatedUser): Promise<void> {
    try {
      const rooms: string[] = [];

      // User-specific room
      if (user.userId) {
        await this.joinRoom(client, `user:${user.userId}`);
        rooms.push(`user:${user.userId}`);
      }

      // Clinic room
      if (user.clinicId) {
        await this.joinRoom(client, `clinic:${user.clinicId}`);
        rooms.push(`clinic:${user.clinicId}`);

        // Role-based room within clinic
        if (user.role) {
          const roleRoom = `clinic:${user.clinicId}:role:${user.role}`;
          await this.joinRoom(client, roleRoom);
          rooms.push(roleRoom);
        }
      }

      safeLog(
        this.loggingService,
        LogType.SYSTEM,
        LogLevel.INFO,
        `Client ${client.id} auto-joined ${rooms.length} rooms: ${rooms.join(', ')}`,
        this.serviceName
      );
    } catch (error: unknown) {
      safeLogError(this.loggingService, error, this.serviceName, {
        clientId: client.id,
        operation: 'autoJoinRooms',
      });
    }
  }

  handleDisconnect(client: Socket): void {
    try {
      const clientId = client.id;
      safeLog(
        this.loggingService,
        LogType.SYSTEM,
        LogLevel.INFO,
        `Client disconnected: ${clientId}`,
        this.serviceName
      );

      // Clean up client data
      this.roomsByClient.delete(clientId);
      this.clientMetadata.delete(clientId);
      this.reconnectAttempts.delete(clientId);

      // Remove client from all rooms
      for (const [roomId, clients] of Array.from(this.clientsByRoom.entries())) {
        if (clients.has(clientId)) {
          clients.delete(clientId);
          if (clients.size === 0) {
            this.clientsByRoom.delete(roomId);
          }
        }
      }
    } catch (error: unknown) {
      safeLogError(this.loggingService, error, this.serviceName, {
        operation: 'handleDisconnect',
      });
    }
  }

  private handleSocketError(client: Socket): void {
    try {
      const attempts = this.reconnectAttempts.get(client.id) || 0;
      if (attempts < this.MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
        this.reconnectAttempts.set(client.id, attempts + 1);

        setTimeout(() => {
          safeLog(
            this.loggingService,
            LogType.SYSTEM,
            LogLevel.INFO,
            `Attempting to reconnect client ${client.id} (attempt ${attempts + 1})`,
            this.serviceName
          );
          client.disconnect(true);
        }, delay);
      } else {
        safeLog(
          this.loggingService,
          LogType.SYSTEM,
          LogLevel.ERROR,
          `Max reconnection attempts reached for client ${client.id}`,
          this.serviceName
        );
        client.disconnect();
      }
    } catch (error: unknown) {
      safeLogError(this.loggingService, error, this.serviceName, {
        operation: 'handleSocketError',
      });
    }
  }

  private handleReconnection(client: Socket): void {
    try {
      const attempts = this.reconnectAttempts.get(client.id) || 0;
      if (attempts < this.MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts.set(client.id, attempts + 1);

        setTimeout(() => {
          safeLog(
            this.loggingService,
            LogType.SYSTEM,
            LogLevel.INFO,
            `Attempting to reconnect client ${client.id} (attempt ${attempts + 1})`,
            this.serviceName
          );
          client.disconnect(true);
        }, this.RECONNECT_INTERVAL);
      }
    } catch (error: unknown) {
      safeLogError(this.loggingService, error, this.serviceName, {
        operation: 'handleReconnection',
      });
    }
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: RoomPayload
  ): Promise<WsResponse<RoomEventData>> {
    try {
      const { room } = data;
      await this.joinRoom(client, room);
      return { event: 'joinRoom', data: { success: true, room } };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      safeLogError(this.loggingService, error, this.serviceName, {
        operation: 'handleJoinRoom',
      });
      return {
        event: 'joinRoom',
        data: { success: false, error: errorMessage },
      };
    }
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: RoomPayload
  ): Promise<WsResponse<RoomEventData>> {
    try {
      const { room } = data;
      await this.leaveRoom(client, room);
      return { event: 'leaveRoom', data: { success: true, room } };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      safeLogError(this.loggingService, error, this.serviceName, {
        operation: 'handleLeaveRoom',
      });
      return {
        event: 'leaveRoom',
        data: { success: false, error: errorMessage },
      };
    }
  }

  protected async joinRoom(client: Socket, room: string): Promise<{ success: boolean }> {
    try {
      // Add client to room
      await client.join(room);

      // Track room membership
      const clientRooms = this.roomsByClient.get(client.id) ?? new Set<string>();
      clientRooms.add(room);
      this.roomsByClient.set(client.id, clientRooms);

      // Track clients in room
      if (!this.clientsByRoom.has(room)) {
        this.clientsByRoom.set(room, new Set<string>());
      }
      this.clientsByRoom.get(room)?.add(client.id);

      safeLog(
        this.loggingService,
        LogType.SYSTEM,
        LogLevel.INFO,
        `Client ${client.id} joined room: ${room}`,
        this.serviceName
      );
      return { success: true };
    } catch (error: unknown) {
      safeLogError(this.loggingService, error, this.serviceName, {
        operation: 'joinRoom',
        room,
        clientId: client.id,
      });
      return { success: false };
    }
  }

  protected async leaveRoom(client: Socket, room: string): Promise<{ success: boolean }> {
    try {
      // Remove client from room
      await client.leave(room);

      // Update tracking
      const clientRooms = this.roomsByClient.get(client.id);
      if (clientRooms) {
        clientRooms.delete(room);
      }

      const roomClients = this.clientsByRoom.get(room);
      if (roomClients) {
        roomClients.delete(client.id);
        if (roomClients.size === 0) {
          this.clientsByRoom.delete(room);
        }
      }

      safeLog(
        this.loggingService,
        LogType.SYSTEM,
        LogLevel.INFO,
        `Client ${client.id} left room: ${room}`,
        this.serviceName
      );
      return { success: true };
    } catch (error: unknown) {
      safeLogError(this.loggingService, error, this.serviceName, {
        operation: 'leaveRoom',
        room,
        clientId: client.id,
      });
      return { success: false };
    }
  }

  protected async leaveAllRooms(client: Socket): Promise<void> {
    try {
      const clientRooms = this.roomsByClient.get(client.id);
      if (!clientRooms) return;

      // Copy the rooms to avoid modification during iteration
      const rooms = Array.from(clientRooms);

      // Leave each room
      for (const room of rooms) {
        await this.leaveRoom(client, room);
      }
    } catch (error: unknown) {
      safeLogError(this.loggingService, error, this.serviceName, {
        operation: 'leaveAllRooms',
        clientId: client.id,
      });
    }
  }

  protected getRoomSize(room: string): number {
    return this.clientsByRoom.get(room)?.size || 0;
  }

  protected getClientMetadata(clientId: string): AuthenticatedUser | undefined {
    return this.clientMetadata.get(clientId);
  }

  protected broadcastToRoom(room: string, event: string, data: SocketEventData): void {
    try {
      this.server.to(room).emit(event, data);
      safeLog(
        this.loggingService,
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `Broadcasted ${event} to room ${room}`,
        this.serviceName,
        { room, event }
      );
    } catch (error: unknown) {
      safeLogError(this.loggingService, error, this.serviceName, {
        operation: 'broadcastToRoom',
        room,
        event,
      });
    }
  }

  protected sendToUser(clientId: string, event: string, data: SocketEventData): void {
    try {
      const socket = this.server.sockets.sockets.get(clientId);
      if (socket) {
        socket.emit(event, data);
        safeLog(
          this.loggingService,
          LogType.SYSTEM,
          LogLevel.DEBUG,
          `Sent ${event} to client ${clientId}`,
          this.serviceName,
          { clientId, event }
        );
      } else {
        safeLog(
          this.loggingService,
          LogType.SYSTEM,
          LogLevel.WARN,
          `Client ${clientId} not found for sending ${event}`,
          this.serviceName
        );
      }
    } catch (error: unknown) {
      safeLogError(this.loggingService, error, this.serviceName, {
        operation: 'sendToUser',
        clientId,
        event,
      });
    }
  }
}
