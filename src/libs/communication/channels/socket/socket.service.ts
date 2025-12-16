import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Server } from 'socket.io';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

/**
 * Socket event data interface
 * @interface SocketEventData
 */
export type SocketEventPrimitive = string | number | boolean | null;
export type SocketEventData = Record<
  string,
  SocketEventPrimitive | SocketEventPrimitive[] | Record<string, SocketEventPrimitive>
>;

/**
 * Socket service for managing WebSocket connections and broadcasting
 *
 * @class SocketService
 */
@Injectable()
export class SocketService {
  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}
  private server!: Server;
  private isServerInitialized = false;
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
    try {
      this.ensureInitialized();

      if (!room || !event) {
        throw new HealthcareError(
          ErrorCode.VALIDATION_REQUIRED_FIELD,
          'Room and event must be provided',
          undefined,
          { room, event },
          'SocketService.sendToRoom'
        );
      }

      this.server.to(room).emit(event, data);
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `Event ${event} sent to room ${room}`,
        'SocketService',
        { room, event }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Error sending event to room: ${errorMessage}`,
        'SocketService',
        { stack: (error as Error)?.stack, room, event }
      );
      throw error; // Re-throw to let the caller handle it
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
      this.ensureInitialized();

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
   * Clean up resources when the service is destroyed
   */
  /**
   * Cleanup on module destroy
   */
  onModuleDestroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
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
