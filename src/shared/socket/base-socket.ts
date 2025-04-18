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

  constructor(
    protected readonly socketService: SocketService,
    serviceName: string,
  ) {
    this.logger = new Logger(`${serviceName}Socket`);
  }

  async afterInit() {
    this.socketService.setServer(this.server);
    this.logger.log('WebSocket server initialized');
  }

  async handleConnection(client: Socket) {
    try {
      this.logger.log(`Client connected: ${client.id}`);
      // Initialize client rooms tracking
      this.roomsByClient.set(client.id, new Set());
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
    } catch (error) {
      this.logger.error(`Error handling disconnect: ${error.message}`, error.stack);
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
} 