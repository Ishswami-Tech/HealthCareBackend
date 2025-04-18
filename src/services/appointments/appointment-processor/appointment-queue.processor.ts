import { Process, Processor } from '@nestjs/bull';
import { Logger, Injectable, OnModuleInit } from '@nestjs/common';
import { Job } from 'bull';
import { JobType, JobData } from '../../../shared/queue/queue.service';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { SocketService } from '../../../shared/socket/socket.service';
import { AppointmentStatus } from '../../../shared/database/prisma/prisma.types';

// Extend the JobData interface for appointment-specific data
interface AppointmentJobData extends JobData {
  doctorId?: string;
}

@Injectable()
@Processor('appointment-queue')
export class AppointmentQueueProcessor implements OnModuleInit {
  // Create a logger instance for this class
  private readonly logger = new Logger(AppointmentQueueProcessor.name);
  
  constructor(
    private readonly prisma: PrismaService,
    private readonly socketService: SocketService
  ) {}

  // Implementation of OnModuleInit
  onModuleInit() {
    this.logger.log('Appointment Queue Processor initialized');
  }

  @Process(JobType.CREATE)
  async processCreateJob(job: Job<AppointmentJobData>) {
    try {
      this.logger.log(`Processing create appointment job ${job.id}`);
      const { id, locationId, userId, doctorId } = job.data;
      
      // Update appointment status in the database
      await this.prisma.appointment.update({
        where: { id },
        data: { status: AppointmentStatus.SCHEDULED },
      });
      
      // Notify via WebSocket
      this.notifyAppointmentUpdate(job.data, AppointmentStatus.SCHEDULED);
      
      this.logger.log(`Appointment ${id} created and scheduled successfully`);
      return { success: true, appointmentId: id, status: AppointmentStatus.SCHEDULED };
    } catch (error) {
      this.logger.error(`Error processing create appointment job: ${error.message}`, error.stack);
      // For critical errors, we might want to notify system admins
      this.notifyCriticalError(job.data, error);
      throw error; // Rethrow to trigger job retry
    }
  }

  @Process(JobType.CONFIRM)
  async processConfirmJob(job: Job<AppointmentJobData>) {
    try {
      this.logger.log(`Processing confirm appointment job ${job.id}`);
      const { id } = job.data;
      
      // Update appointment status in database
      await this.prisma.appointment.update({
        where: { id },
        data: { status: AppointmentStatus.CONFIRMED },
      });
      
      // Notify via WebSocket
      this.notifyAppointmentUpdate(job.data, AppointmentStatus.CONFIRMED);
      
      this.logger.log(`Appointment ${id} confirmed successfully`);
      return { success: true, appointmentId: id, status: AppointmentStatus.CONFIRMED };
    } catch (error) {
      this.logger.error(`Error processing confirm appointment job: ${error.message}`, error.stack);
      this.notifyCriticalError(job.data, error);
      throw error; // Rethrow to trigger job retry
    }
  }

  @Process(JobType.COMPLETE)
  async processCompleteJob(job: Job<AppointmentJobData>) {
    try {
      this.logger.log(`Processing complete appointment job ${job.id}`);
      const { id } = job.data;
      
      // Update appointment status in database
      await this.prisma.appointment.update({
        where: { id },
        data: { status: AppointmentStatus.COMPLETED },
      });
      
      // Notify via WebSocket
      this.notifyAppointmentUpdate(job.data, AppointmentStatus.COMPLETED);
      
      this.logger.log(`Appointment ${id} marked as completed`);
      return { success: true, appointmentId: id, status: AppointmentStatus.COMPLETED };
    } catch (error) {
      this.logger.error(`Error processing complete appointment job: ${error.message}`, error.stack);
      this.notifyCriticalError(job.data, error);
      throw error; // Rethrow to trigger job retry
    }
  }

  @Process(JobType.NOTIFY)
  async processNotifyJob(job: Job<AppointmentJobData>) {
    try {
      this.logger.log(`Processing notification job ${job.id}`);
      const { id, userId, metadata } = job.data;
      
      if (!userId) {
        this.logger.warn(`No userId provided for notification job ${job.id}`);
        return { success: false, error: 'No userId provided' };
      }
      
      // Send real-time notification via WebSocket
      this.socketService.sendToUser(userId, 'appointmentNotification', {
        appointmentId: id,
        title: metadata?.title || 'Appointment Update',
        message: metadata?.message || 'You have an update for your appointment',
        data: { ...job.data }
      });
      
      // Here you would integrate with FCM for push notifications
      // await this.fcmService.sendNotification({
      //   userId,
      //   title: metadata?.title || 'Appointment Update',
      //   body: metadata?.message || 'Your appointment status has been updated',
      //   data: { appointmentId: id },
      // });
      
      this.logger.log(`Notification sent for appointment ${id}`);
      return { success: true, appointmentId: id };
    } catch (error) {
      this.logger.error(`Error processing notification job: ${error.message}`, error.stack);
      // For notification errors, we might not want to retry indefinitely
      if (job.attemptsMade >= 3) {
        this.logger.warn(`Notification delivery failed after ${job.attemptsMade} attempts. Abandoning.`);
        return { success: false, error: error.message };
      }
      throw error; // Rethrow to trigger job retry
    }
  }

  /**
   * Notify all relevant parties about an appointment update
   */
  private notifyAppointmentUpdate(data: AppointmentJobData, status: AppointmentStatus) {
    try {
      const { id, userId, doctorId, locationId } = data;
      
      const updateData = {
        appointmentId: id,
        status,
        message: `Appointment status updated to ${status}`,
        timestamp: new Date().toISOString()
      };
      
      // Send to user
      if (userId) {
        this.socketService.sendToUser(userId, 'appointmentUpdate', updateData);
      }
      
      // Send to doctor
      if (doctorId) {
        this.socketService.sendToResource('doctor', doctorId, 'appointmentUpdate', updateData);
      }
      
      // Send to location staff
      if (locationId) {
        this.socketService.sendToLocation(locationId, 'appointmentUpdate', updateData);
      }
    } catch (error) {
      this.logger.error(`Failed to send WebSocket notification: ${error.message}`, error.stack);
    }
  }

  /**
   * Notify system administrators about critical errors
   */
  private notifyCriticalError(data: AppointmentJobData, error: any) {
    try {
      const { id, locationId } = data;
      
      // Only notify for locationId if it exists
      if (locationId) {
        this.socketService.sendToLocation(locationId, 'systemAlert', {
          type: 'error',
          source: 'appointment-processor',
          message: `Failed to process appointment ${id}: ${error.message}`,
          timestamp: new Date().toISOString()
        });
      }
      
      // You could also log to a monitoring system here
    } catch (err) {
      this.logger.error(`Failed to send error notification: ${err.message}`, err.stack);
    }
  }
} 