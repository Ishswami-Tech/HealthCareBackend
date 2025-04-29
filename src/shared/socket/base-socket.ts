import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WsResponse,
} from '@nestjs/websockets';
import { Logger, Injectable, Inject, Optional } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SocketService } from './socket.service';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 60000,
})
export class BaseSocket implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  protected server: Server;

  protected logger: Logger;
  protected readonly roomsByClient: Map<string, Set<string>> = new Map();
  protected readonly clientsByRoom: Map<string, Set<string>> = new Map();
  private readonly reconnectAttempts: Map<string, number> = new Map();
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_INTERVAL = 5000; // 5 seconds
  private readonly clientMetadata: Map<string, Record<string, any>> = new Map();
  private initializationAttempts = 0;
  private readonly MAX_INITIALIZATION_ATTEMPTS = 3;

  constructor(
    @Inject('SOCKET_SERVICE') @Optional() protected readonly socketService: SocketService,
    protected readonly serviceName: string,
  ) {
    this.logger = new Logger(serviceName || 'BaseSocket');
  }

  async afterInit(server: Server): Promise<void> {
    try {
      this.logger.log('Initializing WebSocket server...');
      
      if (!server) {
        this.logger.error('WebSocket server instance not provided');
        throw new Error('WebSocket server instance not provided');
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
        const errorMessage = error?.message || 'Unknown error';
        const errorStack = error?.stack || '';
        this.logger.error(`Socket.IO server error: ${errorMessage}`, errorStack);
      });

      this.server.on('connection_error', (error: Error) => {
        const errorMessage = error?.message || 'Unknown error';
        const errorStack = error?.stack || '';
        this.logger.error(`Socket.IO connection error: ${errorMessage}`, errorStack);
      });

      // Initialize SocketService if available
      if (this.socketService) {
        await this.initializeSocketService();
      } else {
        this.logger.warn('SocketService is not available, continuing with limited functionality');
      }

      this.logger.log('WebSocket server initialized successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error?.stack || '';
      this.logger.error(`Failed to initialize WebSocket server: ${errorMessage}`, errorStack);
      this.logger.warn('Continuing with limited functionality due to initialization failure');
    }
  }

  private async initializeSocketService(): Promise<void> {
    while (this.initializationAttempts < this.MAX_INITIALIZATION_ATTEMPTS) {
      try {
        await this.socketService.setServer(this.server);
        this.logger.log('SocketService initialized successfully');
        return;
      } catch (error) {
        this.initializationAttempts++;
        this.logger.warn(
          `Failed to initialize SocketService (attempt ${this.initializationAttempts}/${this.MAX_INITIALIZATION_ATTEMPTS}):`,
          error instanceof Error ? error.message : 'Unknown error'
        );
        
        if (this.initializationAttempts < this.MAX_INITIALIZATION_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, 1000 * this.initializationAttempts));
        }
      }
    }
    
    this.logger.warn('Continuing with limited functionality after failed SocketService initialization attempts');
  }

  async handleConnection(client: Socket): Promise<WsResponse<any>> {
    try {
      if (!this.server) {
        this.logger.error('WebSocket server not initialized');
        return { event: 'error', data: { message: 'Server not initialized' } };
      }

      const clientId = client.id;
      this.logger.log(`Client connected: ${clientId}`);

      // Send connection confirmation
      if (this.socketService?.getInitializationState()) {
        await this.socketService.sendToUser(clientId, 'connection_confirmed', { status: 'connected' });
      }

      return { event: 'connected', data: { clientId } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error handling connection: ${errorMessage}`);
      return { event: 'error', data: { message: 'Connection error' } };
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    try {
      const clientId = client.id;
      this.logger.log(`Client disconnected: ${clientId}`);

      // Clean up client data
      this.roomsByClient.delete(clientId);
      this.clientMetadata.delete(clientId);
      this.reconnectAttempts.delete(clientId);

      // Remove client from all rooms
      for (const [roomId, clients] of this.clientsByRoom.entries()) {
        if (clients.has(clientId)) {
          clients.delete(clientId);
          if (clients.size === 0) {
            this.clientsByRoom.delete(roomId);
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error handling disconnection: ${errorMessage}`);
    }
  }

  private handleSocketError(client: Socket, error: Error): void {
    try {
      const attempts = this.reconnectAttempts.get(client.id) || 0;
      if (attempts < this.MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
        this.reconnectAttempts.set(client.id, attempts + 1);
        
        setTimeout(() => {
          this.logger.log(`Attempting to reconnect client ${client.id} (attempt ${attempts + 1})`);
          client.disconnect(true);
        }, delay);
      } else {
        this.logger.error(`Max reconnection attempts reached for client ${client.id}`);
        client.disconnect();
      }
    } catch (error) {
      const errorMessage = error?.message || 'Unknown error';
      this.logger.error(`Error in handleSocketError: ${errorMessage}`);
    }
  }

  private handleReconnection(client: Socket): void {
    try {
      const attempts = this.reconnectAttempts.get(client.id) || 0;
      if (attempts < this.MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts.set(client.id, attempts + 1);
        
        setTimeout(() => {
          this.logger.log(`Attempting to reconnect client ${client.id} (attempt ${attempts + 1})`);
          client.disconnect(true);
        }, this.RECONNECT_INTERVAL);
      }
    } catch (error) {
      const errorMessage = error?.message || 'Unknown error';
      this.logger.error(`Error in handleReconnection: ${errorMessage}`);
    }
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { room: string },
  ): Promise<WsResponse<any>> {
    try {
      const { room } = data;
      await this.joinRoom(client, room);
      return { event: 'joinRoom', data: { success: true, room } };
    } catch (error) {
      const errorMessage = error?.message || 'Unknown error';
      const errorStack = error?.stack || '';
      this.logger.error(`Error joining room: ${errorMessage}`, errorStack);
      return { event: 'joinRoom', data: { success: false, error: errorMessage } };
    }
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { room: string },
  ): Promise<WsResponse<any>> {
    try {
      const { room } = data;
      await this.leaveRoom(client, room);
      return { event: 'leaveRoom', data: { success: true, room } };
    } catch (error) {
      const errorMessage = error?.message || 'Unknown error';
      const errorStack = error?.stack || '';
      this.logger.error(`Error leaving room: ${errorMessage}`, errorStack);
      return { event: 'leaveRoom', data: { success: false, error: errorMessage } };
    }
  }

  protected async joinRoom(client: Socket, room: string): Promise<{ success: boolean }> {
    try {
      // Add client to room
      await client.join(room);
      
      // Track room membership
      const clientRooms = this.roomsByClient.get(client.id) || new Set();
      clientRooms.add(room);
      this.roomsByClient.set(client.id, clientRooms);
      
      // Track clients in room
      if (!this.clientsByRoom.has(room)) {
        this.clientsByRoom.set(room, new Set());
      }
      this.clientsByRoom.get(room).add(client.id);
      
      this.logger.log(`Client ${client.id} joined room: ${room}`);
      return { success: true };
    } catch (error) {
      const errorMessage = error?.message || 'Unknown error';
      this.logger.error(`Error in joinRoom: ${errorMessage}`);
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
      
      this.logger.log(`Client ${client.id} left room: ${room}`);
      return { success: true };
    } catch (error) {
      const errorMessage = error?.message || 'Unknown error';
      this.logger.error(`Error in leaveRoom: ${errorMessage}`);
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
    } catch (error) {
      const errorMessage = error?.message || 'Unknown error';
      this.logger.error(`Error in leaveAllRooms: ${errorMessage}`);
    }
  }

  protected getRoomSize(room: string): number {
    return this.clientsByRoom.get(room)?.size || 0;
  }
  
  protected getClientMetadata(clientId: string): Record<string, any> | undefined {
    return this.clientMetadata.get(clientId);
  }
  
  protected broadcastToRoom(room: string, event: string, data: any): void {
    try {
      this.server.to(room).emit(event, data);
      this.logger.debug(`Broadcasted ${event} to room ${room}`);
    } catch (error) {
      const errorMessage = error?.message || 'Unknown error';
      this.logger.error(`Error in broadcastToRoom: ${errorMessage}`);
    }
  }
  
  protected sendToUser(clientId: string, event: string, data: any): void {
    try {
      const socket = this.server.sockets.sockets.get(clientId);
      if (socket) {
        socket.emit(event, data);
        this.logger.debug(`Sent ${event} to client ${clientId}`);
      } else {
        this.logger.warn(`Client ${clientId} not found for sending ${event}`);
      }
    } catch (error) {
      const errorMessage = error?.message || 'Unknown error';
      this.logger.error(`Error in sendToUser: ${errorMessage}`);
    }
  }
} 