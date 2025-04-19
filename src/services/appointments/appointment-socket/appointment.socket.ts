import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { BaseSocket } from '../../../shared/socket/base-socket';
import { QueueService } from '../../../shared/queue/queue.service';
import { SocketService } from '../../../shared/socket/socket.service';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'appointments',
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 60000,
})
export class AppointmentSocket extends BaseSocket {
  protected readonly logger = new Logger(AppointmentSocket.name);
  private readonly userSessions: Map<string, Set<string>> = new Map(); // userId -> Set<socketId>
  private readonly doctorSessions: Map<string, Set<string>> = new Map(); // doctorId -> Set<socketId>
  private readonly locationSessions: Map<string, Set<string>> = new Map(); // locationId -> Set<socketId>

  constructor(
    private readonly queueService: QueueService,
    socketService: SocketService,
  ) {
    super(socketService, 'Appointment');
  }

  async afterInit() {
    await super.afterInit();
    this.logger.log('Appointment Socket initialized');
  }

  async handleConnection(client: Socket) {
    await super.handleConnection(client);
    
    // Extract user information from handshake
    const userId = client.handshake.query.userId as string;
    const doctorId = client.handshake.query.doctorId as string;
    const locationId = client.handshake.query.locationId as string;
    
    // Store session information
    if (userId) {
      if (!this.userSessions.has(userId)) {
        this.userSessions.set(userId, new Set());
      }
      this.userSessions.get(userId).add(client.id);
      this.logger.debug(`User ${userId} connected with socket ${client.id}`);
    }
    
    if (doctorId) {
      if (!this.doctorSessions.has(doctorId)) {
        this.doctorSessions.set(doctorId, new Set());
      }
      this.doctorSessions.get(doctorId).add(client.id);
      this.logger.debug(`Doctor ${doctorId} connected with socket ${client.id}`);
    }
    
    if (locationId) {
      if (!this.locationSessions.has(locationId)) {
        this.locationSessions.set(locationId, new Set());
      }
      this.locationSessions.get(locationId).add(client.id);
      this.logger.debug(`Location ${locationId} connected with socket ${client.id}`);
    }
  }

  handleDisconnect(client: Socket) {
    super.handleDisconnect(client);
    
    // Clean up session information
    for (const [userId, sessions] of this.userSessions.entries()) {
      if (sessions.has(client.id)) {
        sessions.delete(client.id);
        if (sessions.size === 0) {
          this.userSessions.delete(userId);
        }
        this.logger.debug(`User ${userId} disconnected socket ${client.id}`);
      }
    }
    
    for (const [doctorId, sessions] of this.doctorSessions.entries()) {
      if (sessions.has(client.id)) {
        sessions.delete(client.id);
        if (sessions.size === 0) {
          this.doctorSessions.delete(doctorId);
        }
        this.logger.debug(`Doctor ${doctorId} disconnected socket ${client.id}`);
      }
    }
    
    for (const [locationId, sessions] of this.locationSessions.entries()) {
      if (sessions.has(client.id)) {
        sessions.delete(client.id);
        if (sessions.size === 0) {
          this.locationSessions.delete(locationId);
        }
        this.logger.debug(`Location ${locationId} disconnected socket ${client.id}`);
      }
    }
  }

  @SubscribeMessage('joinUserRoom')
  handleJoinUserRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    try {
      const { userId } = data;
      const room = `user:${userId}`;
      return this.joinRoom(client, room);
    } catch (error) {
      this.logger.error(`Error joining user room: ${error.message}`, error.stack);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('joinDoctorRoom')
  handleJoinDoctorRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { doctorId: string },
  ) {
    try {
      const { doctorId } = data;
      const room = `doctor:${doctorId}`;
      return this.joinRoom(client, room);
    } catch (error) {
      this.logger.error(`Error joining doctor room: ${error.message}`, error.stack);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('joinLocationRoom')
  async handleJoinLocationRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { locationId: string },
  ) {
    try {
      const { locationId } = data;
      const room = `location:${locationId}`;
      
      const result = this.joinRoom(client, room);
      
      // Send initial queue stats
      await this.sendQueueStats(locationId);
      
      return result;
    } catch (error) {
      this.logger.error(`Error joining location room: ${error.message}`, error.stack);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send queue statistics to location room
   */
  async sendQueueStats(locationId: string) {
    try {
      const stats = await this.queueService.getQueueStatsByLocation(locationId, 'appointment');
      
      this.socketService.sendToLocation(locationId, 'queueStats', stats);
      
      this.logger.log(`Sent queue stats to location ${locationId}`);
    } catch (error) {
      this.logger.error(`Error sending queue stats: ${error.message}`, error.stack);
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
        timestamp: new Date().toISOString()
      };
      
      // Send to user room
      if (userId) {
        this.socketService.sendToUser(userId, 'appointmentUpdate', updateData);
      }
      
      // Send to doctor room
      if (doctorId) {
        this.socketService.sendToResource('doctor', doctorId, 'appointmentUpdate', updateData);
      }
      
      // Send updated queue stats to location room
      if (locationId) {
        await this.sendQueueStats(locationId);
      }
      
      this.logger.log(`Sent appointment update for appointment ${id} to relevant rooms`);
    } catch (error) {
      this.logger.error(`Error notifying appointment update: ${error.message}`, error.stack);
    }
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
  getUserSessions(userId: string): Set<string> {
    return this.userSessions.get(userId) || new Set();
  }
  
  /**
   * Get active sessions for a doctor
   */
  getDoctorSessions(doctorId: string): Set<string> {
    return this.doctorSessions.get(doctorId) || new Set();
  }
  
  /**
   * Get active sessions for a location
   */
  getLocationSessions(locationId: string): Set<string> {
    return this.locationSessions.get(locationId) || new Set();
  }
  
  /**
   * Check if a user is online
   */
  isUserOnline(userId: string): boolean {
    return this.userSessions.has(userId) && this.userSessions.get(userId).size > 0;
  }
  
  /**
   * Check if a doctor is online
   */
  isDoctorOnline(doctorId: string): boolean {
    return this.doctorSessions.has(doctorId) && this.doctorSessions.get(doctorId).size > 0;
  }
  
  /**
   * Check if a location has active connections
   */
  isLocationActive(locationId: string): boolean {
    return this.locationSessions.has(locationId) && this.locationSessions.get(locationId).size > 0;
  }
} 