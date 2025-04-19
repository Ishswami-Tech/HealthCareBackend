import {
  WebSocketGateway as NestWebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SocketService } from './socket.service';

export class BaseSocket implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  protected readonly logger: Logger;
  protected readonly roomsByClient: Map<string, Set<string>> = new Map();
  protected readonly clientsByRoom: Map<string, Set<string>> = new Map();
  private readonly reconnectAttempts: Map<string, number> = new Map();
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_INTERVAL = 5000; // 5 seconds
  private readonly clientMetadata: Map<string, Record<string, any>> = new Map();

  constructor(
    protected readonly socketService: SocketService,
    serviceName: string,
  ) {
    this.logger = new Logger(`${serviceName}Socket`);
  }

  async afterInit() {
    if (!this.socketService) {
      this.logger.error('SocketService is not initialized');
      return;
    }
    
    if (!this.server) {
      this.logger.error('WebSocket server is not initialized');
      return;
    }
    
    this.socketService.setServer(this.server);
    this.logger.log('WebSocket server initialized');
    
    // Configure Socket.IO server options for optimal performance
    if (this.server && this.server.engine && this.server.engine.opts) {
      this.server.engine.opts.pingTimeout = 60000; // 60 seconds
      this.server.engine.opts.pingInterval = 25000; // 25 seconds
      this.server.engine.opts.maxHttpBufferSize = 1e8; // 100 MB
      this.server.engine.opts.transports = ['websocket', 'polling']; // Prefer WebSocket
    } else {
      this.logger.warn('Socket.IO engine options not available, using default settings');
    }
    
    // Set up server-wide error handling
    this.server.on('error', (error) => {
      this.logger.error(`Socket.IO server error: ${error.message}`, error.stack);
    });
  }

  async handleConnection(client: Socket) {
    try {
      this.logger.log(`Client connected: ${client.id}`);
      
      // Reset reconnect attempts on successful connection
      this.reconnectAttempts.delete(client.id);
      
      // Initialize client rooms tracking
      this.roomsByClient.set(client.id, new Set());
      
      // Store client metadata
      this.clientMetadata.set(client.id, {
        connectedAt: new Date(),
        userAgent: client.handshake.headers['user-agent'],
        ip: client.handshake.address,
      });
      
      // Set up error handling for this client
      client.on('error', (error) => {
        this.logger.error(`Socket error for client ${client.id}: ${error.message}`, error.stack);
        this.handleSocketError(client, error);
      });
      
      // Set up reconnection handling
      client.on('disconnect', (reason) => {
        this.logger.warn(`Client ${client.id} disconnected. Reason: ${reason}`);
        if (reason === 'transport close' || reason === 'ping timeout') {
          this.handleReconnection(client);
        }
      });
      
      // Send welcome message
      client.emit('connected', { 
        id: client.id, 
        timestamp: new Date().toISOString(),
        message: 'Connected to WebSocket server'
      });
      
    } catch (error) {
      this.logger.error(`Error handling connection: ${error.message}`, error.stack);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    try {
      this.logger.log(`Client disconnected: ${client.id}`);
      this.leaveAllRooms(client);
      this.roomsByClient.delete(client.id);
      this.reconnectAttempts.delete(client.id);
      this.clientMetadata.delete(client.id);
    } catch (error) {
      this.logger.error(`Error handling disconnect: ${error.message}`, error.stack);
    }
  }

  private handleSocketError(client: Socket, error: Error) {
    // Implement exponential backoff for reconnection
    const attempts = this.reconnectAttempts.get(client.id) || 0;
    if (attempts < this.MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(1000 * Math.pow(2, attempts), 30000); // Max 30 seconds
      this.reconnectAttempts.set(client.id, attempts + 1);
      
      setTimeout(() => {
        this.logger.log(`Attempting to reconnect client ${client.id} (attempt ${attempts + 1})`);
        this.server.sockets.sockets.get(client.id)?.disconnect(true);
      }, delay);
    } else {
      this.logger.error(`Max reconnection attempts reached for client ${client.id}`);
      client.disconnect();
    }
  }

  private handleReconnection(client: Socket) {
    const attempts = this.reconnectAttempts.get(client.id) || 0;
    if (attempts < this.MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts.set(client.id, attempts + 1);
      
      setTimeout(() => {
        this.logger.log(`Attempting to reconnect client ${client.id} (attempt ${attempts + 1})`);
        this.server.sockets.sockets.get(client.id)?.disconnect(true);
      }, this.RECONNECT_INTERVAL);
    }
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { room: string },
  ) {
    try {
      const { room } = data;
      return this.joinRoom(client, room);
    } catch (error) {
      this.logger.error(`Error joining room: ${error.message}`, error.stack);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { room: string },
  ) {
    try {
      const { room } = data;
      return this.leaveRoom(client, room);
    } catch (error) {
      this.logger.error(`Error leaving room: ${error.message}`, error.stack);
      return { success: false, error: error.message };
    }
  }

  protected joinRoom(client: Socket, room: string) {
    // Add client to room
    client.join(room);
    
    // Track room membership
    const clientRooms = this.roomsByClient.get(client.id);
    clientRooms.add(room);
    
    // Track clients in room
    if (!this.clientsByRoom.has(room)) {
      this.clientsByRoom.set(room, new Set());
    }
    this.clientsByRoom.get(room).add(client.id);
    
    this.logger.log(`Client ${client.id} joined room: ${room}`);
    return { success: true };
  }

  protected leaveRoom(client: Socket, room: string) {
    // Remove client from room
    client.leave(room);
    
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
  }

  protected leaveAllRooms(client: Socket) {
    const clientRooms = this.roomsByClient.get(client.id);
    if (!clientRooms) return;
    
    // Copy the rooms to avoid modification during iteration
    const rooms = Array.from(clientRooms);
    
    // Leave each room
    for (const room of rooms) {
      this.leaveRoom(client, room);
    }
  }

  /**
   * Get the number of clients in a room
   * @param room - Room name
   * @returns Number of clients
   */
  protected getRoomSize(room: string): number {
    const roomClients = this.clientsByRoom.get(room);
    return roomClients ? roomClients.size : 0;
  }
  
  /**
   * Get client metadata
   * @param clientId - Client ID
   * @returns Client metadata or undefined if not found
   */
  protected getClientMetadata(clientId: string): Record<string, any> | undefined {
    return this.clientMetadata.get(clientId);
  }
  
  /**
   * Broadcast a message to all clients in a room
   * @param room - Room name
   * @param event - Event name
   * @param data - Data to send
   */
  protected broadcastToRoom(room: string, event: string, data: any): void {
    this.server.to(room).emit(event, data);
    this.logger.debug(`Broadcasted ${event} to room ${room}`);
  }
  
  /**
   * Send a message to a specific client
   * @param clientId - Client ID
   * @param event - Event name
   * @param data - Data to send
   */
  protected sendToClient(clientId: string, event: string, data: any): void {
    const socket = this.server.sockets.sockets.get(clientId);
    if (socket) {
      socket.emit(event, data);
      this.logger.debug(`Sent ${event} to client ${clientId}`);
    } else {
      this.logger.warn(`Client ${clientId} not found for sending ${event}`);
    }
  }
} 