import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class SocketService {
  private readonly logger = new Logger(SocketService.name);
  private server: Server;
  private isServerInitialized = false;
  private healthCheckInterval: NodeJS.Timeout;
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

  setServer(server: Server) {
    try {
      if (!server) {
        throw new Error('Cannot initialize SocketService with null server');
      }
      
      this.server = server;
      this.isServerInitialized = true;
      
      // Add error handlers
      this.server.on('error', (error: Error) => {
        this.logger.error(`Socket.IO server error: ${error?.message || 'Unknown error'}`, error?.stack);
        this.handleServerError(error);
      });

      this.server.on('connection_error', (error: Error) => {
        this.logger.error(`Socket.IO connection error: ${error?.message || 'Unknown error'}`, error?.stack);
        this.handleConnectionError(error);
      });

      // Start health check
      this.startHealthCheck();

      this.logger.log('SocketService initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize SocketService: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.isServerInitialized = false;
      throw error;
    }
  }

  private startHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.checkServerHealth();
    }, this.HEALTH_CHECK_INTERVAL);
  }

  private async checkServerHealth() {
    try {
      if (!this.server || !this.isServerInitialized) {
        this.logger.warn('Server health check failed: Server not initialized');
        return false;
      }

      // Check if server is responding
      const connectedClients = await this.server.allSockets();
      this.logger.debug(`Server health check: ${connectedClients.size} clients connected`);
      return true;
    } catch (error) {
      this.logger.error(`Server health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  private handleServerError(error: Error) {
    this.logger.error('Server error occurred, attempting recovery...');
    // Implement recovery logic here
    // For example, try to reinitialize the server or notify administrators
  }

  private handleConnectionError(error: Error) {
    this.logger.error('Connection error occurred, attempting recovery...');
    // Implement recovery logic here
    // For example, try to reconnect or notify administrators
  }

  getInitializationState(): boolean {
    return this.isServerInitialized;
  }

  private ensureInitialized() {
    if (!this.isServerInitialized || !this.server) {
      throw new Error('SocketService is not initialized');
    }
  }

  /**
   * Send an event to a specific room
   * @param room - Room name
   * @param event - Event name
   * @param data - Event data
   */
  sendToRoom(room: string, event: string, data: any) {
    try {
      this.ensureInitialized();
      
      if (!room || !event) {
        throw new Error('Room and event must be provided');
      }
      
      this.server.to(room).emit(event, data);
      this.logger.debug(`Event ${event} sent to room ${room}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error sending event to room: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
      throw error; // Re-throw to let the caller handle it
    }
  }

  /**
   * Send an event to a user
   * @param userId - User ID
   * @param event - Event name
   * @param data - Event data
   */
  sendToUser(userId: string, event: string, data: any) {
    try {
      if (!userId) {
        throw new Error('User ID must be provided');
      }
      this.sendToRoom(`user:${userId}`, event, data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error sending event to user: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
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
  sendToResource(resourceType: string, resourceId: string, event: string, data: any) {
    try {
      if (!resourceType || !resourceId) {
        throw new Error('Resource type and ID must be provided');
      }
      this.sendToRoom(`${resourceType}:${resourceId}`, event, data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error sending event to resource: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }

  /**
   * Send an event to a location
   * @param locationId - Location ID
   * @param event - Event name
   * @param data - Event data
   */
  sendToLocation(locationId: string, event: string, data: any) {
    try {
      if (!locationId) {
        throw new Error('Location ID must be provided');
      }
      this.sendToRoom(`location:${locationId}`, event, data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error sending event to location: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }

  /**
   * Send an event to all connected clients
   * @param event - Event name 
   * @param data - Event data
   */
  broadcast(event: string, data: any) {
    try {
      this.ensureInitialized();
      
      if (!event) {
        throw new Error('Event name must be provided');
      }
      
      this.server.emit(event, data);
      this.logger.debug(`Event ${event} broadcasted to all clients`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error broadcasting event: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
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
   * Clean up resources when the service is destroyed
   */
  onModuleDestroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.server) {
      this.server.close();
    }
  }
} 