import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WsResponse,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import { BaseSocket } from '../../../shared/socket/base-socket';
import { QueueService } from '../../../shared/queue/queue.service';
import { SocketService } from '../../../shared/socket/socket.service';
import { Logger, Injectable, Inject, OnModuleInit, Optional } from '@nestjs/common';
import { AppointmentStatus, QueueStatus } from '../../../shared/database/prisma/prisma.types';
import { AppointmentQueueService } from '../appointment-queue/appointment-queue.service';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { AppointmentService } from '../appointments.service';
import { QueuePosition, LocationQueueStats } from '../../../libs/types/queue.types';

@WebSocketGateway({
  namespace: '/appointments',
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:8088', '*'],
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['authorization', 'Authorization', 'Content-Type'],
  },
  path: '/socket.io',
  serveClient: false,
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 60000,
})
@Injectable()
export class AppointmentSocket extends BaseSocket implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer() protected override server: Server;
  private userSessions: Map<string, string> = new Map();
  private doctorSessions: Map<string, string> = new Map();
  private locationSessions: Map<string, string> = new Map();
  private queuePositions: Map<string, QueuePosition> = new Map();
  private queueUpdateInterval: NodeJS.Timeout;

  constructor(
    private readonly queueService: QueueService,
    @Inject('SOCKET_SERVICE') @Optional() protected readonly socketService: SocketService,
    private readonly appointmentQueueService: AppointmentQueueService,
    private readonly prisma: PrismaService,
    private readonly appointmentService: AppointmentService,
  ) {
    super(socketService, 'AppointmentSocket');
    this.logger = new Logger('AppointmentSocket');
  }

  onModuleInit() {
    this.initializeQueueUpdates();
  }

  async afterInit(server: Server): Promise<void> {
    // Ensure logger is initialized
    if (!this.logger) {
      this.logger = new Logger('AppointmentSocket');
    }

    try {
      // Initialize the server first
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
        try {
          await this.socketService.setServer(this.server);
          this.logger.log('SocketService initialized successfully');
        } catch (error) {
          this.logger.warn('Failed to initialize SocketService:', error instanceof Error ? error.message : 'Unknown error');
          this.logger.warn('Continuing with limited functionality');
        }
      } else {
        this.logger.warn('SocketService is not available, continuing with limited functionality');
      }

      this.logger.log('Appointment WebSocket Gateway initialized');
    } catch (error) {
      this.logger.error(
        'Failed to initialize Appointment WebSocket Gateway:',
        error instanceof Error ? error.stack : error
      );
      throw error;
    }
  }

  async handleConnection(client: Socket): Promise<WsResponse<any>> {
    try {
      await super.handleConnection(client);
      const { userId, userType } = client.handshake.query;

      if (!userId || !userType) {
        this.logger.warn(`Invalid connection attempt - missing userId or userType`);
        client.disconnect();
        return { event: 'error', data: { message: 'Invalid connection data' } };
      }

      const userRoom = `user:${userId}`;
      const typeRoom = `${userType}:${userId}`;

      // Join rooms and wait for completion
      await client.join([userRoom, typeRoom]);
      
      if (userType === 'doctor') {
        this.doctorSessions.set(userId.toString(), client.id);
        this.logger.log(`Doctor ${userId} connected and joined rooms: ${userRoom}, ${typeRoom}`);
      } else if (userType === 'patient') {
        this.userSessions.set(userId.toString(), client.id);
        this.logger.log(`Patient ${userId} connected and joined rooms: ${userRoom}, ${typeRoom}`);
      }

      return { 
        event: 'connection', 
        data: { 
          success: true, 
          userId, 
          userType,
          rooms: [userRoom, typeRoom]
        } 
      };
    } catch (error) {
      this.logger.error(`Error handling connection: ${error.message}`, error.stack);
      client.disconnect();
      return { event: 'error', data: { message: 'Internal server error' } };
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    try {
      const { userId, userType } = client.handshake.query;

      if (userType === 'doctor') {
        this.doctorSessions.delete(userId.toString());
        this.logger.log(`Doctor ${userId} disconnected`);
      } else if (userType === 'patient') {
        this.userSessions.delete(userId.toString());
        this.logger.log(`Patient ${userId} disconnected`);
      }

      super.handleDisconnect(client);
    } catch (error) {
      this.logger.error(`Error handling disconnect: ${error.message}`, error.stack);
    }
  }

  @SubscribeMessage('joinUserRoom')
  async handleJoinUserRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string }
  ): Promise<WsResponse<any>> {
    try {
      const { userId } = data;
      const room = `user:${userId}`;
      
      await this.joinRoom(client, room);
      this.userSessions.set(userId, client.id);
      
      return {
        event: 'joinUserRoom',
        data: { success: true, userId }
      };
    } catch (error) {
      this.logger.error(`Error joining user room: ${error.message}`, error.stack);
      return {
        event: 'joinUserRoom',
        data: { success: false, error: error.message }
      };
    }
  }

  @SubscribeMessage('joinDoctorRoom')
  async handleJoinDoctorRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { doctorId: string }
  ): Promise<WsResponse<any>> {
    try {
      const { doctorId } = data;
      const room = `doctor:${doctorId}`;
      
      await this.joinRoom(client, room);
      this.doctorSessions.set(doctorId, client.id);
      
      return {
        event: 'joinDoctorRoom',
        data: { success: true, doctorId }
      };
    } catch (error) {
      this.logger.error(`Error joining doctor room: ${error.message}`, error.stack);
      return {
        event: 'joinDoctorRoom',
        data: { success: false, error: error.message }
      };
    }
  }

  @SubscribeMessage('joinLocationRoom')
  async handleJoinLocationRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { locationId: string }
  ): Promise<WsResponse<any>> {
    try {
      const { locationId } = data;
      const room = `location:${locationId}`;
      
      await this.joinRoom(client, room);
      this.locationSessions.set(locationId, client.id);
      
      // Send initial queue stats
      await this.sendLocationQueueStats(locationId);
      
      return {
        event: 'joinLocationRoom',
        data: { success: true, locationId }
      };
    } catch (error) {
      this.logger.error(`Error joining location room: ${error.message}`, error.stack);
      return {
        event: 'joinLocationRoom',
        data: { success: false, error: error.message }
      };
    }
  }

  @SubscribeMessage('subscribeToQueueUpdates')
  async handleQueueSubscription(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { appointmentId: string },
  ): Promise<WsResponse<any>> {
    try {
      const { appointmentId } = data;
      const appointment = await this.queueService.getAppointmentDetails(appointmentId);
      
      if (!appointment) {
        throw new Error('Appointment not found');
      }
      
      const room = `queue:${appointmentId}`;
      await this.joinRoom(client, room);
      
      // Send initial queue position
      const position = await this.calculateQueuePosition(appointmentId);
      return { event: 'queuePosition', data: position };
    } catch (error) {
      this.logger.error(`Error in queue subscription: ${error.message}`, error.stack);
      return { event: 'error', data: { message: error.message } };
    }
  }

  @SubscribeMessage('requestQueueUpdate')
  async handleQueueUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { appointmentId: string },
  ): Promise<WsResponse<any>> {
    try {
      const position = await this.calculateQueuePosition(data.appointmentId);
      return { event: 'queuePosition', data: position };
    } catch (error) {
      this.logger.error(`Error updating queue position: ${error.message}`, error.stack);
      return { event: 'error', data: { message: error.message } };
    }
  }

  private async calculateQueuePosition(appointmentId: string): Promise<QueuePosition> {
    const stats = await this.queueService.getAppointmentQueuePosition(appointmentId);
    return {
      position: stats.position,
      estimatedWaitTime: stats.estimatedWaitTime,
      totalAhead: stats.totalAhead,
    };
  }

  private initializeQueueUpdates(): void {
    this.queueUpdateInterval = setInterval(() => {
      this.updateQueuePositions().catch(error => {
        this.logger.error('Failed to update queue positions:', error);
      });
    }, 30000); // Update every 30 seconds
  }

  private async updateQueuePositions(): Promise<void> {
    try {
      const locations = Array.from(this.locationSessions.keys());
      
      for (const locationId of locations) {
        await this.sendLocationQueueStats(locationId);
      }
    } catch (error) {
      this.logger.error(`Error updating queue positions: ${error.message}`, error.stack);
    }
  }

  private async sendUserQueuePosition(userId: string) {
    try {
      const activeAppointments = await this.queueService.getUserActiveAppointments(userId);
      
      for (const appointment of activeAppointments) {
        const position = await this.calculateQueuePosition(appointment.id);
        this.socketService.sendToUser(userId, 'queuePosition', {
          appointmentId: appointment.id,
          ...position,
        });
      }
    } catch (error) {
      this.logger.error(`Error sending user queue position: ${error.message}`, error.stack);
    }
  }

  private async sendDoctorQueueStatus(doctorId: string) {
    try {
      const queueStatus = await this.queueService.getDoctorQueueStatus(doctorId);
      this.socketService.sendToResource('doctor', doctorId, 'queueStatus', queueStatus);
    } catch (error) {
      this.logger.error(`Error sending doctor queue status: ${error.message}`, error.stack);
    }
  }

  private async sendLocationQueueStats(locationId: string): Promise<void> {
    try {
      const queueStats = await this.appointmentQueueService.getLocationQueueStats(locationId);
      const room = `location:${locationId}`;
      
      await this.socketService.sendToRoom(room, 'queueUpdate', {
        locationId,
        stats: queueStats
      });
    } catch (error) {
      this.logger.error(`Error sending location queue stats: ${error.message}`, error.stack);
    }
  }

  /**
   * Notify about appointment update
   */
  async notifyAppointmentUpdate(appointment: any) {
    try {
      const { id, userId, doctorId, locationId, status } = appointment;
      
      const updateData = {
        appointmentId: id,
        status,
        message: `Appointment status updated to ${status}`,
        timestamp: new Date().toISOString(),
        progress: this.calculateProgressPercentage(status),
      };
      
      if (userId) {
        this.socketService.sendToUser(userId, 'appointmentUpdate', updateData);
        await this.sendUserQueuePosition(userId);
      }
      
      if (doctorId) {
        this.socketService.sendToResource('doctor', doctorId, 'appointmentUpdate', updateData);
        await this.sendDoctorQueueStatus(doctorId);
      }
      
      if (locationId) {
        await this.sendLocationQueueStats(locationId);
      }
      
      // Notify all clients in the appointment's queue room
      this.server.to(`queue:${id}`).emit('appointmentUpdate', updateData);
      
      this.logger.log(`Sent appointment update for appointment ${id} to relevant rooms`);
    } catch (error) {
      this.logger.error(`Error in appointment update notification: ${error.message}`, error.stack);
    }
  }

  private calculateProgressPercentage(status: AppointmentStatus): number {
    const statusProgress = {
      [AppointmentStatus.PENDING]: 0,
      [AppointmentStatus.SCHEDULED]: 25,
      [AppointmentStatus.CONFIRMED]: 50,
      [AppointmentStatus.COMPLETED]: 100,
      [AppointmentStatus.CANCELLED]: 0,
      [AppointmentStatus.NO_SHOW]: 0,
    };
    return statusProgress[status] || 0;
  }

  /**
   * Notify a user that they are next in line
   */
  notifyUserNextInLine(appointment: any) {
    try {
      const { id, userId } = appointment;
      
      this.socketService.sendToUser(userId, 'appointmentReady', {
        appointmentId: id,
        message: 'You are next in line for your appointment. Please proceed to the doctor.',
        timestamp: new Date().toISOString()
      });
      
      this.logger.log(`Notified user ${userId} that they are next in line for appointment ${id}`);
    } catch (error) {
      this.logger.error(`Error notifying user next in line: ${error.message}`, error.stack);
    }
  }
  
  /**
   * Get active sessions for a user
   */
  getUserSessions(userId: string): string | undefined {
    return this.userSessions.get(userId);
  }
  
  /**
   * Get active sessions for a doctor
   */
  getDoctorSessions(doctorId: string): string | undefined {
    return this.doctorSessions.get(doctorId);
  }
  
  /**
   * Get active sessions for a location
   */
  getLocationSessions(locationId: string): string | undefined {
    return this.locationSessions.get(locationId);
  }
  
  /**
   * Check if a user is online
   */
  isUserOnline(userId: string): boolean {
    return this.userSessions.has(userId);
  }
  
  /**
   * Check if a doctor is online
   */
  isDoctorOnline(doctorId: string): boolean {
    return this.doctorSessions.has(doctorId);
  }
  
  /**
   * Check if a location has active connections
   */
  isLocationActive(locationId: string): boolean {
    return this.locationSessions.has(locationId);
  }

  onModuleDestroy() {
    try {
      if (this.queueUpdateInterval) {
        clearInterval(this.queueUpdateInterval);
      }
    } catch (error) {
      const errorMessage = error?.message || 'Unknown error';
      this.logger.error(`Error in onModuleDestroy: ${errorMessage}`);
    }
  }

  private async handleUserDisconnect(client: Socket): Promise<void> {
    try {
      const userId = this.getUserId(client);
      if (userId) {
        const room = `user:${userId}`;
        await this.leaveRoom(client, room);
        this.userSessions.delete(userId);
      }
    } catch (error) {
      this.logger.error(`Error handling user disconnect: ${error.message}`, error.stack);
    }
  }

  private async handleDoctorDisconnect(client: Socket): Promise<void> {
    try {
      const doctorId = this.getDoctorId(client);
      if (doctorId) {
        const room = `doctor:${doctorId}`;
        await this.leaveRoom(client, room);
        this.doctorSessions.delete(doctorId);
      }
    } catch (error) {
      this.logger.error(`Error handling doctor disconnect: ${error.message}`, error.stack);
    }
  }

  private async handleLocationDisconnect(client: Socket): Promise<void> {
    try {
      const locationId = this.getLocationId(client);
      if (locationId) {
        const room = `location:${locationId}`;
        await this.leaveRoom(client, room);
        this.locationSessions.delete(locationId);
      }
    } catch (error) {
      this.logger.error(`Error handling location disconnect: ${error.message}`, error.stack);
    }
  }

  private getUserId(client: Socket): string | undefined {
    return Array.from(this.userSessions.entries())
      .find(([_, socketId]) => socketId === client.id)?.[0];
  }

  private getDoctorId(client: Socket): string | undefined {
    return Array.from(this.doctorSessions.entries())
      .find(([_, socketId]) => socketId === client.id)?.[0];
  }

  private getLocationId(client: Socket): string | undefined {
    return Array.from(this.locationSessions.entries())
      .find(([_, socketId]) => socketId === client.id)?.[0];
  }
} 