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

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'appointments',
})
export class AppointmentSocket extends BaseSocket {
  constructor(
    private readonly queueService: QueueService,
    socketService: SocketService,
  ) {
    super(socketService, 'Appointment');
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
      };
      
      // Send to user room
      this.socketService.sendToUser(userId, 'appointmentUpdate', updateData);
      
      // Send to doctor room
      this.socketService.sendToResource('doctor', doctorId, 'appointmentUpdate', updateData);
      
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
      });
      
      this.logger.log(`Notified user ${userId} that they are next in line for appointment ${id}`);
    } catch (error) {
      this.logger.error(`Error notifying user next in line: ${error.message}`, error.stack);
    }
  }
} 