import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class SocketService {
  private readonly logger = new Logger(SocketService.name);
  private server: Server;

  setServer(server: Server) {
    this.server = server;
  }

  /**
   * Send an event to a specific room
   * @param room - Room name
   * @param event - Event name
   * @param data - Event data
   */
  sendToRoom(room: string, event: string, data: any) {
    try {
      if (!this.server) {
        this.logger.error('Server is not initialized');
        return;
      }
      
      this.server.to(room).emit(event, data);
      this.logger.log(`Event ${event} sent to room ${room}`);
    } catch (error) {
      this.logger.error(`Error sending event to room: ${error.message}`, error.stack);
    }
  }

  /**
   * Send an event to a user
   * @param userId - User ID
   * @param event - Event name
   * @param data - Event data
   */
  sendToUser(userId: string, event: string, data: any) {
    this.sendToRoom(`user:${userId}`, event, data);
  }

  /**
   * Send an event to a specific resource
   * @param resourceType - Resource type (e.g., 'appointment', 'doctor')
   * @param resourceId - Resource ID
   * @param event - Event name
   * @param data - Event data
   */
  sendToResource(resourceType: string, resourceId: string, event: string, data: any) {
    this.sendToRoom(`${resourceType}:${resourceId}`, event, data);
  }

  /**
   * Send an event to a location
   * @param locationId - Location ID
   * @param event - Event name
   * @param data - Event data
   */
  sendToLocation(locationId: string, event: string, data: any) {
    this.sendToRoom(`location:${locationId}`, event, data);
  }

  /**
   * Send an event to all connected clients
   * @param event - Event name 
   * @param data - Event data
   */
  broadcast(event: string, data: any) {
    try {
      if (!this.server) {
        this.logger.error('Server is not initialized');
        return;
      }
      
      this.server.emit(event, data);
      this.logger.log(`Event ${event} broadcasted to all clients`);
    } catch (error) {
      this.logger.error(`Error broadcasting event: ${error.message}`, error.stack);
    }
  }
} 